import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {arrangementDays,checkArrangementRange,queryArrangementHistory} from '../src/channels/router-arrangement-history.js'

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close())
 for(const name of ['tasks','archived_tasks','task_events','archived_task_events','router_actions'])
  db.exec('CREATE TABLE dynamic_'+name+'(id TEXT PRIMARY KEY,body TEXT NOT NULL)')
 const put=(table,id,body)=>db.prepare('INSERT INTO dynamic_'+table+' VALUES(?,?)').run(id,JSON.stringify(body))
 return {db,put}
}
const day='2026-11-20',timezone='Asia/Shanghai',range={conversationId:'room',day,through:day,timezone}

test('relative arrangement day uses the inquiry date in the channel timezone and validates explicit ranges',()=>{
 assert.deepEqual(arrangementDays({day:'today'},'2026-11-19T16:05:00.000Z',timezone),{day,through:day,timezone})
 assert.deepEqual(arrangementDays({day:'yesterday'},'2026-11-19T16:05:00.000Z',timezone),{day:'2026-11-19',through:'2026-11-19',timezone})
 assert.equal(arrangementDays({day:'today'},undefined,timezone),null)
 assert.throws(()=>checkArrangementRange({day:'2026-02-30'}),{code:'ROUTER_LOOKUP_ARGUMENT_INVALID'})
 assert.throws(()=>checkArrangementRange({day,through:'2026-12-21'}),{code:'ROUTER_LOOKUP_ARGUMENT_INVALID'})
 assert.throws(()=>checkArrangementRange({day,timezone:'not-a-timezone'}),{code:'ROUTER_LOOKUP_ARGUMENT_INVALID'})
})

test('scope, local date boundaries, historical identity and explicit arrangement time use actual ledger evidence',t=>{
 const {db,put}=fixture(t)
 const task=(id,title,createdAt,extra={})=>({taskId:id,groupId:'room',title,createdAt,requirementRevision:1,...extra})
 const prior=task('past','old plan','2026-11-19T15:59:59.999Z',{startedAt:'2026-11-20T06:00:00.000Z',completedAt:'2026-11-20T07:00:00.000Z'})
 const created=task('creation','original category','2026-11-19T16:00:00.000Z',{appliedOperations:['planned']})
 for(const row of [prior,{...created,title:'different category',requirementRevision:2},task('next','next day','2026-11-20T16:00:00.000Z'),task('other','another channel','2026-11-20T01:00:00.000Z',{groupId:'private'}),task('missing','new name','2026-11-20T02:00:00.000Z',{requirementRevision:2}),task('held','held title','2026-11-20T03:00:00.000Z',{archiveRestore:{reviewRequired:true}})])
   put(row.taskId==='past'?'archived_tasks':'tasks',row.taskId,row)
 const receipt='router-action:'+createHash('sha256').update(JSON.stringify(['room','planned'])).digest('hex')
 put('router_actions',receipt,{conversationId:'room',result:{tasks:[created]}})
 put('archived_task_events','changed',{kind:'task.arranged',taskId:prior.taskId,requirementRevision:1,recordedAt:'2026-11-20T15:59:59.999Z'})
 put('archived_task_events','finished',{kind:'task.completed',taskId:prior.taskId,recordedAt:'2026-11-20T07:00:00.000Z'})
 const result=queryArrangementHistory(db,range)
 assert.equal(result.complete,true)
 assert.deepEqual(result.records.map(({title,kind,localAt,identityMissing})=>[title,kind,localAt,identityMissing]),[
  ['original category','created',day+' 00:00',false],
  ['','created',day+' 10:00',true],
  ['','created',day+' 11:00',true],
  ['old plan','arranged',day+' 23:59',false],
 ])
 assert.deepEqual(queryArrangementHistory(db,{...range,day:'2026-11-21',through:'2026-11-21'}).records.map(row=>row.title),['next day'])
 assert.deepEqual(queryArrangementHistory(db,{...range,day:'2026-11-22',through:'2026-11-22'}),{records:[],complete:true})
})

test('capped or clipped records are distinguishable from a complete unbounded result',t=>{
 const {db,put}=fixture(t)
 for(let i=0;i<25;i++)put('tasks',String(i).padStart(2,'0'),{groupId:'room',title:'a'.repeat(161),createdAt:'2026-11-20T12:00:00.000Z',requirementRevision:1})
 const result=queryArrangementHistory(db,range)
 assert.equal(result.complete,false)
 assert.equal(result.records.length,24)
 assert.ok(result.records.every(row=>row.clipped&&row.title.length===160))
})
