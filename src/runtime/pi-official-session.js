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
export async function createNightOfficialSession({ctx,store,resolved,agentDir,registry,maxParallelToolCalls,admission,createAudit,settingsManager,context={},beforeRequest,prepareActor,beforeStoreClose,resolveResources,deferResources=false}) {
 if(store?.kind!=='pi-native'||!admission||typeof createAudit!=='function')throw new TypeError('Explicit native store and business admission required')
 const actorAdmission=Object.fromEntries(['enqueue','has','status','lookupPacket','pending','current'].filter(key=>typeof admission[key]==='function').map(key=>[key,admission[key].bind(admission)]))
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
 let session,imageBudget
 try {
  // Initial permission selection in application setup must see its exact
  // approval capability, before any scoped resource is resolved or tool copied.
  await prepareActor?.(actor)
  if(resolveResources){
   const resources=await resolveResources(actor)
   if(!resources||typeof resources!=='object')throw new TypeError('Explicit official resources required')
   ;({resolved,agentDir,registry,maxParallelToolCalls,settingsManager,context={}}=resources)
  }
  if(!resolved?.modelRuntime||!agentDir||!registry||!settingsManager)throw new TypeError('Explicit model, settings, resources and registry required')
  tools=createPiOfficialTools({registry,owner:actor,businessAudit:audit,maxParallelToolCalls})
  const bridge=createNightOfficialContext({...context,cwd:store.header.cwd,agentDir,getActor:()=>actor,settingsManager})
  await bridge.resourceLoader.reload()
  ;({session}=await createAgentSession({cwd:store.header.cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager,resourceLoader:bridge.resourceLoader,sessionManager:store.manager,noTools:'builtin',tools:tools.customTools.map(tool=>tool.name),customTools:tools.customTools}))
  actor.piSession=session
  session.agent.toolExecution='parallel'
  if(resolved.requestImageLimitsFor)imageBudget=bindPiRequestImageBudget({session,getLimits:resolved.requestImageLimitsFor})
  const stream=session.agent.streamFunction
  session.agent.streamFunction=(model,request,options)=>{
   const configured=resolved.requestOptions??{}
   // Pi clamps output to its remaining context budget before dispatch. A lower
   // application cap may reduce that value, but must never increase it again.
   const maxTokens=configured.maxTokens===undefined?options?.maxTokens:Math.min(configured.maxTokens,options?.maxTokens??configured.maxTokens)
   return stream(model,request,{...options,...configured,...maxTokens===undefined?{}:{maxTokens}})
  }
  durability=bindOfficialDurability({session,store,tools,beforeStoreClose:()=>beforeStoreClose?.(actor),beforeRequest:async(...args)=>{if(failure)throw failure;await beforeRequest?.(actor,...args);if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure}})
  tools.bindContextDelivery(createOfficialToolContextDelivery({session,actor,fence}))
  if(!deferResources){await bridge.refreshResources();await bridge.resourceLoader.reload()}
  return {actor,session,tools,bridge,durability,get requestImageFailure(){return imageBudget?.failure},
   async deliver(packetId,options){
    if(typeof admission.deliver!=='function')throw new TypeError('Durable business delivery capability required')
    if(!session.isStreaming)tools.beginTurn()
    await bridge.refreshResources();await bridge.resourceLoader.reload()
    const result=await admission.deliver(session,packetId,options)
    if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure
    if(durability.failure)throw durability.failure
    if(durability.requestFailure)throw durability.requestFailure
    if(failure)throw failure
    return result
   },
   async prompt(...args){
    tools.beginTurn()
    await bridge.refreshResources();await bridge.resourceLoader.reload()
    await session.prompt(...args)
    // The official extension runner reports and absorbs handler exceptions.
    // Aborting protects dispatch; returning the typed reason protects the UI.
    if(imageBudget?.failure)throw imageBudget.failure
    if(bridge.policyFailure)throw bridge.policyFailure
    if(durability.failure)throw durability.failure
    if(durability.requestFailure)throw durability.requestFailure
    if(failure)throw failure
   },
   async close(){await durability.close();imageBudget?.close();unbindApproval()},
  }
 }catch(cause){
  unbindApproval();imageBudget?.close();await session?.abort();await tools?.close();session?.dispose()
  // No SDK execution has been admitted during construction. Preserve any
  // independently owned store for its caller to inspect and close explicitly.
  throw cause
 }
}
