import {nativeLifecycle,nativeLifecycleTimeout,nativeTemporaryDirectory as mkdtemp,nativeRemove as rm} from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import {createSingleTaskSessions} from '../src/tasks/single-session.js'
import {installTaskSessionPersistence,taskSessionLogRoot} from '../packages/dingtalk-core/task-session-persistence.js'
import {taskWorkspace} from '../packages/dingtalk-core/session-workspaces.js'

test('strict read-only native observation cannot acquire a cold task writer and the Host resumes its next lease',{timeout:nativeLifecycleTimeout(15000)},nativeLifecycle(15000,async t=>{
 const root=await mkdtemp(join(tmpdir(),'task-follow-conflict-'))
 const h=await nativeRuntimeHost(root,async()=>[{name:'task_result',args:{decision:{action:'wait',summary:'等待原任务资料',evidence:[],limitations:[]}}}],{resident:true})
 const workspaceRoot=h.ctx.runtimePaths.workspaces,persistence=await installTaskSessionPersistence(h.ctx,{root:workspaceRoot}),cwd=await taskWorkspace(workspaceRoot,'task-follow')
 const manager=createSingleTaskSessions({ctx:h.ctx,isCurrent:async()=>true,getWorkspaceDir:async()=>{await persistence.register({taskId:'task-follow',sessionId:'follow-original',cwd});return cwd},withPersistenceWriter:(binding,action)=>persistence.runOwned(binding,action)})
 t.after(async()=>{try{await manager.close();await h.close()}finally{await rm(root,{recursive:true,force:true})}})
 await t.beginBusiness()
 const run=(leaseEpoch,sessionBound)=>manager.run({binding:{kind:'task-session',taskId:'task-follow',sessionId:'follow-original',leaseEpoch,sessionBound,requirementRevision:1,controlRevision:1,contextRevision:0},provider:'native-task-test',model:'controlled',input:{task:{title:'原任务',objective:'继续原任务'},sources:[],materials:[],blockers:[]},onSessionBound:async()=>{},submit:async()=>({accepted:true})})
 assert.equal((await t.step(()=>run(1,false))).status,'submitted')
 const sessionDir=taskSessionLogRoot(workspaceRoot,'task-follow'),files=(await readdir(sessionDir,{recursive:true})).filter(path=>path.endsWith('.jsonl'))
 assert.equal(files.length,1);const bytes=await readFile(join(sessionDir,files[0]))
 // Native observation consumes the strict committed official projection directly;
 // it does not fabricate the retired Night event/query ABI.
 const before=await h.ctx.sessionPersistence.readNative('follow-original',{requireComplete:true})
 assert.equal(before.format,'pi-native-v1');assert.ok(before.context.projection.entries.length>0);assert.equal('events' in before,false)
 assert.equal(h.ctx.agents.get('follow-original'),undefined);assert.equal(h.ctx.get('sessions'),undefined);assert.equal(h.ctx.piAuthority.describe('follow-original'),undefined);assert.equal((await h.ctx.sessionCatalog.header('follow-original')).id,'follow-original')
 const activation=await h.ctx.sessionController.resolveAgent('follow-original')
 assert.ok(activation.error);assert.match(activation.error.message,/TASK_SESSION_HOST_WRITER_REQUIRED|NIGHT_SESSION_TASK_OWNED/)
 await assert.rejects(h.ctx.sessionPersistence.openNative('follow-original'),{code:'TASK_SESSION_HOST_WRITER_REQUIRED'})
 const after=await h.ctx.sessionPersistence.readNative('follow-original',{requireComplete:true})
 assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.audit,before.audit);assert.deepEqual(after.context.projection,before.context.projection)
 assert.deepEqual(await readFile(join(sessionDir,files[0])),bytes)
 assert.equal(h.ctx.agents.get('follow-original'),undefined);assert.equal(h.ctx.get('sessions'),undefined);assert.equal(h.ctx.piAuthority.describe('follow-original'),undefined);assert.equal((await h.ctx.sessionCatalog.header('follow-original')).id,'follow-original')
 assert.equal((await t.step(()=>run(2,true))).status,'submitted')
 const saved=await h.ctx.sessionPersistence.readNative('follow-original',{requireComplete:true})
 assert.deepEqual(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').map(r=>r.payload.source.taskSession.leaseEpoch),[1,2])
 assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
 assert.equal(h.requests.length,2)
}))
