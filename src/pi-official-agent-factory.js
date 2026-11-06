import {sessionNameAuditKinds} from './pi-session-names.js'
import {effectReconciliationAuditKinds} from './tasks/effect-reconciliation.js'
import {installSessionSkillRefresh,skillObservationAuditKinds} from '../packages/dingtalk-core/session-skill-refresh.js'
import {AsyncLocalStorage} from 'node:async_hooks'
import {isDeepStrictEqual} from 'node:util'
import {createScope,scopeTarget} from './native-scope.js'
import {deepFreeze} from './native-values.js'
import {createNightOfficialSession} from './runtime/pi-official-session.js'
import {createBusinessAdmission,admissionAuditKinds} from './runtime/pi-business-admission.js'
import {createNativeBusinessState,nativeBusinessAuditKinds} from './runtime/pi-business-state.js'
import {jobReceiptKinds} from './runtime/job-ledger.js'
import {todoAuditKinds} from './native-tool-todo.js'
import {bindBusinessInputAuthority} from './runtime/pi-business-inputs.js'
import {bindBusinessNotices} from './runtime/pi-business-notices.js'
import {assertPlatformScheduleSource} from './runtime/pi-platform-source.js'
import {bindPiAgentObservation} from './runtime/pi-agent-observation.js'
import {officialRetrySettings} from './runtime/pi-official-settings.js'

const fail=code=>Object.assign(new Error(code),{code})
const mergeKinds=(...sources)=>{
 const result={}
 for(const source of sources)for(const [key,value] of Object.entries(source??{})){
  if(Object.hasOwn(result,key)&&result[key]!==value)throw fail('PI_AUDIT_KIND_CONFLICT')
  result[key]=value
 }
 return result
}
/** Application ownership and lifecycle only. Pi owns messages, queues, retries
 * and inference. No model/history loop or legacy Session facade is installed. */
export class OfficialAgentFactory {
 constructor(ctx,ports={}){
  this.ctx=ctx;this.ports=ports;this.startups=new Set();this.startupCleanupFailures=new Set();this.handles=new Set();this.lifetime=new AbortController();this.closing=undefined;this.startContext=new AsyncLocalStorage();this.executionContext=new AsyncLocalStorage()
  ctx.effect(()=>()=>this.close(),'official agent factory ownership')
 }
 close(){
  if(this.startContext.getStore()===this||this.executionContext.getStore())return Promise.reject(fail('PI_OFFICIAL_FACTORY_CLOSE_REENTRANT'))
  if(this.closing)return this.closing
  this.lifetime.abort(fail('PI_OFFICIAL_FACTORY_CLOSED'))
  return this.closing=(async()=>{
   const stopping=Promise.allSettled([...this.handles].map(handle=>handle.dispose()))
   const starts=await Promise.allSettled([...this.startups])
   const outcomes=[...await stopping,...await Promise.allSettled([...this.handles].map(handle=>handle.dispose()))]
   const errors=outcomes.filter(item=>item.status==='rejected').map(item=>item.reason)
   // Failed construction reports any cleanup failure rather than losing the
   // still-owned lease behind an expected startup cancellation.
   for(const item of starts)if(item.status==='rejected'&&item.reason?.cleanupFailure)errors.push(item.reason.cleanupFailure)
   errors.push(...this.startupCleanupFailures)
   if(errors.length)throw new AggregateError([...new Set(errors)],'Official factory shutdown failed; ownership retained')
  })()
 }
 createAgent(ownerCtx,options){return this.open(ownerCtx,options,'create')}
 resume(ownerCtx,options){return this.open(ownerCtx,options,'resume')}
 open(ownerCtx,options={},mode){
  if(this.lifetime.signal.aborted)return Promise.reject(fail('PI_OFFICIAL_FACTORY_CLOSED'))
  const ownerLifetime=new AbortController()
  let operation,handle
  ownerCtx.effect(()=>async()=>{
   ownerLifetime.abort(fail('PI_OFFICIAL_OWNER_CLOSED'))
   if(this.startContext.getStore()===this)throw fail('PI_OFFICIAL_OWNER_CLOSE_REENTRANT')
   if(operation){try{handle=await operation}catch(error){if(error?.cleanupFailure)throw error.cleanupFailure;return}await handle.dispose()}
  },'official actor ownership')
  const signal=AbortSignal.any([this.lifetime.signal,ownerLifetime.signal,...options.signal?[options.signal]:[]])
  operation=this.startContext.run(this,()=>this.openOwned(ownerCtx,{...options,signal},mode))
  this.startups.add(operation)
  void operation.catch(error=>{if(error?.cleanupFailure)this.startupCleanupFailures.add(error.cleanupFailure)}).finally(()=>this.startups.delete(operation)).catch(()=>{})
  return operation
 }
 async openOwned(ownerCtx,options={},mode){
  options.signal.throwIfAborted()
  const ports=this.ports,backend=ports.store??ownerCtx.get('sessionPersistence')
  const authorize=options.authorizeInput??ports.authorizeInput,drainBusiness=ports.drainBusiness
  if(typeof authorize!=='function'||typeof drainBusiness!=='function'||typeof ports.resolveResources!=='function')throw fail('PI_OFFICIAL_FACTORY_CAPABILITIES_REQUIRED')
  for(const key of ['history','messages','events','seed'])if(Object.hasOwn(options,key))throw fail('PI_OFFICIAL_FACTORY_HISTORY_UNSUPPORTED')
  if(options.parentAgent&&(ownerCtx.agents.get(options.parentAgent.id)!==options.parentAgent||!options.parentAgent.piSession||options.parentAgent.lifecycle?.isLive()!==true||options.parentAgent.lifecycle.signal.aborted))throw fail('PI_OFFICIAL_PARENT_NOT_LIVE')
  const id=mode==='resume'?(options.resumeSessionId??options.sessionId):options.sessionId
  if(typeof id!=='string'||!id)throw fail('PI_OFFICIAL_FACTORY_ID_REQUIRED')
  const auditKinds=mergeKinds(nativeBusinessAuditKinds,admissionAuditKinds,jobReceiptKinds,todoAuditKinds,skillObservationAuditKinds,effectReconciliationAuditKinds,sessionNameAuditKinds,ports.auditKinds,options.auditKinds)
  const metadata=mode==='resume'?undefined:(await ports.createMetadata?.(options.meta??{},options)??options.meta)
  const store=mode==='resume'?await backend.openNative(id,{auditKinds,signal:options.signal}):await backend.createNative({...metadata,version:4,id,createdAt:Date.now(),isSeeded:false},{auditKinds,signal:options.signal})
  let actor,bundle,scope,unbind,unbindInputs,unbindNotices,observer,skillRefresh,detach,published=false,disposed=false,closing=false,cancelled=false,closePromise,maintenance=Promise.resolve(),maintenanceCount=0,maintenanceRestore=false,maintenanceFailed=false,maintenanceReleases=[]
  const cancellationError=fail('PI_OFFICIAL_ACTOR_NOT_LIVE')
  const lifecycle=new AbortController(),deliveryContext=new AsyncLocalStorage(),pending=new Set()
  const requestGuards=new Set()
  const live=()=>!!scope&&!disposed&&(!published||ownerCtx.agents.get(id)===actor)
  const check=()=>{const error=bundle?.durability.failure??bundle?.durability.requestFailure??bundle?.requestImageFailure??bundle?.bridge.policyFailure;if(error)throw error}
  const active=()=>{if(bundle?.durability.failure)throw bundle.durability.failure;if(cancelled)throw cancellationError;if(closing||disposed||!published||!live())throw fail('PI_OFFICIAL_ACTOR_NOT_LIVE')}
  const drain=async(phase)=>{
   // These are actual public SDK and tool-lease joins, independent of a
   // request's business outcome. Failed joins never produce an attestation.
   await bundle.session.agent.waitForIdle();await bundle.tools.drain()
   if(bundle.session.isStreaming||bundle.session.agent.state.isStreaming)throw fail('PI_OFFICIAL_MODEL_DRAIN_UNPROVEN')
   const proof=await drainBusiness(actor,{phase})
   if(!proof||!(proof.processes===0&&proof.jobs===0))throw Object.assign(fail('execution_process_drain_failed'),{executionDrained:false})
   await options.drainBusiness?.(actor,{phase,proof:Object.freeze({...proof,modelIdle:true,toolsIdle:true})})
   return proof
  }
  try{
   if(mode==='resume'&&options.initialReceipts?.length)throw fail('PI_OFFICIAL_RESUME_INITIAL_RECEIPTS_UNSUPPORTED')
   for(const receipt of options.initialReceipts??[])store.appendAudit(receipt)
   await store.commit()
   let publishInternal
   const admission=await createBusinessAdmission({store,authorize:packet=>authorize(packet,actor),authorizeSkillCommand:async(packet,name)=>{
    const authorizeCommand=options.authorizeSkillCommand??ports.authorizeSkillCommand
    if(typeof authorizeCommand!=='function')return false
    await bundle.bridge.refreshResources();await bundle.bridge.resourceLoader.reload()
    return await authorizeCommand(packet,name,actor)===true
   },bindInternal:publish=>{publishInternal=(...args)=>{if(bundle?.durability.failure)throw bundle.durability.failure;return publish(...args)}}})
   const state=await createNativeBusinessState(store,{readOnly:options.readOnly===true})
   bundle=await createNightOfficialSession({ctx:ownerCtx,store,admission,deferResources:true,
    prepareActor:async value=>{
     actor=value;scope=createScope(ownerCtx,actor,{parent:options.parentAgent});actor.ctx=scope.ctx
     Object.defineProperty(actor,'metadata',{value:deepFreeze(structuredClone(store.header)),enumerable:true});actor.options=deepFreeze(Object.fromEntries(['provider','model','reasoningEffort','maxTokens','temperature'].filter(key=>options.agentOptions?.[key]!==undefined).map(key=>[key,options.agentOptions[key]])))
     actor.lifecycle=Object.freeze({signal:AbortSignal.any([lifecycle.signal,options.signal]),isLive:live})
     actor.requestPolicy=Object.freeze({addBeforeRequest(guard){if(typeof guard!=='function')throw new TypeError('Business request guard required');requestGuards.add(guard);return()=>requestGuards.delete(guard)}})
     actor.receipts=Object.freeze({append:receipt=>store.appendAudit(receipt),read:()=>store.readAudit(),readEntries:()=>store.readAuditEntries(),commit:()=>store.commit()})
     unbind=state.bindActor(actor,{isLive:live,admitNotice:async change=>{
      const entry=store.manager.getEntries().findLast(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='directory'&&entry.data.kind==='changed')
      if(!entry)throw fail('PI_DIRECTORY_NOTICE_RECEIPT_REQUIRED')
      await publishInternal({id:`directory:${entry.id}`,source:{kind:'directory-change'},content:`Working directory changed to ${change.cwd}`})
     }})
     actor.ctx.get('tools')?.guard(()=>published&&live()&&!closing&&!cancelled&&!admission.paused?undefined:'Agent is not admitting effects')
     await ports.mount?.(actor.ctx,actor,options)
     await options.setup?.(actor.ctx,actor)
     await ports.prepareTools?.(actor.ctx,actor,options)
     await ownerCtx.serial(scopeTarget(actor,actor),'night/agent-prepare',{agent:actor,signal:options.signal})
     await ports.validatePreparedActor?.(actor,{options,mode})
    },
    resolveResources:async()=>{
     const resources=await ports.resolveResources({actor,options,header:store.header,store,ownerCtx,mode})
     const expected=officialRetrySettings(resources?.resolved?.retrySettings).retry,settings=resources?.settingsManager
     const {provider,...retry}=expected
     if(!settings||!isDeepStrictEqual(settings.getRetrySettings(),retry)||!isDeepStrictEqual(Object.fromEntries(Object.entries(settings.getProviderRetrySettings()).filter(([,value])=>value!==undefined)),provider))throw fail('PI_OFFICIAL_RETRY_SETTINGS_MISMATCH')
     return resources
    },
    createAudit:()=>state.audit({isLive:()=>published&&live(),isTurnOpen:()=>!!actor.piSession?.isStreaming}),
    beforeRequest:async()=>{
     active();await admission.beforeRequest();assertPlatformScheduleSource(actor)
     const jobs=actor.ctx.get('jobs');if(jobs){if(typeof jobs.assertCanRun!=='function')throw fail('PI_JOB_ADMISSION_REQUIRED');await jobs.assertCanRun(actor)}
     await options.beforeRequest?.(actor)
     for(const guard of requestGuards)await guard({actor,signal:lifecycle.signal})
    },
    onToolResult:options.onToolResult,
    beforeStoreClose:async()=>{await ownerCtx.get('sessionNames')?.closeActor(actor);await skillRefresh?.close();if(published)await drain('dispose');await admission.close()},
   })
   actor.options=deepFreeze({...actor.options,...bundle.session.model?{provider:bundle.session.model.provider,model:bundle.session.model.id}:{},reasoningEffort:bundle.session.thinkingLevel})
   Object.defineProperty(actor,'status',{enumerable:true,get:()=>bundle.session.isStreaming?'running':'idle'})
   admission.bindSession(bundle.session,{signal:actor.lifecycle.signal})
   unbindInputs=bindBusinessInputAuthority(actor,{lookupPacket:admission.lookupPacket,lookupCommandEntry:admission.lookupCommandEntry,pending:admission.pending,isLive:live})
   unbindNotices=bindBusinessNotices(actor,{enqueue:publishInternal,isLive:live})
   options.signal.throwIfAborted();await store.commit();detach=ownerCtx.agents.enter(actor,options.parentAgent);published=true
   await ownerCtx.get('sessionNames')?.bind(actor,{automatic:false,...options.sessionNaming})
   skillRefresh=await installSessionSkillRefresh(actor.ctx,actor,{cwd:actor.metadata.cwd,signal:actor.lifecycle.signal})
   await bundle.bridge.refreshResources();await bundle.bridge.resourceLoader.reload()
   observer=bindPiAgentObservation({actor,emit:(owner,record)=>owner.ctx.emit(scopeTarget(owner,owner),'night/agent-observation',owner,record),onError:()=>ownerCtx.logger.warn('Native agent observation could not be recorded')})
   let settled
   const unsubscribe=bundle.session.subscribe(event=>{if(event.type==='agent_start')settled??=Promise.withResolvers();if(event.type==='agent_settled'){settled?.resolve();settled=undefined;void ownerCtx.get('sessionNames')?.settled(actor).catch(()=>ownerCtx.logger.warn('Session name generation failed'))}})
   const whenIdle=async()=>{
    for(;;){await Promise.allSettled([...pending]);await bundle.session.agent.waitForIdle();if(settled)await settled.promise;await bundle.tools.drain();if(!pending.size&&!bundle.session.isStreaming&&!settled)break}
    // Business request rejection remains recorded and is returned by delivery.
    // Explicit cancellation can still truthfully join resources; storage poison
    // is never converted into a successful drain.
    if(cancelled){if(bundle.durability.failure)throw bundle.durability.failure}else check()
   }
   const cancel=async cause=>{
    cancelled=true;lifecycle.abort();admission.pause();const errors=[]
    try{await bundle.session.abort()}catch(error){errors.push(error)}
    try{await whenIdle()}catch(error){if(error!==cancellationError)errors.push(error)}
    try{await admission.cancelPending(typeof cause?.kind==='string'?cause.kind:'user')}catch(error){errors.push(error)}
    try{await ownerCtx.get('schedule')?.cancelAccepted?.(actor)}catch(error){errors.push(error)}
    try{await drain('cancel')}catch(error){errors.push(error)}
    if(errors.length===1)throw errors[0]
    if(errors.length)throw new AggregateError(errors,'Official actor cancellation failed')
   }
   const thisFactory=this
   const handle={actor,agent:actor,session:bundle.session,
    enqueue:packet=>{active();return admission.enqueue(packet)},
    deliver:(packetId,deliveryOptions)=>{
     active();const operation=deliveryContext.run(actor,()=>thisFactory.executionContext.run(actor,()=>bundle.deliver(packetId,deliveryOptions)));pending.add(operation);void operation.finally(()=>pending.delete(operation)).catch(()=>{});return operation
    },whenIdle,cancel,
    runMaintenance(action){
     if(deliveryContext.getStore()===actor)return Promise.reject(fail('PI_MAINTENANCE_REENTRANT'))
     if(typeof action!=='function')return Promise.reject(new TypeError('Maintenance callback required'))
     if(!maintenanceCount){maintenanceRestore=!admission.paused;maintenanceFailed=false;maintenanceReleases=[]}maintenanceCount++;admission.pause()
     const operation=maintenance.then(async()=>{if(closing||disposed)throw fail('PI_OFFICIAL_ACTOR_NOT_LIVE');await bundle.session.abort();await whenIdle();const proof=await drain('maintenance');if(proof.resume)maintenanceReleases.push(proof.resume);const result=await thisFactory.executionContext.run(actor,()=>action(actor));await store.commit();return result})
     maintenance=operation.catch(()=>{});
     return operation.then(async result=>{maintenanceCount--;if(!maintenanceCount&&!maintenanceFailed&&!closing&&!cancelled){for(const release of maintenanceReleases)await release();maintenanceReleases=[];if(maintenanceRestore)admission.resume()}return result},error=>{maintenanceFailed=true;maintenanceCount--;throw error})
    },
    dispose(){if(deliveryContext.getStore()===actor||thisFactory.executionContext.getStore()===actor)return Promise.reject(fail('PI_OFFICIAL_DISPOSE_REENTRANT'));return closePromise??=(async()=>{closing=true;cancelled=true;lifecycle.abort();admission.pause();await maintenance;await bundle.close();await observer?.close();await scope.dispose();unbindNotices?.();unbindInputs?.();unbind?.();disposed=true;detach?.();unsubscribe();deliveryContext.disable();thisFactory.handles.delete(handle)})()},
   }
   this.handles.add(handle)
   actor.input=Object.freeze({enqueue:handle.enqueue,deliver:handle.deliver})
   actor.whenIdle=whenIdle;actor.cancel=cancel;actor.runMaintenance=handle.runMaintenance;actor.dispose=handle.dispose
   options.signal.throwIfAborted()
   await ownerCtx.agents.announce(actor,mode==='resume'?'resume':'startup',options.signal)
   return handle
  }catch(cause){
   if(bundle){closing=true;cancelled=true;lifecycle.abort();try{await bundle.close();await observer?.close();await scope.dispose();unbindNotices?.();unbindInputs?.();unbind?.();disposed=true;detach?.();for(const handle of this.handles)if(handle.actor===actor)this.handles.delete(handle)}catch(cleanupFailure){cause=Object.assign(new AggregateError([cause,cleanupFailure],'Official startup cleanup failed'),{cleanupFailure})}}
   else{try{await scope?.dispose();unbind?.();await store.close()}catch(cleanupFailure){cause=Object.assign(new AggregateError([cause,cleanupFailure],'Official startup cleanup failed'),{cleanupFailure})}}
   throw cause
  }
 }
}
export default OfficialAgentFactory
