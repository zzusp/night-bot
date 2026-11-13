import {skillCommand} from './pi-skill-command-input.js'
import {bindBusinessTurnYield} from './pi-business-turn-yield.js'
import {bindPiToolCallBatchGuard} from './pi-tool-call-batch.js'
import {bindPiRequestImageBudget} from './pi-request-image-budget.js'
import {createAgentSession} from '@earendil-works/pi-coding-agent'
import {createPiOfficialTools,createOfficialToolContextDelivery} from './pi-official-tools.js'
import {createNightOfficialContext} from './pi-official-context.js'
import {bindOfficialDurability} from './pi-official-durability.js'
import {bindApprovalAudit} from '../native-approval.js'

/** Assemble official SDK components with explicit application capabilities.
 * No global/home resources, alternate message model or model loop is installed.
 * The application must durably admit work before calling session.prompt/steer.
 */
export async function createNightOfficialSession({ctx,store,resolved,agentDir,registry,maxParallelToolCalls,admission,createAudit,settingsManager,context={},beforeRequest,prepareActor,beforeStoreClose,resolveResources,deferResources=false,onToolResult,measurePhase=(_phase,run)=>run()}) {
 if(store?.kind!=='pi-native'||!admission||typeof createAudit!=='function')throw new TypeError('Explicit native store and business admission required')
 let resumedInput
 const actorAdmission=Object.fromEntries(['enqueue','has','status','lookupPacket','pending','current'].filter(key=>typeof admission[key]==='function').map(key=>[key,admission[key].bind(admission)]))
 const current=actorAdmission.current
 if(current)actorAdmission.current=()=>resumedInput===undefined?current():structuredClone(resumedInput)
 Object.defineProperty(actorAdmission,'paused',{enumerable:true,get:()=>admission.paused});Object.freeze(actorAdmission)
 const actor={id:store.id,ctx,admission:actorAdmission,piSession:undefined}
 Object.defineProperty(actor,'id',{value:store.id,enumerable:true,writable:false,configurable:false})
 const sourceAudit=createAudit(actor)
 if(typeof sourceAudit?.flush!=='function')throw new TypeError('Durable business audit capability required')
 let durability,tools,failure
 const fence=cause=>{failure??=cause;tools?.fence(failure);durability?.fence(failure);return failure}
 // Fix the wrapper before approval captures it. NativeTools converts failures
 // into result messages, so the fence must happen here before that conversion.
 const methods={}
 for(const key of ['isLive','isTurnOpen','approvalPolicy','append']){if(typeof sourceAudit[key]!=='function')throw new TypeError('Business audit requires '+key);methods[key]=(...args)=>Reflect.apply(sourceAudit[key],sourceAudit,args)}
 const audit=Object.freeze({...methods,flush:async()=>{if(failure)throw failure;try{await sourceAudit.flush()}catch(cause){throw fence(cause)}}})
 actor.audit=audit
 const unbindApproval=bindApprovalAudit(actor,audit)
 let session,imageBudget,toolBatchGuard,businessYield
 try {
  // Initial permission selection in application setup must see its exact
  // approval capability, before any scoped resource is resolved or tool copied.
  await measurePhase('session-prepare-actor',()=>prepareActor?.(actor))
  if(resolveResources){
   const resources=await measurePhase('session-resolve-resources',()=>resolveResources(actor))
   if(!resources||typeof resources!=='object')throw new TypeError('Explicit official resources required')
   ;({resolved,agentDir,registry,maxParallelToolCalls,settingsManager,context={}}=resources)
  }
  if(!resolved?.modelRuntime||!agentDir||!registry||!settingsManager)throw new TypeError('Explicit model, settings, resources and registry required')
  tools=createPiOfficialTools({registry,owner:actor,businessAudit:audit,maxParallelToolCalls})
  const bridge=createNightOfficialContext({...context,cwd:store.header.cwd,agentDir,getActor:()=>actor,settingsManager,measurePhase})
  await bridge.reloadResources()
  await measurePhase('session-sdk-create',async()=>{
   ;({session}=await createAgentSession({cwd:store.header.cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager,resourceLoader:bridge.resourceLoader,sessionManager:store.manager,noTools:'builtin',tools:tools.customTools.map(tool=>tool.name),customTools:tools.customTools}))
  })
  actor.piSession=session
  session.agent.toolExecution='parallel'
  toolBatchGuard=bindPiToolCallBatchGuard(session)
  if(resolved.requestImageLimitsFor)imageBudget=bindPiRequestImageBudget({session,getLimits:resolved.requestImageLimitsFor})
  const stream=session.agent.streamFunction
  session.agent.streamFunction=(model,request,options)=>{
   const configured=resolved.requestOptions??{}
   // Pi clamps output to its remaining context budget before dispatch. A lower
   // application cap may reduce that value, but must never increase it again.
   const maxTokens=configured.maxTokens===undefined?options?.maxTokens:Math.min(configured.maxTokens,options?.maxTokens??configured.maxTokens)
   return stream(model,request,{...options,...configured,...maxTokens===undefined?{}:{maxTokens}})
  }
  if(onToolResult!==undefined)businessYield=bindBusinessTurnYield({session,actor,onToolResult,fence})
  durability=bindOfficialDurability({session,store,tools,measurePhase,beforeStoreClose:()=>beforeStoreClose?.(actor),beforeRequest:async(...args)=>{if(failure)throw failure;await beforeRequest?.(actor,...args);if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure}})
  tools.bindContextDelivery(createOfficialToolContextDelivery({session,actor,fence}))
  if(!deferResources){await bridge.refreshResources();await bridge.reloadResources()}
  return {actor,session,tools,bridge,durability,get requestImageFailure(){return imageBudget?.failure},
   async deliver(packetId,options){
    if(typeof admission.deliver!=='function')throw new TypeError('Durable business delivery capability required')
    if(!session.isStreaming)tools.beginTurn()
    // Ordinary packets use sendCustomMessage: refresh at actual before_agent_start.
    // Only slash skills need a current loader before Pi prompt expansion.
    const packet=admission.lookupPacket?.(packetId)
    if(!packet||skillCommand(packet))await measurePhase('resources-deliver',async()=>{await bridge.refreshResources();await bridge.reloadResources()})
    const result=await admission.deliver(session,packetId,options)
    if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure
    if(durability.failure)throw durability.failure
    if(durability.requestFailure)throw durability.requestFailure
    if(failure)throw failure
    return result
   },
   async resumeRouterBatch(packet,beforeStart,afterClaim,supplements=[]){
    tools.beginTurn()
    await bridge.refreshResources();await bridge.reloadResources()
    const proof=await beforeStart()
    // 在官方入口可能触发压缩前，先持久消费原失败 checkpoint；它不是业务输入或授权。
    actor.lifecycle.signal.throwIfAborted()
    await session.sendCustomMessage({customType:'night.router-resume-claim',content:'Host 已领取原 Router 失败回合的显式续办；本控制记录不提供新来源或授权。',display:false,details:proof},{triggerTurn:false})
    await durability.commit()
    await afterClaim(proof)
    // 较新真实输入先耐久接纳但不启动推理，取消/延期必须早于恢复动作可见。
    for(const input of supplements){
     actor.lifecycle.signal.throwIfAborted()
     await admission.enqueue(input)
     await session.sendCustomMessage({customType:'night.business-input',content:input.content,display:false,details:{packetId:input.id,source:input.source}},{triggerTurn:false})
    }
    await admission.beforeRequest()
    resumedInput={id:packet.id,messages:structuredClone([packet,...supplements])}
    try{
     actor.lifecycle.signal.throwIfAborted()
     await session.sendCustomMessage({customType:'night.router-resume-turn',content:'Host 请求继续原已接纳的 Router 批次。沿原历史与当前权限处理未结事件；先统筹后续真实输入中的取消、延期和变更，再决定动作。不执行中断回复中未派发的旧生成调用，不重放已完成动作、不重跑任务；必要动作有持久收据后才结清事件。本控制消息不是用户来源或新授权。',display:false,details:proof},{triggerTurn:true})
     if(imageBudget?.failure)throw imageBudget.failure
     if(bridge.policyFailure)throw bridge.policyFailure
     if(durability.failure)throw durability.failure
     if(durability.requestFailure)throw durability.requestFailure
     if(failure)throw failure
    }finally{resumedInput=undefined}
   },
   async prompt(...args){
    tools.beginTurn()
    await bridge.refreshResources();await bridge.reloadResources()
    await session.prompt(...args)
    // The official extension runner reports and absorbs handler exceptions.
    // Aborting protects dispatch; returning the typed reason protects the UI.
    if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure
    if(durability.failure)throw durability.failure
    if(durability.requestFailure)throw durability.requestFailure
    if(failure)throw failure
   },
   async close(){await durability.close();businessYield?.close();imageBudget?.close();toolBatchGuard?.close();unbindApproval()},
  }
 }catch(cause){
  unbindApproval();businessYield?.close();imageBudget?.close();toolBatchGuard?.close();await session?.abort();await tools?.close();session?.dispose()
  // No SDK execution has been admitted during construction. Preserve any
  // independently owned store for its caller to inspect and close explicitly.
  throw cause
 }
}
