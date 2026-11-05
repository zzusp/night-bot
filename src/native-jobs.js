import {randomUUID} from 'node:crypto'
import {prepareJobJournal,JobLedgerError,unresolvedJobReceipts} from './runtime/job-ledger.js'
import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeOf,scopeChainOf} from './native-scope.js'
const terminal=job=>!['running','stopping'].includes(job.status)
const defaults={maxConcurrentJobsPerOwner:10,retainBytes:262144,settledRetainBytes:16384,pumpPollMs:150}
/** Application-owned job lifetimes. Model shell producers use startDurable;
 * trusted in-process start() producers are ephemeral and supply no cold proof.
 * Neither API restores or replays a producer from historical events. */
export default class NativeJobs extends Service {
 static Config=z.object(Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(value)])))
 constructor(ctx,config={}){
  super(ctx,'jobs');this.config={...defaults,...config};for(const n of Object.values(this.config))if(!Number.isSafeInteger(n)||n<1)throw new TypeError('Invalid job registry limits')
  this.host=ctx;this.records=new Map();this.counts=new Map();this.controllers=new Set();this.listeners=new Set();this.cleanups=new Map();this.closing=false;this.pending=new Set();this.admissions=new Set()
  ctx.effect(()=>()=>this.disposeAll(),'native jobs teardown')
  ctx.on('agent/pre-step',({agent},next)=>{const unresolved=unresolvedJobReceipts(agent.session.snapshotEvents(),agent.id);return unresolved.some(receipt=>{const live=this.records.get(receipt.jobId);return receipt.uncertain||!live||live.journalError||live.drainUncertain})?{kind:'reject',reason:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'}:next()})
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
 admit(spec){
  if(this.closing)throw new Error('jobs registry is closing');const owner=this.owner(spec.owner)
  if(![...this.controllers].some(c=>this.visible(c.scope,owner)))throw new Error('background jobs unavailable: no job controller serves this agent')
  if(typeof spec.kind!=='string'||!spec.kind||typeof spec.label!=='string'||!spec.label)throw new Error('job kind and label must be non-empty strings')
  if(spec.outputLimitBytes!==undefined&&(!Number.isSafeInteger(spec.outputLimitBytes)||spec.outputLimitBytes<1))throw new Error('invalid outputLimitBytes')
  if([...this.records.values()].filter(j=>j.owner===owner&&!terminal(j)).length+[...this.pending].filter(r=>r.owner===owner).length>=this.config.maxConcurrentJobsPerOwner)throw new Error('background job limit reached for this owner')
  if(typeof spec.run!=='function')throw new TypeError('job producer must be a function')
  return owner
 }
 start(spec){return startJob(this,spec)}
 startDurable(spec,exec){
  const owner=this.admit(spec),reservation={owner};this.pending.add(reservation)
  const id=spec.kind+'-'+randomUUID(),startedAt=Date.now()
  const action=(async()=>{
   let journal,invoked=false
   try{
    journal=await prepareJobJournal(this.host,exec,spec,{id,startedAt})
    if(this.closing||exec.signal.aborted){await journal.notStarted('cancelled before producer invocation');exec.signal.throwIfAborted();throw new Error('jobs registry is closing')}
    owner.ctx.fiber.assertActive()
    this.pending.delete(reservation)
    return startJob(this,spec,{id,startedAt,journal,onLaunch:()=>{invoked=true}})
   }catch(error){
    if(journal)try{if(invoked)await journal.startUncertain(error);else await journal.notStarted('admission ended before producer invocation')}catch(cause){throw new JobLedgerError('NIGHT_JOB_START_UNCERTAIN',new AggregateError([error,cause],'Job admission and audit are uncertain'))}
    if(invoked)throw new JobLedgerError('NIGHT_JOB_START_UNCERTAIN',error)
    throw error
   }finally{this.pending.delete(reservation)}
  })()
  this.admissions.add(action);void action.then(()=>this.admissions.delete(action),()=>this.admissions.delete(action));return action
 }

 trim(j,cap){while(j.bytes>cap&&j.chunks.length>1)j.bytes-=j.chunks.shift().bytes;const c=j.chunks[0];if(c&&c.bytes>cap){const b=Buffer.from(c.text);let at=b.length-cap;while(at<b.length&&(b[at]&192)===128)at++;c.text=b.subarray(at).toString();c.at+=at;c.bytes=b.length-at;c.gapBefore=true;j.bytes=c.bytes}}
 append(j,text,options){if(terminal(j)||!text.length)return;const bytes=Buffer.byteLength(text);j.chunks.push({at:j.total,text,bytes,...options?.channel!==undefined?{channel:options.channel}:{},...options?.gapBefore!==undefined?{gapBefore:options.gapBefore}:{}});j.total+=bytes;j.bytes+=bytes;this.trim(j,this.config.retainBytes);if(j.published)this.output(j)}
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
 settle(j,outcome,cause,producerReported=false){
  if(terminal(j))return
  if(j.settlement)return j.settlement
  const finishedAt=Date.now();j.producerFinished=producerReported
  if(!['completed','failed','killed'].includes(outcome?.status)){outcome={status:'failed',detail:'invalid producer outcome'};producerReported=false}
  if(!j.journal)return this.complete(j,outcome,cause,producerReported,finishedAt)
  if(!producerReported)j.drainUncertain=true
  return j.settlement=(async()=>{
   try{await j.journal.settle(outcome,cause,{producerReported,finishedAt});this.complete(j,outcome,cause,producerReported,finishedAt)}
   catch(error){j.journalError=error;j.status='stopping';j.detail='job outcome journal is uncertain; recovery must not replay';const waiters=[...j.waiters];j.waiters.clear();for(const done of waiters)done(error);j.release();throw error}
  })()
 }
 complete(j,outcome,cause,producerReported,finishedAt){if(terminal(j))return;j.status=outcome.status;j.detail=outcome.status==='killed'&&j.killReason!==undefined?[outcome.detail,j.killReason].filter(x=>x!==undefined).join('; '):outcome.detail;j.result=outcome.result;j.progress=undefined;j.finishedAt=finishedAt;this.trim(j,Math.max(this.config.settledRetainBytes,j.total-j.cursor));const waiters=[...j.waiters];j.waiters.clear();for(const done of waiters)done();j.release();this.emit({type:'settled',job:this.view(j),cause,producerReported,awaited:waiters.length>0},j.owner);this.output(j)}
 kill(id,caller,reason){const j=this.expect(id,caller);if(terminal(j)||j.producerFinished)return'already-finished';j.cancel(reason);j.status='stopping';j.killReason=reason;j.cause='kill';this.emit({type:'stopping',job:this.view(j)},j.owner);return'requested'}
 async wait(id,timeout,caller,signal){const j=this.expect(id,caller);if(j.journalError)throw j.journalError;if(!Number.isFinite(timeout)||timeout<=0)throw new Error('invalid wait timeout');if(!terminal(j)){if(signal?.aborted)throw new Error('wait aborted');await new Promise((resolve,reject)=>{let timer;const cleanup=()=>{clearTimeout(timer);j.waiters.delete(done);signal?.removeEventListener('abort',abort)},done=error=>{cleanup();if(error)reject(error);else resolve()},abort=()=>{cleanup();reject(new Error('wait aborted'))};j.waiters.add(done);signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(done,timeout)})}return this.view(j)}
 remove(id,caller){const j=this.expect(id,caller);if(!terminal(j))throw new Error(`job ${id} is still ${j.status}`);this.drop(j)}
 drop(j){if(!this.records.delete(j.id))return;this.emit({type:'removed',job:this.view(j)},j.owner)}
 async disposeJobs(jobs,reason){for(const j of jobs)if(!terminal(j)&&!j.producerFinished){j.cause='teardown';try{j.cancel(reason);j.status='stopping';this.emit({type:'stopping',job:this.view(j)},j.owner)}catch(error){this.warn(error);void this.settle(j,{status:'failed',detail:`cancel threw during teardown; work may be orphaned: ${String(error)}`},'teardown',false)?.catch(error=>this.warn(error))}}await Promise.all(jobs.map(j=>j.settled));const uncertain=jobs.filter(j=>j.journalError||j.drainUncertain);if(uncertain.length)throw new AggregateError(uncertain.map(j=>j.journalError??new Error('NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN')),'Job drain proof is uncertain');for(const j of jobs)this.drop(j)}
 async disposeAll(){this.closing=true;await Promise.allSettled([...this.admissions]);await this.disposeJobs([...this.records.values()],'jobs service disposed');const cleanup=[...this.cleanups.values()];this.cleanups.clear();await Promise.all(cleanup.map(fn=>fn()))}
}

function startJob(registry,spec,durable){
 const owner=registry.admit(spec),n=(registry.counts.get(spec.kind)??0)+1;registry.counts.set(spec.kind,n)
 let release,earlyCancel=false,earlyReason
 const job={id:durable?.id??`${spec.kind}-${n}`,kind:spec.kind,label:spec.label,owner,outputLimitBytes:spec.outputLimitBytes,
  status:'running',published:false,chunks:[],total:0,bytes:0,cursor:0,spills:new Set(),waiters:new Set(),
  startedAt:durable?.startedAt??Date.now(),journal:durable?.journal,settled:new Promise(resolve=>{release=resolve}),release:()=>release(),
  cancel:reason=>{earlyCancel=true;earlyReason=reason}}
 // Bind cleanup before invoking an effect-producing callback. Publish only after
 // valid hooks exist, but reserve capacity during synchronous/reentrant startup.
 if(owner&&!registry.cleanups.has(owner)){
  const detach=owner.ctx.effect(()=>async()=>{registry.cleanups.delete(owner);await registry.disposeJobs([...registry.records.values()].filter(j=>j.owner===owner),'owner disposed')},'native jobs owner')
  registry.cleanups.set(owner,detach)
 }
 registry.records.set(job.id,job)
 let hooks
 try{
  durable?.onLaunch()
  hooks=spec.run({id:job.id,append:(text,options)=>registry.append(job,text,options),updateProgress:line=>{if(terminal(job))return;job.progress=line;if(job.published)registry.emit({type:'progress',job:registry.view(job)},owner)}})
  if(!hooks||typeof hooks.cancel!=='function'||!hooks.done?.then)throw new Error('invalid job producer hooks')
 }catch(error){registry.records.delete(job.id);job.release();throw error}
 job.cancel=reason=>hooks.cancel(reason)
 const outcome=Promise.resolve(hooks.done).catch(error=>{registry.warn(error);return{status:'failed',detail:String(error)}})
 const pump=registry.pump(job,spec.output??[],Promise.race([outcome,job.settled]))
 outcome.then(async result=>{await pump;await registry.settle(job,result,job.cause??'producer',true)}).catch(error=>{registry.warn(error);if(!job.journalError)return registry.settle(job,{status:'failed',detail:String(error)},job.cause??'producer',false)})
 if(earlyCancel){try{hooks.cancel(earlyReason)}catch(error){registry.warn(error);void registry.settle(job,{status:'failed',detail:'startup cancellation threw; producer exit is unproven'},'teardown',false)?.catch(error=>registry.warn(error))}}
 job.published=true;registry.emit({type:'registered',job:registry.view(job)},owner)
 return job.id
}
