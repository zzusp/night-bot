import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-live-transition-')),db=await openDynamicTaskStore({dbPath:join(root,'db'),instanceId:'live-transition',initialize:true});let n=0;t.after(async()=>{await db.close();await rm(root,{recursive:true,force:true})});const command=(kind,args,id=kind+':'+(++n))=>db.command({kind,args,id}),query=(kind,args={})=>db.query({kind,...args});await command('task.create',{taskId:'task',groupId:'group',ownerActorId:'owner',request:'Original objective'});const {binding}= (await command('task.claim',{taskId:'task'})).result;return{command,query,binding}}
const supplement=(f,id,binding=f.binding)=>f.command('task.supplement',{taskId:'task',messageId:id,text:'Exact supplementary source '+id,expectedRequirementRevision:1,expectedControlRevision:1,liveBinding:binding},'supplement:'+id)
test('live supplement claims and ACKs only its exact wake after ordered official admission proof handoff',async t=>{
 const f=await fixture(t);await supplement(f,'one');await supplement(f,'two')
 const task=await f.query('task.get',{taskId:'task'});assert.equal(task.leaseEpoch,f.binding.leaseEpoch);assert.equal(task.claimContextRevision,0);assert.equal(task.liveSupplements.length,2)
 const admitted=(id,revision)=>f.command('task.supplement.admitted',{binding:{...f.binding,contextRevision:revision},messageId:id,packetId:'packet:'+id,entryId:'official:'+id},'admitted:'+id)
 await assert.rejects(admitted('two',2),{code:'TASK_LIVE_SUPPLEMENT_ORDER'})
 await admitted('one',1);await admitted('two',2)
 const next=await f.query('task.get',{taskId:'task'}),wakes=await f.query('wake.list',{taskId:'task'})
 assert.equal(next.claimContextRevision,2);assert.equal(next.drained,false);assert.equal(next.leaseEpoch,f.binding.leaseEpoch)
 assert.equal(next.liveSupplements.every(row=>row.state==='admitted'),true)
 for(const row of next.liveSupplements){const wake=wakes.find(w=>w.id===row.wakeId);assert.equal(wake.state,'acked');assert.equal(wake.leaseEpoch,f.binding.leaseEpoch)}
 assert.equal(wakes.find(w=>w.kind==='task.created'||w.kind==='task.create')?.state??wakes[0].state,'claimed','original owner wake is not consumed by supplemental admission')
 await f.command('task.supplement.admitted',{binding:{...f.binding,contextRevision:2},messageId:'two',packetId:'packet:two',entryId:'foreign-entry'},'foreign-entry').then(()=>assert.fail('conflicting official entry must reject'),error=>assert.equal(error.code,'TASK_LIVE_SUPPLEMENT_CONFLICT'))
})
test('a replan invalidates the original live supplemental admission and cannot inherit the old producer authority',async t=>{
 const f=await fixture(t);await supplement(f,'one');await f.command('task.revise',{taskId:'task',expectedRequirementRevision:1,expectedControlRevision:1,request:'Changed objective'})
 await assert.rejects(f.command('task.supplement.admitted',{binding:{...f.binding,contextRevision:1},messageId:'one',entryId:'entry',packetId:'packet'}),{code:'TASK_LIVE_SUPPLEMENT_STALE'})
 await assert.rejects(supplement(f,'two'),{code:'DYNAMIC_TASK_REVISION_STALE'})
})
test('foreign lease and skipped context transitions cannot authorize live supplemental delivery',async t=>{
 const f=await fixture(t)
 await assert.rejects(supplement(f,'foreign',{...f.binding,leaseEpoch:f.binding.leaseEpoch+1}),{code:'DYNAMIC_TASK_LEASE_STALE'})
 await assert.rejects(supplement(f,'skipped',{...f.binding,contextRevision:5}),{code:'TASK_LIVE_SUPPLEMENT_STALE'})
 const task=await f.query('task.get',{taskId:'task'});assert.equal(task.contextRevision??0,0);assert.equal(task.liveSupplements,undefined)
})
