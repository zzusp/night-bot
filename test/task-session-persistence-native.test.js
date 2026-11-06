import {createHost} from '../src/host.js'
import {convertToLlm} from '@earendil-works/pi-coding-agent'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {randomUUID} from 'node:crypto'
import testRunner from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { taskDirectories, taskWorkspace, taskExecutionWorkspace, taskFilePath } from '../packages/dingtalk-dsh-assistant/session-workspaces.js'
import { installTaskSessionPersistence, registerTaskSessionPersistence, taskSessionLogRoot } from '../packages/dingtalk-dsh-assistant/task-session-persistence.js'
import { findSessionLog } from './fixtures/session-persistence.js'

const run = promisify(execFile)
const test = process.argv[2] === '--task-native-child' ? () => {} : testRunner
const artifacts = resolve('docs/tmp/task-session-native-persistence')
async function temporary() { await mkdir(artifacts, { recursive: true }); return mkdtemp(join(artifacts, 'run-')) }

async function host(root) {
  const app = await createHost({workspaceDir:root,stateDir:root+'-state',model:{provider:'task-native-fixture',model:'fixture'},providers:{'task-native-fixture':{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'PERSISTENCE_FIXTURE_KEY',models:[{id:'fixture',input:['text'],contextWindow:32000,maxTokens:128}]}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false},{environmentOptions:{inherited:{PERSISTENCE_FIXTURE_KEY:'local-fixture-only'}}})
  const ctx=app.ctx, requests=[],handles=[],actualCwds=[]
  const profile=ctx.nativePiProvider.profiles().get('task-native-fixture');delete profile.api
  profile.baseProvider={id:'task-native-fixture',name:'Persistence scripted model',auth:{},getModels:()=>profile.models,streamSimple(model,context){
    requests.push({messages:structuredClone(convertToLlm(context.messages))})
    const done=context.messages.at(-1)?.role==='toolResult',stream=createAssistantMessageEventStream()
    const value={role:'assistant',content:done?[{type:'text',text:'native probe finished'}]:[{type:'toolCall',id:'probe-'+requests.length,name:'actual_cwd_probe',arguments:{}}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:done?'stop':'toolUse',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
    queueMicrotask(()=>{stream.push({type:'done',reason:value.stopReason,message:value});stream.end(value)});return stream
  }}
  const identity=ctx.sessionPersistence.identity,router=await installTaskSessionPersistence(ctx,{root});assert.equal(ctx.sessionPersistence.identity,identity)
  ctx.tools.register({ name:'actual_cwd_probe',description:'Run a real process in the session cwd',parameters:{type:'object'},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_args,execution){
    const actor=execution.agent
    const {stdout}=await run(process.execPath,['-e','require("fs").writeFileSync("cwd-proof-"+process.argv[1]+".txt",process.argv[1]); process.stdout.write(process.cwd())',actor.id],{cwd:actor.metadata.cwd})
    actualCwds.push({sessionId:actor.id,cwd:stdout});return{cwd:stdout,sessionId:actor.id}
  }})
  async function create(taskId,sessionId,execution=false){
    const cwd=execution?await taskExecutionWorkspace(root,taskId,sessionId):await taskWorkspace(root,taskId)
    await registerTaskSessionPersistence(ctx,{taskId,sessionId,cwd})
    const handle=await router.runOwned({taskId,sessionId},()=>ctx.agents.create({sessionId,meta:{cwd},auditKinds:{'persistence/proof':v=>v.taskId==='durable-task'},authorizeInput:()=>true,agentOptions:{provider:'task-native-fixture',model:'fixture'}}));handles.push(handle);return handle.agent
  }
  async function resume(sessionId){
    const saved=await ctx.sessionPersistence.readNative(sessionId,{requireComplete:true}),taskId=relative(join(root,'tasks'),saved.header.cwd).split(/[\\/]/u)[0]
    const handle=await router.runOwned({taskId,sessionId},()=>ctx.agents.resume({resumeSessionId:sessionId,authorizeInput:()=>true,agentOptions:{provider:'task-native-fixture',model:'fixture'}}));handles.push(handle);return handle.agent
  }
  return{ctx,router,requests,actualCwds,create,resume,async createLog(header,options){
    const taskId=relative(join(root,'tasks'),header.cwd).split(/[\\/]/u)[0]
    if(!taskId||taskId==='..')return ctx.sessionPersistence.createNative(header,options)
    const activeRouter=await installTaskSessionPersistence(ctx,{root});return activeRouter.runOwned({taskId,sessionId:header.id},()=>ctx.sessionPersistence.createNative(header,options))
  },async close(){for(const handle of handles)await handle.dispose();await router.close();await app.close()}}
}
const auditHeader=(id,meta)=>({version:4,id,createdAt:Date.now(),isSeeded:false,...meta})
async function deliver(agent,text){const packet={id:randomUUID(),source:{kind:'coordinator'},content:[{type:'text',text}]};await agent.input.enqueue(packet);await agent.input.deliver(packet.id);await agent.whenIdle()}

test('task folders include shared materials/outputs and isolated execution cwd without moving legacy folders', async () => {
  const root = await temporary()
  const old = join(root, 'session-workspaces', '任务执行'); await mkdir(old, { recursive: true }); await writeFile(join(old, 'history.txt'), 'untouched')
  const paths = await taskDirectories(root, 'task-1')
  assert.deepEqual(Object.keys(paths).sort(), ['logicalTaskId', 'root', 'materials', 'outputs', 'tmp', 'work'].sort())
  const owner = await taskWorkspace(root, 'task-1'), a = await taskExecutionWorkspace(root, 'task-1', 'execution-a'), b = await taskExecutionWorkspace(root, 'task-1', 'execution-b')
  assert.equal(owner, join(root, 'tasks', 'task-1'))
  assert.equal(a, owner); assert.equal(b, owner)
  assert.equal(taskFilePath(root, 'task-1', 'materials', 'input.txt'), join(paths.materials, 'input.txt'))
  assert.equal(await readFile(join(old, 'history.txt'), 'utf8'), 'untouched')
  await assert.rejects(taskExecutionWorkspace(root, 'task-1', '../escape'), /TASK_DIRECTORY_INVALID/)
})

test('official AgentSession and native commit write each task log only to its task while same-task real parallel subprocesses share cwd and other tasks stay isolated', { timeout: 15000 }, async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const agents = await Promise.all([h.create('task-a', 'owner-a'), h.create('task-a', 'exec-a', true), h.create('task-a', 'exec-b', true), h.create('task-b', 'owner-b')])
  await Promise.all(agents.map(agent=>deliver(agent,'WORK_FOR_'+agent.id)))
  await h.ctx.sessionPersistence.flush()
  assert.equal(h.actualCwds.length, 4)
  assert.equal(new Set(h.actualCwds.filter(value => value.sessionId !== 'owner-b').map(value => value.cwd)).size, 1)
  assert.notEqual(h.actualCwds.find(value => value.sessionId === 'owner-b').cwd, h.actualCwds.find(value => value.sessionId === 'owner-a').cwd)
  assert.equal((await h.ctx.sessionPersistence.list()).length, 4)
  for (const agent of agents) {
    const taskId = agent.id === 'owner-b' ? 'task-b' : 'task-a'
    const saved = await h.ctx.sessionPersistence.readNative(agent.id,{requireComplete:true})
    assert.equal(saved.header.cwd, agent.metadata.cwd)
    assert.equal(h.actualCwds.find(value => value.sessionId === agent.id).cwd, saved.header.cwd)
    assert.equal(await readFile(join(saved.header.cwd, 'cwd-proof-' + agent.id + '.txt'), 'utf8'), agent.id)
    assert.ok(saved.context.piMessages.some(event => event.role === 'toolResult'))
    assert.ok((await findSessionLog(root, agent.id)).startsWith(taskSessionLogRoot(root, taskId)))
    assert.equal((await h.ctx.sessionPersistence.stat(agent.id)).header.cwd, saved.header.cwd)
    await assert.rejects(h.router.runOwned({ taskId, sessionId: agent.id }, () => h.ctx.sessionPersistence.openNative(agent.id)), { name: 'SessionAlreadyOwnedError' })
  }
  assert.equal((await readdir(join(root, 'legacy-sessions')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).length, 0)
})

test('an active task writer rejects duplicate public activation without releasing its original registry identity', async t => {
  const root=await temporary(),h=await host(root);t.after(()=>h.close())
  const actor=await h.create('child-task','original-task'),before=await h.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
  await assert.rejects(h.ctx.agents.resume({resumeSessionId:actor.id,agentOptions:{provider:'task-native-fixture',model:'fixture'}}))
  await assert.rejects(h.ctx.sessionPersistence.openNative(actor.id),{code:'TASK_SESSION_HOST_WRITER_REQUIRED'})
  assert.equal(h.ctx.agents.get(actor.id),actor)
  assert.deepEqual((await h.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})).entries,before.entries)
})

test('task routing rejects forged parent identities, cross-task cwd and unrelated resume identities', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const parent = await h.create('parent-task', 'real-parent'), other = await h.create('other-task', 'other-parent')
  const options = { sessionId: 'rejected-child', parentAgent: parent,
    meta: { origin: 'subagent', parentSession: parent.id, cwd: parent.metadata.cwd },
    agentOptions: { provider: 'task-native-fixture', model: 'fixture' } }
  for (const invalid of [
    { ...options, parentAgent: { id: parent.id } },
    { ...options, meta: { ...options.meta, cwd: other.metadata.cwd } },
    { ...options, meta: { ...options.meta, parentSession: other.id } },
    { ...options, meta: { ...options.meta, origin: undefined } },
  ]) await assert.rejects(h.ctx.agents.create(invalid), { code: 'TASK_SESSION_BINDING_REQUIRED' })
  assert.equal(await h.ctx.sessionPersistence.stat(options.sessionId), undefined)
  for (const resumeSessionId of [other.id, parent.id]) {
    const before=await h.ctx.sessionPersistence.readNative(resumeSessionId,{requireComplete:true})
    await assert.rejects(h.ctx.agents.resume({resumeSessionId,agentOptions:options.agentOptions}),{code:'TASK_SESSION_HOST_WRITER_REQUIRED'})
    assert.deepEqual((await h.ctx.sessionPersistence.readNative(resumeSessionId,{requireComplete:true})).entries,before.entries)
  }
  assert.equal(h.ctx.agents.get(parent.id),parent);assert.equal(h.ctx.agents.get(other.id),other)
})

test('durable registration precedes session creation, survives router close/reinstall and rejects cwd or task rebinding', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const cwd = await taskWorkspace(root, 'task-a')
  await h.router.register({ taskId: 'task-a', sessionId: 'not-yet-created', cwd })
  assert.equal(await h.ctx.sessionPersistence.stat('not-yet-created'), undefined)
  await h.router.close()
  const next = await installTaskSessionPersistence(h.ctx, { root })
  t.after(() => next.close())
  const session = auditHeader('not-yet-created', { cwd })
  const writer = await h.createLog(session)
  await writer.flush(); await writer.close()
  assert.equal((await h.ctx.sessionPersistence.stat(session.id)).header.cwd, cwd)
  await assert.rejects(next.register({ taskId: 'task-b', sessionId: session.id, cwd: await taskWorkspace(root, 'task-b') }), { code: 'TASK_SESSION_BINDING_CONFLICT' })
  await assert.rejects(h.createLog({ ...session, cwd: root }), { code: 'TASK_SESSION_CWD_MISMATCH' })
  const unbound = auditHeader('unregistered', { cwd })
  await assert.rejects(h.createLog(unbound), { code: 'TASK_SESSION_BINDING_REQUIRED' })
})

test('unregistered native records remain readable but cannot be silently rebound into task persistence', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const legacy = auditHeader('legacy', { cwd: root })
  const writer = await h.createLog(legacy)
  await writer.flush(); await writer.close()
  const path = await findSessionLog(root+'-state', 'legacy'), before = await readFile(path)
  await assert.rejects(h.router.register({ taskId: 'task-a', sessionId: 'legacy', cwd: await taskWorkspace(root, 'task-a') }), { code: 'TASK_SESSION_LEGACY_LOCATION' })
  assert.equal((await h.ctx.sessionPersistence.readNative('legacy',{requireComplete:true})).header.cwd, root)
  assert.deepEqual(await readFile(path), before)
  assert.equal((await h.ctx.sessionPersistence.list()).length, 1)
})

test('concurrent installation and conflicting registrations keep one native routing owner and immutable durable task binding', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  await h.router.close()
  const [a, b] = await Promise.all([installTaskSessionPersistence(h.ctx, { root }), installTaskSessionPersistence(h.ctx, { root })])
  assert.equal(a, b)
  const cwdA = await taskWorkspace(root, 'task-a'), cwdB = await taskWorkspace(root, 'task-b')
  const registrations = await Promise.allSettled([
    a.register({ taskId: 'task-a', sessionId: 'one-id', cwd: cwdA }),
    b.register({ taskId: 'task-b', sessionId: 'one-id', cwd: cwdB }),
  ])
  assert.equal(registrations.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(registrations.find(result => result.status === 'rejected').reason.code, 'TASK_SESSION_BINDING_CONFLICT')
  const winner = registrations.find(result => result.status === 'fulfilled').value
  const session = auditHeader('one-id', { cwd: winner.cwd })
  const writer = await h.createLog(session)
  await writer.flush(); await writer.close()
  await a.close()
  const next = await installTaskSessionPersistence(h.ctx, { root })
  assert.equal((await h.ctx.sessionPersistence.stat('one-id')).header.cwd, winner.cwd)
  assert.equal((await h.ctx.sessionPersistence.list()).length, 1)
  await next.close()
})

test('cancelled native persistence calls retain their abort reason and never create a session', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const cwd = await taskWorkspace(root, 'task-a')
  await h.router.register({ taskId: 'task-a', sessionId: 'cancelled', cwd })
  const session = auditHeader('cancelled', { cwd })
  const signal = AbortSignal.abort(new Error('test abort'))
  for (const operation of [
    () => h.createLog(session, { signal }),
    () => h.ctx.sessionPersistence.readNative(session.id, {signal}),
    () => h.ctx.sessionPersistence.stat(session.id, { signal }),
    () => h.ctx.sessionPersistence.list({ signal }),
  ]) await assert.rejects(operation(), error => error === signal.reason)
  assert.equal(await h.ctx.sessionPersistence.stat(session.id), undefined)
})

test('task and log directory links fail before creating anything outside the configured root', async t => {
  const root = await temporary(), outside = await temporary(), h = await host(root); t.after(() => h.close())
  const directories = await taskDirectories(root, 'task-a')
  await symlink(outside, join(directories.root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(h.router.register({ taskId: 'task-a', sessionId: 'owner-a', cwd: directories.work }), /TASK_DIRECTORY_OUTSIDE_ROOT/)
  assert.deepEqual(await readdir(outside), [])
})

for (const replaced of ['root', 'project', 'session', 'log']) test(`cached native backend rejects a replaced ${replaced} link at every persistence public entry point`, async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const cwd = await taskWorkspace(root, 'task-a')
  await h.router.register({ taskId: 'task-a', sessionId: 'before', cwd })
  await h.router.register({ taskId: 'task-a', sessionId: 'after', cwd })
  const session = auditHeader('before', { cwd })
  const writer = await h.createLog(session)
  await writer.flush(); await writer.close()
  const log = await findSessionLog(root, 'before'), before = await readFile(log)
  const selected = replaced === 'root' ? taskSessionLogRoot(root, 'task-a') : replaced === 'project' ? dirname(dirname(log)) : replaced === 'session' ? dirname(log) : log
  const outside = join(root, 'outside-' + replaced)
  await rename(selected, outside)
  // Windows 最终日志路径使用无特权 junction；文件 symlink 仍由 POSIX 覆盖。
  const windowsLogLink = replaced === 'log' && process.platform === 'win32'
  const linkTarget = windowsLogLink ? join(root, 'outside-log-directory') : outside
  if (windowsLogLink) await mkdir(linkTarget)
  await symlink(linkTarget, selected, process.platform === 'win32' ? 'junction' : replaced === 'log' ? 'file' : 'dir')
  const nextHeader = auditHeader('after', { cwd })
  for (const operation of [
    () => h.router.register({ taskId: 'task-a', sessionId: 'new-binding', cwd }),
    () => h.createLog(nextHeader),
    () => h.ctx.sessionPersistence.readNative('before'),
    () => h.router.runOwned({ taskId: 'task-a', sessionId: 'before' }, () => h.ctx.sessionPersistence.openNative('before')),
    () => h.ctx.sessionPersistence.stat('before'),
    () => h.ctx.sessionPersistence.list(),
  ]) await assert.rejects(operation(), /TASK_DIRECTORY_OUTSIDE_ROOT/)
  await assert.rejects(h.ctx.sessionPersistence.flush(), error => error instanceof AggregateError
    && error.errors.some(item => /TASK_DIRECTORY_OUTSIDE_ROOT/.test(item.message)))
  assert.deepEqual(await readFile(replaced === 'log' ? outside : log), before)
  if (windowsLogLink) assert.deepEqual(await readdir(linkTarget), [])
  if (replaced !== 'log') assert.ok(!(await readdir(outside, { recursive: true })).some(path => path.includes('after') || path.includes('new-binding')))
})

test('cached task routes reject a replaced routing-index directory before registration or native access', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const cwd = await taskWorkspace(root, 'task-a')
  await h.router.register({ taskId: 'task-a', sessionId: 'cached', cwd })
  const index = join(root, 'tasks', '.session-routes'), outside = join(root, 'outside-index')
  await rename(index, outside); await symlink(outside, index, process.platform === 'win32' ? 'junction' : 'dir')
  const entries = await readdir(outside)
  await assert.rejects(h.router.register({ taskId: 'task-a', sessionId: 'new-binding', cwd }), /TASK_DIRECTORY_OUTSIDE_ROOT/)
  await assert.rejects(h.ctx.sessionPersistence.stat('cached'), /TASK_DIRECTORY_OUTSIDE_ROOT/)
  await assert.rejects(h.ctx.sessionPersistence.flush(), /TASK_DIRECTORY_OUTSIDE_ROOT/)
  assert.deepEqual(await readdir(outside), entries)
})

async function processPhase(root, phase) {
  const h = await host(root)
  try {
    const writing = phase === 'write' || phase === 'crash-write'
    const agent = writing ? await h.create('durable-task', 'durable-owner') : await h.resume('durable-owner')
    await deliver(agent,writing ? 'ORIGINAL_HISTORY_MARKER' : 'RESUME_AFTER_COMPACTION')
    if (writing) {
      agent.piSession.sessionManager.appendCompaction('NATIVE_COMPACTION_SUMMARY',null,100)
      agent.receipts.append({version:1,domain:'persistence',kind:'proof',payload:{taskId:'durable-task'}})
    }
    await agent.receipts.commit()
    await writeFile(join(root, phase + '.json'), JSON.stringify({ pid: process.pid, saved: await h.ctx.sessionPersistence.readNative(agent.id,{requireComplete:true}), requests: h.requests, actualCwds: h.actualCwds }))
    if (phase === 'crash-write') process.exit(73) // No agent, router, writer or Context teardown.
  } finally { await h.close() }
}

test('unclean native process exit resumes original task session with compaction preserved and no global duplicate log', { timeout: 20000 }, async () => {
  const root = await temporary(), self = fileURLToPath(import.meta.url)
  await assert.rejects(run(process.execPath, [self, '--task-native-child', root, 'crash-write'], { timeout: 15000 }), { code: 73 })
  await run(process.execPath, [self, '--task-native-child', root, 'resume'], { timeout: 15000 })
  const first = JSON.parse(await readFile(join(root, 'crash-write.json'), 'utf8')), next = JSON.parse(await readFile(join(root, 'resume.json'), 'utf8'))
  assert.notEqual(first.pid, next.pid)
  assert.equal(next.saved.header.cwd, first.saved.header.cwd)
  assert.deepEqual(next.saved.entries.slice(0, first.saved.entries.length), first.saved.entries)
  assert.ok(next.saved.entries.some(entry => entry.type === 'compaction'))
  assert.ok(JSON.stringify(next.saved.entries).includes('ORIGINAL_HISTORY_MARKER'))
  assert.ok(JSON.stringify(next.requests[0]).includes('NATIVE_COMPACTION_SUMMARY'))
  assert.ok(!JSON.stringify(next.requests[0]).includes('ORIGINAL_HISTORY_MARKER'))
  assert.equal(next.actualCwds[0].cwd, first.saved.header.cwd)
  assert.ok((await findSessionLog(root, 'durable-owner')).startsWith(taskSessionLogRoot(root, 'durable-task')))
})

if (process.argv[2] === '--task-native-child') await processPhase(process.argv[3], process.argv[4])


test('registered task writers require exact active Host scope while readonly native access and unrelated unbound native sessions remain available', async t => {
  const root = await temporary(), h = await host(root); t.after(() => h.close())
  const cwd = await taskWorkspace(root, 'scope-task')
  for (const sessionId of ['owned-a', 'owned-b']) await h.router.register({ taskId: 'scope-task', sessionId, cwd })
  const header = auditHeader('owned-a', { cwd })
  await assert.rejects(h.ctx.sessionPersistence.createNative(header), { code: 'TASK_SESSION_HOST_WRITER_REQUIRED' })
  await assert.rejects(h.router.runOwned({ taskId: 'scope-task', sessionId: 'owned-b' }, () => h.ctx.sessionPersistence.createNative(header)), { code: 'TASK_SESSION_HOST_WRITER_REQUIRED' })
  await assert.rejects(h.router.runOwned({ taskId: 'wrong-task', sessionId: 'owned-a' }, () => h.ctx.sessionPersistence.createNative(header)), { code: 'TASK_SESSION_BINDING_REQUIRED' })
  const writer = await h.router.runOwned({ taskId: 'scope-task', sessionId: 'owned-a' }, () => h.ctx.sessionPersistence.createNative(header))
  await writer.flush(); await writer.close()
  const read = await h.ctx.sessionPersistence.readNative('owned-a',{requireComplete:true});assert.equal(read.header.id,'owned-a')
  await assert.rejects(h.ctx.sessionPersistence.openNative('owned-a'), { code: 'TASK_SESSION_HOST_WRITER_REQUIRED' })
  const gate = Promise.withResolvers()
  let detached
  await h.router.runOwned({ taskId: 'scope-task', sessionId: 'owned-a' }, async () => { detached = gate.promise.then(() => h.ctx.sessionPersistence.openNative('owned-a')) })
  gate.resolve()
  await assert.rejects(detached, { code: 'TASK_SESSION_HOST_WRITER_REQUIRED' })
  const legacy = auditHeader('legacy-unbound', { cwd: root })
  const legacyWriter = await h.ctx.sessionPersistence.createNative(legacy); await legacyWriter.close()
})
