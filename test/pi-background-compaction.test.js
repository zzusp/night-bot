import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {createBackgroundCompaction} from '../src/runtime/pi-background-compaction.js'
const deferred=()=>Promise.withResolvers()
async function eventually(predicate){for(let i=0;i<100;i++){if(predicate())return;await delay(2)}assert.ok(predicate(),'condition did not settle')}
function fixture(t,{tokens=300000,compact,commit,outputReserveTokens,isHealthy,isInputHealthy}={}){
 const listeners=new Set(),calls=[],appends=[],errors=[],phases=[]
 const state={leaf:'leaf',revision:1,entries:[{id:'leaf'}],tokens,paused:false,inputs:[],refreshes:0,commits:0,projection:[],settings:{},foreground:0}
 const signal=new AbortController()
 const session={model:{provider:'fixture',id:'model',contextWindow:1000000},settingsManager:{getSettings:()=>state.settings},thinkingLevel:'low',systemPrompt:'prompt',isIdle:true,pendingMessageCount:0,isRetrying:false,getActiveToolNames:()=>['read'],getContextUsage:()=>({tokens:state.tokens}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},refreshContext(){state.refreshes++}}
 const store={snapshot:()=>({revision:state.revision}),manager:{getLeafId:()=>state.leaf,getEntries:()=>state.entries,getBranch:()=>state.entries,appendCompaction(...args){appends.push(args);state.leaf='compacted';state.entries.push({id:state.leaf});state.revision++}}}
 session.sessionManager={buildSessionProjection:()=>({messages:state.projection})};session.compact=async()=>{state.foreground++;state.tokens=10;state.projection=[]}
 const worker=createBackgroundCompaction({session,store,outputReserveTokens,isHealthy,isInputHealthy,signal:signal.signal,admission:{get paused(){return state.paused},pending:()=>state.inputs},compact:args=>{calls.push(args);return compact?compact(args):Promise.resolve(result())},commit:async()=>{state.commits++;await commit?.()},onError:error=>errors.push(error),measurePhase:async(name,run)=>{phases.push(name);return run()}})
 const emit=type=>{for(const listener of listeners)listener({type})}
 t.after(()=>worker.close())
 return {worker,session,store,state,calls,appends,errors,phases,emit,signal,listeners}
}
const result=()=>({summary:'Native summary',firstKeptEntryId:'leaf',tokensBefore:300000,details:{readFiles:[]}})
test('only idle settled round at soft threshold creates and commits candidate',async t=>{
 const f=fixture(t,{tokens:299999});f.worker.settled();await delay(10);assert.equal(f.calls.length,0)
 f.state.tokens=300000;f.emit('agent_settled');await eventually(()=>f.state.refreshes===1)
 assert.equal(f.calls.length,1);assert.equal(f.appends.length,1);assert.equal(f.state.commits,1);assert.ok(f.phases.includes('background-compaction-adopted'))
})
test('queued inputs, streaming, retrying and paused admission prevent background starts',async t=>{
 const f=fixture(t)
 for(const [set,reset] of [[()=>f.state.inputs.push('p'),()=>f.state.inputs.pop()],[()=>f.session.pendingMessageCount=1,()=>f.session.pendingMessageCount=0],[()=>f.session.isIdle=false,()=>f.session.isIdle=true],[()=>f.session.isRetrying=true,()=>f.session.isRetrying=false],[()=>f.state.paused=true,()=>f.state.paused=false]]){set();f.emit('agent_settled');await delay(5);assert.equal(f.calls.length,0);reset()}
 f.emit('agent_settled');await eventually(()=>f.state.refreshes===1)
})
test('new input never waits for candidate ignoring abort; late result cannot be adopted',async t=>{
 const gate=deferred(),f=fixture(t,{compact:()=>gate.promise});f.worker.settled();await eventually(()=>f.calls.length===1)
 await Promise.race([f.worker.beforeInput(),delay(200).then(()=>assert.fail('new input waited for background'))]);assert.equal(f.calls[0].signal.aborted,true)
 gate.resolve(result());await delay(10);assert.equal(f.appends.length,0);assert.equal(f.state.refreshes,0);assert.ok(f.phases.includes('background-compaction-cancelled'))
})
test('changed leaf, model, prompt, thinking or revision discards stale snapshots',async t=>{
 for(const change of [f=>f.state.leaf='new',f=>f.session.model={...f.session.model,id:'changed'},f=>f.session.systemPrompt='changed',f=>f.session.thinkingLevel='high',f=>f.state.revision++]){
  const gate=deferred(),f=fixture(t,{compact:()=>gate.promise});f.worker.settled();await eventually(()=>f.calls.length===1);change(f);gate.resolve(result());await eventually(()=>!f.worker.pending);assert.equal(f.appends.length,0)
 }
})
test('business ingress waits for committed adoption',async t=>{
 const gate=deferred(),f=fixture(t,{commit:()=>gate.promise});f.worker.settled();await eventually(()=>f.state.commits===1)
 let received=false;const input=f.worker.beforeInput().then(()=>received=true);await delay(10);assert.equal(received,false);assert.equal(f.state.refreshes,0)
 gate.resolve();await input;assert.equal(f.state.refreshes,1)
})
test('failed candidate runs once per checkpoint; changed checkpoint permits another attempt',async t=>{
 const f=fixture(t,{compact:()=>Promise.reject(new Error('failure'))});f.worker.settled();await eventually(()=>f.errors.length===1)
 for(let i=0;i<3;i++){f.worker.settled();await delay(5)}assert.equal(f.calls.length,1)
 f.state.revision++;f.worker.settled();await eventually(()=>f.errors.length===2);assert.equal(f.calls.length,2);assert.equal(f.appends.length,0)
})
test('native foreground compaction invalidates background and records wait',async t=>{
 const gate=deferred(),f=fixture(t,{compact:()=>gate.promise});f.worker.settled();await eventually(()=>f.calls.length===1);f.emit('compaction_start');assert.equal(f.calls[0].signal.aborted,true)
 gate.resolve(result());f.emit('compaction_end');await delay(10);assert.equal(f.appends.length,0);assert.ok(f.phases.includes('foreground-compaction'))
})
test('close cancels active work, unsubscribes and prohibits later starts',async t=>{
 const f=fixture(t,{compact:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});f.worker.settled();await eventually(()=>f.calls.length===1);await f.worker.close()
 assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.listeners.size,0);f.worker.settled();await delay(5);assert.equal(f.calls.length,1);assert.equal(f.errors.length,0)
})
test('invalid candidate cannot mutate live store',async t=>{
 const f=fixture(t,{compact:async()=>({...result(),firstKeptEntryId:'missing'})});f.worker.settled();await eventually(()=>f.errors.length===1);assert.equal(f.appends.length,0);assert.equal(f.state.commits,0)
})
test('cancelled late candidate cannot clear newer adoption durability barrier',async t=>{
 const first=deferred(),second=deferred(),durable=deferred();let calls=0
 const f=fixture(t,{compact:()=>++calls===1?first.promise:second.promise,commit:()=>durable.promise});f.worker.settled();await eventually(()=>f.calls.length===1);await f.worker.beforeInput()
 f.state.revision++;f.worker.settled();await eventually(()=>f.calls.length===2);second.resolve(result());await eventually(()=>f.state.commits===1);first.resolve(result());await delay(10)
 let resumed=false;const ingress=f.worker.beforeInput().then(()=>resumed=true);await delay(10)
 try{assert.equal(resumed,false,'late cancelled attempt removed a newer commit barrier')}finally{durable.resolve();await ingress}assert.equal(f.state.refreshes,1)
})
test('changed native settings invalidate candidate before adoption',async t=>{
 const gate=deferred(),f=fixture(t,{compact:()=>gate.promise});f.worker.settled();await eventually(()=>f.calls.length===1);f.state.settings={compaction:{enabled:false}};gate.resolve(result());await eventually(()=>!f.worker.pending);assert.equal(f.appends.length,0)
})
test('large incoming packet triggers native compaction before first request',async t=>{
 const f=fixture(t,{tokens:390000});f.state.inputs.push('durable-packet');await f.worker.beforeInput({content:'x'.repeat(80000)})
 assert.equal(f.state.foreground,1);assert.equal(f.state.commits,1);assert.deepEqual(f.state.inputs,['durable-packet'])
})
test('concurrent large preflights share native compaction and await commit',async t=>{
 const gate=deferred(),durable=deferred(),f=fixture(t,{tokens:390000,commit:()=>durable.promise});f.session.compact=async()=>{f.state.foreground++;await gate.promise;f.state.tokens=10;f.state.projection=[]}
 let arrived=0;const a=f.worker.beforeInput({content:'x'.repeat(80000)}).then(()=>arrived++),b=f.worker.beforeInput({content:'y'.repeat(80000)}).then(()=>arrived++)
 await delay(10);assert.equal(f.state.foreground,1);assert.equal(arrived,0);gate.resolve();await eventually(()=>f.state.commits===1);assert.equal(arrived,0);durable.resolve();await Promise.all([a,b]);assert.equal(arrived,2);assert.equal(f.state.foreground,1)
})
test('oversized input and insufficient post-compaction room preserve pending input',async t=>{
 const f=fixture(t,{tokens:390000,outputReserveTokens:100000});f.state.inputs.push('durable-packet');await assert.rejects(f.worker.beforeInput({content:'x'.repeat(2000000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'});assert.equal(f.state.foreground,0);assert.deepEqual(f.state.inputs,['durable-packet'])
 f.session.compact=async()=>{f.state.foreground++;f.state.tokens=null;f.state.projection=[{role:'user',content:'x'.repeat(1560000)}]};await assert.rejects(f.worker.beforeInput({content:'x'.repeat(80000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'});assert.equal(f.state.foreground,1);assert.deepEqual(f.state.inputs,['durable-packet'])
})
test('preflight failure propagates and leaves input pending',async t=>{
 const failure=new Error('provider failed'),f=fixture(t,{tokens:390000});f.state.inputs.push('durable-packet');f.session.compact=async()=>{throw failure};await assert.rejects(f.worker.beforeInput({content:'x'.repeat(80000)}),error=>error===failure);assert.deepEqual(f.state.inputs,['durable-packet']);assert.equal(f.state.commits,0)
})
test('exact native hard waterline compacts before incoming input',async t=>{
 const f=fixture(t,{tokens:400000});await f.worker.beforeInput({content:'new input'});assert.equal(f.state.foreground,1)
})

test('a failed durable adoption never refreshes the live context',async t=>{
 const f=fixture(t,{commit:async()=>{throw new Error('disk failure')}})
 f.worker.settled();await eventually(()=>f.errors.length===1)
 assert.equal(f.state.refreshes,0)
 assert.equal(f.appends.length,1,'the native store owns uncertain append fencing')
})

test('closing foreground compaction settles its observation span',async t=>{
 const listeners=new Set(),spans=[]
 const session={subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}}
 const worker=createBackgroundCompaction({session,store:{},admission:{},compact:()=>{},commit:()=>{},measurePhase:(_name,run)=>{const promise=run();spans.push(promise);return promise},onError:()=>{}})
 for(const listener of listeners)listener({type:'compaction_start'})
 await worker.close()
 await Promise.race([Promise.allSettled(spans),delay(200).then(()=>assert.fail('foreground observation never settled'))])
})

test('recoverable request failure blocks background but permits next input; permanent fence still rejects',async t=>{
 let inputHealthy=true
 const f=fixture(t,{isHealthy:()=>false,isInputHealthy:()=>inputHealthy})
 f.worker.settled();await delay(10);assert.equal(f.calls.length,0)
 await f.worker.beforeInput({content:'next batch'})
 inputHealthy=false
 await assert.rejects(f.worker.beforeInput({content:'forbidden'}),{code:'PI_OFFICIAL_ACTOR_NOT_LIVE'})
})

test('active steer refuses an oversized packet without compacting or consuming pending input',async t=>{
 const f=fixture(t,{tokens:1000});f.session.model.contextWindow=131072;f.session.isIdle=false;f.state.inputs.push('steer')
 await assert.rejects(f.worker.beforeInput({content:'x'.repeat(480000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(f.state.foreground,0);assert.deepEqual(f.state.inputs,['steer'])
 await f.worker.beforeInput({content:'ordinary steer'});assert.equal(f.state.foreground,0)
})

test('history already beyond foreground waterline compacts and verifies remaining room',async t=>{
 const f=fixture(t,{tokens:110000});f.session.model.contextWindow=131072
 f.session.compact=async()=>{f.state.foreground++;f.state.tokens=null;f.state.projection=[{role:'user',content:'x'.repeat(80000)}]}
 await assert.rejects(f.worker.beforeInput({content:'x'.repeat(456000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(f.state.foreground,1)
})

test('first input and post-compaction estimates include current system prompt and declared tools',async t=>{
 const f=fixture(t,{tokens:0});f.session.model.contextWindow=131072;f.session.systemPrompt='s'.repeat(80000)
 f.session.agent={state:{tools:[{name:'read',description:'d'.repeat(8000),parameters:{type:'object'}}]}}
 await assert.rejects(f.worker.beforeInput({content:'x'.repeat(380000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(f.state.foreground,0)
 f.state.tokens=110000;f.session.compact=async()=>{f.state.foreground++;f.state.tokens=null;f.state.projection=[{role:'user',content:'h'.repeat(80000)}]}
 await assert.rejects(f.worker.beforeInput({content:'x'.repeat(320000)}),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(f.state.foreground,1)
})

test('Router resume batch capacity counts all supplemental packets together',async t=>{
 const f=fixture(t,{tokens:1000});f.session.model.contextWindow=131072
 await assert.rejects(f.worker.beforeInput([{content:'a'.repeat(240000)},{content:'b'.repeat(240000)}]),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(f.state.foreground,0)
})
