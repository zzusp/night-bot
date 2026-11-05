import {createAgentSession} from '@earendil-works/pi-coding-agent'
import {createPiOfficialTools} from './pi-official-tools.js'
import {createNightOfficialContext} from './pi-official-context.js'
import {bindOfficialDurability} from './pi-official-durability.js'
import {bindApprovalAudit} from '../native-approval.js'

/** Assemble official SDK components with explicit application capabilities.
 * No global/home resources, alternate message model or model loop is installed.
 * The application must durably admit work before calling session.prompt/steer.
 */
export async function createNightOfficialSession({ctx,store,resolved,agentDir,registry,maxParallelToolCalls,admission,createAudit,settingsManager,context={},beforeRequest}) {
 if(store?.kind!=='pi-native'||!resolved?.modelRuntime||!agentDir||!admission||!settingsManager||typeof createAudit!=='function')throw new TypeError('Explicit native store, model, settings, resources and business admission required')
 const actor={id:store.id,ctx,admission,piSession:undefined}
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
 let session
 try {
  tools=createPiOfficialTools({registry,owner:actor,businessAudit:audit,maxParallelToolCalls})
  const bridge=createNightOfficialContext({...context,cwd:store.header.cwd,agentDir,getActor:()=>actor,settingsManager})
  await bridge.resourceLoader.reload()
  ;({session}=await createAgentSession({cwd:store.header.cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager,resourceLoader:bridge.resourceLoader,sessionManager:store.manager,noTools:'builtin',tools:tools.customTools.map(tool=>tool.name),customTools:tools.customTools}))
  actor.piSession=session
  session.agent.toolExecution='parallel'
  const stream=session.agent.streamFunction
  session.agent.streamFunction=(model,request,options)=>{
   const configured=resolved.requestOptions??{}
   // Pi clamps output to its remaining context budget before dispatch. A lower
   // application cap may reduce that value, but must never increase it again.
   const maxTokens=configured.maxTokens===undefined?options?.maxTokens:Math.min(configured.maxTokens,options?.maxTokens??configured.maxTokens)
   return stream(model,request,{...options,...configured,...maxTokens===undefined?{}:{maxTokens}})
  }
  durability=bindOfficialDurability({session,store,tools,beforeRequest:async(...args)=>{if(failure)throw failure;await beforeRequest?.(actor,...args);if(bridge.policyFailure)throw bridge.policyFailure}})
  await bridge.refreshResources();await bridge.resourceLoader.reload()
  return {actor,session,tools,bridge,durability,
   async prompt(...args){
    tools.beginTurn()
    await bridge.refreshResources();await bridge.resourceLoader.reload()
    await session.prompt(...args)
    // The official extension runner reports and absorbs handler exceptions.
    // Aborting protects dispatch; returning the typed reason protects the UI.
    if(bridge.policyFailure)throw bridge.policyFailure
    if(durability.failure)throw durability.failure
    if(failure)throw failure
   },
   async close(){await durability.close();unbindApproval()},
  }
 }catch(cause){
  unbindApproval();await session?.abort();await tools?.close();session?.dispose()
  // No SDK execution has been admitted during construction. Preserve any
  // independently owned store for its caller to inspect and close explicitly.
  throw cause
 }
}
