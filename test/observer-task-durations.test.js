import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { projectTaskDurations, pageTaskDurations } from '../src/tasks/observer-durations.js'
import { receiptOwnerSql } from '../packages/dingtalk-core/task-archive.js'
const iso = s => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString()
const now = Date.parse(iso(100))
const task = {taskId:'t', createdAt:iso(0), status:'active', control:'active', state:'waiting', leaseEpoch:2, drained:true}
const row = (leaseEpoch, at, drained, claim=false) => ({taskId:'t', leaseEpoch, updatedAt:iso(at), drained, claim, control:'active', status:'active'})
const rounds = [row(1,10,false,true),row(1,20,true),row(2,50,false,true),row(2,60,true)]
test('sums execution rounds, freezes waiting and ignores later non-transition edits', () => {
 const result=projectTaskDurations(task,[...rounds,row(2,90,true)],now)
 assert.equal(result.execution.milliseconds,20000)
 assert.equal(result.total.milliseconds,60000)
})
test('active execution excludes queue/wait gaps; total spans creation',()=>{
 const value=projectTaskDurations({...task,state:'running',drained:false},rounds.slice(0,-1),now)
 assert.deepEqual(value.execution,{milliseconds:10000,activeSince:iso(50)})
 assert.deepEqual(value.total,{milliseconds:0,activeSince:iso(0)})
})
test('completion uses actual completion not unrelated updatedAt',()=>{
 const value=projectTaskDurations({...task,status:'completed',state:'completed',completion:{at:iso(65)},updatedAt:iso(99)},rounds,now)
 assert.equal(value.total.milliseconds,65000)
 assert.equal(value.execution.milliseconds,20000)
})
test('missing claims, missing drain, overlaps, clock corruption and recovering remain unknown',()=>{
 for(const receipts of [rounds.slice(1), rounds.slice(0,-1),[row(1,10,false,true),row(1,55,true),...rounds.slice(2)], [...rounds,{...row(2,59,false),recovering:true}], [row(1,110,false,true),...rounds.slice(1)]])
  assert.equal(projectTaskDurations(task,receipts,now).execution.milliseconds,null)
 assert.equal(projectTaskDurations(task,null,now).execution.milliseconds,null)
 assert.equal(projectTaskDurations({...task,leaseEpoch:Number.MAX_SAFE_INTEGER},rounds,now).execution.milliseconds,null)
})
test('never-started task is zero execution; unknown old metadata is not zero',()=>{
 assert.equal(projectTaskDurations({...task,leaseEpoch:0},[],now).execution.milliseconds,0)
 assert.equal(projectTaskDurations({...task,leaseEpoch:undefined},[],now).execution.milliseconds,null)
 assert.equal(projectTaskDurations({...task,createdAt:'invalid'},rounds,now).total.milliseconds,null)
})
test('page query uses existing owner index, only selected tasks and archived receipts',()=>{
 const db=new DatabaseSync(':memory:')
 db.exec(`CREATE TABLE dynamic_receipts(id TEXT PRIMARY KEY,body TEXT);CREATE INDEX dynamic_receipt_owner ON dynamic_receipts(${receiptOwnerSql});CREATE TABLE dynamic_archived_receipts(id TEXT PRIMARY KEY,sequence INTEGER,body TEXT);CREATE INDEX archived_owner ON dynamic_archived_receipts(${receiptOwnerSql})`)
 rounds.forEach((r,i)=>{const {claim,...snapshot}=r;const body=JSON.stringify({result:{task:snapshot,...(claim?{wakeIds:[]}: {})},dispatchEligible:claim});
 if(i<2)db.prepare('INSERT INTO dynamic_archived_receipts VALUES (?,?,?)').run(String(i),i,body)
 else db.prepare('INSERT INTO dynamic_receipts VALUES (?,?)').run(String(i),body)})
 // Keep archived ordering comparable to live rowids.
 db.prepare('UPDATE dynamic_archived_receipts SET sequence=sequence-10').run()
 const result=pageTaskDurations(db,[task],now)[0]
 assert.equal(result.durations.execution.milliseconds,20000)
 db.exec('DROP INDEX dynamic_receipt_owner')
 assert.equal(pageTaskDurations(db,[task],now)[0].durations.execution.milliseconds,null)
 db.close()
})
