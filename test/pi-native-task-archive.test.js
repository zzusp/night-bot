import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import {TaskArchives,backupTask,restoreTask,validateTaskArchive,archiveHash} from '../src/tasks/archive.js'
import {taskAuditKinds} from '../src/tasks/session-audit.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {initializeTaskDirectories} from '../packages/dingtalk-core/session-workspaces.js'
// 低层归档夹具也须兑现真实 Host 的工作区创建事务，不能直接 claim pending 任务。
async function initializeWorkspace(store,workspaceRoot,taskId){
 const task=await store.query({kind:'task.get',taskId});if(!task.workspaceInitialization)return
 const {creationCommandId,sessionId}=task.workspaceInitialization,binding={taskId,creationCommandId,sessionId}
 const begin=await store.command({id:creationCommandId+':workspace-begin',kind:'task.workspace.begin',args:binding})
 const observation=await initializeTaskDirectories(workspaceRoot,begin.result.task)
 await store.command({id:creationCommandId+':workspace-finish',kind:'task.workspace.finish',args:{...binding,state:'ready',observation:observation.native}})
}

import {readNativeHistory} from '../packages/dingtalk-core/native-maintenance-drain.js'
import {inspectSession} from '../packages/dingtalk-core/session-persistence.js'

async function fixture(t,{identity=true}={}){
 const root=await mkdtemp(join(tmpdir(),'night-native-archive-')),paths=runtimePaths({installRoot:root});await prepareRuntimePaths(paths)
 const config={installRoot:root,resident:{taskSessions:{instanceId:'native-archive',webActorId:'owner',initialize:true}}}
 const store=await openDynamicTaskStore({...config.resident.taskSessions,dbPath:join(paths.state,'tasks.sqlite')}),routes=new Map(),manager=new TaskArchives({paths,store,routes}),taskId='task'
 await store.command({id:'create',kind:'task.create',args:{taskId,request:'retain real native archive',ownerActorId:'owner'}})
 await initializeWorkspace(store,paths.workspaces,taskId)
 const binding=(await store.command({id:'claim',kind:'task.claim',args:{taskId}})).result.binding
 const task=await store.query({kind:'task.get',taskId}),{root:taskRoot}=await manager.register(task)
 const ctx=new Context();ctx.provide('taskSessionRoutes',routes);ctx.provide('portablePaths',portablePaths(paths));authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')}),header={version:4,id:task.sessionId,createdAt:Date.now(),isSeeded:false,cwd:taskRoot,agentPreset:'night-bot-task'}
 const writer=await backend.createNative(header,{auditKinds:taskAuditKinds})
 if(identity)writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId,sessionId:task.sessionId}})
 writer.manager.appendMessage({role:'user',content:[{type:'text',text:'native retained context'}],timestamp:Date.now()});await writer.close()
 await store.command({id:'bound',kind:'task.sessionBound',args:{binding}})
 await store.command({id:'wait',kind:'task.wait',args:{binding,summary:'paused retained evidence'}})
 await store.command({id:'drained',kind:'task.drained',args:{binding}})
 t.after(async()=>{await ctx.fiber.dispose();await store.close();await rm(root,{recursive:true,force:true})})
 return {root,paths,config,store,manager,backend,task,taskId,taskRoot,ctx}
}

test('native task archive seals, backs up and restores exact Pi bytes with held effects',async t=>{
 const f=await fixture(t),sealed=await f.manager.seal(f.taskId),session=join(f.taskRoot,'sessions',archiveHash(f.task.sessionId)+'.pi.jsonl'),original=await readFile(session)
 assert.equal((await validateTaskArchive(sealed.root)).snapshot.sessionId,f.task.sessionId)
 assert.throws(()=>readNativeHistory(f.paths.workspaces,{taskId:f.taskId,sessionId:f.task.sessionId}),/PI_SESSION_PATH_CODEC_REQUIRED/)
 const stored=readNativeHistory(f.paths.workspaces,{taskId:f.taskId,sessionId:f.task.sessionId},{pathCodec:portablePaths(f.paths)})
 assert.equal(stored.format,'pi-native-v1');assert.equal('events' in stored,false);assert.equal(stored.context.piMessages[0].content[0].text,'native retained context');assert.equal(stored.audit[0].payload.taskId,f.taskId)
 await assert.rejects(inspectSession(f.backend,f.task.sessionId),{code:'SESSION_EVENT_API_RETIRED'})
 await f.ctx.fiber.dispose();await f.store.close()
 const destination=join(f.root,'backups','native');await backupTask(f.config,f.taskId,destination)
 const restoredRoot=await mkdtemp(join(tmpdir(),'night-native-archive-restored-'));t.after(()=>rm(restoredRoot,{recursive:true,force:true}))
 const result=await restoreTask({...f.config,installRoot:restoredRoot},destination);assert.equal(result.paused,true)
 const targetPaths=runtimePaths({installRoot:restoredRoot}),target=join(result.root,'sessions',archiveHash(f.task.sessionId)+'.pi.jsonl')
 assert.deepEqual(await readFile(target),original)
 const read=readNativeHistory(targetPaths.workspaces,{taskId:f.taskId,sessionId:f.task.sessionId},{pathCodec:portablePaths(targetPaths)})
 assert.equal(read.header.cwd,result.root);assert.equal(read.audit[0].payload.sessionId,f.task.sessionId)
 const index=await openDynamicTaskStore({...f.config.resident.taskSessions,dbPath:join(targetPaths.state,'tasks.sqlite')})
 try{const task=await index.query({kind:'task.get',taskId:f.taskId});assert.equal(task.control,'paused');assert.equal(task.archiveRestore.reviewRequired,true)}finally{await index.close()}
})

test('native task archives require typed task identity and strict complete commit',async t=>{
 const missing=await fixture(t,{identity:false});await assert.rejects(missing.manager.seal(missing.taskId),{code:'TASK_ARCHIVE_SESSION_IDENTITY_INVALID'})
 const f=await fixture(t);await f.manager.seal(f.taskId)
 const path=join(f.taskRoot,'sessions',archiveHash(f.task.sessionId)+'.pi.jsonl');await appendFile(path,'{"torn":')
 await assert.rejects(f.manager.seal(f.taskId),{code:'TASK_ARCHIVE_SESSION_INCOMPLETE'})
 assert.throws(()=>readNativeHistory(f.paths.workspaces,{taskId:f.taskId,sessionId:f.task.sessionId},{pathCodec:portablePaths(f.paths)}),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
})
