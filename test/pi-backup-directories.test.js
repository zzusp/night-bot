import {symlink} from './fixtures/filesystem-link.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,lstat,readdir,rm} from 'node:fs/promises'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {join} from 'node:path'
import {backupData,restoreData} from '../src/runtime/backup.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {memoryHost} from './fixtures/memory-host.js'
import {createHost} from '../src/host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function temp(t){const root=await mkdtemp(join(tmpdir(),'night-backup-dirs-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
async function snapshot(t){const root=await temp(t),config={installRoot:root},paths=runtimePaths(config);await prepareRuntimePaths(paths);await mkdir(join(paths.workspaces,'work/sub'),{recursive:true});await mkdir(join(paths.workspaces,'tasks/task/outputs'),{recursive:true});await mkdir(join(paths.workspaces,'credentials-empty'));await writeFile(join(paths.state,'record.json'),'retained');const backup=join(root,'backups/snapshot');await backupData(config,backup);return {root,config,paths,backup,manifest:JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'))}}

test('own backup restores real empty directories across roots with private permissions and exclusions',async t=>{
 const f=await snapshot(t),target=await temp(t),config={installRoot:target};assert.ok(f.manifest.directories.includes('workspaces/work/sub'));assert.ok(f.manifest.directories.includes('workspaces/tasks/task/outputs'));assert.ok(!f.manifest.directories.some(path=>/(?:^|\/)(?:[^/]*credentials[^/]*|secrets|cache|logs|runtime)(?:\/|$)/.test(path)))
 await restoreData(config,f.backup);const paths=runtimePaths(config)
 for(const path of ['work/sub','tasks/task/outputs']){const info=await lstat(join(paths.workspaces,path));assert.ok(info.isDirectory());if(process.platform!=='win32')assert.equal(info.mode&0o777,0o700);assert.deepEqual(await readdir(join(paths.workspaces,path)),[])}
 assert.equal(await readFile(join(paths.state,'record.json'),'utf8'),'retained')
})

test('explicit secret opt-in preserves its empty directories while the default excludes them',async t=>{
 const f=await snapshot(t);await mkdir(join(f.paths.secrets,'private-empty'));await writeFile(join(f.paths.secrets,'credentials-fixture.json'),'fixture-only')
 const backup=join(f.root,'backups/with-secrets');await backupData(f.config,backup,{includeSecrets:true});const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));assert.ok(manifest.directories.includes('secrets/private-empty'))
 const target=await temp(t);await restoreData({installRoot:target},backup);const paths=runtimePaths({installRoot:target});assert.deepEqual(await readdir(join(paths.secrets,'private-empty')),[]);assert.equal(await readFile(join(paths.secrets,'credentials-fixture.json'),'utf8'),'fixture-only')
})
test('old v1 backups without directories remain supported',async t=>{
 const f=await snapshot(t),target=await temp(t);delete f.manifest.directories;await writeFile(join(f.backup,'manifest.json'),JSON.stringify(f.manifest));await restoreData({installRoot:target},f.backup);assert.equal(await readFile(join(runtimePaths({installRoot:target}).state,'record.json'),'utf8'),'retained')
})
test('directory metadata rejects duplicate, file conflict, ancestor file, excluded and escaping paths before installation',async t=>{
 const f=await snapshot(t)
 for(const directories of [null,{},['workspaces/work/sub','workspaces/work/sub'],['state/record.json'],['state/record.json/child'],['../escape'],['workspaces/../escape'],['config/config.json/child'],['secrets'],['runtime/x'],['workspaces/.env'],['workspaces/.write-stage'],['workspaces/a\\b'],['workspaces/x:y'],['workspaces/.. /outside'],['workspaces/a.'],['workspaces/CON']]){
  const target=await temp(t);await writeFile(join(f.backup,'manifest.json'),JSON.stringify({...f.manifest,directories}));await assert.rejects(restoreData({installRoot:target},f.backup),{code:'NIGHT_BACKUP_MANIFEST_INVALID'});await assert.rejects(lstat(join(target,'data/state/record.json')),{code:'ENOENT'})
 }
})
test('backup and restore reject symbolic directory entries and symbolic parent paths',async t=>{
 const f=await snapshot(t),outside=await temp(t);await mkdir(join(outside,'sub'));await rm(join(f.backup,'workspaces/work/sub'),{recursive:true});await symlink(join(outside,'sub'),join(f.backup,'workspaces/work/sub'));await assert.rejects(restoreData({installRoot:await temp(t)},f.backup),{code:'NIGHT_BACKUP_UNSAFE_ENTRY'})
 await symlink(outside,join(f.paths.workspaces,'escape'));await assert.rejects(backupData(f.config,join(f.root,'backups/unsafe')),{code:'NIGHT_BACKUP_UNSAFE_ENTRY'});await rm(join(f.paths.workspaces,'escape'))
 await mkdir(join(f.root,'backups/link-parent'));await symlink(outside,join(f.root,'backups/link-parent/link'));await assert.rejects(backupData(f.config,join(f.root,'backups/link-parent/link/sub/escape')),{code:'NIGHT_BACKUP_UNSAFE_ENTRY'})
})
test('late root or config installation failure rolls back files and preserves prior empty directories',async t=>{
 const f=await snapshot(t)
 for(const mode of ['root','config']){
  const target=await temp(t),paths=runtimePaths({installRoot:target});await prepareRuntimePaths(paths);await mkdir(join(paths.workspaces,'prior-empty'),{recursive:true})
  const rename=fs.rename;let installs=0;fs.rename=async(from,to)=>{
   if(mode==='root'&&String(from).includes('.restore-')&&!String(from).includes('/.prior/')&&String(to).startsWith(paths.data)&&++installs===2)throw Object.assign(Error('fixture installation failure'),{code:'TEST_RESTORE_INSTALL_FAILED'})
   if(mode==='config'&&String(to)===join(paths.config,'config.json')){await rename(from,to);throw Object.assign(Error('fixture config commit failure'),{code:'TEST_RESTORE_INSTALL_FAILED'})}
   return rename(from,to)
  };syncBuiltinESMExports()
  try{await assert.rejects(restoreData({installRoot:target},f.backup),{code:'TEST_RESTORE_INSTALL_FAILED'})}finally{fs.rename=rename;syncBuiltinESMExports()}
  assert.ok((await lstat(join(paths.workspaces,'prior-empty'))).isDirectory());await assert.rejects(lstat(join(paths.state,'record.json')),{code:'ENOENT'});await assert.rejects(lstat(join(paths.config,'config.json')),{code:'ENOENT'});assert.ok(!(await readdir(paths.runtime)).some(name=>name.startsWith('.restore-')||name==='restore.pending.json'))
 }
})

test('actual official actor resumes an initially empty cwd after an own backup across install roots',{timeout:20000},async t=>{
 const f=await memoryHost(t),cwd=join(f.host.ctx.runtimePaths.workspaces,'work/sub');await mkdir(cwd,{recursive:true})
 const actor=await f.host.ctx.agents.create({sessionId:'empty-cwd',agentOptions:f.config.model,meta:{cwd},authorizeInput:()=>true});await actor.dispose();await f.close()
 const backup=join(f.root,'backups/actor');await backupData(f.config,backup);const target=await temp(t),config={...f.config,installRoot:target};await restoreData(config,backup)
 const host=await createHost(config,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});try{const resumed=await host.ctx.agents.resume({sessionId:'empty-cwd',authorizeInput:()=>true});try{const expected=join(host.ctx.runtimePaths.workspaces,'work/sub');assert.equal(resumed.agent.ctx.get('workingDirectory').get(resumed.agent),expected);assert.ok((await lstat(expected)).isDirectory());assert.equal(resumed.agent.metadata.cwd,expected);assert.equal(resumed.agent.ctx.get('sandboxPolicy').resolve({actor:resumed.agent}).workspaceRoot,expected)}finally{await resumed.dispose()}}finally{await host.close()}
 assert.equal(f.requests.length,0)
})

async function service(host,config,initialize){const ctx=host.ctx,options={...config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'empty-task.sqlite'),instanceId:'empty-task',ownerActorId:'owner',webActorId:'owner',reasoningMode:'inherit'},resident=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...options,initialize});const tasks=await openTaskSessionService({ctx,config:options,store,residentStore:resident,legacy:{getAgentConfig:()=>options,getGroup:id=>resident.getGroup(id)},notifications:{async send(){throw Error('no sends')},async readback(){throw Error('no readback')}}});return {tasks,store,async close(){await tasks.close();await store.close();await resident.close()}}}
async function until(fn){for(let n=0;n<400;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('task timeout')}
test('real task empty work/sub and outputs survive own restore while uncertain effects remain held',{timeout:20000},async t=>{
 let effects=0;const f=await memoryHost(t,()=>({tool:'partial_empty_task',args:{}}));f.host.ctx.get('tools').register({name:'partial_empty_task',description:'Fixture partial effect',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/partial.txt'),'unknown effect');throw Error('lost acknowledgement')}})
 const h=await service(f.host,f.config,true),task=await h.tasks.createTask({requestId:'empty-output-task',objective:'Keep partial work held'});await until(async()=>!!(await h.tasks.taskDialogue(task.taskId)).error);await h.tasks.whenIdle();const row=await h.store.query({kind:'task.get',taskId:task.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});await mkdir(join(stored.header.cwd,'work/sub'),{recursive:true});await mkdir(join(stored.header.cwd,'outputs'),{recursive:true});await h.close();await f.close()
 const backup=join(f.root,'backups/task');await backupData(f.config,backup);const target=await temp(t),config={...f.config,installRoot:target};await restoreData(config,backup)
 const host=await createHost(config,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}}),next=await service(host,config,false)
 try{await next.tasks.recover();await next.tasks.whenIdle();const current=await next.store.query({kind:'task.get',taskId:task.taskId}),native=await host.ctx.sessionPersistence.readNative(current.sessionId,{requireComplete:true});for(const dir of ['work/sub','outputs'])assert.deepEqual(await readdir(join(native.header.cwd,dir)),[]);assert.equal(current.drained,true);assert.equal(current.lastDecision.action,'blocked');assert.ok(current.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'));assert.equal(host.ctx.agents.get(current.sessionId),undefined);assert.equal(native.audit.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(native.audit.filter(receipt=>receipt.kind==='effect-result').length,0);assert.equal(effects,1);assert.equal(f.requests.length,1)}finally{await next.close();await host.close()}
})
