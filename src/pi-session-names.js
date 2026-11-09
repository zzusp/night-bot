import {AgentSession,ModelRuntime} from '@earendil-works/pi-coding-agent'

const fail=code=>Object.assign(new Error(code),{code})
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key))
const text=value=>typeof value==='string'&&value.trim().length>0&&Buffer.byteLength(value)<=512&&!/[\x00-\x1f\x7f]/u.test(value)
const secret=value=>/(?:-----BEGIN .*PRIVATE KEY-----|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,}|\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/iu.test(value)
export const sessionNameAuditKinds=Object.freeze({'session-name/set':value=>keys(value,['version','nameEntryId','mode','pinned','subjectId'])&&value.version===1&&text(value.nameEntryId)&&['manual','automatic','refresh'].includes(value.mode)&&typeof value.pinned==='boolean'&&(value.subjectId===undefined||text(value.subjectId))})

/** Business naming only. Pi owns the name entry; the application commit owns its
 * durability acknowledgement. No conversation messages are read by this service. */
export default class PiSessionNames {
 constructor({readCommitted}={}){if(typeof readCommitted!=='function')throw fail('PI_SESSION_NAME_READ_REQUIRED');this.readCommitted=readCommitted;this.states=new WeakMap();this.owned=new Set();this.closed=false}
 async bind(actor,{automatic=false,readPublicSubject,resolveModel}={}){
  if(this.closed)throw fail('PI_SESSION_NAMES_CLOSED')
  if(!(actor?.piSession instanceof AgentSession)||actor.ctx?.get?.('agents')?.get(actor.id)!==actor||actor.metadata?.id!==actor.id||!actor.receipts?.append||!actor.receipts?.commit||!actor.receipts?.read||!actor.lifecycle?.isLive?.())throw fail('PI_SESSION_NAME_ACTOR_REQUIRED')
  if(this.states.has(actor))throw fail('PI_SESSION_NAME_ALREADY_BOUND')
  if(typeof automatic!=='boolean'||(automatic&&(typeof readPublicSubject!=='function'||typeof resolveModel!=='function')))throw fail('PI_SESSION_NAME_CONFIGURATION_INVALID')
  const snapshot=await this.readCommitted(actor)
  const state={actor,automatic,readPublicSubject,resolveModel,descriptor:structuredClone(snapshot.sessionName??{}),revision:0,tail:Promise.resolve(),jobs:new Set(),controllers:new Set(),closed:false}
  const receipts=await actor.receipts.read(),last=receipts.filter(r=>r.domain==='session-name'&&r.kind==='set'&&r.payload.nameEntryId===state.descriptor.nameEntryId).at(-1)
  state.pinned=last?.payload.pinned??!!state.descriptor.nameEntryId
  if(this.closed||!actor.lifecycle.isLive()||actor.lifecycle.signal?.aborted)throw fail('PI_SESSION_NAMES_CLOSED')
  if(this.states.has(actor))throw fail('PI_SESSION_NAME_ALREADY_BOUND')
  this.states.set(actor,state);this.owned.add(state)
 }
 state(actor){const state=this.states.get(actor);if(!state)throw fail('PI_SESSION_NAME_UNBOUND');if(state.failure)throw state.failure;if(this.closed||state.closed||actor.ctx.get('agents').get(actor.id)!==actor||!actor.lifecycle.isLive()||actor.lifecycle.signal?.aborted)throw fail('PI_SESSION_NAME_CLOSED');return state}
 async refreshCommitted(state){
  const snapshot=await this.readCommitted(state.actor),descriptor=snapshot.sessionName??{}
  if(descriptor.nameEntryId!==state.descriptor.nameEntryId){
   const receipts=await state.actor.receipts.read(),receipt=receipts.findLast(r=>r.domain==='session-name'&&r.kind==='set'&&r.payload.nameEntryId===descriptor.nameEntryId)
   state.descriptor=structuredClone(descriptor);state.pinned=receipt?.payload.pinned??!!descriptor.nameEntryId
  }
 }
 async get(actor){const state=this.states.get(actor);if(!state)throw fail('PI_SESSION_NAME_UNBOUND');if(!state.failure)await this.refreshCommitted(state);return structuredClone({...state.descriptor,pinned:state.pinned,durable:true})}
 supersede(state){state.revision++;for(const controller of state.controllers)controller.abort();return state.revision}
 publish(state,name,{mode,pinned,subjectId,revision}){
  const operation=state.tail.then(async()=>{
   this.state(state.actor);if(revision!==state.revision)throw fail('PI_SESSION_NAME_SUPERSEDED')
   if(mode==='automatic'&&state.actor.piSession.sessionManager.getEntries().findLast(entry=>entry.type==='session_info')?.id!==state.descriptor.nameEntryId)throw fail('PI_SESSION_NAME_EXTERNAL_CHANGE')
   if(!text(name)||secret(name))throw fail('PI_SESSION_NAME_INVALID')
   const normalized=name.trim();let entry
   try{
    const length=state.actor.piSession.sessionManager.getEntries().length
    state.actor.piSession.setSessionName(normalized)
    const names=state.actor.piSession.sessionManager.getEntries().slice(length).filter(item=>item.type==='session_info')
    entry=names[0]
    if(names.length!==1||entry.name!==normalized)throw fail('PI_SESSION_NAME_OFFICIAL_ENTRY_MISSING')
    state.actor.receipts.append({version:1,domain:'session-name',kind:'set',payload:{version:1,nameEntryId:entry.id,mode,pinned,...subjectId===undefined?{}:{subjectId}}})
    await state.actor.receipts.commit()
   }catch(error){state.failure=error;throw error}
   state.descriptor={name:normalized,nameEntryId:entry.id};state.pinned=pinned
   return structuredClone({...state.descriptor,pinned,durable:true})
  });state.tail=operation.catch(()=>{});return operation
 }
 set(actor,name,{pin=true}={}){const state=this.state(actor);if(typeof pin!=='boolean')throw fail('PI_SESSION_NAME_CONFIGURATION_INVALID');return this.publish(state,name,{mode:'manual',pinned:pin,revision:this.supersede(state)})}
 async settled(actor,{packetId}={}){
  const state=this.state(actor);if(!state.automatic)return Promise.resolve({skipped:true})
  // Register the whole operation before returning: committed-name reads can be
  // asynchronous too. The operation never calls drain or awaits its own set.
  const job=(async()=>{await this.refreshCommitted(state);this.state(actor);if(state.pinned)return {skipped:true};return this.generate(state,'automatic',packetId)})()
  state.jobs.add(job);job.finally(()=>state.jobs.delete(job)).catch(()=>{})
  return job
 }
 refresh(actor,{packetId,signal}={}){return this.generate(this.state(actor),'refresh',packetId,signal)}
 generate(state,mode,packetId,callerSignal){
  if(typeof state.readPublicSubject!=='function'||typeof state.resolveModel!=='function')throw fail('PI_SESSION_NAME_AUTOMATION_UNCONFIGURED')
  callerSignal?.throwIfAborted()
  const revision=this.supersede(state),controller=new AbortController(),signal=controller.signal
  const abort=()=>controller.abort();callerSignal?.addEventListener('abort',abort,{once:true});state.actor.lifecycle.signal?.addEventListener('abort',abort,{once:true});state.controllers.add(controller)
  const job=(async()=>{
   const subject=await state.readPublicSubject(state.actor,{packetId,signal});signal.throwIfAborted()
   if(!keys(subject,['id','text'])||!text(subject.id)||secret(subject.id)||!text(subject.text)||secret(subject.text))throw fail('PI_SESSION_NAME_SUBJECT_REJECTED')
   const resolved=await state.resolveModel(state.actor,{signal});signal.throwIfAborted()
   if(!(resolved?.modelRuntime instanceof ModelRuntime)||!resolved.model)throw fail('PI_SESSION_NAME_MODEL_REQUIRED')
   // Request options are bounded here; no caller-supplied tools, messages or headers.
   const stream=resolved.modelRuntime.streamSimple(resolved.model,{systemPrompt:'Return one short plain session name for this approved public label. No explanation.',messages:[{role:'user',content:subject.text,timestamp:0}]},{signal,maxTokens:64,...resolved.thinkingLevel===undefined?{}:{reasoning:resolved.thinkingLevel}})
   const result=await stream.result();signal.throwIfAborted()
   if(result.stopReason!=='stop'||result.content.some(part=>part.type!=='text'))throw fail('PI_SESSION_NAME_RESPONSE_REJECTED')
   return this.publish(state,result.content.map(part=>part.text).join('').trim(),{mode,pinned:false,subjectId:subject.id,revision})
  })();state.jobs.add(job)
  job.finally(()=>{state.jobs.delete(job);state.controllers.delete(controller);state.actor.lifecycle.signal?.removeEventListener('abort',abort);callerSignal?.removeEventListener('abort',abort)}).catch(()=>{})
  return job
 }
 async drain(actor){const states=actor?[this.states.get(actor)]:[...this.owned];if(states.some(state=>!state))throw fail('PI_SESSION_NAME_UNBOUND');for(const state of states){while(state.jobs.size)await Promise.allSettled([...state.jobs]);await state.tail;if(state.failure)throw state.failure}}
 async closeActor(actor){const state=this.states.get(actor);if(!state)return;state.closed=true;this.supersede(state);await Promise.allSettled([...state.jobs]);await state.tail;if(state.failure)throw state.failure;this.owned.delete(state)}
 async close(){this.closed=true;const results=await Promise.allSettled([...this.owned].map(state=>this.closeActor(state.actor)));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Session names did not close durably')}
}
