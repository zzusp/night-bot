import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'readonly-query-ledger-')),store=await openDynamicTaskStore({dbPath:join(root,'tasks.sqlite'),initialize:true,instanceId:'lookup-ledger',ownerActorId:'operator',webActorId:'operator'});t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})});let seq=0
 const command=(kind,args)=>store.command({id:'lookup-ledger-'+(++seq),kind,args}),query=(kind,args={})=>store.query({kind,...args})
 await command('source.record-direct',{source:{sourceId:'source',groupId:'room',messageId:'message',actorId:'alice',version:1,text:'Read the retained task status'},conversation:{conversationId:'room'}})
 await command('router.ensure',{conversationId:'room',sessionId:'router-one'})
 for(const [taskId,groupId]of [['task','room'],['foreign','other']])await command('task.create',{taskId,groupId,conversationId:groupId,ownerActorId:'alice',request:'Retained synthetic task'})
 const args={conversationId:'room',generation:1,sourceId:'source',messageVersion:1,operationId:'lookup',taskIds:['task']}
 return {command,query,args,store,root,dbPath:join(root,'tasks.sqlite')}
}
test('durable lookup admission is scoped and idempotent per source version without changing task state',async t=>{
 const f=await fixture(t),tasks=await f.query('task.list')
 for(const patch of [{taskIds:['foreign']},{conversationId:'other'},{sourceId:'missing'},{taskIds:[]},{taskIds:['task','task']}])await assert.rejects(f.command('router.lookup.submit',{...f.args,...patch}))
 const first=await f.command('router.lookup.submit',f.args),again=await f.command('router.lookup.submit',f.args);assert.deepEqual(first.result,again.result)
 await assert.rejects(f.command('router.lookup.submit',{...f.args,operationId:'second'}),{code:'ROUTER_LOOKUP_SOURCE_ALREADY_SUBMITTED'})
 assert.deepEqual(await f.query('task.list'),tasks);assert.equal((await f.query('router.lookup.pending')).length,1)
 await assert.rejects(f.command('router.lookup.complete',{conversationId:'other',lookupId:first.result.lookup.id,status:'failed'}),{code:'ROUTER_LOOKUP_SCOPE'})
})
for(const change of ['version','retract'])test('late '+change+' result is durably discarded, never enqueued or replayed',async t=>{
 const f=await fixture(t),lookup=(await f.command('router.lookup.submit',f.args)).result.lookup
 await f.command('source.record-direct',{source:{sourceId:'source-v2',groupId:'room',messageId:'message',actorId:'alice',version:2,text:change==='retract'?'[withdrawn]':'Updated current query',...change==='retract'?{retracted:true}:{}},conversation:{conversationId:'room'}})
 const before=await f.query('router.inbox-count',{conversationId:'room'})
 const completion={conversationId:'room',lookupId:lookup.id,status:'completed',summary:'Late old snapshot',limitations:[],snapshots:[{taskId:'task',requirementRevision:1,controlRevision:1,contextRevision:0,runSequence:1,status:'active',leaseEpoch:0}]}
 const value=await f.command('router.lookup.complete',completion);assert.equal(value.result.lookup.state,'discarded');assert.equal(value.result.event,undefined)
 await f.command('router.lookup.complete',completion);assert.equal(await f.query('router.inbox-count',{conversationId:'room'}),before);assert.equal((await f.query('router.lookup.pending')).length,0)
})
test('only exact submitted tasks/versions form result evidence; completion has one internal event and no human-source privileges',async t=>{
 const f=await fixture(t),lookup=(await f.command('router.lookup.submit',f.args)).result.lookup
 const value=await f.command('router.lookup.complete',{conversationId:'room',lookupId:lookup.id,status:'completed',summary:'Snapshot read',limitations:[],snapshots:[{taskId:'task',requirementRevision:1,controlRevision:1,contextRevision:0,runSequence:1,status:'active',leaseEpoch:0}]})
 assert.equal(value.result.lookup.state,'completed');assert.equal(value.result.event.kind,'router.lookup.completed');assert.equal(value.result.event.sourceId,undefined)
 const after=await f.query('router.inbox-count',{conversationId:'room'});await f.command('router.lookup.complete',{conversationId:'room',lookupId:lookup.id,status:'interrupted'});assert.equal(await f.query('router.inbox-count',{conversationId:'room'}),after)
})
test('task revision changes produce stale metadata, not an obsolete successful summary',async t=>{
 const f=await fixture(t),lookup=(await f.command('router.lookup.submit',f.args)).result.lookup
 await f.command('task.control',{taskId:'task',control:'paused',expectedControlRevision:1})
 const value=await f.command('router.lookup.complete',{conversationId:'room',lookupId:lookup.id,status:'completed',summary:'Obsolete running status',limitations:[],snapshots:[{taskId:'task',requirementRevision:1,controlRevision:1,contextRevision:0,runSequence:1,status:'active',leaseEpoch:0}]})
 assert.equal(value.result.lookup.state,'stale');assert.equal(value.result.event.lookupResult.summary,undefined)
})
test('durable admission queues independent conversations without granting cross-conversation reads',async t=>{
 const f=await fixture(t)
 await f.command('router.lookup.submit',f.args)
 for(const room of ['other','third']){
  await f.command('source.record-direct',{source:{sourceId:room+'-source',groupId:room,messageId:room+'-message',actorId:'alice',version:1,text:'Read retained status'},conversation:{conversationId:room}})
  await f.command('router.ensure',{conversationId:room,sessionId:room+'-router'})
  if(room==='third')await f.command('task.create',{taskId:'third-task',groupId:room,conversationId:room,ownerActorId:'alice',request:'Retained task'})
  const args={conversationId:room,generation:1,sourceId:room+'-source',messageVersion:1,operationId:room+'-lookup',taskIds:[room==='other'?'foreign':'third-task']}
  await f.command('router.lookup.submit',args)
 }
 assert.equal((await f.query('router.lookup.pending')).length,3)
})

test('same-version retracted legacy source cannot deliver a late result even without an authorizationRevoked flag',async t=>{
 const f=await fixture(t),lookup=(await f.command('router.lookup.submit',f.args)).result.lookup
 const db=new DatabaseSync(f.dbPath)
 try{db.prepare("UPDATE dynamic_sources SET body=json_set(body,'$.retracted',json('true')) WHERE id=?").run('source')}finally{db.close()}
 const source=(await f.query('source.list')).find(row=>row.sourceId==='source');assert.equal(source.version,1);assert.equal(source.authorizationRevoked,undefined)
 const before=await f.query('router.inbox-count',{conversationId:'room'})
 const value=await f.command('router.lookup.complete',{conversationId:'room',lookupId:lookup.id,status:'failed'})
 assert.equal(value.result.lookup.state,'discarded');assert.equal(value.result.event,undefined);assert.equal(await f.query('router.inbox-count',{conversationId:'room'}),before)
})
for(const change of ['lease','completion'])test('task '+change+' within the same run rejects the old successful snapshot',async t=>{
 const f=await fixture(t)
 await initializeMemoryTaskWorkspace(f.store,join(f.root,'workspaces'),'task')
 let claimed
 if(change==='completion')claimed=(await f.command('task.claim',{taskId:'task'})).result
 const before=await f.query('task.get',{taskId:'task'}),snap=Object.fromEntries(['taskId','requirementRevision','controlRevision','contextRevision','runSequence','status','leaseEpoch'].map(key=>[key,before[key]??0]))
 const lookup=(await f.command('router.lookup.submit',f.args)).result.lookup
 if(change==='lease')await f.command('task.claim',{taskId:'task'})
 else await f.command('task.complete',{binding:claimed.binding,summary:'Task completed while the lookup was running',result:{evidence:['fixture:complete'],limitations:[]}})
 const after=await f.query('task.get',{taskId:'task'})
 for(const key of ['requirementRevision','controlRevision','contextRevision','runSequence'])assert.equal(after[key],before[key],key+' did not change')
 assert.notEqual(after[change==='lease'?'leaseEpoch':'status'],before[change==='lease'?'leaseEpoch':'status'])
 const value=await f.command('router.lookup.complete',{conversationId:'room',lookupId:lookup.id,status:'completed',summary:'Old task snapshot',limitations:[],snapshots:[snap]})
 assert.equal(value.result.lookup.state,'stale');assert.equal(value.result.event.lookupResult.summary,undefined)
})
