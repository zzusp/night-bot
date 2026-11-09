import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {providerHost,result,latestInput} from './fixtures/provider-official-host.js'

test('background recovery and pending wakes never run archived tasks, normal continuation still runs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'archive-scheduling-'))
 let service,sequence=0
 const turns=[]
 t.after(async()=>{try{await service?.close()}finally{await rm(root,{recursive:true,force:true})}})
 const open=initialize=>providerHost(t,{root,initialize,decide:request=>{
  turns.push(latestInput(request).task.taskId)
  return [result('complete')]
 }})
 service=await open(true)
 const archivedId=await service.create('archived'),normalId=await service.create('normal')
 await service.service.whenIdle()
 const command=(kind,args)=>service.service.store.command({id:`fixture-${++sequence}`,kind,args})
 await service.service.archiveTask({taskId:archivedId})
 const archivedRecord=await service.query('task.get',{taskId:archivedId})
 assert.ok(archivedRecord.archivedAt,'Explicit history reads retain archived tasks')
 assert.deepEqual((await service.query('task.list')).map(task=>task.taskId),[normalId])
 const normalBefore=await service.query('task.get',{taskId:normalId})
 const originalTurns=turns.slice()
 await command('wake.enqueue',{taskId:archivedId,kind:'late-new-message'})
 await assert.rejects(command('task.reopen',{taskId:archivedId,expectedRequirementRevision:archivedRecord.requirementRevision,objective:'late source'}),{code:'DYNAMIC_TASK_ARCHIVED_CONFLICT'})
 await command('task.reopen',{taskId:normalId,expectedRequirementRevision:normalBefore.requirementRevision,objective:'normal follow-up'})
 await service.service.recover();await service.service.whenIdle()
 assert.deepEqual(turns,[...originalTurns,normalId])
 const archived=await service.service.taskDetail(archivedId),normal=await service.query('task.get',{taskId:normalId})
 assert.equal(archived.status,'completed');assert.equal(archived.drained,true);assert.ok(archived.archivedAt)
 assert.equal(normal.sessionId,normalBefore.sessionId);assert.equal(normal.status,'completed');assert.equal(normal.drained,true)
 assert.equal((await service.query('execution.list')).length,0)
 const settledTurns=turns.slice()
 await service.close();service=await open(false)
 await service.service.recover();await service.service.whenIdle()
 assert.deepEqual(turns,settledTurns)
 assert.equal((await service.service.taskDetail(archivedId)).archivedAt,archived.archivedAt)
 assert.equal((await service.query('task.get',{taskId:normalId})).sessionId,normal.sessionId)
})
