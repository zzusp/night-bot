import {AsyncLocalStorage} from 'node:async_hooks'
import {Service} from '@deepseek-ai/cordis'
// Error identities remain interoperable with trusted existing interaction plugins.
import {AuthorizationError,AuthorizationDeclinedError} from '@deepseek-ai/dsh-authorization'
import {credentialKey} from './native-credentials.js'
export {AuthorizationError,AuthorizationDeclinedError}
const failure=(code,message)=>new AuthorizationError(message,code)
/** Application-owned authorization attempts. Pi owns provider login protocol;
 * this service owns who may commit, cancellation, publication and draining. */
export default class NativeAuthorization extends Service {
 static inject=['credentials']
 constructor(ctx){super(ctx,'authorization');this.host=ctx;this.calls=new AsyncLocalStorage();this.flows=new Map();this.running=new Map();this.closed=false;ctx.effect(()=>async()=>{this.closed=true;const pending=[...this.running.values()];for(const a of pending)if(!a.committing)a.controller.abort();await Promise.allSettled(pending.filter(a=>a!==this.calls.getStore()).map(a=>a.done))},'native authorization teardown')}
 warn(message){try{this.host.logger.warn('Native authorization: '+message)}catch{}}
 settle(key,status){try{for(const fn of this.host.events.dispatch('emit',['authorization/settled',key,status]))try{Promise.resolve(fn(key,status)).catch(()=>this.warn('settled observer failed'))}catch{this.warn('settled observer failed')}}catch{this.warn('settled dispatch failed')}}
 registerFlow(flow){credentialKey(flow.key);if(typeof flow.label!=='string'||!flow.label||typeof flow.run!=='function'||!Array.isArray(flow.methods)||!flow.methods.length||flow.methods.some(m=>typeof m.id!=='string'||!m.id||typeof m.label!=='string')||new Set(flow.methods.map(m=>m.id)).size!==flow.methods.length)throw failure('INVALID_FLOW','Invalid authorization flow')
  const key=flow.key,entry={key,label:flow.label,methods:flow.methods.map(m=>({...m})),run:flow.run.bind(flow)};return this.ctx.effect(()=>{if(this.closed)throw failure('CLOSED','Authorization service closed');if(this.flows.has(key))throw failure('DUPLICATE_FLOW','Authorization flow already registered');this.flows.set(key,entry);return async()=>{if(this.flows.get(key)!==entry)return;this.flows.delete(key);const a=this.running.get(key);if(a){if(!a.committing)a.controller.abort();if(a!==this.calls.getStore())await a.done}}},'native authorization registration')
 }
 entry(flow){return{key:flow.key,label:flow.label,methods:flow.methods.map(m=>({...m})),inFlight:this.running.has(flow.key)}}
 list(){return[...this.flows.values()].map(f=>this.entry(f))}
 describe(key){const f=this.flows.get(key);return f&&this.entry(f)}
 cancel(key){const a=this.running.get(key);if(a&&!a.committing)a.controller.abort()}
 async begin(request){
  if(this.closed)throw failure('CLOSED','Authorization service closed');const flow=this.flows.get(request.key);if(!flow)throw failure('NO_FLOW','No authorization flow registered');const method=request.method??flow.methods[0].id;if(!flow.methods.some(m=>m.id===method))throw failure('UNKNOWN_METHOD','Unknown authorization method');if(this.running.has(flow.key))throw failure('ALREADY_IN_FLIGHT','Authorization attempt already in flight');if(request.signal?.aborted)return{status:'cancelled'}
  const a={key:flow.key,controller:new AbortController(),committing:false,sealed:false,declined:false,observed:false,committed:false,writes:new Set()};let finish;a.done=new Promise(r=>finish=r);this.running.set(flow.key,a)
  const withdraw=()=>{if(!a.committing)a.controller.abort(request.signal?.reason)};request.signal?.addEventListener('abort',withdraw,{once:true});if(request.signal?.aborted)withdraw()
  let status='failed';try{const result=await this.attempt(flow,method,request.interaction,a);status=result.status;return result}finally{a.sealed=true;request.signal?.removeEventListener('abort',withdraw);if(this.running.get(flow.key)===a)this.running.delete(flow.key);this.settle(flow.key,status);finish()}
 }
 assertActive(a,key,allowSealed=false){if(key!==a.key)throw failure('WRONG_CREDENTIAL','Authorization attempt cannot write another record');if(a.sealed&&!allowSealed||this.running.get(key)!==a)throw failure('CANCELLED','Authorization attempt no longer active');a.controller.signal.throwIfAborted()}
 /** Keep the commit gate inside the real credential mutex. Waiting for a lock
  * does not disable cancellation; a started rotation must settle durably. */
 async modify(a,key,mutate,options){this.assertActive(a,key);a.scoped=true;const signal=options?.signal?AbortSignal.any([options.signal,a.controller.signal]):a.controller.signal;let wrote=false;const task=this.host.credentials.modifyRecord(key,async current=>{this.assertActive(a,key,a.allowQueuedCommits);signal.throwIfAborted();a.committing=true;const next=await mutate(current);wrote=next!==undefined;return next},{...options,signal}).then(record=>{if(wrote)a.committed=true;return record});a.writes.add(task);void task.catch(()=>{});return task}
 async attempt(flow,method,interaction,a){
  const signal=a.controller.signal;let abort;const withdrawn=new Promise(r=>{abort=()=>r('withdrawn');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});const off=this.host.on('credentials/record-updated',key=>{if(key===a.key&&!a.scoped&&this.calls.getStore()===a)a.observed=true})
  const store=this.host.credentials,credentials={readRecord:key=>store.readRecord(key),listRecords:()=>store.listRecords(),resolve:ref=>store.resolve(ref),modifyRecord:(key,fn,options)=>this.modify(a,key,fn,options),deleteRecord:async()=>{throw failure('NOT_COMMITTED','Authorization flow cannot delete credentials')}}
  let pending;try{pending=Promise.resolve().then(()=>{this.assertActive(a,a.key);return this.calls.run(a,()=>flow.run({method,signal,credentials,commit:record=>this.modify(a,a.key,()=>record),notify:notice=>{try{Promise.resolve(interaction.notify(notice)).catch(()=>this.warn('notice surface failed'))}catch{this.warn('notice surface failed')}},prompt:prompt=>Promise.resolve().then(()=>interaction.prompt(prompt)).catch(e=>{if(e instanceof AuthorizationDeclinedError)a.declined=true;throw e})}));});void pending.catch(()=>{})
   try{if(await Promise.race([pending.then(()=> 'ran'),withdrawn])==='withdrawn')return{status:'cancelled'}}catch(e){if(signal.aborted||a.declined)return{status:'cancelled'};throw e}
   // No late background commit may sneak in after the runner returns. Drain
   // every admitted write even when the flow neglected to await it.
   a.allowQueuedCommits=true;a.sealed=true;const writes=[...a.writes];await Promise.all(writes)
   if(!(a.committed||a.observed)||!(await store.describeRecord(a.key)).configured)throw failure('NOT_COMMITTED','Authorization flow did not commit a credential record')
   return{status:'authorized'}
  }finally{a.sealed=true;if(!a.allowQueuedCommits&&!a.committing)a.controller.abort();signal.removeEventListener('abort',abort);off();await Promise.allSettled([...a.writes])}
 }
}
