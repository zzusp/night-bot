import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,rename,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {backupData} from '../src/runtime/backup.js'
import {inspectResidentRouterUpgrade,executeResidentRouterUpgrade} from '../src/runtime/resident-router-upgrade.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')

async function oldInstallation(t) {
  const root=await mkdtemp(join(tmpdir(),'night-resident-upgrade-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const config={installRoot:root,dataDir:'data',resident:{taskSessions:{instanceId:'upgrade-test'}}},paths=runtimePaths(config)
  await prepareRuntimePaths(paths)
  const dbPath=join(paths.state,'tasks.sqlite'),store=await openDynamicTaskStore({dbPath,instanceId:'upgrade-test',initialize:true})
  for(const id of ['pending','ambiguous','historical'])await store.command({id:'source-'+id,kind:'source.record',args:{sourceId:id,
    groupId:'conversation',messageId:id,actorId:'alice',version:1,text:'Original '+id}})
  await store.command({id:'preserved-task',kind:'task.create',args:{taskId:'preserved-task',groupId:'conversation',ownerActorId:'alice',request:'Preserve existing task identity',sourceRefs:['pending'],topicRefs:[{topicId:'legacy-topic',revision:1}]}})
  const original=await store.query({kind:'task.get',taskId:'preserved-task'})
  await store.close()
  const mutate=fn=>{const db=new DatabaseSync(dbPath);try{return fn(db)}finally{db.close()}}
  mutate(db=>{
    db.exec("DELETE FROM dynamic_meta WHERE key='router_schema'; PRAGMA user_version=3")
    for(const id of ['pending','historical']){
      const row=JSON.parse(db.prepare('SELECT body FROM dynamic_sources WHERE id=?').get(id).body)
      if(id==='pending'){row.routed=false;row.processingPending=true}
      else{row.routed=true;row.processingPending=false;row.processingCompleted=true}
      db.prepare('UPDATE dynamic_sources SET body=? WHERE id=?').run(JSON.stringify(row),id)
    }
  })
  const messages=['pending','ambiguous','historical','unlinked'].map(id=>({messageId:id,messageVersion:1,
    senderOpenDingTalkId:'alice',text:'Original '+id,routingStatus:id==='historical'?'routed':'pending',units:[]}))
  const resident={unit:{name:'dingtalk_dsh_assistant',version:9},tables:{groups:{conversation:{groupId:'conversation',messages}}}}
  const contexts={conversation:{type:'chat-room',channelId:'fixture',conversationId:'fixture-room',participants:{alice:'Alice'}}}
  await mkdir(join(paths.state,'storage'),{recursive:true});await mkdir(join(paths.state,'channels'),{recursive:true})
  await writeFile(join(paths.state,'storage','dingtalk_dsh_assistant.json'),JSON.stringify(resident))
  await writeFile(join(paths.state,'channels','contexts.json'),JSON.stringify(contexts))
  const snapshot=async()=>{
    const files=await readdir(paths.state,{recursive:true}),entries=[]
    for(const file of files){try{entries.push([file,digest(await readFile(join(paths.state,file)))])}catch(error){if(error.code!=='EISDIR'&&error.code!=='EPERM')throw error}}
    return entries.sort(([a],[b])=>a.localeCompare(b))
  }
  return {config,paths,root,dbPath,mutate,snapshot,original}
}

test('offline upgrade check is zero-write; authenticated pending sources convert while uncertain and unlinked history is held',{timeout:30000},async t=>{
  const f=await oldInstallation(t),before=await f.snapshot()
  const checked=await inspectResidentRouterUpgrade(f.config)
  assert.equal(checked.ready,true);assert.equal(checked.fromVersion,3);assert.equal(checked.routerSchema,null)
  assert.deepEqual(await f.snapshot(),before,'check cannot create WAL/SHM, mutate rows or rewrite source files')
  assert.equal(checked.sourceDispositions.find(row=>row.sourceId==='pending').state,'pending')
  assert.equal(checked.sourceDispositions.find(row=>row.sourceId==='ambiguous').state,'held')
  assert.equal(checked.sourceDispositions.find(row=>row.sourceId==='historical').state,'historical')
  assert.equal(checked.heldMessages.length,1);assert.equal(checked.heldMessages[0].messageId,'unlinked')
  await assert.rejects(executeResidentRouterUpgrade(f.config,{expectedDigest:checked.expectedDigest}),{code:'ROUTER_UPGRADE_BACKUP_REQUIRED'})
  assert.deepEqual(await f.snapshot(),before,'missing backup rejection is also zero-write')
  const backup=join(f.root,'backups','before-upgrade');await backupData(f.config,backup)
  const refreshed=await inspectResidentRouterUpgrade(f.config)
  const result=await executeResidentRouterUpgrade(f.config,{backup,expectedDigest:refreshed.expectedDigest})
  assert.equal(result.applied,true);assert.equal(result.automaticDelivery,false)
  f.mutate(db=>{
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,4)
    assert.equal(db.prepare("SELECT value FROM dynamic_meta WHERE key='router_schema'").get().value,'1')
    const task=JSON.parse(db.prepare("SELECT body FROM dynamic_tasks WHERE id='preserved-task'").get().body)
    assert.equal(task.taskId,f.original.taskId);assert.equal(task.sessionId,f.original.sessionId)
    assert.equal(task.runSequence,f.original.runSequence);assert.equal(task.requirementRevision,f.original.requirementRevision)
    assert.deepEqual(db.prepare("SELECT json_extract(body,'$.sourceId') sourceId FROM dynamic_triage").all().map(row=>row.sourceId),['pending'])
    assert.equal(JSON.parse(db.prepare("SELECT body FROM dynamic_sources WHERE id='ambiguous'").get().body).triageHold,true)
    assert.equal(db.prepare('SELECT count(*) n FROM dynamic_router_upgrade_audit').get().n,1)
    assert.equal(db.prepare('SELECT count(*) n FROM dynamic_router_inbox').get().n,0)
  })
  const after=await f.snapshot(),again=await executeResidentRouterUpgrade(f.config,{backup,expectedDigest:refreshed.expectedDigest})
  assert.equal(again.applied,false);assert.deepEqual(await f.snapshot(),after,'second execution cannot replay conversion or enqueue messages')
})

test('offline upgrade rejects source drift after check and unknown effects before any schema write',{timeout:30000},async t=>{
  const f=await oldInstallation(t),checked=await inspectResidentRouterUpgrade(f.config),backup=join(f.root,'backups','before-drift')
  await backupData(f.config,backup)
  const contexts=join(f.paths.state,'channels','contexts.json');await writeFile(contexts,(await readFile(contexts,'utf8'))+'\n')
  await assert.rejects(executeResidentRouterUpgrade(f.config,{backup,expectedDigest:checked.expectedDigest}),{code:'ROUTER_UPGRADE_STATE_CHANGED'})
  f.mutate(db=>db.prepare('INSERT INTO dynamic_operations(id,body) VALUES (?,?)').run('uncertain',JSON.stringify({id:'uncertain',operationId:'uncertain',taskId:'preserved-task',state:'unknown'})))
  const blocked=await inspectResidentRouterUpgrade(f.config)
  assert.equal(blocked.ready,false);assert.ok(blocked.blockReasons.includes('unresolved-operations'))
  await assert.rejects(executeResidentRouterUpgrade(f.config,{backup,expectedDigest:blocked.expectedDigest}),{code:'ROUTER_UPGRADE_NOT_QUIESCENT'})
  f.mutate(db=>assert.equal(db.prepare('PRAGMA user_version').get().user_version,3))
})


test('offline check refuses an external contexts parent junction without touching installation or target',{timeout:30000},async t=>{
  const f=await oldInstallation(t),outside=await mkdtemp(join(tmpdir(),'night-upgrade-external-'))
  t.after(()=>rm(outside,{recursive:true,force:true}))
  const directory=join(f.paths.state,'channels'),original=join(f.paths.state,'channels-original')
  await rename(directory,original)
  const external=join(outside,'contexts.json'),content=await readFile(join(original,'contexts.json'))
  await writeFile(external,content)
  await symlink(outside,directory,process.platform==='win32'?'junction':'dir')
  const before=await f.snapshot()
  await assert.rejects(inspectResidentRouterUpgrade(f.config),/TASK_DIRECTORY_OUTSIDE_ROOT/)
  assert.deepEqual(await f.snapshot(),before)
  assert.deepEqual(await readFile(external),content)
  f.mutate(db=>assert.equal(db.prepare('PRAGMA user_version').get().user_version,3))
})
