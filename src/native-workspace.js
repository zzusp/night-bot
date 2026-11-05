import {AgentSession} from '@earendil-works/pi-coding-agent'
import {AsyncLocalStorage} from 'node:async_hooks'
import {Service,symbols} from '@deepseek-ai/cordis'
import {randomUUID} from 'node:crypto'
import {mkdir,realpath,stat} from 'node:fs/promises'
import {posix,win32} from 'node:path'
import {z} from 'zod'
import {defineDomain,domainTable} from './native-domain.js'
// Preserve public error identities for existing RPC and trusted plugins. The
// registry/data mutations below never construct or delegate to the old service.
import {WorkspaceActiveSessionError,WorkspaceArchivedSessionPinError,WorkspaceMoveInvalidError,WorkspaceOrderInvalidError,WorkspaceUnknownSessionError} from './native-capability-errors.js'
export {WorkspaceActiveSessionError,WorkspaceArchivedSessionPinError,WorkspaceMoveInvalidError,WorkspaceOrderInvalidError,WorkspaceUnknownSessionError}
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i])
const unchanged=Symbol('workspace unchanged')
const errorText=e=>{try{return String(e)}catch{return'[unrenderable thrown value]'}}
export function fullyQualifiedWorkspacePath(path,platform=process.platform){if(typeof path!=='string')return false;if(platform!=='win32')return posix.isAbsolute(path);const root=win32.parse(path).root;return win32.isAbsolute(path)&&root!=='\\'&&root!=='/'}
export function defaultWorkspaceTitle(path,platform=process.platform){const api=platform==='win32'?win32:posix;return api.basename(path)||api.parse(path).root}
export async function realpathNormalize(path){if(!fullyQualifiedWorkspacePath(path))throw new TypeError('Workspace path must be fully qualified');return realpath(path)}
export const workspaceRecord=z.object({path:z.string(),title:z.string(),sessionIds:z.array(z.string()),createdAt:z.string(),updatedAt:z.string()})
export const workspaceDomainState=z.object({initialized:z.boolean(),defaultWorkspaceId:z.string().optional(),workspaceIds:z.array(z.string()),archivedSessionIds:z.array(z.string()).default([]),pinnedSessionIds:z.array(z.string()).default([]),pendingMutation:z.discriminatedUnion('operation',[z.object({operation:z.literal('create'),workspaceId:z.string()}),z.object({operation:z.literal('delete'),workspaceId:z.string()})]).optional()})
export const workspaceDomainSpec=defineDomain({name:'workspace',version:2,global:{schema:workspaceDomainState,initial:{initialized:false,workspaceIds:[],archivedSessionIds:[],pinnedSessionIds:[]}},tables:{workspaces:domainTable(workspaceRecord)}})
/** Preserve the nonvisual archived-session guard formerly installed by the UI
 * session controller. Forks are independent; subagent lineage inherits archive. */
const admissionFailure=code=>Object.assign(new Error(code),{code})
function officialHeader(ctx,actor){
 const agents=ctx.get('agents')
 if(!(actor?.piSession instanceof AgentSession)||agents?.get(actor.id)!==actor||actor.metadata?.id!==actor.id)throw admissionFailure('WORKSPACE_ACTOR_UNBOUND')
 agents.ownerOf(actor)
 return actor.metadata
}
export function underArchivedSession(ctx,actor,archived,cached=new Map()){
 let current=actor,header=officialHeader(ctx,actor);const visited=new Set(),agents=ctx.get('agents')
 for(;;){
  if(visited.has(header.id))throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')
  visited.add(header.id);if(archived.includes(header.id))return true
  if(header.origin==='fork')return false
  const owner=current?agents.ownerOf(current):undefined
  if(owner){if(header.origin==='subagent'&&header.parentSession!==undefined&&header.parentSession!==owner.id)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN');if(agents.get(owner.id)===owner){current=owner;header=officialHeader(ctx,owner)}else{current=undefined;header=cached.get(owner.id);if(!header)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')}continue}
  if(header.origin!=='subagent')return false
  if(typeof header.parentSession!=='string'||!header.parentSession)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')
  current=undefined;header=cached.get(header.parentSession)
  if(!header)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')
 }
}
class WorkspaceEntity {
 #record
 constructor(host,id,record){this.host=host;Object.defineProperty(this,'id',{value:id,enumerable:true});this.#record=record}
 get path(){return this.#record.path}get title(){return this.#record.title}get createdAt(){return this.#record.createdAt}get updatedAt(){return this.#record.updatedAt}get sessionIds(){return this.#record.sessionIds.filter(id=>this.host.sessionPaths.get(id)===this.#record.path)}
 async status(){try{return(await stat(this.path)).isDirectory()?'ok':'missing-dir'}catch{return'missing-dir'}}
 async mutate(fn){this.host.assertOpen();try{const next=await this.host.requireTable().update(this.id,current=>{const changed=fn(current),sessionIds=changed.sessionIds.filter(id=>this.host.sessionPaths.get(id)===changed.path);if(changed===current&&sessionIds.length===current.sessionIds.length)throw unchanged;return{...changed,sessionIds,updatedAt:new Date().toISOString()}});this.#record=next}catch(e){if(e!==unchanged)throw e}}
 setTitle(title){return this.mutate(record=>({...record,title}))}
 attachSession(id){return this.host.enqueueOperation(async()=>{if(!this.#record.sessionIds.includes(id)){const header=await this.host.readSessionHeader(id);if(header.cwd===undefined)throw new Error('Session has no immutable cwd to validate workspace membership');let cwd;try{cwd=await realpathNormalize(header.cwd)}catch(e){throw new Error('Session cwd cannot be validated',{cause:e})}if(!(await stat(cwd)).isDirectory()||cwd!==this.path)throw new Error('Session cwd does not match workspace');this.host.sessionPaths.set(id,cwd);this.host.invalidSessionPaths.delete(id)}
  // A previously filtered legacy slot cannot remain in another raw account
  // after an explicit valid rebind; that would fail the next boot invariant.
  for(const [otherId,record]of this.host.requireTable().entries())if(otherId!==this.id&&record.sessionIds.includes(id)){if(record.path===this.path)throw new Error('Session is already accounted by another workspace');const other=this.host.entities.get(otherId);if(!other)throw new Error('Workspace account has no published owner');await other.detachSession(id)}
  return this.mutate(record=>record.sessionIds.includes(id)?record:{...record,sessionIds:[id,...record.sessionIds]})})}

 detachSession(id){return this.mutate(record=>record.sessionIds.includes(id)?{...record,sessionIds:record.sessionIds.filter(v=>v!==id)}:record)}
 insertSessionBefore(id,before){return this.mutate(record=>{if(!record.sessionIds.includes(id)||before!==undefined&&!record.sessionIds.includes(before))throw new WorkspaceMoveInvalidError('Session or anchor is not accounted by this workspace');if(before===id)return record;const rest=record.sessionIds.filter(v=>v!==id),at=before===undefined?rest.length:rest.indexOf(before),sessionIds=[...rest.slice(0,at),id,...rest.slice(at)];return same(sessionIds,record.sessionIds)?record:{...record,sessionIds}})}
}
/** Durable workspace accounts over the native JSON domain. Pi remains the
 * session/header authority; history bootstrap never reads model/event bodies. */
export default class NativeWorkspace extends Service {
 static inject=['storageDomain','sessionPersistence']
 constructor(ctx){
  super(ctx,'workspaceRegistry');this.entities=new Map();this.headers=new Map();this.lineageHeaders=new Map();this.archiveFailures=new Map();this.sessionPaths=new Map();this.invalidSessionPaths=new Map();this.operationTail=Promise.resolve();this.operationContext=new AsyncLocalStorage();this.closed=false;this.domainClosing=false
  ctx.inject(['agents'],child=>child.on('night/agent-prepare',({agent})=>{
   if(typeof agent.requestPolicy?.addBeforeRequest!=='function')throw admissionFailure('WORKSPACE_REQUEST_POLICY_REQUIRED')
   agent.requestPolicy.addBeforeRequest(async({actor,signal})=>{
    signal?.throwIfAborted();this.assertOpen();officialHeader(child,actor)
    const archived=this.requireState().archivedSessionIds
    if(!archived.length)return
    await this.loadLineage(actor)
    if(underArchivedSession(child,actor,archived,this.lineageHeaders))throw admissionFailure('WORKSPACE_SESSION_ARCHIVED')
   })
  }))
 }
 async loadLineage(actor){
  const agents=this.ctx.get('agents'),visited=new Set();let current=actor,header=officialHeader(this.ctx,actor)
  for(;;){
   if(visited.has(header.id))throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')
   visited.add(header.id);this.lineageHeaders.set(header.id,header)
   if(header.origin==='fork')return
   const owner=current?agents.ownerOf(current):undefined
   if(owner){if(header.origin==='subagent'&&header.parentSession!==undefined&&header.parentSession!==owner.id)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN');if(agents.get(owner.id)===owner){current=owner;header=officialHeader(this.ctx,owner)}else{current=undefined;header=await this.strictLineageHeader(owner.id)}continue}
   if(header.origin!=='subagent')return
   if(typeof header.parentSession!=='string'||!header.parentSession)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN')
   const parentId=header.parentSession,live=agents.get(parentId)
   if(live){current=live;header=officialHeader(this.ctx,live);continue}
   current=undefined;header=this.lineageHeaders.get(parentId)
   if(!header)header=await this.strictLineageHeader(parentId)
  }
 }
 async strictLineageHeader(id){const cached=this.lineageHeaders.get(id);if(cached)return cached;const saved=await this.ctx.sessionPersistence.readNative(id,{requireComplete:true});if(saved.header?.id!==id)throw admissionFailure('WORKSPACE_LINEAGE_UNPROVEN');const header=Object.freeze(structuredClone(saved.header));this.lineageHeaders.set(id,header);return header}
 async affectedActors(id){
  const result=[]
  for(const actor of this.ctx.get('agents')?.list()??[]){if(!(actor?.piSession instanceof AgentSession))continue;await this.loadLineage(actor);if(underArchivedSession(this.ctx,actor,[id],this.lineageHeaders))result.push(actor)}
  return result
 }
 async *[Service.init](){const domain=await this.ctx.storageDomain.open(workspaceDomainSpec);this.domain=domain;const rawClose=domain.close.bind(domain);let closing,releaseSelf;const selfClosing=new Promise(resolve=>releaseSelf=resolve);domain.close=()=>{this.closed=true;if(this.operationContext.getStore()===this)releaseSelf();return closing??=(async()=>{await Promise.race([this.operationTail,selfClosing]);this.domainClosing=true;await rawClose()})()};yield()=>domain.close();this.table=domain.table('workspaces');this.global=domain.global;this.state=domain.global.get();await this.recoverPendingMutation();this.validateStoredState();if(!this.state.initialized){const headers=await this.listStoredHeaders();await this.replaceHeaderIndex(headers);await this.bootstrap(headers)}else if(this.table.size)await this.replaceHeaderIndex(await this.listStoredHeaders());await this.indexHeaders(this.ctx.get('sessions')?.list().map(s=>s.header)??[]);this.validateStoredState();for(const id of this.state.workspaceIds)this.entities.set(id,new WorkspaceEntity(this[symbols.original]??this,id,this.table.get(id)));for(const entity of this.entities.values())for(const id of this.table.get(entity.id).sessionIds)if(this.sessionPaths.get(id)!==entity.path)this.warn('filtered workspace session membership: '+id)}
 assertOpen(){if(this.closed)throw new Error('Workspace registry disposed')}
 requireTable(){if(!this.table)throw new Error('Workspace registry is not started');return this.table}
 requireState(){if(!this.state)throw new Error('Workspace registry is not started');return this.state}
 warn(message){try{this.ctx.logger.warn('workspace: '+message)}catch{}}
 async setState(state,publish){await this.global.set(state);this.state=state;publish?.()}
 enqueueOperation(fn){if(this.closed)return Promise.reject(new Error('Workspace registry disposed'));const task=this.operationTail.then(async()=>{this.assertOpen();return this.operationContext.run(this[symbols.original]??this,async()=>{await this.recoverPendingMutation();return fn()})});this.operationTail=task.then(()=>{},()=>{});return task}
 get(id){return this.entities.get(id)}
 list(){return this.requireState().workspaceIds.map(id=>{const e=this.entities.get(id);if(!e)throw new Error('Workspace order references a missing entity');return e})}
 get archivedSessionIds(){return this.requireState().archivedSessionIds}get pinnedSessionIds(){return this.requireState().pinnedSessionIds}
 async resolveByPath(path){const canonical=await realpathNormalize(path);return[...this.entities.values()].find(e=>e.path===canonical)}
 async create(path,title){this.assertOpen();const canonical=await realpathNormalize(path);if(!(await stat(canonical)).isDirectory())throw new Error('Workspace path is not a directory');return this.enqueueOperation(()=>this.createCanonical(canonical,title))}
 initializeDefault(resolveDirectory){return this.enqueueOperation(async()=>{const state=this.requireState();if(state.defaultWorkspaceId!==undefined)return this.entities.get(state.defaultWorkspaceId);const sessions=this.ctx.get('sessions');if(!sessions)throw new Error('Default workspace initialization requires sessions');if(state.workspaceIds.length||state.archivedSessionIds.length||sessions.list().length||(await this.listStoredHeaders()).length)return;const path=await resolveDirectory();if(this.domainClosing)throw new Error('Workspace registry disposed during directory resolution');if(!fullyQualifiedWorkspacePath(path))throw new TypeError('Workspace path must be fully qualified');await mkdir(path,{recursive:true});const canonical=await realpathNormalize(path);if((await this.listStoredHeaders()).length||sessions.list().length)return;return this.createCanonical(canonical,defaultWorkspaceTitle(path),true)})}
 async createCanonical(path,title,firstUse=false){for(const e of this.entities.values())if(e.path===path)return e;const state=this.requireState(),id=randomUUID(),now=new Date().toISOString(),record={path,title:title??defaultWorkspaceTitle(path),sessionIds:[],createdAt:now,updatedAt:now},entity=new WorkspaceEntity(this[symbols.original]??this,id,record);await this.setState({...state,pendingMutation:{operation:'create',workspaceId:id}});try{await this.table.put(id,record)}catch(e){try{await this.setState(state)}catch(rollback){throw new AggregateError([e,rollback],'Workspace record write and marker rollback failed')}throw e}try{await this.setState({...state,pendingMutation:undefined,initialized:true,...firstUse?{defaultWorkspaceId:id}:{},workspaceIds:[id,...state.workspaceIds]},()=>this.entities.set(id,entity))}catch(e){try{await this.table.delete(id)}catch(rollback){throw new AggregateError([e,rollback],'Workspace order write and record rollback failed; pending marker remains recoverable')}try{await this.setState(state)}catch(rollback){throw new AggregateError([e,rollback],'Workspace order write and marker rollback failed')}throw e}return entity}
 delete(id){return this.enqueueOperation(()=>this.deleteKnown(id))}
 async deleteKnown(id){const entity=this.entities.get(id);if(!entity)return false;const state=this.requireState(),next={...state,pendingMutation:undefined,initialized:true,workspaceIds:state.workspaceIds.filter(v=>v!==id)};await this.setState({...next,pendingMutation:{operation:'delete',workspaceId:id}},()=>this.entities.delete(id));try{await this.table.delete(id)}catch(e){try{await this.setState(state,()=>this.entities.set(id,entity))}catch(rollback){this.entities.delete(id);throw new AggregateError([e,rollback],'Workspace deletion and registry order rollback failed')}throw e}try{await this.setState(next)}catch(e){this.warn('Deleted workspace pending marker could not be cleared: '+errorText(e))}return true}
 insertBefore(id,before){return this.enqueueOperation(async()=>{const state=this.requireState();if(!state.workspaceIds.includes(id))throw new WorkspaceOrderInvalidError(id);if(before!==undefined&&!state.workspaceIds.includes(before))throw new WorkspaceOrderInvalidError(before);if(before===id)return state.workspaceIds;const rest=state.workspaceIds.filter(v=>v!==id),at=before===undefined?rest.length:rest.indexOf(before),workspaceIds=[...rest.slice(0,at),id,...rest.slice(at)];if(same(workspaceIds,state.workspaceIds))return state.workspaceIds;await this.setState({...state,workspaceIds});return workspaceIds})}
 async sessionKnown(id){if(this.ctx.get('agents')?.get(id)?.metadata||this.ctx.get('sessions')?.get(id)!==undefined||this.headers.has(id))return true;await this.indexHeaders(await this.listStoredHeaders());return this.headers.has(id)}
 archiveSession(id,options={}){return this.enqueueOperation(async()=>{
  if(this.archivedSessionIds.includes(id)){if(this.archiveFailures.has(id))throw this.archiveFailures.get(id);return}
  if(!await this.sessionKnown(id))throw new WorkspaceUnknownSessionError(id,'archive')
  const affected=await this.affectedActors(id),ids=new Set([id,...affected.map(actor=>actor.id)])
  if(options.stopActivity!==true){
   const activity=[]
   for(const sessionId of ids)activity.push(...await this.ctx.waterfall('workspace/session-activity',{sessionId},()=>Promise.resolve([])))
   if(activity.length)throw new WorkspaceActiveSessionError(id,activity)
  }
  const state=this.requireState()
  // The durable gate precedes cancellation. A crash or failed drain must not
  // reactivate this lineage on cold recovery.
  await this.setState({...state,archivedSessionIds:[...state.archivedSessionIds,id],pinnedSessionIds:state.pinnedSessionIds.filter(value=>value!==id)})
  if(options.stopActivity===true){
   const actors=await this.affectedActors(id),outcomes=await Promise.allSettled(actors.map(async actor=>{await actor.cancel({kind:'archive'});await actor.whenIdle()}))
   const errors=outcomes.filter(result=>result.status==='rejected').map(result=>result.reason)
   for(const sessionId of new Set([id,...actors.map(actor=>actor.id)]))try{await this.ctx.parallel('workspace/session-stop',{sessionId})}catch(error){errors.push(...error instanceof AggregateError?error.errors:[error])}
   if(errors.length){const failure=Object.assign(new AggregateError(errors,'Workspace archived; activity drain failed and ownership is retained'),{code:'WORKSPACE_ARCHIVE_DRAIN_FAILED'});this.archiveFailures.set(id,failure);throw failure}
  }
 })}
 unarchiveSession(id){return this.enqueueOperation(async()=>{const state=this.requireState();if(state.archivedSessionIds.includes(id))await this.setState({...state,archivedSessionIds:state.archivedSessionIds.filter(v=>v!==id)});this.archiveFailures.delete(id)})}
 pinSession(id){return this.enqueueOperation(async()=>{if(this.pinnedSessionIds.includes(id))return;if(this.archivedSessionIds.includes(id))throw new WorkspaceArchivedSessionPinError(id);if(!await this.sessionKnown(id))throw new WorkspaceUnknownSessionError(id,'pin');await this.setState({...this.state,pinnedSessionIds:[id,...this.state.pinnedSessionIds]})})}
 unpinSession(id){return this.enqueueOperation(async()=>{const state=this.requireState();if(state.pinnedSessionIds.includes(id))await this.setState({...state,pinnedSessionIds:state.pinnedSessionIds.filter(v=>v!==id)})})}
 async recoverPendingMutation(){const state=this.requireState(),pending=state.pendingMutation;if(!pending)return;if(state.workspaceIds.includes(pending.workspaceId))throw new Error('Workspace pending mutation unexpectedly references an ordered record');await this.table.delete(pending.workspaceId);await this.setState({...state,pendingMutation:undefined})}
 validateStoredState(){const state=this.requireState(),table=this.requireTable(),order=new Set(),paths=new Set(),accounted=new Set();for(const id of state.workspaceIds){if(order.has(id)||!table.get(id))throw new Error('Workspace domain has duplicate or missing registry order');order.add(id)}if(state.initialized&&order.size!==table.size)throw new Error('Workspace domain has unexplained unordered records');for(const [,record]of table.entries()){if(paths.has(record.path))throw new Error('Workspace directory is accounted more than once');paths.add(record.path);for(const id of record.sessionIds){if(accounted.has(id))throw new Error('Session is accounted more than once');accounted.add(id)}}}
 async listStoredHeaders(){return(await this.ctx.sessionPersistence.list()).map(s=>s.header)}
 async replaceHeaderIndex(headers){this.headers.clear();this.sessionPaths.clear();this.invalidSessionPaths.clear();await this.indexHeaders(headers)}
 async indexHeaders(headers){for(const header of headers){this.headers.set(header.id,header);this.sessionPaths.delete(header.id);if(header.cwd===undefined){this.invalidSessionPaths.set(header.id,'header has no cwd');continue}try{const path=await realpathNormalize(header.cwd);if(!(await stat(path)).isDirectory()){this.invalidSessionPaths.set(header.id,'cwd is not a directory');continue}this.sessionPaths.set(header.id,path);this.invalidSessionPaths.delete(header.id)}catch{this.invalidSessionPaths.set(header.id,'cwd does not resolve')}}}
 async readSessionHeader(id){const actor=this.ctx.get('agents')?.get(id);if(actor?.piSession){const header=officialHeader(this.ctx,actor);this.headers.set(id,header);return header}const live=this.ctx.get('sessions')?.get(id);if(live){this.headers.set(id,live.header);return live.header}if(this.headers.has(id))return this.headers.get(id);await this.indexHeaders(await this.listStoredHeaders());if(!this.headers.has(id))throw new Error('Session persistence has no header for membership validation');return this.headers.get(id)}
 async bootstrap(headers){const groups=new Map();for(const header of headers){const path=this.sessionPaths.get(header.id);if(path!==undefined){if(!groups.has(path))groups.set(path,[]);groups.get(path).push(header)}}const ordered=[...groups].map(([path,headers])=>{headers.sort((a,b)=>b.createdAt-a.createdAt||String(a.id).localeCompare(String(b.id)));return{path,headers,newestAt:headers[0].createdAt}}).sort((a,b)=>b.newestAt-a.newestAt||a.path.localeCompare(b.path)),byPath=new Map(),accounted=new Map();for(const [id,record]of this.table.entries()){byPath.set(record.path,id);for(const session of record.sessionIds)accounted.set(session,id)}for(const group of ordered){let id=byPath.get(group.path);if(id===undefined){const sessionIds=group.headers.map(h=>h.id).filter(id=>!accounted.has(id));if(!sessionIds.length)continue;id=randomUUID();const time=new Date(group.newestAt).toISOString();await this.table.put(id,{path:group.path,title:defaultWorkspaceTitle(group.path),sessionIds,createdAt:time,updatedAt:time});byPath.set(group.path,id);for(const session of sessionIds)accounted.set(session,id)}else{const current=this.table.get(id),history=group.headers.map(h=>h.id).filter(s=>accounted.get(s)===undefined||accounted.get(s)===id),seen=new Set(history),sessionIds=[...history,...current.sessionIds.filter(s=>!seen.has(s))];if(!same(current.sessionIds,sessionIds))await this.table.update(id,record=>({...record,sessionIds,updatedAt:new Date().toISOString()}));for(const session of history)accounted.set(session,id)}}const state=this.requireState(),rank=new Map(ordered.map(g=>[g.path,g.newestAt])),prior=new Map(state.workspaceIds.map((id,i)=>[id,i])),workspaceIds=[...this.table.entries()].sort(([a,x],[b,y])=>(rank.get(y.path)??Date.parse(y.createdAt))-(rank.get(x.path)??Date.parse(x.createdAt))||(prior.get(a)??Number.MAX_SAFE_INTEGER)-(prior.get(b)??Number.MAX_SAFE_INTEGER)||String(a).localeCompare(String(b))).map(([id])=>id);if(!same(state.workspaceIds,workspaceIds))await this.setState({initialized:false,workspaceIds,archivedSessionIds:state.archivedSessionIds,pinnedSessionIds:state.pinnedSessionIds});await this.setState({initialized:true,workspaceIds,archivedSessionIds:state.archivedSessionIds,pinnedSessionIds:state.pinnedSessionIds})}
}
