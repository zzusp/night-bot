import {defineTool,parameterSchemaSpecToJsonSchema,CodeRunFailedError,TOOL_RUNTIME_SCHEDULER} from '@deepseek-ai/dsh-tools'
import {nativeEscalationTargets as ESCALATION_TARGETS,approveNativeSandbox as approveEscalation,validateNativeEscalation as validateEscalationArgs} from './native-sandbox-approval.js'
import {snapshotJsonValue,deepFreeze} from './native-values.js'
import { createUserMessage } from './native-message-protocol.js';
const json=value=>{const copy=snapshotJsonValue(value);if(copy===undefined)throw new TypeError('Code tool arguments must be lossless JSON');return copy}
const guidance=' A wider program sandbox requires separate approval for one run. Nested tools retain their own policies. Request wider access only after evidence of a denial and choose the narrowest sufficient mode. Earlier effects may have completed: inspect them before an explicit retry. Programs are never replayed automatically.'
function render(value){
 if(typeof value==='string')return value
 const work=[{kind:'value',value,depth:0,compact:false}],output=[]
 while(work.length){
  const item=work.pop()
  if(item.kind==='text'){output.push(item.text);continue}
  const data=item.value
  if(data===null||typeof data!=='object'){output.push(JSON.stringify(data));continue}
  const array=Array.isArray(data),keys=Object.keys(data),compact=item.compact||(item.depth+1)*2>10
  output.push(array?'[':'{')
  if(!keys.length){output.push(array?']':'}');continue}
  work.push({kind:'text',text:(compact?'':'\n'+'  '.repeat(item.depth))+(array?']':'}')})
  for(let index=keys.length-1;index>=0;index--){
   const key=keys[index]
   work.push({kind:'value',value:data[key],depth:item.depth+1,compact})
   if(!array)work.push({kind:'text',text:JSON.stringify(key)+(compact?':':': ')})
   work.push({kind:'text',text:compact?(index?',':''):(index?',\n':'\n')+'  '.repeat(item.depth+1)})
  }
 }
 return output.join('')
}

/** Ordered admissions/commits with concurrent safe bodies. A program's terminal
 * state stops queued work and waits for all started bodies and audit work.
 */
function dispatchLane(registry,exec,controller,maxParallel){
 const pending=[],commits=[],flights=new Set(),logs=new Set(),auditFailures=[];let exclusive=false,driving,wakeup,sequence=0
 const wake=()=>{wakeup?.();wakeup=undefined}
 async function audit(input,result,logged){
  if(!exec.agent)return
  const details={exec,agent:exec.agent,subCallId:input.callId,name:input.name,isError:result.isError,content:result.content}
  const content=await registry.shapeDispatchLog(details)
  exec.agent.session.append('tool/ptc-dispatch',{rootCallId:exec.rootCallId,parentCallId:exec.callId,subCallId:input.callId,name:input.name,arguments:logged,isError:result.isError,...result.error?.info?{error:result.error.info}:{},content,...result.meta===undefined?{}:{meta:result.meta}})
  await registry.flushSession(exec.agent)
 }
 const pump=()=>{
  if(driving)return driving
  driving=(async()=>{
   for(;;){
    const head=commits[0]
    if(head?.settled){
     commits.shift();let result
     try{const parked=head.parked,scheduler=registry[TOOL_RUNTIME_SCHEDULER];result=parked.kind==='post-result'?await scheduler.finalize(parked.exec,parked.result):scheduler.finish(parked.exec,parked.result)
      if(!result.isError&&result.content.some(block=>block.type==='image'))exec.deferContext(createUserMessage({source:{kind:'ptc-mode'},content:result.content}))
      for(const context of result.additionalContexts??[])exec.deferContext(context)
      if(result.concludesTurn)exec.concludeTurn()
      const work=audit(head.input,result,head.logged).catch(error=>{auditFailures.push(error);controller.abort(error);wake()}).finally(()=>logs.delete(work));logs.add(work)
      if(result.isError)head.reject(new Error(result.error.message));else head.resolve(result.value)
     }catch(error){head.reject(error)}finally{if(head.mode==='exclusive')exclusive=false}
     while(logs.size>maxParallel)await Promise.race(logs)
     continue
    }
    if(pending.length&&controller.signal.aborted){pending.shift().reject(new Error('Code run ended before tool admission'));continue}
    const next=pending[0]
    if(next&&!exclusive){
     const mode=registry.executionMode(next.input).kind
     if(mode==='exclusive'?flights.size===0:flights.size<maxParallel){
      pending.shift();next.mode=mode;exclusive=mode==='exclusive';commits.push(next)
      try{
       exec.agent?.session.append('tool/ptc-dispatch-start',{rootCallId:exec.rootCallId,parentCallId:exec.callId,subCallId:next.input.callId,name:next.input.name,arguments:next.logged})
       const scheduler=registry[TOOL_RUNTIME_SCHEDULER],prepared=await scheduler.prepare(next.input)
       if(prepared.kind==='dispatch'){
        const flight=scheduler.dispatch(prepared.exec).then(outcome=>{next.parked={...outcome,exec:prepared.exec};next.settled=true},error=>{next.parked={kind:'final-result',exec:prepared.exec,result:{isError:true,content:[{type:'text',text:error.message}],error:{message:error.message}}};next.settled=true}).finally(()=>{flights.delete(flight);wake()});flights.add(flight)
       }else{next.parked=prepared;next.settled=true}
      }catch(error){commits.pop();if(mode==='exclusive')exclusive=false;next.reject(error)}
      continue
     }
    }
    if(!pending.length&&!commits.length&&!flights.size)return
    await new Promise(resolve=>{wakeup=resolve})
   }
  })().finally(()=>{driving=undefined;if(pending.length||commits.length)void pump()})
  driving.catch(error=>{controller.abort(error);wake()});return driving
 }
 return{
  submit(schema,args){
   if(controller.signal.aborted){const stopped=Promise.reject(new Error('Code run already ended'));stopped.catch(()=>{});return stopped}
   const dispatched=json(args),logged=json(dispatched),callId=String(exec.callId)+':ptc:'+ ++sequence
   const input={callId,rootCallId:exec.rootCallId,name:schema.name,schema,arguments:dispatched,...exec.agent?{agent:exec.agent}:{},parent:exec.token,signal:controller.signal}
   const promise=new Promise((resolve,reject)=>pending.push({input,logged,resolve,reject,settled:false})).then(value=>{if(controller.signal.aborted)throw new Error('Code run ended; tool result discarded');return value})
   promise.catch(()=>{});wake();void pump();return promise
  },
  async drain(){wake();await pump();while(logs.size)await Promise.allSettled([...logs]);if(auditFailures.length)throw new AggregateError(auditFailures,'Code dispatch audit failed')},
 }
}
export function nativeCodeTransport(registry){
 const peek=()=>{const runtime=registry.ctx.get('ptcRuntime');if(runtime&&!['typescript','python'].includes(runtime.language))throw new Error('Unsupported code runtime language');return runtime}
 const parameters=(forceAll=false)=>{
  const runtime=forceAll?undefined:peek()
  return{description:{type:'string',required:true,description:'A clear description of this program.'},code:{type:'string',required:true,description:'Body of an async '+(runtime?.language==='python'?'Python':'TypeScript')+' function; await and return are available.'},...runtime&&runtime.timeout===undefined?{}:{timeoutMs:{type:'number',description:'Positive elapsed-time budget including nested tools and approval waits.'+(runtime?.timeout?' Default '+runtime.timeout.defaultMs+'; capped at '+runtime.timeout.maxMs+'. Zero does not disable the deadline.':'')}},...runtime&&runtime.sandboxMode===undefined?{}:{sandbox_permissions:{type:'string',enum:[...ESCALATION_TARGETS],description:'Narrowest wider mode for one explicit retry after a sandbox denial; requires justification and approval.'},justification:{type:'string',description:'Why this complete program needs wider access, in the user request language.'}}}
 }
 const definition=defineTool({name:'run_code',description:'Run an asynchronous program using the declared tools.',parameters:parameters(true),output:{schema:{type:'object',additionalProperties:false,properties:{logs:{type:'array',required:true,items:{type:'string'}},result:{type:'json'},sandbox:{type:'object',additionalProperties:false,properties:{mode:{type:'string',required:true,enum:['read-only','workspace-write','danger-full-access']},denied:{type:'boolean',required:true},enforcement:{type:'string',enum:['full','partial']}}}}},render:(_args,value)=>[{type:'text',text:[value.logs.join('\n'),value.result===undefined?'':render(value.result),value.sandbox?.enforcement==='partial'?'File sandbox enforcement is partial on this host.':'',value.sandbox?.denied?'The '+value.sandbox.mode+' program sandbox denied an operation.'+guidance:''].filter(Boolean).join('\n')||'(run_code completed with no output)'}]},
  async execute(args,exec){
   if(!args.description.trim())throw new Error('Code program description must not be empty')
   const runtime=registry.requirePtcRuntime();validateEscalationArgs(args.sandbox_permissions,args.justification)
   if(args.timeoutMs!==undefined&&(!runtime.timeout||!Number.isFinite(args.timeoutMs)||args.timeoutMs<=0))throw new Error('Invalid or unsupported program timeout')
   let policy
   if(runtime.sandboxMode!==undefined){const sandbox=registry.ctx.get('sandboxPolicy');if(!sandbox)throw new Error('Code runtime requires sandbox policy');policy=sandbox.resolve(exec.agent?{session:exec.agent.session}:{})}
   if(args.sandbox_permissions!==undefined){if(!policy)throw new Error('Code runtime does not support sandbox escalation');policy={...policy,mode:await approveEscalation({requestedMode:args.sandbox_permissions,justification:args.justification,effectiveMode:policy.mode,subject:'program'},{approver:registry.ctx.get('approval'),agent:exec.agent,callId:exec.callId,toolName:'run_code',signal:exec.signal})}}
   let cwd
   if(exec.agent){const directories=registry.ctx.get('workingDirectory');if(!directories)throw new Error('Code runtime requires workingDirectory');cwd=await directories.ensure(exec.agent,exec.signal)}
   exec.signal.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort(exec.signal.reason);exec.signal.addEventListener('abort',abort,{once:true});if(exec.signal.aborted)abort()
   const lane=dispatchLane(registry,exec,controller,registry.config.maxParallelSubCalls),functions=Object.create(null)
   for(const schema of registry.schemas(exec.agent))if(schema.name!=='run_code')Object.defineProperty(functions,schema.name,{enumerable:true,value:args=>lane.submit(deepFreeze(schema),args)})
   try{
    let result
    try{result=await runtime.run(runtime.resolve({program:args.code,bindings:[{global:'tools',functions,errorClass:{name:'ToolCallError',memberNameProperty:'toolName'}}],signal:controller.signal,...cwd===undefined?{}:{cwd},...policy===undefined?{}:{sandboxPolicy:policy},...args.timeoutMs===undefined?{}:{timeoutMs:args.timeoutMs}}))}finally{controller.abort('Code run settled');await lane.drain()}
    if(result.error)throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}`+(result.logs.length?'\nCaptured output:\n'+result.logs.join('\n'):'')+(result.sandbox?'\nFile sandbox: '+JSON.stringify(result.sandbox):'')+(result.sandbox?.denied?guidance:''))
    return{logs:result.logs,...result.sandbox===undefined?{}:{sandbox:result.sandbox},...result.value===undefined?{}:{result:result.value}}
   }finally{exec.signal.removeEventListener('abort',abort)}
  },
 })
 Object.defineProperty(definition,'parameters',{enumerable:true,get:()=>parameterSchemaSpecToJsonSchema(parameters())})
 Object.defineProperty(definition,'description',{enumerable:true,get:()=>`Execute the body of an async ${peek()?.language==='python'?'Python':'TypeScript'} function. Call declared tools through await tools.name(args), print or return curated output. Image-bearing tool results are attached after the run. Programs start in the Session current directory and keep that initial directory.${peek()?.executionInstructions?' '+peek().executionInstructions:''}${peek()?.sandboxMode===undefined?'':guidance}`})
 return definition
}
