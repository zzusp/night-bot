import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {makeAgentObservation,agentObservationSchema,bindPiAgentObservation,createAgentPhaseTimer} from '../src/runtime/pi-agent-observation.js'
import {openNativeDomains} from '../src/native-domain.js'
import NativeAgents from '../src/native-agents.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {createTaskSessionObservability,createTaskObservationQueue} from '../packages/dingtalk-core/task-session-observability.js'
import {officialToolsFixture,definition} from './fixtures/pi-official-tools.js'
const hash=value=>createHash('sha256').update(value).digest('hex')
const base=Date.parse('2026-11-05T01:00:00Z')
const record=(kind,time,summary={},extra={})=>makeAgentObservation({ownerId:'owner',runId:'run',entryId:['model-completed','input-admitted'].includes(kind)?'native-'+kind:kind.startsWith('tool-')?'native-model-completed':null,spanId:hash(kind.startsWith('model-')?'model':kind.startsWith('tool-')?'tool':kind),kind,timestamp:base+time,summary,...extra})
async function storage(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'night-observation-')),facilities=[];let store
 const open=async()=>{const facility=await openNativeDomains({root,...options});facilities.push(facility);return store=await openResidentStore(facility)}
 t.after(async()=>{await store?.close();for(const facility of facilities)await facility.closeAll();await rm(root,{recursive:true,force:true})})
 return{root,open}
}
const view=store=>createTaskSessionObservability({store,activityLimit:3,listTasks:()=>[{taskId:'task'}],resolveSessionIdentity:id=>id==='owner'?{taskId:'task',groupId:'group',role:'execution'}:null})

test('native metadata schema rejects payloads, private tool identifiers, fake entry IDs and mutated event identities',()=>{
 const valid=record('tool-completed',20,{isError:true})
 for(const secret of [{...valid,body:'SECRET'},{...valid,callId:'SECRET'},{...valid,summary:{...valid.summary,toolName:'SECRET'}},{...valid,summary:{arguments:{secret:'SECRET'}}},{...valid,eventId:hash('forged')},{...record('model-completed',20),entryId:null}])assert.equal(agentObservationSchema.safeParse(secret).success,false)
 for(const usage of [{input:-1},{input:Infinity},{input:NaN},{input:2,secret:'SECRET'}])assert.throws(()=>record('model-completed',20,{usage}))
 assert.throws(()=>record('model-started',0,{usage:{input:1}}))
})

test('native SDK metrics share durable resident batches, privacy filters and restart idempotence without Session events',async t=>{
 const f=await storage(t);let store=await f.open(),observation=view(store)
 const records=[record('input-admitted',0,{sourceKind:'coordinator',inputBytes:32}),record('model-started',10),record('model-first-token',40),record('model-completed',160,{stopReason:'stop',usage:{input:10,output:2,cacheRead:3,cacheWrite:1,totalTokens:16}}),record('tool-started',170),record('tool-completed',220,{isError:true}),record('run-settled',230,{outcome:'completed'})]
 const errors=[],queue=createTaskObservationQueue({observe:event=>observation.observeNative(event),onError:error=>errors.push(error)})
 for(const event of [...records,...records])queue.enqueue(event)
 await queue.close();assert.deepEqual(errors,[])
 let row=observation.listPerformance().rows[0]
 assert.equal(row.modelCalls,1);assert.equal(row.firstStreamMs.sum,30);assert.equal(row.modelResponseMs.sum,150)
 assert.equal(row.modelActiveMs,150);assert.equal(row.toolMs.sum,50);assert.equal(row.toolActiveMs,50);assert.equal(row.toolCalls,1);assert.equal(row.toolResults,1);assert.equal(row.toolErrors,1)
 assert.equal(row.coordinationMessages,1);assert.equal(row.coordinationInputBytes,32);assert.equal(row.usage.totalInputTokens,14)
 assert.equal(observation.listActivities().length,3);assert.ok(observation.listActivities().every(activity=>!Object.hasOwn(activity,'seq')))
 assert.equal(observation.listTaskTimings()[0].observedModelSessionMs,150);assert.equal(observation.listTaskTimings()[0].waitingMs,null)
 const foreign=record('model-completed',20,{},{ownerId:'foreign'})
 assert.deepEqual(await observation.observeNative(foreign),{created:false});assert.equal(observation.listPerformance().rows.length,1)
 await store.close();store=await f.open();observation=view(store)
 assert.deepEqual(observation.listActivities(),[])
 for(const event of records)assert.deepEqual(await observation.observeNative(event),{created:false})
 row=observation.listPerformance().rows[0];assert.equal(row.modelCalls,1);assert.equal(row.toolResults,1)
 const document=await readFile(join(f.root,'dingtalk_resident.json'),'utf8').catch(async()=>{const {readdir}=await import('node:fs/promises');return(await Promise.all((await readdir(f.root)).filter(name=>name.endsWith('.json')).map(name=>readFile(join(f.root,name),'utf8')))).join('\n')})
 assert.equal(document.includes('assistant/message'),false);assert.equal(document.includes('tool/call'),false)
 assert.ok(document.includes('nativeSessions'))
})

test('unfinished native spans remain explicitly incomplete, and owner keys cannot alter prototypes',async t=>{
 const f=await storage(t),store=await f.open(),observation=view(store)
 await observation.observeNative(record('model-started',0));await observation.observeNative(record('run-settled',100,{outcome:'failed'}))
 const row=observation.listPerformance().rows[0];assert.equal(row.missingModelResult,1);assert.equal(observation.listTaskTimings()[0].observedModelSessionMs,null)
 const prototypeOwner=record('model-completed',20,{usage:{input:1}},{ownerId:'__proto__'})
 assert.deepEqual(await store.recordAgentObservation({taskId:'other',observation:prototypeOwner}),{created:true})
 assert.equal(Object.prototype.models,undefined);assert.equal(store.listPerformance({sessionId:'__proto__'}).rows[0].modelCalls,1)
})

async function sdk(t,register){
 const f=await officialToolsFixture(t,register);new NativeAgents(f.ctx)
 const actor=f.owner;actor.piSession=f.session;actor.metadata=Object.freeze({id:actor.id});actor.admission={current:()=>({id:'SDK-run',messages:[]}),lookupPacket:()=>undefined}
 const detach=f.ctx.agents.enter(actor,undefined);t.after(detach)
 return{...f,actor,detach}
}
test('actual public SDK events emit metadata only, associate entries by identity and do not leak body, tool name or call ID',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await sdk(t,({ctx})=>ctx.tools.register(definition('SECRET_TOOL_NAME',async()=>{entered.resolve();await release.promise;return{private:'SECRET_TOOL_OUTPUT'}})))
 const records=[],errors=[];let now=base
 const observer=bindPiAgentObservation({actor:f.actor,clock:()=>++now,emit:(_actor,event)=>records.push(event),onError:error=>errors.push(error)})
 t.after(()=>observer.close())
 const running=f.run([{name:'SECRET_TOOL_NAME',id:'SECRET_PRIVATE_CALL_ID'}]);await entered.promise;release.resolve();await running
 assert.deepEqual(errors,[])
 assert.ok(records.some(event=>event.kind==='model-started'));assert.ok(records.some(event=>event.kind==='model-completed'))
 assert.ok(records.some(event=>event.kind==='tool-started'));assert.ok(records.some(event=>event.kind==='tool-completed'));assert.equal(records.filter(event=>event.kind==='run-settled').length,1);assert.equal(records.find(event=>event.kind==='run-settled').summary.outcome,'completed')
 const completed=records.find(event=>event.kind==='model-completed'),tool=records.find(event=>event.kind==='tool-completed')
 assert.equal(f.manager.getEntry(completed.entryId).type,'message');assert.equal(f.manager.getEntry(tool.entryId).message.role,'assistant')
 assert.equal(JSON.stringify(records).includes('SECRET'),false)
 const count=records.length;f.detach();await f.run([]);assert.equal(records.length,count,'an expired owner cannot emit observations')
 release.resolve()
})

test('the real SDK first-token signal is measured without retaining the native delta',async t=>{
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai'),f=await sdk(t,()=>{}),model=f.session.agent.state.model
 f.session.agent.streamFunction=()=>{
  const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:'SECRET_NATIVE_DELTA'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'text_start',contentIndex:0,partial:message});stream.push({type:'text_delta',contentIndex:0,delta:'SECRET_NATIVE_DELTA',partial:message});stream.push({type:'text_end',contentIndex:0,content:'SECRET_NATIVE_DELTA',partial:message});stream.push({type:'done',reason:'stop',message});stream.end(message)})
  return stream
 }
 const records=[],observer=bindPiAgentObservation({actor:f.actor,emit:(_actor,event)=>records.push(event)});t.after(()=>observer.close())
 await f.run([])
 assert.equal(records.filter(event=>event.kind==='model-first-token').length,1)
 assert.equal(JSON.stringify(records).includes('SECRET_NATIVE_DELTA'),false)
})

test('observation failures and a pending metadata write do not block real SDK business effects; close joins its accepted queue',async t=>{
 let effects=0;const f=await sdk(t,({ctx})=>ctx.tools.register(definition('effect',async()=>{effects++;return{ok:true}})))
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),seen=[],errors=[]
 const queue=createTaskObservationQueue({observe:async record=>{entered.resolve();await release.promise;seen.push(record.kind);throw Object.assign(new Error('metadata write failed'),{code:'METADATA_FAILED'})},onError:async error=>{await Promise.resolve();errors.push(error.code)}})
 const observer=bindPiAgentObservation({actor:f.actor,emit:(_actor,event)=>queue.enqueue(event)});t.after(()=>observer.close())
 await f.run([{name:'effect',id:'private-effect-call'}]);await entered.promise
 assert.equal(effects,1);assert.deepEqual(errors,[])
 let closed=false;const closing=queue.close().then(()=>{closed=true});await Promise.resolve();assert.equal(closed,false)
 release.resolve();await closing;assert.ok(seen.includes('tool-completed'));assert.ok(errors.every(code=>code==='METADATA_FAILED'));assert.equal(queue.pending,0)
})

test('a read-only prior Night metrics source is never used as a fallback legacy event writer',async()=>{
 let oldWrites=0
 const observation=createTaskSessionObservability({store:{recordPerformanceEvent(){oldWrites++;throw Error('legacy writer must not run')},listPerformance:()=>({rows:[]})},listTasks:()=>[{taskId:'task'}],resolveSessionIdentity:()=>({taskId:'task'})})
 assert.equal(observation.listPerformance().status,'unsupported')
 assert.deepEqual(await observation.observeNative(record('model-completed',10)),{created:false,status:'unsupported'})
 assert.equal(oldWrites,0)
})


test('Host phase timing preserves success/failure when the metadata sink fails and rejects private payloads',async()=>{
 const records=[],errors=[],cause=Error('PRIVATE_BUSINESS_FAILURE');let now=0
 const measure=createAgentPhaseTimer({ownerId:'triage',emit:event=>{records.push(event);throw Error('sink failed')},onError:error=>errors.push(error),clock:()=>base,elapsed:()=>++now})
 assert.equal(await measure('session-create',async()=>42),42)
 await assert.rejects(measure('request-commit',async()=>{throw cause}),error=>error===cause)
 assert.deepEqual(records.map(event=>event.summary.outcome),['completed','failed'])
 assert.equal(records[0].summary.elapsedMs,1);assert.equal(errors.length,2)
 assert.equal(JSON.stringify(records).includes('PRIVATE_BUSINESS_FAILURE'),false)
 for(const summary of [{phase:'PRIVATE_PHASE',elapsedMs:1,outcome:'completed'},{phase:'skills',elapsedMs:-1,outcome:'completed'},{phase:'skills',elapsedMs:1,outcome:'unknown'},{phase:'skills',elapsedMs:1,outcome:'completed',body:'SECRET'}])assert.throws(()=>makeAgentObservation({...records[0],summary}))
})

test('taskless triage metrics, failed phases and SDK completions survive queued disposal and cold restart',async t=>{
 const f=await storage(t);let store=await f.open()
 const observe=()=>createTaskSessionObservability({store,listTasks:()=>[],resolveSessionIdentity:()=>null})
 let observation=observe();const identity=Object.freeze({groupId:'group',runtimeOwner:'channel-triage'})
 const completed=record('model-completed',40,{usage:{input:3,output:2}})
 const phase=record('phase-completed',50,{phase:'session-dispose',elapsedMs:12,outcome:'failed'})
 const errors=[],queue=createTaskObservationQueue({observe:(event,scope)=>observation.observeNative(event,scope),onError:error=>errors.push(error)})
 for(const event of [completed,phase,completed,phase])queue.enqueue(event,identity)
 await queue.close();assert.deepEqual(errors,[])
 let row=observation.listPerformance({sessionId:'owner',runtimeOwner:'channel-triage'}).rows[0]
 assert.equal(row.taskId,undefined);assert.equal(row.groupId,'group');assert.equal(row.modelCalls,1)
 assert.deepEqual(row.phaseMs['session-dispose'],{count:1,sum:12,max:12,failures:1,p50:12,p95:12})
 assert.equal(observation.listPerformance({taskId:'foreign'}).rows.length,0)
 assert.equal((await observation.observeNative(completed)).created,false)
 await store.close();store=await f.open();observation=observe()
 row=observation.listPerformance({groupId:'group'}).rows[0]
 assert.equal(row.modelCalls,1);assert.equal(row.phaseMs['session-dispose'].failures,1)
 assert.deepEqual(await observation.observeNative(phase,identity),{created:false})
})
