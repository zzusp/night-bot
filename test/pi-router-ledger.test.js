import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {validateTaskLedger,ledgerDigest} from '../src/tasks/ledger-archive.js'
import {initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'night-router-ledger-'))
  const config={dbPath:join(root,'tasks.sqlite'),initialize:true,instanceId:'router-ledger',ownerActorId:'operator',webActorId:'operator'}
  let store=await openDynamicTaskStore(config),sequence=0
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  const command=(kind,args,id='test-'+(++sequence))=>store.command({id,kind,args})
  const query=(kind,args={})=>store.query({kind,...args})
  const conversationId='conversation-a',sourceId='source-a'
  await command('source.record-direct',{source:{sourceId,groupId:conversationId,messageId:'user-order',actorId:'alice',version:1,
    text:'First verify A; only after the evidence is accepted, produce B'},conversation:{conversationId}})
  await command('router.ensure',{conversationId,sessionId:'router-generation-one'})
  const state=await query('router.get',{conversationId}),generation=state.generation
  const plan=async(extra={})=>{
    const result=await command('router.plan',{conversationId,generation,sourceId,messageVersion:1,operationId:'original-plan',
      tasks:[{taskId:'a',request:'Verify A',ownerActorId:'alice',groupId:conversationId},
        {taskId:'b',request:'Produce B after verification',ownerActorId:'alice',groupId:conversationId}],
      dependencies:[{taskId:'b',prerequisiteTaskId:'a',condition:'Verification evidence is complete and accepted'}],...extra})
    for(const task of await query('task.list')){
      if(task.workspaceInitialization?.state==='pending')await initializeMemoryTaskWorkspace(store,join(root,'workspaces'),task.taskId)
    }
    return result
  }
  async function complete(taskId='a',extra={},drain=true) {
    const claimed=(await command('task.claim',{taskId})).result
    await command('task.complete',{binding:claimed.binding,summary:'Verification finished',
      result:{evidence:['proof:a'],limitations:[]},...extra})
    const event=(await query('task.events')).events.findLast(row=>row.taskId===taskId)
    if(drain){await command('wake.ack',{binding:claimed.binding,wakeIds:claimed.wakeIds});await command('task.drained',{binding:claimed.binding})}
    return {binding:claimed.binding,event,wakeIds:claimed.wakeIds}
  }
  async function evaluation(extra={}) {
    const dependency=(await query('router.dependencies',{conversationId,taskId:'b'}))[0]
    const a=await query('task.get',{taskId:'a'}),b=await query('task.get',{taskId:'b'})
    const event=(await query('task.events')).events.findLast(row=>row.taskId==='a')
    return {conversationId,generation,operationId:'accept-a',dependencyId:dependency.id,
      completionEventId:event.id,prerequisiteRequirementRevision:a.requirementRevision,
      requirementRevision:b.requirementRevision,controlRevision:b.controlRevision,
      arrangementRevision:dependency.arrangementRevision,decision:'satisfied',evidence:['proof:a'],...extra}
  }
  return {get store(){return store},command,query,plan,complete,evaluation,conversationId,sourceId,generation,
    async reopen(){await store.close();store=await openDynamicTaskStore({...config,initialize:false})}}
}

test('A completion is not dependency acceptance; evidence and the current Router decision release B once even when notification is unknown',async t=>{
  const f=await fixture(t);await f.plan()
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  const {event}=await f.complete('a',{notification:{destination:f.conversationId,text:'A verified'}})
  assert.equal(event.kind,'task.completed')
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  const notice=(await f.query('notification.list'))[0]
  await f.command('notification.start',{notificationId:notice.id})
  await f.reopen()
  assert.equal((await f.query('notification.get',{notificationId:notice.id})).state,'unknown')
  assert.ok((await f.query('router.inbox',{conversationId:f.conversationId})).some(row=>row.eventId===event.id),'completion reference survives restart independently of notification')
  const args=await f.evaluation()
  await f.command('router.evaluate',args)
  const wakes=await f.query('wake.list',{taskId:'b'})
  await f.command('router.evaluate',args)
  assert.deepEqual(await f.query('wake.list',{taskId:'b'}),wakes,'stable business operation survives different command IDs')
  const claim=(await f.command('task.claim',{taskId:'b'})).result
  assert.equal(claim.task.taskId,'b');assert.ok(claim.wakeIds.length>0)
})

test('insufficient evidence and explicit wait or continue never release B',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  await assert.rejects(f.command('router.evaluate',await f.evaluation({evidence:[]})),/EVIDENCE|DEPENDENC|ARGUMENT/)
  await f.command('router.evaluate',await f.evaluation({operationId:'wait-for-proof',decision:'wait',evidence:[]}))
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  await f.command('router.evaluate',await f.evaluation({operationId:'needs-more-work',decision:'continue',evidence:['proof:a']}))
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
})

test('a prior completion and assessment cannot authorize B after A is reopened',async t=>{
  const f=await fixture(t);await f.plan();const {binding,wakeIds}=await f.complete('a',{},false),old=await f.evaluation()
  await assert.rejects(f.command('task.reopen',{taskId:'a',expectedRequirementRevision:1,objective:'Verify missing proof under the same goal'}),/QUIESCENT/)
  await f.command('wake.ack',{binding,wakeIds});await f.command('task.drained',{binding})
  await f.command('task.reopen',{taskId:'a',expectedRequirementRevision:1,objective:'Verify missing proof under the same goal'})
  await assert.rejects(f.command('router.evaluate',old),/STALE|REVISION|DEPENDENC|VERSION/)
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
})

test('B cancellation defeats a previously prepared successful dependency evaluation',async t=>{
  const f=await fixture(t);await f.plan();await f.complete();const old=await f.evaluation()
  await f.command('task.control',{taskId:'b',control:'cancelled',expectedControlRevision:1})
  await assert.rejects(f.command('router.evaluate',old),/STALE|REVISION|CANCEL|ACTIVE|DEPENDENC|VERSION/)
  const task=await f.query('task.get',{taskId:'b'})
  assert.equal(task.control,'cancelled');assert.equal(task.status,'cancelled')
})

test('self-dependencies and cycles reject the complete plan atomically',async t=>{
  const f=await fixture(t)
  for(const dependencies of [[{taskId:'a',prerequisiteTaskId:'a',condition:'self'}],
    [{taskId:'b',prerequisiteTaskId:'a',condition:'after a'},{taskId:'a',prerequisiteTaskId:'b',condition:'after b'}]]) {
    await assert.rejects(f.plan({operationId:'bad-plan-'+dependencies.length,dependencies}),/CYCLE|SELF|DEPENDENC/)
    assert.deepEqual(await f.query('task.list'),[],'a rejected dependency graph must not leak runnable tasks')
  }
})

test('Router plan uses current source versions and cannot borrow another conversation authorization',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.plan({messageVersion:2}),/SOURCE|VERSION|STALE/)
  await f.command('router.ensure',{conversationId:'foreign-room',sessionId:'foreign-router'})
  const foreign=await f.query('router.get',{conversationId:'foreign-room'})
  await assert.rejects(f.plan({conversationId:'foreign-room',generation:foreign.generation}),/SOURCE|CONVERSATION|SCOPE/)
  assert.deepEqual(await f.query('task.list'),[])
})

async function restoreStore(t) {
  const root=await mkdtemp(join(tmpdir(),'night-router-restored-'))
  const store=await openDynamicTaskStore({dbPath:join(root,'tasks.sqlite'),initialize:true,instanceId:'restored',ownerActorId:'operator',webActorId:'operator'})
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  return store
}
const reseal = snapshot => ({...snapshot,digest:ledgerDigest({version:snapshot.version,taskId:snapshot.taskId,tables:snapshot.tables})})

test('single-task B archive excludes A content and Router history; isolated restore holds its prerequisite and all delivery',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  await f.command('router.evaluate',await f.evaluation())
  const snapshot=await f.store.exportTaskArchive('b')
  assert.equal(snapshot.version,2)
  assert.deepEqual(snapshot.tables.tasks.map(row=>row.body.taskId),['b'])
  assert.equal(snapshot.tables.dependencies.length,1)
  assert.equal(snapshot.tables.dependencies[0].body.prerequisiteTaskId,'a')
  assert.doesNotMatch(JSON.stringify(snapshot),/router-generation-one|Verification finished/,'shared journal and A result body are not B archive material')
  const target=await restoreStore(t)
  const imported=await target.importTaskArchive(snapshot)
  assert.equal(imported.paused,true)
  const task=await target.query({kind:'task.get',taskId:'b'})
  assert.equal(task.control,'paused');assert.equal(task.archiveRestore.reviewRequired,true)
  assert.equal(await target.query({kind:'task.get',taskId:'a'}),null)
  const dependencies=await target.query({kind:'router.dependencies',taskId:'b'})
  assert.equal(dependencies[0].state,'pending');assert.equal(dependencies[0].archiveRestoreHold,true)
  assert.equal(dependencies[0].evaluationId,undefined)
  await assert.rejects(target.command({id:'not-reviewed',kind:'task.claim',args:{taskId:'b'}}),{code:'ROUTER_DEPENDENCY_PENDING'})
  assert.ok((await target.query({kind:'notification.list'})).every(row=>row.archiveRestoreHold===true),'restore cannot create unheld deliveries')
})

test('old v1 task ledger validates but Topic facts restore only as held historical audit',async t=>{
  const source=await restoreStore(t)
  await source.command({id:'historical-task',kind:'task.create',args:{taskId:'legacy',request:'Retain a historical task without replay'}})
  const current=await source.exportTaskArchive('legacy')
  const tables=structuredClone(current.tables)
  delete tables.source_links;delete tables.dependencies;delete tables.completion_evaluations
  delete tables.historical_topic_facts
  tables.topic_facts=[{id:'old-fact',body:{id:'old-fact',taskId:'legacy',kind:'completed',summary:'Historical evidence only'}}]
  const old=reseal({version:1,taskId:'legacy',tables})
  validateTaskLedger(old)
  const target=await restoreStore(t)
  await target.importTaskArchive(old)
  const reexported=await target.exportTaskArchive('legacy')
  assert.equal(reexported.version,2)
  assert.equal(reexported.tables.historical_topic_facts.length,1)
  assert.equal(reexported.tables.historical_topic_facts[0].body.archiveRestoreHold,true)
  assert.equal((await target.query({kind:'task.get',taskId:'legacy'})).control,'paused')
  await assert.rejects(target.command({id:'legacy-review-required',kind:'task.claim',args:{taskId:'legacy'}}),{code:'TASK_ARCHIVE_RESTORE_REVIEW_REQUIRED'})
  assert.deepEqual(await target.query({kind:'source.list',unrouted:true}),[],'historical facts do not become new source commands')
})

test('archive validation rejects foreign rows, uncovered sources and added shared Router tables even after digest recomputation',async t=>{
  const source=await restoreStore(t)
  await source.command({id:'owned-source',kind:'source.record',args:{sourceId:'b-source',groupId:'conversation-a',messageId:'request',actorId:'alice',text:'Create only B'}})
  await source.command({id:'owned-task',kind:'task.create',args:{taskId:'b',request:'Produce B',sourceRefs:['b-source']}})
  const snapshot=await source.exportTaskArchive('b')
  const foreign=structuredClone(snapshot)
  foreign.tables.task_events.push({id:'foreign-event',body:{id:'foreign-event',taskId:'a',kind:'task.completed'}})
  assert.throws(()=>validateTaskLedger(reseal(foreign)),/ROW_SCOPE_INVALID/)
  const uncovered=structuredClone(snapshot);uncovered.tables.sources=[]
  assert.throws(()=>validateTaskLedger(reseal(uncovered)),/SOURCE_MISSING/)
  const shared=structuredClone(snapshot);shared.tables.router_conversations=[]
  assert.throws(()=>validateTaskLedger(reseal(shared)),/LEDGER_INVALID/)
})

test('triage commits handling and reply independently with durable per-source-version deduplication',async t=>{
  const f=await fixture(t),sources=[]
  for(let index=0;index<4;index++){
    const source={sourceId:'four-'+index,groupId:f.conversationId,messageId:'four-'+index,actorId:'alice',version:1,text:'Original '+index}
    await f.command('source.record-direct',{source,conversation:{conversationId:f.conversationId}});sources.push(source)
  }
  const dispositions=sources.map((source,index)=>({sourceId:source.sourceId,messageVersion:1,
    needsHandling:index>=2,...index%2?{reply:'Concise reply '+index}:{},reason:'Independent handling/reply choice'}))
  await f.command('triage.commit',{dispositions})
  const pending=(await f.query('router.inbox',{conversationId:f.conversationId})).filter(row=>sources.some(source=>source.sourceId===row.sourceId))
  assert.deepEqual(pending.map(row=>row.sourceId).sort(),['four-2','four-3'])
  const notices=(await f.query('notification.list')).filter(row=>row.kind==='triage-reply')
  assert.equal(notices.length,2)
  await f.command('triage.commit',{dispositions})
  assert.equal((await f.query('router.inbox',{conversationId:f.conversationId})).filter(row=>sources.some(source=>source.sourceId===row.sourceId)).length,2)
  assert.equal((await f.query('notification.list')).filter(row=>row.kind==='triage-reply').length,2)
  await f.reopen()
  assert.equal((await f.query('router.inbox',{conversationId:f.conversationId})).filter(row=>sources.some(source=>source.sourceId===row.sourceId)).length,2)
})

test('same-goal rework follows the drained original task version and releases B only after accepting the new completion',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  const old=await f.evaluation()
  await f.command('router.evaluate',{...old,operationId:'request-rework',decision:'continue'})
  await f.command('router.task-action',{conversationId:f.conversationId,generation:f.generation,sourceId:f.sourceId,messageVersion:1,
    operationId:'reopen-same-goal',kind:'task.reopen',sameGoal:true,
    action:{taskId:'a',expectedRequirementRevision:1,expectedControlRevision:1,objective:'Verify A'}})
  const waiting=(await f.query('router.dependencies',{taskId:'b'}))[0]
  assert.equal(waiting.prerequisiteRequirementRevision,2);assert.equal(waiting.state,'pending');assert.equal(waiting.evaluationId,undefined)
  await assert.rejects(f.command('router.evaluate',old),/STALE/)
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  await f.complete()
  await f.command('router.evaluate',await f.evaluation({operationId:'accept-reworked-a'}))
  const a=await f.query('task.get',{taskId:'a'}),b=(await f.command('task.claim',{taskId:'b'})).result.task
  assert.equal(a.requirementRevision,2);assert.equal(b.requirementRevision,1)
  assert.equal((await f.query('wake.list',{taskId:'b'})).filter(wake=>wake.kind==='dependency.satisfied').length,1)
})

test('the authenticated Router can cancel a task using another sender as provenance',async t=>{
  const f=await fixture(t);await f.plan()
  await f.command('source.record-direct',{source:{sourceId:'bob-cancel',groupId:f.conversationId,messageId:'cancel',actorId:'bob',version:1,text:'Cancel the work'},conversation:{conversationId:f.conversationId}})
  await f.command('router.task-action',{conversationId:f.conversationId,generation:f.generation,
    sourceId:'bob-cancel',messageVersion:1,operationId:'router-cancel',kind:'task.control',
    action:{taskId:'a',expectedRequirementRevision:1,expectedControlRevision:1,control:'cancelled'}})
  assert.equal((await f.query('task.get',{taskId:'a'})).control,'cancelled')
})

test('a changed source requests reassessment but cannot veto the current Router decision',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  const accepted=await f.evaluation();await f.command('router.evaluate',accepted)
  await f.command('source.record-direct',{source:{sourceId:'source-a-v2',groupId:f.conversationId,messageId:'user-order',actorId:'alice',version:2,
    text:'Do not produce B until I review it'},conversation:{conversationId:f.conversationId}})
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  await f.command('router.evaluate',{...accepted,operationId:'router-reassessed'})
  assert.equal((await f.command('task.claim',{taskId:'b'})).result.task.taskId,'b')
})

test('all prerequisite assessments are required; accepting A cannot bypass an independent prerequisite C',async t=>{
  const f=await fixture(t)
  await f.plan({tasks:[{taskId:'a',request:'Verify A'},{taskId:'c',request:'Verify C'},{taskId:'b',request:'Use verified A and C'}],
    dependencies:[{taskId:'b',prerequisiteTaskId:'a',condition:'A verified'},{taskId:'b',prerequisiteTaskId:'c',condition:'C verified'}]})
  await f.complete();await f.command('router.evaluate',await f.evaluation())
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
  const {event}=await f.complete('c'),dependency=(await f.query('router.dependencies',{taskId:'b'})).find(row=>row.prerequisiteTaskId==='c')
  await f.command('router.evaluate',await f.evaluation({operationId:'accept-c',dependencyId:dependency.id,completionEventId:event.id}))
  assert.equal((await f.command('task.claim',{taskId:'b'})).result.task.taskId,'b')
})

test('a fabricated evidence reference cannot release a dependency even when it is nonempty',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  await assert.rejects(f.command('router.evaluate',await f.evaluation({evidence:['proof:not-in-current-result']})),/EVIDENCE/)
  await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
})

test('stable plan operation IDs survive physical-session changes without duplicating tasks or effects',async t=>{
  const f=await fixture(t),first=await f.plan(),before=await f.query('task.list')
  const replay=await f.plan({sessionId:'replacement-physical-session',generation:f.generation+1})
  assert.deepEqual(replay.result.tasks,first.result.tasks)
  assert.deepEqual(await f.query('task.list'),before)
  assert.equal((await f.query('wake.list',{taskId:'a'})).length,1)
  await assert.rejects(f.plan({sessionId:'replacement-physical-session',generation:f.generation+1,
    tasks:[{taskId:'a',request:'Different unauthorized plan'}]}),/OPERATION_CONFLICT/)
})

test('a consumed Router event cannot advance its business cursor twice under a new operation ID',async t=>{
  const f=await fixture(t)
  await f.command('triage.commit',{dispositions:[{sourceId:f.sourceId,messageVersion:1,needsHandling:true,reason:'Needs Router'}]})
  const event=(await f.query('router.inbox',{conversationId:f.conversationId}))[0]
  await f.command('router.settle',{conversationId:f.conversationId,generation:f.generation,eventIds:[event.id],operationId:'settle-first'})
  const first=await f.query('router.get',{conversationId:f.conversationId})
  await f.command('router.settle',{conversationId:f.conversationId,generation:f.generation,eventIds:[event.id],operationId:'settle-duplicate'})
    .catch(error=>assert.equal(error.code,'ROUTER_EVENT_ALREADY_CONSUMED'))
  assert.equal((await f.query('router.get',{conversationId:f.conversationId})).cursor,first.cursor)
})

test('archiving A retains its original completion event and evidence for B acceptance without copying A into B',async t=>{
  const f=await fixture(t);await f.plan();const {event}=await f.complete()
  const args=await f.evaluation()
  await f.command('task.archive',{taskId:'a',actorId:'operator'})
  await f.reopen()
  const inbox=await f.query('router.inbox',{conversationId:f.conversationId})
  assert.equal(inbox.find(row=>row.eventId===event.id).taskEvent.id,event.id)
  await f.command('router.evaluate',args)
  assert.equal((await f.command('task.claim',{taskId:'b'})).result.task.taskId,'b')
})

test('new authenticated control sources remain complete in a portable task archive and restore held',async t=>{
  const f=await fixture(t)
  await f.plan({tasks:[{taskId:'a',request:'Verify A',ownerActorId:'alice',groupId:f.conversationId}],dependencies:[]})
  for(const [index,control] of ['paused','active','cancelled'].entries()){
    const sourceId='control-source-'+index,task=await f.query('task.get',{taskId:'a'})
    await f.command('source.record-direct',{source:{sourceId,groupId:f.conversationId,messageId:sourceId,actorId:'alice',version:1,text:control+' the original verification task'},conversation:{conversationId:f.conversationId}})
    await f.command('router.task-action',{conversationId:f.conversationId,generation:f.generation,sourceId,messageVersion:1,operationId:'control-'+index,kind:'task.control',action:{taskId:'a',control,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}})
    const snapshot=await f.store.exportTaskArchive('a')
    validateTaskLedger(snapshot)
    assert.ok(snapshot.tables.sources.some(row=>row.body.sourceId===sourceId),'control authorization source must accompany its task-only link')
    assert.ok(snapshot.tables.source_links.some(row=>row.body.sourceId===sourceId),'the actual control receipt remains attributable')
    const target=await restoreStore(t)
    await target.importTaskArchive(snapshot)
    const restored=await target.query({kind:'task.get',taskId:'a'})
    assert.equal(restored.archiveRestore.reviewRequired,true)
    assert.equal((await target.query({kind:'source.get',sourceId})).text,control+' the original verification task')
    await assert.rejects(target.command({id:'no-automatic-control-'+index,kind:'task.claim',args:{taskId:'a'}}),/RESTORE|REVIEW|CANCEL|CONTROL/)
    assert.deepEqual(await target.query({kind:'notification.list'}),[])
  }
})

test('ordinary Web task revisions and control changes rebind B dependencies before current evidence evaluation',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  await f.command('task.revise',{taskId:'b',expectedRequirementRevision:1,objective:'Produce the corrected B after current verification'})
  await f.command('task.control',{taskId:'b',control:'paused',expectedControlRevision:1})
  await f.command('task.control',{taskId:'b',control:'active',expectedControlRevision:2})
  const task=await f.query('task.get',{taskId:'b'}),dependency=(await f.query('router.dependencies',{taskId:'b'}))[0]
  assert.equal(task.requirementRevision,2);assert.equal(task.controlRevision,3)
  assert.equal(dependency.requirementRevision,task.requirementRevision);assert.equal(dependency.controlRevision,task.controlRevision)
  await f.command('router.evaluate',await f.evaluation())
  assert.equal((await f.command('task.claim',{taskId:'b'})).result.task.taskId,'b')
})

test('stable task action retries ignore physical generation and live binding without duplicating source context',async t=>{
  const f=await fixture(t);await f.plan()
  const claimed=(await f.command('task.claim',{taskId:'a'})).result
  const args={conversationId:f.conversationId,generation:f.generation,sourceId:f.sourceId,messageVersion:1,operationId:'stable-supplement',kind:'task.supplement',hostLiveBinding:claimed.binding,
    action:{taskId:'a',expectedRequirementRevision:1,expectedControlRevision:1,messageId:'stable-supplement',text:'Retain one exact source supplement'}}
  const first=await f.command('router.task-action',args),snapshot=await f.query('task.get',{taskId:'a'})
  const replay=await f.command('router.task-action',{...args,generation:args.generation+1,hostLiveBinding:{sessionId:'new-actor',leaseEpoch:2}})
  assert.deepEqual(replay.result,first.result);assert.deepEqual(await f.query('task.get',{taskId:'a'}),snapshot)
  assert.equal(snapshot.request.split('Retain one exact source supplement').length-1,1)
  assert.equal((await f.query('router.source-links',{taskId:'a'})).filter(row=>row.relation==='task.supplement').length,1)
  await assert.rejects(f.command('router.task-action',{...args,action:{...args.action,text:'Changed action under the same stable ID'}}),/OPERATION_CONFLICT/)
})

test('Router can atomically replace dependencies even during a live lease, preserving version and cycle guards',async t=>{
  const f=await fixture(t);await f.plan({tasks:[{taskId:'a',request:'Verify A'},{taskId:'b',request:'Produce B'},{taskId:'c',request:'Verify C'}]})
  const args={conversationId:f.conversationId,generation:f.generation,sourceId:f.sourceId,messageVersion:1,operationId:'arrange-b',kind:'task.arrange',action:{taskId:'b',expectedRequirementRevision:1,expectedControlRevision:1,expectedArrangementRevision:1,dependencies:[{prerequisiteTaskId:'c',condition:'Use C instead of A'}]}}
  await f.command('router.task-action',args)
  const task=await f.query('task.get',{taskId:'b'}),rows=await f.query('router.dependencies',{taskId:'b'})
  assert.equal(task.arrangementRevision,2);assert.deepEqual(rows.map(row=>row.prerequisiteTaskId),['c'])
  await assert.rejects(f.command('router.task-action',{...args,operationId:'stale-arrangement'}),/ARRANGEMENT_STALE/)
  await assert.rejects(f.command('router.task-action',{...args,operationId:'self-arrangement',action:{...args.action,expectedArrangementRevision:2,dependencies:[{prerequisiteTaskId:'b',condition:'Illegal self dependency'}]}}),/DEPENDENC/)
  assert.equal((await f.query('task.get',{taskId:'b'})).arrangementRevision,2);assert.deepEqual(await f.query('router.dependencies',{taskId:'b'}),rows)
  await f.command('router.task-action',{...args,operationId:'clear-arrangement',action:{...args.action,expectedArrangementRevision:2,dependencies:[]}})
  assert.deepEqual(await f.query('router.dependencies',{taskId:'b'}),[])
  const snapshot=await f.store.exportTaskArchive('b')
  assert.ok(snapshot.tables.task_events.some(row=>row.body.kind==='task.arranged'),'removed arrangements remain a task-only audit trail')
  await f.command('task.claim',{taskId:'b'})
  await f.command('router.task-action',{...args,operationId:'active-arrangement',action:{...args.action,expectedArrangementRevision:3,dependencies:[]}})
  assert.equal((await f.query('task.get',{taskId:'b'})).arrangementRevision,4)
})

test('撤回墓碑保留全部来源版本且不复活分诊，真实 Router 仍能自主调度',async t=>{
 const f=await fixture(t)
 const tombstone={sourceId:'retracted-v2',groupId:f.conversationId,messageId:'user-order',actorId:'alice',version:2,text:'[消息已撤回]',retracted:true}
 await f.command('source.record-direct',{source:tombstone})
 const sources=await f.query('source.list')
 assert.equal(sources.length,2);assert.ok(sources.every(source=>source.authorizationRevoked))
 assert.equal(sources.find(source=>source.sourceId===f.sourceId).text,'First verify A; only after the evidence is accepted, produce B')
 assert.equal(sources.find(source=>source.retracted).routed,true)
 assert.deepEqual(await f.query('triage.pending',{conversationId:f.conversationId}),[])
 await assert.rejects(f.command('triage.commit',{dispositions:[{sourceId:f.sourceId,messageVersion:1,needsHandling:true,reply:'Too late',reason:'Old decision'}]}),/ROUTER_SOURCE_STALE/)
 await f.reopen();await f.command('source.record-direct',{source:tombstone})
 assert.deepEqual(await f.query('source.list'),sources)
 assert.deepEqual(await f.query('task.list'),[]);assert.deepEqual(await f.query('notification.list'),[])
 await f.plan()
 assert.equal((await f.query('task.list')).length,2,'原来源只作审计，创建权限来自真实 Router')
 const task=await f.query('task.get',{taskId:'a'})
 await f.command('router.task-action',{conversationId:f.conversationId,generation:f.generation,sourceId:tombstone.sourceId,messageVersion:2,operationId:'router-stop',kind:'task.control',action:{taskId:'a',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,control:'cancelled'}})
 assert.equal((await f.query('task.get',{taskId:'a'})).control,'cancelled')
})

test('同ID跨作者的撤回整笔回滚，不能撤销原作者来源',async t=>{
 const f=await fixture(t),before=await f.query('source.list')
 await assert.rejects(f.command('source.record-direct',{source:{sourceId:'forged-retraction',groupId:f.conversationId,messageId:'user-order',actorId:'mallory',version:2,text:'[消息已撤回]',retracted:true}}),/DYNAMIC_SOURCE_CONFLICT/)
 assert.deepEqual(await f.query('source.list'),before)
 assert.equal((await f.query('triage.pending',{conversationId:f.conversationId})).length,1)
})

test('Router activation of completed A requires a fresh current completion assessment before B can run',async t=>{
 const f=await fixture(t);await f.plan();await f.complete();const old=await f.evaluation();await f.command('router.evaluate',old)
 const before=await f.query('task.get',{taskId:'a'})
 await f.command('router.task-action',{conversationId:f.conversationId,generation:f.generation,operationId:'restart-completed',kind:'task.control',action:{taskId:'a',expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision,control:'active'}})
 const task=await f.query('task.get',{taskId:'a'}),dependency=(await f.query('router.dependencies',{taskId:'b'}))[0]
 assert.equal(task.requirementRevision,before.requirementRevision+1);assert.equal(dependency.prerequisiteRequirementRevision,task.requirementRevision);assert.equal(dependency.state,'pending')
 await f.complete()
 await assert.rejects(f.command('task.claim',{taskId:'b'}),/DEPENDENC/)
 await assert.rejects(f.command('router.evaluate',{...old,operationId:'old-assessment'}),/STALE/)
 await f.command('router.evaluate',await f.evaluation({operationId:'current-assessment'}))
 assert.equal((await f.command('task.claim',{taskId:'b'})).result.task.taskId,'b')
})

test('Router stop of an archived task retains new source audit and subsequent activation preserves original receipts',async t=>{
 const f=await fixture(t);await f.plan({tasks:[{taskId:'a',request:'Keep original proof'}],dependencies:[]});await f.complete()
 const before=await f.query('task.get',{taskId:'a'}),original=(await f.store.exportTaskArchive('a')).tables.receipts
 await f.command('task.archive',{taskId:'a',actorId:'operator'})
 await f.command('source.record-direct',{source:{sourceId:'archived-stop',groupId:f.conversationId,messageId:'stop',actorId:'bob',version:1,text:'Router decides to stop'},conversation:{conversationId:f.conversationId}})
 const base={conversationId:f.conversationId,generation:f.generation,kind:'task.control',action:{taskId:'a',expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision}}
 await f.command('router.task-action',{...base,operationId:'stop-archived',sourceId:'archived-stop',messageVersion:1,action:{...base.action,control:'paused'}})
 const stopped=await f.query('task.get',{taskId:'a'});assert.ok(stopped.archivedAt);assert.ok(stopped.sourceRefs.includes('archived-stop'))
 validateTaskLedger(await f.store.exportTaskArchive('a'))
 await f.command('router.task-action',{...base,operationId:'start-archived',action:{...base.action,control:'active'}})
 const current=await f.query('task.get',{taskId:'a'}),snapshot=await f.store.exportTaskArchive('a')
 assert.equal(current.archivedAt,undefined);assert.equal(current.status,'active');assert.equal(current.sessionId,before.sessionId)
 assert.ok(original.every(row=>snapshot.tables.receipts.some(next=>next.id===row.id&&next.digest===row.digest&&JSON.stringify(next.body)===JSON.stringify(row.body))))
 await f.complete();await f.command('task.archive',{taskId:'a',actorId:'operator'});validateTaskLedger(await f.store.exportTaskArchive('a'))
})

test('completion probe is conversation-scoped and summarized handoff cannot abort',async t=>{
  const f=await fixture(t);await f.plan();await f.complete()
  assert.equal(await f.query('router.pending-completion',{conversationId:f.conversationId}),true)
  assert.equal(await f.query('router.pending-completion',{conversationId:'other'}),false)
  const pending=await f.query('router.inbox',{conversationId:f.conversationId})
  await f.command('router.settle',{conversationId:f.conversationId,generation:f.generation,eventIds:pending.map(row=>row.id),operationId:'settled'})
  assert.equal(await f.query('router.pending-completion',{conversationId:f.conversationId}),false)
  const args={conversationId:f.conversationId,generation:f.generation,handoffId:'guard-summary'}
  await f.command('router.handoff.begin',args)
  await f.command('router.handoff.ready',{...args,handoff:{currentIntent:'Test'},commitProof:{sessionId:'router-generation-one',commitId:'proof'}})
  await assert.rejects(f.command('router.handoff.abort',{...args,safeToResume:true}),/ROUTER_ROTATION_STALE/)
  assert.equal((await f.query('router.rotations',{conversationId:f.conversationId}))[0].state,'summarized')
})

test('an ignored historical source can supplement the existing task with versioned links, without creating a new task',async t=>{
 const h=await fixture(t)
 await h.command('source.record-direct',{source:{sourceId:'historical',groupId:h.conversationId??'conversation-a',messageId:'background',actorId:'alice',version:1,text:'Use attachment version B'},conversation:{conversationId:'conversation-a'}})
 await h.command('triage.commit',{dispositions:[{sourceId:'historical',messageVersion:1,needsHandling:false,reason:'Background only'}]})
 await h.plan()
 const before=await h.query('task.get',{taskId:'a'})
 await h.command('router.task-action',{conversationId:'conversation-a',generation:1,sourceId:'historical',messageVersion:1,operationId:'attach-background',kind:'task.supplement',action:{taskId:'a',messageId:'history-supplement',expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision,text:'Use attachment version B'},quote:'attachment version B'})
 const after=await h.query('task.get',{taskId:'a'}),links=await h.query('router.source-links',{taskId:'a'})
 assert.equal(after.sessionId,before.sessionId);assert.ok(after.sourceRefs.includes('historical'));assert.match(after.request,/Use attachment version B/)
 assert.ok(links.some(link=>link.sourceId==='historical'&&link.messageVersion===1&&link.relation==='task.supplement'))
 assert.equal((await h.query('task.list')).length,2)
 assert.equal((await h.query('router.source-status',{sourceId:'historical'})).event,null)
})
