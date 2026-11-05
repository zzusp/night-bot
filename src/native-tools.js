import {nativeCodeTransport} from './native-code-transport.js'
import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeOf,scopeChainOf,scopeTarget} from './native-scope.js'
import {snapshotJsonValue,deepFreeze} from './native-values.js'
import {HarnessError} from './native-llm-protocol.js'
import {assertObjectJsonSchema,assertSupportedJsonSchema,ToolArgsError,validateJsonSchemaValue,ToolNotFoundError,ToolOutputError,TOOL_RUNTIME_SCHEDULER,renderToolsSdk,renderToolsSdkPy} from './native-tool-protocol.js'
const errorText=error=>{try{return typeof error?.message==='string'?error.message:String(error)}catch{return'Unprintable tool failure'}}
const snapshot=value=>{const result=snapshotJsonValue(value);if(result===undefined)throw new TypeError('Tool values must be lossless JSON');return result}
const failure=error=>{const message=errorText(error);let info;try{if(error instanceof HarnessError){const name=error.name,code=error.code;if(typeof name==='string'&&typeof code==='string')info={name,code}}}catch{}return{isError:true,content:[{type:'text',text:'Error: '+message}],error:{message,...info?{info}:{}}}}
const aborted=(started,prior)=>({isError:true,content:[{type:'text',text:started?'Error: tool call aborted':'Error: tool call aborted before dispatch'}],error:{message:started?'tool call aborted':'tool call aborted before dispatch',info:{name:'AbortError',code:started?'ABORTED':'ABORTED_BEFORE_DISPATCH'}},...prior?.additionalContexts?.length?{additionalContexts:prior.additionalContexts}:{}})
const layer=()=>({tools:new Map(),restrictions:new Set(),guards:new Set(),mode:undefined})
function fusedSignals(caller,wrapper){
 if(caller===wrapper)return{signal:caller,close:()=>{}}
 const controller=new AbortController();let attached=false
 const close=()=>{if(!attached)return;attached=false;caller.removeEventListener('abort',fromCaller);wrapper.removeEventListener('abort',fromWrapper)}
 const relay=signal=>{controller.abort(signal.reason);close()},fromCaller=()=>relay(caller),fromWrapper=()=>relay(wrapper)
 if(wrapper.aborted)relay(wrapper);else if(caller.aborted)relay(caller);else{attached=true;caller.addEventListener('abort',fromCaller,{once:true});wrapper.addEventListener('abort',fromWrapper,{once:true})}
 return{signal:controller.signal,close}
}
/** Application-owned registry and execution pipeline. Scope/event carrier and
 * schema helper compatibility is explicit while those generic seams migrate.
 * Native calls and the optional code transport share this policy pipeline.
 */
export default class NativeTools extends Service {
 static inject=['systemPrompt']
 static Config=z.object({mode:z.union(['native','ptc']).default('native'),maxParallelSubCalls:z.natural().min(1).default(10)})
 constructor(ctx,config={}){
  super(ctx,'tools');this.config={mode:'native',maxParallelSubCalls:10,...config};if(!['native','ptc'].includes(this.config.mode)||!Number.isInteger(this.config.maxParallelSubCalls)||this.config.maxParallelSubCalls<1)throw new TypeError('Invalid native tool runtime configuration');this.global=layer();this.scoped=new Map();this.states=new WeakMap();this.canonical=new WeakMap();this.contracts=new WeakMap()
  ctx.systemPrompt.tools(context=>this.wireSchemas(context.scope))
  if(this.config.mode!=='native'){ctx.systemPrompt.section(this.collapseSection());ctx.systemPrompt.section(this.sdkSection())}
  this[TOOL_RUNTIME_SCHEDULER]={prepare:input=>this.prepare(input),dispatch:exec=>this.dispatch(exec),finalize:(exec,result)=>this.finalize(exec,result),finish:(exec,result)=>this.finish(exec,result)}
 }
 chain(scope){return scope===undefined?[]:scopeChainOf(scope).reverse().map(key=>this.scoped.get(key)).filter(Boolean)}
 mutate(action,{notify=true}={}){
  const context=this.ctx,scope=scopeOf(context),empty=target=>!target.tools.size&&!target.restrictions.size&&!target.guards.size&&target.mode===undefined
  return context.effect(function*(){
   let target=this.global,created=false
   if(scope!==undefined){target=this.scoped.get(scope);if(!target){target=layer();this.scoped.set(scope,target);created=true}}
   let undo;try{undo=action(target)}catch(error){if(created&&empty(target))this.scoped.delete(scope);throw error}
   yield()=>{undo();if(scope!==undefined&&empty(target))this.scoped.delete(scope);if(notify)context.emit('tools/change')}
   if(notify)context.emit('tools/change')
  }.bind(this),'native tools registration')
 }
 register(definition){
  assertObjectJsonSchema(definition.parameters)
  if(definition.name==='run_code')throw new Error('run_code is a reserved transport name')
  if(!definition.output||typeof definition.output.render!=='function'||definition.output.presentationMeta!==undefined&&typeof definition.output.presentationMeta!=='function')throw new TypeError('Tool output schema and render are required')
  assertSupportedJsonSchema(definition.output.schema)
  if(definition.timeoutMs!==undefined&&(!Number.isFinite(definition.timeoutMs)||definition.timeoutMs<=0))throw new TypeError('Tool timeoutMs must be positive')
  // Keep the definition identity: application markers and scoped ownership use it.
  // Captured data contracts belong to the registry and cannot be mutated by authors.
  if(!this.contracts.has(definition)){
   const contract={parameters:deepFreeze(snapshot(definition.parameters)),output:deepFreeze(snapshot(definition.output.schema))}
   // A static domain rejection preserves model-facing correction contracts without
   // calling tool code, an execution wrapper, or an effect/intent barrier.
   if(Object.hasOwn(definition,'argumentRejection')){
    const rejection=deepFreeze(snapshot(definition.argumentRejection))
    if(rejection?.status!=='invalid-arguments'||!Array.isArray(rejection.issues)||!rejection.issues.length||rejection.issues.some(issue=>typeof issue?.code!=='string'||!issue.code))throw new TypeError('argumentRejection must be a static invalid-arguments result with issue codes')
    if(validateJsonSchemaValue(contract.output,rejection).length)throw new TypeError('argumentRejection must satisfy the tool output contract')
    contract.argumentRejection=rejection
   }
   this.contracts.set(definition,contract)
  }
  return this.mutate(target=>{if(target.tools.has(definition.name))throw new Error('Duplicate tool '+definition.name);target.tools.set(definition.name,definition);return()=>{if(target.tools.get(definition.name)===definition)target.tools.delete(definition.name)}})
 }
 view(scope){
  const chain=this.chain(scope),own=scope===undefined?undefined:this.scoped.get(scope),inherited=new Map(this.global.tools)
  for(const item of chain)if(item!==own)for(const entry of item.tools)inherited.set(...entry)
  const visible=new Map(),knownNames=new Set(inherited.keys()),restrictableNames=new Set(inherited.keys())
  for(const [name,definition]of inherited)if(chain.every(item=>[...item.restrictions].every(mask=>(!mask.allow||mask.allow.has(name))&&!mask.deny?.has(name))))visible.set(name,definition)
  if(own)for(const [name,definition]of own.tools){visible.set(name,definition);knownNames.add(name)}
  if(this.modeFor(scope)!=='native')visible.set('run_code',this.requireCodeTransport())
  return{visible,knownNames,restrictableNames}
 }
 get(name,scope){return this.view(scope).visible.get(name)}
 restrict(filter){
  const scope=scopeOf(this.ctx);if(scope===undefined)throw new Error('Tool restrictions require an agent scope')
  if(filter.allow===undefined&&filter.deny===undefined)throw new Error('Empty tool restriction')
  const names=[...filter.allow??[],...filter.deny??[]],known=this.view(scope).restrictableNames
  if(names.some(name=>name==='run_code'||!known.has(name)))throw new Error('Tool restriction names unknown or reserved capabilities')
  const mask={...filter.allow===undefined?{}:{allow:new Set(filter.allow)},...filter.deny===undefined?{}:{deny:new Set(filter.deny)}}
  return this.mutate(target=>{target.restrictions.add(mask);return()=>target.restrictions.delete(mask)})
 }
 guard(guard){const registration={check:guard};return this.mutate(target=>{target.guards.add(registration);return()=>target.guards.delete(registration)},{notify:false})}
 guardReason(exec){for(const item of [this.global,...this.chain(exec.agent)])for(const guard of item.guards){const reason=guard.check(exec);if(reason!==undefined)return reason}}
 modeFor(scope){const chain=this.chain(scope);for(let index=chain.length-1;index>=0;index--)if(chain[index].mode!==undefined)return chain[index].mode;return this.config.mode}
 presentAs(mode){
  if(!['native','ptc'].includes(mode)||scopeOf(this.ctx)===undefined)throw new Error('Presentation requires a valid scoped mode')
  const context=this.ctx
  return context.effect(function*(){
   yield this.mutate(target=>{if(target.mode!==undefined)throw new Error('Presentation is already declared for this scope');target.mode=mode;return()=>{target.mode=undefined}})
   if(mode!=='native'){yield context.systemPrompt.section(this.collapseSection());yield context.systemPrompt.section(this.sdkSection())}
  }.bind(this),'native tools presentation')
 }
 requirePtcRuntime(){const runtime=this.ctx.get('ptcRuntime');if(!runtime)throw new Error('PTC presentation requires a mounted ptcRuntime');if(!['typescript','python'].includes(runtime.language))throw new Error('Unsupported code runtime language');return runtime}
 requireCodeTransport(){return this.codeTransport??=nativeCodeTransport(this)}
 collapseSection(){return{name:'tools:ptc-only',order:this.ctx.systemPrompt.getSectionOrder('PTC_ONLY'),text:context=>this.modeFor(context.scope)==='ptc'?'run_code is the only directly callable tool. Reach declared capabilities through the generated tools API.':''}}
 sdkSection(){return{name:'tools:sdk',order:this.ctx.systemPrompt.getSectionOrder('TOOLS_SDK'),interpolate:false,text:context=>{if(this.modeFor(context.scope)==='native')return'';const runtime=this.requirePtcRuntime();return(runtime.language==='python'?renderToolsSdkPy:renderToolsSdk)(this.sdkSchemas(context.scope))}}}
 async shapeDispatchLog(dispatch){try{return await this.ctx.waterfall(scopeTarget(this,dispatch.agent),'tools/ptc-dispatch-log',dispatch,()=>Promise.resolve(dispatch.content))}catch(error){this.ctx.logger.warn(errorText(error));return dispatch.content}}

 schemaOf(definition,detach=true){const{name,description,deferLoading}=definition,parameters=this.contracts.get(definition)?.parameters??definition.parameters;return{name,description,parameters:detach?snapshot(parameters):parameters,...deferLoading===true?{deferLoading:true}:{}}}
 schemas(scope){return[...this.view(scope).visible.values()].map(d=>this.schemaOf(d))}
 sdkSchemas(scope){return[...this.view(scope).visible.values()].filter(d=>d.name!=='run_code').map(d=>({...this.schemaOf(d),output:snapshot(this.contracts.get(d)?.output??d.output.schema)}))}
 wireSchemas(scope){if(this.modeFor(scope)!=='native')this.requirePtcRuntime();const view=this.view(scope);return{schemas:[...view.visible.values()].filter(d=>this.modeFor(scope)==='native'||d.name==='run_code').map(d=>this.schemaOf(d,false)),knownNames:this.modeFor(scope)==='native'?[...view.knownNames]:['run_code']}}
 resolveExecution(name,scope,nested){if(this.modeFor(scope)==='ptc'&&!nested&&name!=='run_code')return;return this.get(name,scope)}
 executionMode(exec){const tool=this.resolveExecution(exec.name,exec.agent,exec.parent!==undefined);try{return{kind:tool?.isConcurrencySafe?.(exec.arguments)===true?'parallel':'exclusive'}}catch{return{kind:'exclusive'}}}
 materialize(result){
  const presentation={isError:result.isError===true,content:result.content,...result.meta===undefined?{}:{meta:result.meta},...result.additionalContexts===undefined?{}:{additionalContexts:result.additionalContexts}}
  if(result.isError)return deepFreeze(snapshot({...presentation,error:result.error}))
  return deepFreeze({...deepFreeze(snapshot({...presentation,...result.concludesTurn===true?{concludesTurn:true}:{}})),value:result.value})
 }
 mark(exec,result){this.canonical.set(result,exec.token);return result}
 success(exec,definition,candidate){
  let value;try{value=deepFreeze(snapshot(candidate))}catch(error){throw new ToolOutputError(definition.name,[errorText(error)])}
  const errors=validateJsonSchemaValue(this.contracts.get(definition)?.output??definition.output.schema,value,'value');if(errors.length)throw new ToolOutputError(definition.name,errors)
  let content,meta;try{content=snapshot(definition.output.render(exec.arguments,value));if(definition.output.presentationMeta)meta=snapshot(definition.output.presentationMeta(exec.arguments,value))}catch(error){throw new ToolOutputError(definition.name,[errorText(error)])}
  return this.mark(exec,this.materialize({isError:false,value,content,...meta===undefined?{}:{meta},...this.states.get(exec).concluded?{concludesTurn:true}:{}}))
 }
 async ask(exec,gate){
  const approval=this.ctx.get('approval')
  if(!approval||!exec.agent)return{kind:'deny',reason:gate.reason??`tool "${exec.name}" requires approval (not yet supported)`}
  const outcome=await approval.request({agent:exec.agent,toolName:exec.name,callId:exec.callId,...gate.reason?{reason:gate.reason}:{},...gate.displayReason?{displayReason:gate.displayReason}:{},signal:exec.signal})
  if(outcome==='allowed-once')return{kind:'allow'}
  if(!['rejected','cancelled','unavailable'].includes(outcome))throw new Error('Unknown approval outcome')
  return{kind:'deny',approvalCancelled:outcome==='cancelled',reason:outcome==='rejected'?`the user rejected tool "${exec.name}"`:outcome==='cancelled'?`approval for tool "${exec.name}" was cancelled`:`tool "${exec.name}" requires approval, but no approval channel is available`}
 }
 executionIdentity(exec){
  const state=this.states.get(exec),identity=state?.identity
  if(!identity||!state.started||state.finished||state.callerSignal.aborted||exec.signal.aborted
    ||exec.token!==identity.token||exec.agent!==identity.agent||exec.callId!==identity.callId||exec.rootCallId!==identity.rootCallId
    ||exec.name!==identity.name||exec.arguments!==state.arguments)return
  return Object.freeze({callId:identity.callId,rootCallId:identity.rootCallId,name:identity.name,owner:identity.agent?.id})
 }
 async prepare(input){
  const state={callerSignal:input.signal,started:false,deferred:[],concluded:false},definition=this.get(input.name,input.agent)
  const exec={token:Symbol('night.tool.execution'),callId:input.callId,rootCallId:input.rootCallId??input.callId,name:input.name,signal:input.signal,...input.agent===undefined?{}:{agent:input.agent},...input.parent===undefined?{}:{parent:input.parent},...input.schema===undefined?{}:{schema:input.schema},deferContext:context=>state.deferred.push(context),concludeTurn:()=>{state.concluded=true}}
  const collapsed=this.modeFor(input.agent)==='ptc'&&input.parent===undefined&&input.name!=='run_code'
  state.finalizer=collapsed&&!input.signal.aborted?undefined:definition?.finalizeContent?.bind(definition);state.projector=collapsed?undefined:definition?.projectContent?.bind(definition);this.states.set(exec,state)
  try{
   exec.arguments=deepFreeze(snapshot(input.arguments));state.arguments=exec.arguments;state.identity={token:exec.token,agent:exec.agent,callId:exec.callId,rootCallId:exec.rootCallId,name:exec.name}
   // Middleware may wrap cancellation, but cannot replace the admitted capability,
   // owner, RPC parent or captured parameters before an effect.
   for(const key of ['token','agent','callId','rootCallId','name','arguments','parent','schema'])Object.defineProperty(exec,key,{value:exec[key],writable:false,configurable:false,enumerable:Object.hasOwn(exec,key)})
   if(state.callerSignal.aborted)return{kind:'final-result',exec,result:aborted(false)}
   if(this.modeFor(exec.agent)==='ptc'&&exec.parent===undefined&&exec.name!=='run_code')return{kind:'final-result',exec,result:failure(new ToolNotFoundError(exec.name,'use run_code instead'))}
   let gate=await this.ctx.waterfall(scopeTarget(this,exec.agent),'tools/pre-execute',exec,()=>Promise.resolve({kind:'allow'}))
   if(gate.kind==='ask')gate=await this.ask(exec,gate)
   if(!['allow','deny','cancel'].includes(gate?.kind)||gate.kind==='deny'&&typeof gate.reason!=='string')throw new TypeError('Invalid tool admission decision')
   if(gate.kind==='cancel'||state.callerSignal.aborted&&gate.approvalCancelled)return{kind:'post-result',exec,result:aborted(false)}
   const denial=gate.kind==='allow'?this.guardReason(exec):gate.reason
   if(denial!==undefined)return{kind:'post-result',exec,result:{isError:true,content:[{type:'text',text:'Error: '+denial}],error:{message:denial,...gate.info===undefined?{}:{info:gate.info}}}}
   if(state.callerSignal.aborted)return{kind:'post-result',exec,result:aborted(false)}
   const admitted=this.resolveExecution(exec.name,exec.agent,exec.parent!==undefined)
   if(!admitted)throw new ToolNotFoundError(exec.name)
   const violations=validateJsonSchemaValue(this.contracts.get(admitted)?.parameters??admitted.parameters,exec.arguments,'')
   if(violations.length){
    const rejection=this.contracts.get(admitted)?.argumentRejection
    if(rejection!==undefined)return{kind:'post-result',exec,result:this.success(exec,admitted,rejection)}
    throw new ToolArgsError(violations)
   }
   return{kind:'dispatch',exec}
  }catch(error){return{kind:'final-result',exec,result:failure(error)}}
 }
 async body(exec){
  const state=this.states.get(exec),wrapper=exec.signal,fused=fusedSignals(state.callerSignal,wrapper),signal=fused.signal
  if(signal.aborted){fused.close();return aborted(false)}
  exec.signal=signal
  try{const definition=this.resolveExecution(exec.name,exec.agent,exec.parent!==undefined);if(!definition)throw new ToolNotFoundError(exec.name);state.started=true;const result=this.success(exec,definition,await definition.execute(exec.arguments,exec));return signal.aborted?aborted(true,result):result}catch(error){return failure(error)}finally{fused.close();exec.signal=wrapper}
 }
 normalize(exec,result){if(this.canonical.get(result)===exec.token)return result;if(result.isError)return this.mark(exec,{isError:true,error:result.error,content:result.content,...result.meta===undefined?{}:{meta:result.meta},...result.additionalContexts===undefined?{}:{additionalContexts:result.additionalContexts}});const definition=this.resolveExecution(exec.name,exec.agent,exec.parent!==undefined);if(!definition)throw new ToolNotFoundError(exec.name);return this.mark(exec,{...this.success(exec,definition,result.value),...result.additionalContexts===undefined?{}:{additionalContexts:result.additionalContexts}})}
 async flushSession(agent){const sessions=this.ctx.get('sessions');if(agent&&sessions)await sessions.flush(agent.session)}
 async dispatch(exec){try{await this.flushSession(exec.agent);const state=this.states.get(exec);if(state.callerSignal.aborted)return{kind:'post-result',result:aborted(false)};const raw=await this.ctx.waterfall(scopeTarget(this,exec.agent),'tools/execute',exec,()=>this.body(exec));let result=this.normalize(exec,raw);if(state.deferred.length)result=this.mark(exec,{...result,additionalContexts:[...state.deferred,...result.additionalContexts??[]]});if(state.callerSignal.aborted&&!result.isError)result=aborted(state.started,result);return{kind:'post-result',result}}catch(error){return{kind:'final-result',result:failure(error)}}}
 async finalize(exec,candidate){
  try{
   const state=this.states.get(exec),project=state.projector;state.projector=undefined
   let result=candidate
   if(project){const content=project(exec,result);if(content!==undefined)result=this.mark(exec,this.materialize({...result,content}))}
   const decision=await this.ctx.waterfall(scopeTarget(this,exec.agent),'tools/post-execute',exec,result,()=>Promise.resolve({kind:'accept'}))
   if(!['accept','block'].includes(decision?.kind))throw new TypeError('Invalid tool post-execute decision')
   if(decision.kind==='block')result={isError:true,content:decision.feedback,error:{message:decision.feedback.map(b=>b.type==='text'?b.text:`[${b.type} content]`).join('\n')||'tool result blocked by post-execute policy'},...decision.additionalContexts?.length?{additionalContexts:decision.additionalContexts}:{}}
   else{
    if(Object.hasOwn(decision,'content')&&Object.hasOwn(decision,'value'))throw new TypeError('Post policy cannot replace both value and content')
    const contexts=[...result.additionalContexts??[],...decision.additionalContexts??[]]
    if(Object.hasOwn(decision,'value')){if(result.isError)throw new TypeError('Post policy cannot replace a failed value');const definition=this.resolveExecution(exec.name,exec.agent,exec.parent!==undefined);if(!definition)throw new ToolNotFoundError(exec.name);result=this.success(exec,definition,decision.value)}
    result={...result,...decision.content===undefined?{}:{content:decision.content},...contexts.length?{additionalContexts:contexts}:{}}
   }
   if(state.callerSignal.aborted&&!result.isError)result=aborted(state.started,result)
   return this.finish(exec,result)
  }catch(error){return this.finish(exec,failure(error))}
 }
 finish(exec,candidate){
  let result
  try{result=this.materialize(candidate);const finalize=this.states.get(exec)?.finalizer;if(finalize){const content=finalize(exec,result);if(content!==undefined)result=this.materialize({...result,content})}}catch(error){result=this.materialize(failure(error))}
  const state=this.states.get(exec);if(state)state.finished=true
  Object.freeze(exec)
  for(const callback of this.ctx.events.dispatch('emit',[scopeTarget(this,exec.agent),'tools/result',exec,result]))try{Promise.resolve(callback(exec,result)).catch(error=>this.ctx.logger.warn(errorText(error)))}catch(error){this.ctx.logger.warn(errorText(error))}
  return result
 }
 async execute(input){const prepared=await this.prepare(input);if(prepared.kind==='final-result')return this.finish(prepared.exec,prepared.result);if(prepared.kind==='post-result')return this.finalize(prepared.exec,prepared.result);const outcome=await this.dispatch(prepared.exec);return outcome.kind==='post-result'?this.finalize(prepared.exec,outcome.result):this.finish(prepared.exec,outcome.result)}
}
