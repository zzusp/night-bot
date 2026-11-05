import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeOf,scopeChainOf} from './native-scope.js'
const terminal=job=>!['running','stopping'].includes(job.status)
const defaults={maxConcurrentJobsPerOwner:10,retainBytes:262144,settledRetainBytes:16384,pumpPollMs:150}
/** Application-owned ephemeral job registry. Durable process receipts remain in
 * the task service; this registry never restarts or replays a producer. */
export default class NativeJobs extends Service {
 static Config=z.object(Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(value)])))
 constructor(ctx,config={}){
  super(ctx,'jobs');this.config={...defaults,...config};for(const n of Object.values(this.config))if(!Number.isSafeInteger(n)||n<1)throw new TypeError('Invalid job registry limits')
  this.host=ctx;this.records=new Map();this.counts=new Map();this.controllers=new Set();this.listeners=new Set();this.cleanups=new Map();this.closing=false
  ctx.effect(()=>()=>this.disposeAll(),'native jobs teardown')
  ctx.on('workspace/session-activity',async({sessionId},next)=>{const rest=await next(),jobs=this.list(sessionId).filter(j=>j.owner===sessionId&&!terminal(j));return jobs.length?[{kind:'job',items:jobs.map(({id,label})=>({id,label}))},...rest]:rest})
  ctx.on('workspace/session-stop',({sessionId})=>{for(const job of this.list(sessionId))if(job.owner===sessionId&&!terminal(job))try{this.kill(job.id,sessionId,'session archived')}catch(error){this.warn(error)}})
 }
 warn(error){this.host.logger.warn(String(error))}
 visible(scope,owner){return scope===undefined||owner!==undefined&&scopeChainOf(scopeOf(owner.ctx)).includes(scope)}
 attachController(name){const cell={scope:scopeOf(this.ctx),name};return this.ctx.effect(()=>{this.controllers.add(cell);return()=>this.controllers.delete(cell)},'native jobs controller')}
 get events(){const ctx=this.ctx;return{subscribe:(filter,listener)=>{const cell={scope:scopeOf(ctx),filter,listener};return ctx.effect(()=>{this.listeners.add(cell);return()=>this.listeners.delete(cell)},'native jobs subscription')}}}
 emit(event,owner){for(const cell of this.listeners){const f=cell.filter;if('owner'in f&&owner!==undefined&&f.owner!==owner.id)continue;if(f.owners==='scope'&&!this.visible(cell.scope,owner))continue;try{cell.listener(event)}catch(error){this.warn(error)}}}
 owner(id){if(id===undefined)return;const owner=this.host.get('agents')?.get(id);if(!owner)throw new Error(`session "${id}" has no live agent`);return owner}
 expect(id,caller){const job=this.records.get(id);if(!job)throw new Error(`unknown job ${id}`);if(job.owner!==undefined&&job.owner.id!==caller)throw new Error(`job ${id} belongs to another session`);return job}
 view(j){return{id:j.id,kind:j.kind,label:j.label,...j.owner?{owner:j.owner.id}:{},...j.outputLimitBytes!==undefined?{outputLimitBytes:j.outputLimitBytes}:{},status:j.status,...j.progress!==undefined?{progress:j.progress}:{},...j.detail!==undefined?{detail:j.detail}:{},startedAt:j.startedAt,...j.finishedAt!==undefined?{finishedAt:j.finishedAt}:{},output:{total:j.total,earliest:j.chunks[0]?.at??j.total,...j.spills.size?{spillPaths:[...j.spills]}:{}}}}
 list(caller){return[...this.records.values()].filter(j=>j.owner===undefined||j.owner.id===caller).map(j=>this.view(j))}
 get(id,caller){return this.view(this.expect(id,caller))}
 start(spec){
  if(this.closing)throw new Error('jobs registry is closing');const owner=this.owner(spec.owner)
  if(![...this.controllers].some(c=>this.visible(c.scope,owner)))throw new Error('background jobs unavailable: no job controller serves this agent')
  if(typeof spec.kind!=='string'||!spec.kind||typeof spec.label!=='string'||!spec.label)throw new Error('job kind and label must be non-empty strings')
  if(spec.outputLimitBytes!==undefined&&(!Number.isSafeInteger(spec.outputLimitBytes)||spec.outputLimitBytes<1))throw new Error('invalid outputLimitBytes')
  if([...this.records.values()].filter(j=>j.owner===owner&&!terminal(j)).length>=this.config.maxConcurrentJobsPerOwner)throw new Error('background job limit reached for this owner')
  const n=(this.counts.get(spec.kind)??0)+1;this.counts.set(spec.kind,n)
  let release;const job={id:`${spec.kind}-${n}`,kind:spec.kind,label:spec.label,owner,outputLimitBytes:spec.outputLimitBytes,status:'running',chunks:[],total:0,bytes:0,cursor:0,spills:new Set(),waiters:new Set(),startedAt:Date.now(),settled:new Promise(r=>release=r),release:()=>release()}
  // Producer startup is synchronous. No externally visible record exists on throw.
  const hooks=spec.run({id:job.id,append:(text,options)=>this.append(job,text,options),updateProgress:line=>{if(terminal(job))return;job.progress=line;if(this.records.has(job.id))this.emit({type:'progress',job:this.view(job)},owner)}})
  if(!hooks||typeof hooks.cancel!=='function'||!hooks.done?.then)throw new Error('invalid job producer hooks')
  job.cancel=reason=>hooks.cancel(reason);this.records.set(job.id,job)
  if(owner&&!this.cleanups.has(owner)){const detach=owner.ctx.effect(()=>async()=>{this.cleanups.delete(owner);await this.disposeJobs([...this.records.values()].filter(j=>j.owner===owner),'owner disposed')},'native jobs owner');this.cleanups.set(owner,detach)}
  this.emit({type:'registered',job:this.view(job)},owner)
  const outcome=Promise.resolve(hooks.done).catch(error=>{this.warn(error);return{status:'failed',detail:String(error)}})
  const pump=this.pump(job,spec.output??[],Promise.race([outcome,job.settled]))
  outcome.then(async result=>{await pump;this.settle(job,result,job.cause??'producer')}).catch(error=>{this.warn(error);this.settle(job,{status:'failed',detail:String(error)},job.cause??'producer')})
  return job.id
 }
 trim(j,cap){while(j.bytes>cap&&j.chunks.length>1)j.bytes-=j.chunks.shift().bytes;const c=j.chunks[0];if(c&&c.bytes>cap){const b=Buffer.from(c.text);let at=b.length-cap;while(at<b.length&&(b[at]&192)===128)at++;c.text=b.subarray(at).toString();c.at+=at;c.bytes=b.length-at;c.gapBefore=true;j.bytes=c.bytes}}
 append(j,text,options){if(terminal(j)||!text.length)return;const bytes=Buffer.byteLength(text);j.chunks.push({at:j.total,text,bytes,...options?.channel!==undefined?{channel:options.channel}:{},...options?.gapBefore!==undefined?{gapBefore:options.gapBefore}:{}});j.total+=bytes;j.bytes+=bytes;this.trim(j,this.config.retainBytes);if(this.records.has(j.id))this.output(j)}
 output(j){this.emit({type:'output',id:j.id,...j.owner?{owner:j.owner.id}:{},total:j.total},j.owner)}
 readAt(id,from,caller){if(!Number.isSafeInteger(from)||from<0)throw new Error('invalid output read offset');return this.readFrom(this.expect(id,caller),from)}
 readFrom(j,from){return{chunks:j.chunks.filter(c=>c.at+c.bytes>from).map(({bytes,...c})=>({...c})),next:j.total,lossy:from<(j.chunks[0]?.at??j.total)}}
 read(id,caller){const j=this.expect(id,caller),read=this.readFrom(j,j.cursor);j.cursor=j.total;const result=terminal(j)&&!j.delivered?j.result:undefined;if(result!==undefined)j.delivered=true;if(terminal(j))this.trim(j,this.config.settledRetainBytes);return{chunks:read.chunks,lossy:read.lossy,...result!==undefined?{result}:{},job:this.view(j)}}
 async pump(j,sources,until){
  const states=sources.map(source=>({source,cursor:0,failed:false}));let stopped=false,wake,timer
  const drain=()=>{for(const s of states){if(s.failed)continue;try{const r=s.source.read(s.cursor);s.cursor=r.nextOffset;if(r.spillPath!==undefined)j.spills.add(r.spillPath);this.append(j,r.text,{...s.source.channel!==undefined?{channel:s.source.channel}:{},...r.lossy?{gapBefore:true}:{}})}catch(error){s.failed=true;this.warn(error)}}}
  until.then(()=>{stopped=true;clearTimeout(timer);wake?.()},()=>{stopped=true;clearTimeout(timer);wake?.()})
  while(!stopped){drain();await new Promise(r=>{wake=r;timer=setTimeout(r,this.config.pumpPollMs)});wake=undefined}drain()
 }
 settle(j,outcome,cause){if(terminal(j))return;j.status=outcome.status;j.detail=outcome.status==='killed'&&j.killReason!==undefined?[outcome.detail,j.killReason].filter(x=>x!==undefined).join('; '):outcome.detail;j.result=outcome.result;j.progress=undefined;j.finishedAt=Date.now();this.trim(j,Math.max(this.config.settledRetainBytes,j.total-j.cursor));const waiters=[...j.waiters];j.waiters.clear();for(const done of waiters)done();j.release();this.emit({type:'settled',job:this.view(j),cause,awaited:waiters.length>0},j.owner);this.output(j)}
 kill(id,caller,reason){const j=this.expect(id,caller);if(terminal(j))return'already-finished';j.cancel(reason);j.status='stopping';j.killReason=reason;j.cause='kill';this.emit({type:'stopping',job:this.view(j)},j.owner);return'requested'}
 async wait(id,timeout,caller,signal){const j=this.expect(id,caller);if(!Number.isFinite(timeout)||timeout<=0)throw new Error('invalid wait timeout');if(!terminal(j)){if(signal?.aborted)throw new Error('wait aborted');await new Promise((resolve,reject)=>{let timer;const cleanup=()=>{clearTimeout(timer);j.waiters.delete(done);signal?.removeEventListener('abort',abort)},done=()=>{cleanup();resolve()},abort=()=>{cleanup();reject(new Error('wait aborted'))};j.waiters.add(done);signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(done,timeout)})}return this.view(j)}
 remove(id,caller){const j=this.expect(id,caller);if(!terminal(j))throw new Error(`job ${id} is still ${j.status}`);this.drop(j)}
 drop(j){if(!this.records.delete(j.id))return;this.emit({type:'removed',job:this.view(j)},j.owner)}
 async disposeJobs(jobs,reason){for(const j of jobs)if(!terminal(j)){j.cause='teardown';try{j.cancel(reason);j.status='stopping';this.emit({type:'stopping',job:this.view(j)},j.owner)}catch(error){this.warn(error);this.settle(j,{status:'failed',detail:`cancel threw during teardown; work may be orphaned: ${String(error)}`},'teardown')}}await Promise.all(jobs.map(j=>j.settled));for(const j of jobs)this.drop(j)}
 async disposeAll(){this.closing=true;await this.disposeJobs([...this.records.values()],'jobs service disposed');const cleanup=[...this.cleanups.values()];this.cleanups.clear();await Promise.all(cleanup.map(fn=>fn()))}
}
