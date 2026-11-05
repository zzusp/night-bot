import {Service} from '@deepseek-ai/cordis'
import {scopeOf,scopeTarget} from './native-scope.js'
import {Session,SessionId,SessionForkError,buildForkSeed} from '@deepseek-ai/dsh-session'
const attachments=new WeakMap(),hookOwners=new WeakMap()
const callbacks=(ctx,carrier,name,...args)=>[...ctx.events.dispatch('emit',[carrier,name,...args])]
function observe(ctx,list,args){for(const callback of list)try{Promise.resolve(callback(...args)).catch(error=>ctx.logger.warn(error))}catch(error){ctx.logger.warn(error)}}
/** Owns publication, liveness and durability admission. The pinned legacy
 * Session data facade remains explicit; Pi SessionManager owns durable context.
 * No legacy SessionStore instance is constructed or used. */
export default class NativeSessions extends Service{
 constructor(ctx){super(ctx,'sessions');this.store=new Map();this.counter=0;this.projections=[];ctx.inject(['typert'],child=>child.typert.lookups.register('session',{parameter:'session',wire:'sessionId',hostTypeSymbol:'@deepseek-ai/dsh-session#Session',wireTypeSymbol:'@deepseek-ai/dsh-session/types#SessionId',resolve:id=>this.get(id)}))}
 get messageProjections(){return this.projections}
 registerMessageProjection(projection){if(this.projections.some(p=>p.type===projection.type))throw new Error(`session message projection "${projection.type}" is already registered`);return this.ctx.effect(()=>{this.projections.push(projection);return()=>{const at=this.projections.indexOf(projection);if(at>=0)this.projections.splice(at,1)}},'native session message projection')}
 prepare(id,options){
  let key;if(id===undefined)do{key=SessionId(`session-${++this.counter}`)}while(this.store.has(key));else key=SessionId(id)
  if(this.store.has(key))throw new Error(`session "${key}" already exists`)
  if(options?.eventState!==undefined){if(!['detached','shared-frozen'].includes(options.eventState))throw new Error('Unsupported restored session event state');return Session.fromRestore(key,options.seed,options.meta,options.inheritedEventCount,options.eventState,this.projections)}
  const meta=options?.meta,header={version:4,id:key,createdAt:meta?.createdAt??Date.now(),isSeeded:meta?.isSeeded??false}
  for(const field of ['cwd','parentSession','origin','delegationDepth','agentPreset']){const value=meta?.[field];if(value!==undefined)header[field]=value}
  return Session.create(key,options?.seed,header,options?.inheritedEventCount,this.projections)
 }
 create(id,options){const session=this.prepare(id,options);this.ctx.effect(function*(){yield this.enter(session);this.announce(session)}.bind(this),'native session lifecycle');return session}
 enter(session){
  const id=session.id;if(this.store.has(id))throw new Error(`session "${id}" already exists`);if(attachments.has(session))throw new Error(`session "${id}" is already attached to a store`)
  // Pinned compatibility seam: preserve the original private publication method
  // and restore it on detach where configurable. Sealed facades retain a
  // stateless, owner-checked hook; its WeakMap entry is still removed.
  // A foreign live attachment fails before log mutation.
  const original=session.publicationEntry,descriptor=Object.getOwnPropertyDescriptor(session,'publicationEntry')
  if(typeof original!=='function'||typeof session.commit!=='function')throw new Error('Unsupported Session publication facade')
  if(hookOwners.has(original)&&hookOwners.get(original)!==session)throw new Error('Session publication hook belongs to another facade')
  if(Reflect.apply(original,session,[])!==undefined)throw new Error(`session "${id}" is already attached to a store`)
  const entry={id,session,carrier:scopeTarget(session,scopeOf(this.ctx)),emitCtx:this.ctx,announced:false,announcing:false,appending:false,detachRequested:false}
  const hook=hookOwners.get(original)===session?original:()=>{const own=attachments.get(session),foreign=Reflect.apply(original,session,[]);if(own&&foreign&&foreign!==own)throw new Error('Session has conflicting publication owners');const live=own??foreign;if(live?.appending)throw new Error('session append cannot reenter while another append is being published');return live}
  if(hook!==original){hookOwners.set(hook,session);Object.defineProperty(session,'publicationEntry',{value:hook,configurable:true,writable:false})}
  entry.restoreHook=()=>{const current=Object.getOwnPropertyDescriptor(session,'publicationEntry');if(hook===original||current?.value!==hook||!current.configurable)return;if(descriptor)Object.defineProperty(session,'publicationEntry',descriptor);else delete session.publicationEntry}
  entry.detach=()=>this.detach(entry);this.store.set(id,entry);attachments.set(session,entry);let entered=true
  return()=>{if(!entered)return;entered=false;if(entry.announcing||entry.appending)entry.detachRequested=true;else entry.detach()}
 }
 detach(entry){entry.detachRequested=false;if(this.store.get(entry.id)!==entry)return;this.store.delete(entry.id);attachments.delete(entry.session);entry.restoreHook();if(entry.announced)try{observe(this.ctx,callbacks(this.ctx,entry.carrier,'session/disposed',entry.session),[entry.session])}catch(error){this.ctx.logger.warn(error)}}
 liveEntryFor(session){const entry=attachments.get(session);if(!entry||this.store.get(entry.id)!==entry)throw new Error(`session "${session.id}" is not live in this store`);return entry}
 announce(session){const entry=this.liveEntryFor(session);if(entry.announced||entry.announcing)throw new Error(`session "${entry.id}" was already announced`);entry.announced=true;entry.announcing=true;try{for(const callback of callbacks(this.ctx,entry.carrier,'session/created',session)){const returned=callback(session);Promise.resolve(returned).catch(error=>this.ctx.logger.warn(error))}}finally{entry.announcing=false;if(entry.detachRequested&&!entry.appending)entry.detach()}}
 async flush(session){const entry=this.liveEntryFor(session),list=callbacks(this.ctx,entry.carrier,'session/flush',session),results=await Promise.allSettled(list.map(callback=>{try{return callback(session)}catch(error){return Promise.reject(error)}})),failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;return list.length>0}
 get(id){return this.store.get(id)?.session}
 list(){return[...this.store.values()].map(e=>e.session)}
 fork(source,boundary,childId){
  if(childId!==undefined&&this.get(childId)!==undefined)throw new SessionForkError(`session "${childId}" already exists`,'SESSION_ALREADY_EXISTS')
  const id=typeof source==='string'?source:source.id,live=this.get(id);if(!live)throw new SessionForkError(`session "${id}" not found`,'SESSION_NOT_FOUND');if(typeof source!=='string'&&source!==live)throw new SessionForkError(`session "${id}" is not the live store instance`,'SESSION_NOT_LIVE')
  const events=live.snapshotEvents(),cut=boundary??events.at(-1)?.seq
  if(cut!==undefined&&(!Number.isSafeInteger(cut)||cut<0||cut>=events.length||events[cut]?.seq!==cut))throw new SessionForkError(`invalid fork boundary ${String(cut)} for session "${id}"`,'INVALID_BOUNDARY')
  return this.create(childId,{seed:cut===undefined?[]:buildForkSeed(events,cut),inheritedEventCount:cut===undefined?0:cut+1,meta:{...live.header.cwd!==undefined?{cwd:live.header.cwd}:{},parentSession:live.id,isSeeded:true}})
 }
}
