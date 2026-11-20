import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { access, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { openTaskSessionService } from '../packages/dingtalk-core/task-session-service.js'
import {latestInput} from './fixtures/task-session-native-host.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {taskDirectories} from '../packages/dingtalk-core/session-workspaces.js'
import {resolveTaskMaterialPaths} from '../src/tasks/material-paths.js'
import { canonicalExecutionJson } from '../packages/dingtalk-core/execution-artifacts.js'
import { openDynamicTaskStore } from '../packages/dingtalk-core/dynamic-task-store.js'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function temporary() {
  const base = resolve('.test-runs/task-session-material-history'); await mkdir(base, { recursive: true })
  return mkdtemp(join(base, 'run-'))
}
async function snapshot(root) {
  const files = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const path = join(entry.parentPath, entry.name)
    files.push([path.slice(root.length), digest(await readFile(path))])
  }
  return files.sort((a, b) => a[0].localeCompare(b[0]))
}
async function historicalFixture() {
  const root = await temporary(), archive = join(root, 'archive'), artifactDirectory = join(archive, 'artifacts'), workspace = join(archive, 'workspace')
  await mkdir(artifactDirectory, { recursive: true }); await mkdir(workspace)
  async function artifact(value, taskId) {
    const bytes = Buffer.from(canonicalExecutionJson(value)), fileName = `sha256-${digest(bytes)}.json`
    const directory = taskId ? join(workspace, 'tasks', taskId, 'work', 'artifacts') : artifactDirectory
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, fileName), bytes)
    return taskId ? `tasks/${taskId}/${fileName}` : fileName
  }
  const requirement = await artifact({ request: '保留历史任务目标与结果', constraints: ['不能重跑历史写入'] })
  const evidence = await artifact({ kind: 'verified-native-evidence', command: 'verify.sh', result: '真实历史检查通过' }, 'legacy-task')
  const output = await artifact({ status: 'completed', summary: '历史执行的完整结果', evidenceRefs: [evidence] })
  const codeOutput = await artifact({ summary: '没有会话的代码步骤结果也保留', checked: true })
  const dbPath = join(archive, 'old.sqlite'), db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE business_tasks(task_id TEXT PRIMARY KEY,requirement_ref TEXT,status TEXT,requirement_revision INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE task_owners(task_id TEXT PRIMARY KEY,session_id TEXT,session_bound INTEGER);
    CREATE TABLE task_controls(task_id TEXT PRIMARY KEY,state TEXT,control_revision INTEGER);
    CREATE TABLE execution_runs(run_id TEXT PRIMARY KEY,task_id TEXT,status TEXT,requirement_ref TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE execution_nodes(node_run_id TEXT,run_id TEXT,session_id TEXT,status TEXT,drained INTEGER,output_ref TEXT,evidence_refs TEXT);
    CREATE TABLE task_reports(report_id TEXT,task_id TEXT,report_type TEXT,facts_json TEXT,created_at TEXT);
    CREATE TABLE task_events(seq INTEGER,task_id TEXT,event_type TEXT,payload_ref TEXT,created_at TEXT);
    CREATE TABLE task_plan_stages(task_id TEXT,stage_id TEXT,status TEXT);`)
  db.prepare('INSERT INTO business_tasks VALUES(?,?,?,?,?,?)').run('legacy-task', requirement, 'succeeded', 3, 'old-created', 'old-updated')
  db.prepare('INSERT INTO task_owners VALUES(?,?,?)').run('legacy-task', 'legacy-session', 1)
  db.prepare('INSERT INTO task_controls VALUES(?,?,?)').run('legacy-task', 'active', 2)
  db.prepare('INSERT INTO execution_runs VALUES(?,?,?,?,?,?)').run('old-run', 'legacy-task', 'succeeded', requirement, 'old-created', 'old-updated')
  db.prepare('INSERT INTO execution_nodes VALUES(?,?,?,?,?,?,?)').run('old-node', 'old-run', 'old-execution-session', 'succeeded', 1, output, JSON.stringify([evidence]))
  db.prepare('INSERT INTO execution_nodes VALUES(?,?,?,?,?,?,?)').run('old-code-node', 'old-run', null, 'succeeded', 1, codeOutput, '[]')
  db.prepare('INSERT INTO task_reports VALUES(?,?,?,?,?)').run('old-progress', 'legacy-task', 'wait', JSON.stringify({ summary: '之前等待检查' }), 'old-wait')
  db.prepare('INSERT INTO task_reports VALUES(?,?,?,?,?)').run('old-final', 'legacy-task', 'complete', JSON.stringify({ summary: '已完成，保留原始结论', evidenceRefs: [evidence], limitations: ['仅历史记录'] }), 'old-complete')
  db.prepare('INSERT INTO task_events VALUES(?,?,?,?,?)').run(1, 'legacy-task', 'execution.recorded', evidence, 'old-event')
  db.prepare('INSERT INTO task_plan_stages VALUES(?,?,?)').run('legacy-task', 'retired-stage', 'completed')
  db.close()
  return { root, archive, dbPath, artifactDirectory, workspace, refs: { requirement, evidence, output, codeOutput } }
}

// Script only model decisions; ingress, Router, task preparation and receipts are real.
async function service(t, options = {}) {
  const inputs = [], planned = new Map(), handled = new Set()
  let host, reopenTaskId
  host = await residentRouterHost(t, body => {
    const tools = requestTools(body)
    if (tools.includes('channel_triage_submit')) {
      const input = requestEnvelope(body, '一级分诊请求：')
      return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Synthetic material request'}))}}
    }
    if (tools.includes('task_result')) {
      inputs.push(latestInput(body))
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic materials observed',evidence:['isolated fixture'],limitations:[]}}}
    }
    if (tools.includes('resident_router_settle')) {
      const input=requestEnvelope(body,'Router 请求：'),event=input.events.find(event=>event.source)
      if(body.messages.at(-1)?.role==='tool'&&host.results.at(-1)?.name==='resident_router_settle')return {text:'Synthetic settled'}
      if(event&&!handled.has(event.id)) {
        handled.add(event.id)
        if(reopenTaskId) {
          const taskId=reopenTaskId;reopenTaskId=undefined
          return host.query('task.get',{taskId}).then(task=>({tool:'resident_task_action',args:{operationId:'reopen:'+event.id,kind:'reopen',handoff:'Inspect the same synthetic materials again.',sameGoal:true,taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,sourceId:event.sourceId,messageVersion:event.messageVersion}}))
        }
        const taskId='material-task-'+(planned.size+1);planned.set(event.sourceId,taskId)
        return {tool:'resident_task_plan',args:{operationId:'plan:'+event.id,sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId,handoff:'Inspect the attached synthetic materials in isolation.',title:'Synthetic material inspection',objective:'Inspect isolated source materials',requirements:[]}],dependencies:[]}}
      }
      return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
    }
    return {text:'No other synthetic work'}
  },{config:{retryIntervalMs:600000,...options.config},readResource:options.readResource})
  return {...host, inputs,
    async material(task) {
      const directory=(await taskDirectories(host.host.ctx.runtimePaths.workspaces,task.taskId,{task})).materials
      const name=(await readdir(directory)).find(name=>name.startsWith('source-')&&name.endsWith('.json'))
      const path=join(directory,name)
      return {directory,path,material:JSON.parse(await readFile(path,'utf8'))}
    },
    async reopen(taskId) {
      reopenTaskId=taskId
      await host.receive(channelMessage('reopen-'+host.requests.length,{text:'Recheck the same synthetic materials.'}))
      await host.service.whenIdle()
    },
  }
}

test('legacy import configuration is rejected and active service never exposes or imports nearby retired archives', {timeout:nativeTestTimeout(30000)},async t=>{
  const f=await historicalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}))
  const before=await snapshot(f.archive)
  await assert.rejects(openDynamicTaskStore({dbPath:join(f.root,'rejected.sqlite'),instanceId:'legacy-rejection',initialize:true,legacyDbPath:f.dbPath}),{code:'DYNAMIC_LEGACY_IMPORT_RETIRED'})
  await assert.rejects(access(join(f.root,'rejected.sqlite')),{code:'ENOENT'})
  const h=await service(t)
  assert.equal(await h.service.taskDetail('legacy-task'),null)
  assert.deepEqual((await h.service.taskExecutions('legacy-task')).executions,[])
  for(const kind of ['task.list','execution.list','legacy.list'])assert.deepEqual(await h.query(kind),[])
  assert.deepEqual(await h.service.boardTasks(),[])
  assert.equal(h.inputs.length,0)
  await h.close()
  assert.deepEqual(await snapshot(f.archive),before)
})

test('attachment bytes are materialized without source text in separate task archives and cached without redownload', {timeout:nativeTestTimeout(30000)},async t=>{
  const calls=[],imageBytes=Uint8Array.from([137,80,78,71,13,10,0,255])
  const h=await service(t,{readResource:async(conversationId,messageId,resource)=>{
    calls.push({conversationId,messageId,resource})
    return resource.resourceId==='text'?{text:'Synthetic attachment body\nSELECT 1;',complete:true,mediaType:'text/plain'}:{image:{data:imageBytes,mediaType:'image/png',name:'../untrusted.png'}}
  }})
  const first=channelMessage('one',{text:'Inspect these synthetic materials.',resourceRefs:[{kind:'file',resourceId:'text'},{kind:'image',resourceId:'image'}]})
  await h.receive(first);await h.service.whenIdle()
  await h.receive({...first,messageId:'two',text:'A separate synthetic material task.'});await h.service.whenIdle()
  const tasks=await h.query('task.list')
  assert.equal(tasks.length,2);assert.equal(calls.length,4);assert.equal(h.inputs.length,2)
  const directories=[]
  for(const task of tasks){
    const {directory,path,material}=await h.material(task);directories.push(directory)
    // Stored paths use the portable binding contract; resolve them before comparing native paths.
    const resolved=resolveTaskMaterialPaths(material,directory,path)
    assert.equal(resolved.taskId,task.taskId);assert.equal(resolved.path,path)
    const source=await h.query('source.get',{sourceId:resolved.sourceId})
    assert.equal(Object.hasOwn(resolved,'text'),false);assert.equal(Object.hasOwn(resolved,'quote'),false);assert.ok(source.text);assert.equal(resolved.actorId,source.actorId);assert.equal(resolved.messageId,source.messageId)
    assert.equal(resolved.resources.length,2)
    for(const entry of resolved.resources){
      assert.equal(entry.status,'read');assert.equal(entry.complete,true)
      assert.ok(entry.path.startsWith(directory+sep))
      const bytes=await readFile(entry.path);assert.equal(digest(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes)
      if(entry.resource.resourceId==='text')assert.equal(bytes.toString('utf8'),'Synthetic attachment body\nSELECT 1;')
      else assert.deepEqual(bytes,Buffer.from(imageBytes))
    }
  }
  assert.notEqual(directories[0],directories[1])
  await h.receive(first);await h.service.whenIdle()
  assert.equal(calls.length,4);assert.equal(h.inputs.length,2,'duplicate ingress must not execute again')
  await h.reopen(tasks[0].taskId)
  assert.equal(calls.length,4);assert.equal(h.inputs.length,3,'same-goal reopen exercises cache validation')
  assert.ok(h.inputs.every(input=>input.materials.every(material=>material.resources.every(resource=>resource.path.includes(sep+'materials'+sep)))))
})

for(const mode of ['throw','null','partial','metadata-only','unconfigured'])test(`resource ${mode} never becomes a successful material download`,{timeout:nativeTestTimeout(30000)},async t=>{
  const h=await service(t,{readResource:mode==='unconfigured'?undefined:async()=>{
    if(mode==='throw')throw Object.assign(new Error('connector detail must not be stored'),{code:'CONNECTOR_UNAVAILABLE'})
    if(mode==='null')return null
    if(mode==='partial')return {text:'only first page',complete:false}
    return {url:'https://example.invalid/not-downloaded'}
  }})
  await h.receive(channelMessage(mode,{resourceRefs:[{kind:'file',resourceId:'missing'}]}));await h.service.whenIdle()
  const tasks=await h.query('task.list');assert.equal(tasks.length,1);assert.equal(h.inputs.length,1)
  const {directory,material}=await h.material(tasks[0]),resource=material.resources[0]
  const entries=await readdir(directory,{withFileTypes:true})
  assert.deepEqual(entries.filter(entry=>entry.isFile()).map(entry=>entry.name),[entries.find(entry=>entry.name.startsWith('source-')).name])
  assert.ok(entries.filter(entry=>!entry.isFile()).every(entry=>entry.name==='runtime-evidence'&&entry.isDirectory()),'only the current Host evidence directory may accompany the source snapshot')
  assert.equal(resource.status,'unavailable');assert.ok(resource.reason)
  assert.equal(resource.path,undefined);assert.equal(resource.value,undefined)
  assert.doesNotMatch(JSON.stringify(material),/connector detail|only first page|example\.invalid/)
  assert.equal(h.inputs[0].materials[0].resources[0].status,'unavailable')
})

for(const mode of ['snapshot-link','snapshot-truncated','foreign-resource','resource-link','source-identity'])test(`cached material ${mode} is rejected before reaching any task model or connector`,{timeout:nativeTestTimeout(30000)},async t=>{
  let reads=0
  const h=await service(t,{readResource:async()=>{reads++;return {text:'original bytes',complete:true}}})
  await h.receive(channelMessage(mode,{resourceRefs:[{kind:'file',resourceId:'own'}]}));await h.service.whenIdle()
  const [task]=await h.query('task.list');assert.ok(task);assert.equal(h.inputs.length,1)
  const {directory,path,material}=await h.material(task),originalSnapshot=await readFile(path)
  const resolved=resolveTaskMaterialPaths(material,directory,path)
  const foreign=join(h.host.ctx.runtimePaths.workspaces,'foreign-fixture');await mkdir(foreign,{recursive:true})
  const foreignFile=join(foreign,'private.txt');await writeFile(foreignFile,'FOREIGN_SECRET_MUST_NOT_REACH_MODEL')
  const modelCalls=h.inputs.length,savedSnapshot=join(foreign,'saved-snapshot.json'),savedResource=join(foreign,'saved-resource.txt')
  if(mode==='snapshot-link'){
    await rename(path,savedSnapshot)
    await symlink(process.platform==='win32'?foreign:savedSnapshot,path,process.platform==='win32'?'junction':'file')
  }else if(mode==='snapshot-truncated')await writeFile(path,'{"sourceId":')
  else if(mode==='foreign-resource'){
    material.resources[0].path=foreignFile;material.resources[0].sha256=digest(await readFile(foreignFile));material.resources[0].bytes=(await readFile(foreignFile)).length
    await writeFile(path,JSON.stringify(material))
  }else if(mode==='resource-link'){
    await rename(resolved.resources[0].path,savedResource)
    await symlink(process.platform==='win32'?foreign:foreignFile,resolved.resources[0].path,process.platform==='win32'?'junction':'file')
  }else{
    material.resources[0].resource.resourceId='another-users-resource'
    await writeFile(path,JSON.stringify(material))
  }
  await h.reopen(task.taskId)
  const expected={ 'snapshot-link':'TASK_MATERIAL_PATH_INVALID','snapshot-truncated':'TASK_MATERIAL_SNAPSHOT_INVALID','foreign-resource':'TASK_MATERIAL_PATH_BINDING_INVALID','resource-link':'TASK_MATERIAL_PATH_INVALID','source-identity':'TASK_MATERIAL_SOURCE_MISMATCH'}[mode]
  assert.equal((await h.service.taskDialogue(task.taskId)).error,expected)
  assert.equal(h.inputs.length,modelCalls);assert.equal(reads,1)
  assert.doesNotMatch(JSON.stringify(h.inputs),/FOREIGN_SECRET/)
  assert.equal(await readFile(foreignFile,'utf8'),'FOREIGN_SECRET_MUST_NOT_REACH_MODEL')
  assert.deepEqual((await readdir(foreign)).sort(),['private.txt',...mode==='snapshot-link'?['saved-snapshot.json']:mode==='resource-link'?['saved-resource.txt']:[]].sort())
  if(mode==='snapshot-link')assert.deepEqual(await readFile(savedSnapshot),originalSnapshot)
  if(mode==='resource-link')assert.equal(await readFile(savedResource,'utf8'),'original bytes')
})

test('missing official factory is rejected before creating the database and permits a clean initialized retry',async t=>{
  const root=await temporary();t.after(()=>rm(root,{recursive:true,force:true}))
  const config={dbPath:join(root,'failed-start.sqlite'),instanceId:'failed-start',initialize:true,workspaceDir:root}
  await assert.rejects(openTaskSessionService({ctx:{},config,legacy:{getAgentConfig:()=>({workspaceDir:root})}}),{code:'TASK_OFFICIAL_FACTORY_REQUIRED'})
  await assert.rejects(access(config.dbPath),{code:'ENOENT'})
  const reopened=await openDynamicTaskStore({...config,initialize:true})
  try{assert.deepEqual(await reopened.query({kind:'task.list'}),[])}finally{await reopened.close()}
})
