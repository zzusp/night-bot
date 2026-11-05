import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,readFile,writeFile,readdir,symlink,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {runtimePaths,prepareRuntimePaths,prepareSecrets,environmentPaths,pathInventory} from '../src/runtime/paths.js'
import {backupData,restoreData,sanitizedConfig} from '../src/runtime/backup.js'
import {loadConfig} from '../src/config.js'
import {loadNativeEnvironment} from '../src/native-environment.js'
import {createHost} from '../src/host.js'
import {memoryHost} from './fixtures/memory-host.js'
const config=root=>({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}})
async function fixture(t){const root=await mkdtemp('/tmp/night-data-');t.after(()=>rm(root,{recursive:true,force:true}));return root}
test('portable defaults live below install root while explicit legacy paths remain unchanged',async t=>{
  const root=await fixture(t),file=join(root,'config.json');await writeFile(file,JSON.stringify(config(root)))
  const loaded=await loadConfig(file),paths=runtimePaths(loaded)
  assert.equal(paths.state,join(root,'data','state'));assert.equal(paths.credentials,join(root,'data','secrets','credentials.json'))
  assert.equal(paths.attachmentsHome,join(root,'data'));assert.equal(paths.memory,join(root,'data','memory'))
  assert.equal(runtimePaths({stateDir:join(root,'old-state'),workspaceDir:join(root,'old-work')}).mode,'legacy')
  assert.throws(()=>runtimePaths({...config(root),dataDir:'../outside'}),/OUTSIDE_INSTALL_ROOT/)
  assert.throws(()=>runtimePaths({...config(root),stateDir:join(root,'old')}),/MIXED_DATA_LAYOUT/)
  assert.match(pathInventory(loaded).relocation,/relative/)
})
test('real default Host, auth credential path, attachment cache and memory use the portable layout',async t=>{
  const f=await memoryHost(t),p=f.host.ctx.runtimePaths
  assert.equal(f.host.ctx.credentials.spec.filename,p.credentials)
  assert.equal(f.host.ctx.attachments.root,join(p.data,'attachments','v1'))
  assert.equal(f.host.ctx.attachments.cacheRoot,join(p.cache,'attachments'))
  assert.equal(f.host.ctx.memory.root,p.memory)
  const processHandle=f.host.ctx.subprocess.spawn({argv:[process.execPath,'-e','process.stdout.write("evidence".repeat(50))'],cwd:p.workspaces,stdio:{stdin:'ignore',stdout:{maxBytes:8,spill:{maxBytes:10000}},stderr:{maxBytes:8}},graceMs:100})
  assert.equal((await processHandle.done).exitCode,0);await processHandle.waitForExit()
  assert.ok(processHandle.collected.stdout.readFrom(0).spillPath.startsWith(p.processSpills))
  await assert.rejects(createHost(f.config),e=>e.code==='NIGHT_DATA_IN_USE')
  await assert.rejects(backupData(f.config,join(f.root,'backups','snapshot')),e=>e.code==='NIGHT_DATA_IN_USE')
})
test('offline backups exclude credentials/env/cache/logs, sanitize config, relocate controlled data and refuse corrupt bytes',async t=>{
  const root=await fixture(t),c=config(root),p=runtimePaths(c);await prepareRuntimePaths(p)
  await writeFile(join(p.state,'record.json'),'durable');await writeFile(join(p.state,'.env'),'NOT_IN_BACKUP')
  await writeFile(join(p.secrets,'credentials.json'),'PRIVATE_SECRET');await writeFile(join(p.secrets,'.env'),'TOKEN=PRIVATE_ENV')
  await writeFile(join(p.cache,'cache.txt'),'rebuild');await writeFile(join(p.logs,'log.txt'),'diagnostic')
  await writeFile(join(p.skills,'SKILL.md'),'local skill');await writeFile(join(p.harnessHome,'AGENTS.md'),'local instruction')
  const destination=join(root,'backups','snapshot'),result=await backupData({...c,nested:{password:'INLINE_SECRET',apiKeyEnv:'KEY_NAME',headers:{Authorization:'Bearer HIDDEN_HEADER'},url:'postgres://user:HIDDEN_URL@localhost/db?token=HIDDEN_QUERY'}},destination)
  assert.equal(result.includesSecrets,false)
  const manifest=JSON.parse(await readFile(join(destination,'manifest.json'),'utf8'))
  assert.ok(manifest.files.some(f=>f.path==='state/record.json'));assert.ok(manifest.files.every(f=>!f.path.startsWith('secrets/')&&!f.path.includes('.env')&&!f.path.startsWith('logs/')&&!f.path.startsWith('cache/')))
  assert.doesNotMatch(await readFile(join(destination,'config/config.json'),'utf8'),/INLINE_SECRET|HIDDEN_HEADER|HIDDEN_URL|HIDDEN_QUERY/)
  assert.equal(await readFile(join(destination,'config/skills/SKILL.md'),'utf8'),'local skill')
  assert.equal(sanitizedConfig({apiKey:'bad',apiKeyEnv:'KEY'}).apiKeyEnv,'KEY')
  const relocated=await restoreData(config(join(root,'different-root')),destination);assert.equal(relocated.relocated,true);assert.equal(await readFile(join(root,'different-root/data/state/record.json'),'utf8'),'durable')
  await rm(p.state,{recursive:true});await mkdir(p.state)
  await rm(p.skills,{recursive:true});await mkdir(p.skills);await rm(p.harnessHome,{recursive:true});await mkdir(p.harnessHome)
  const restored=await restoreData(c,destination);assert.equal(restored.credentialsRestored,false);assert.equal(await readFile(join(p.state,'record.json'),'utf8'),'durable')
  assert.equal(await readFile(join(p.secrets,'credentials.json'),'utf8'),'PRIVATE_SECRET')
  assert.equal(await readFile(join(p.harnessHome,'AGENTS.md'),'utf8'),'local instruction')
  await writeFile(join(destination,'state','record.json'),'corrupt')
  await assert.rejects(restoreData(c,destination),/HASH_MISMATCH/)
})
test('unified layout never silently falls back when a data directory is a symlink or unwritable file',async t=>{
  const root=await fixture(t),outside=await fixture(t);await symlink(outside,join(root,'data'))
  await assert.rejects(prepareRuntimePaths(runtimePaths(config(root))),/DIRECTORY_UNAVAILABLE/)
  const guarded=await fixture(t);await assert.rejects(createHost({...config(guarded),skillDirs:[outside]}),/SKILL_DIRECTORY_OUTSIDE_INSTALL/);await symlink(outside,join(guarded,'linked-skills'));await assert.rejects(createHost({...config(guarded),skillDirs:['linked-skills']}),/SKILL_DIRECTORY_ALIAS_UNSAFE/)
  const other=await fixture(t);await writeFile(join(other,'data'),'file');await assert.rejects(prepareRuntimePaths(runtimePaths(config(other))),/DIRECTORY_UNAVAILABLE/)
})

test('an interrupted restore blocks startup and new snapshots instead of accepting partial state',async t=>{
  const root=await fixture(t),c=config(root),p=runtimePaths(c);await prepareRuntimePaths(p)
  await writeFile(join(p.runtime,'restore.pending.json'),'{"version":1,"interrupted":true}')
  await assert.rejects(createHost(c),e=>e.code==='NIGHT_RESTORE_INCOMPLETE')
  await assert.rejects(backupData(c,join(root,'backups','snapshot')),e=>e.code==='NIGHT_RESTORE_INCOMPLETE')
})
test('managed launcher writes logs/tmp under data and starts the real loopback service',async t=>{
  const root=await fixture(t),c=config(root),p=runtimePaths(c);await prepareRuntimePaths(p)
  const http=await import('node:http'),reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r))
  c.resident={host:'127.0.0.1',port,groups:[],dws:{enabled:false,writesAuthorized:false},taskSessions:{instanceId:'layout-test',ownerActorId:'fixture',webActorId:'fixture',initialize:true,ingressEpoch:new Date().toISOString()}}
  const file=join(root,'config.json');await writeFile(file,JSON.stringify(c))
  const child=spawn(process.execPath,['bin/night-bot-run.js',file],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',d=>error+=d);const exited=once(child,'exit')
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited}})
  let health
  for(let n=0;n<150;n++){if(child.exitCode!==null)assert.fail(error);try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){health=await r.json();break}}catch{}await new Promise(r=>setTimeout(r,30))}
  assert.equal(health?.status,'ok',error);assert.ok((await readdir(p.logs)).includes('service.log'));assert.ok(Array.isArray(await readdir(p.temp)))
  child.kill('SIGTERM');assert.equal((await exited)[0],0,error)
})

test('new Night Bot data restores A to B: continued Pi history, workspace, scheduled task, attachment and Markdown memory',{timeout:20000},async t=>{
  const f=await memoryHost(t),a=f.host.ctx.runtimePaths,h=await f.agent('relocation',{actorId:'owner'})
  await f.say(h.agent,'记住 facts/project：portable assistant')
  const workspace=await f.host.ctx.workspaceRegistry.create(a.workspaces);await workspace.attachSession('relocation')
  const attachment=await f.host.ctx.attachments.saveFile({data:new TextEncoder().encode('attachment-proof'),mediaType:'text/plain',name:'proof.txt'})
  const task=await f.host.ctx.schedule.create('relocation',{title:'relocated timer',prompt:'RELOCATED_TIMER_PROOF',at:new Date(Date.now()+2200).toISOString()})
  await writeFile(join(a.workspaces,'artifact.txt'),'retained-output')
  await f.close()
  const backup=join(f.root,'backups','portable');await backupData(f.config,backup)
  const destination=await fixture(t),configB={...f.config,installRoot:destination},restored=await restoreData(configB,backup);assert.equal(restored.relocated,true);assert.equal((await loadConfig(join(destination,'data/config/config.json'))).installRoot,destination)
  const b=await createHost(configB,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});t.after(()=>b.close())
  const paths=b.ctx.runtimePaths,resumed=await b.ctx.sessionController.resolveAgent('relocation');assert.ok(resumed.agent,resumed.error?.message)
  assert.equal(resumed.agent.metadata.cwd,paths.workspaces)
  const restoredPiCwd=resumed.agent.piSession.sessionManager.getCwd()
  assert.equal(b.ctx.workspaceRegistry.get(workspace.id).path,paths.workspaces)
  assert.equal((await b.ctx.memory.read(resumed.agent,{topic:'facts'})).entries[0].text,'portable assistant')
  assert.equal(await readFile(join(paths.workspaces,'artifact.txt'),'utf8'),'retained-output')
  const chunks=[];for await(const chunk of b.ctx.attachments.readFileStream(attachment))chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),'attachment-proof')
  for(let n=0;n<180;n++){const row=(await b.ctx.schedule.catalog()).find(r=>r.id===task.id);if(row?.status==='inactive'&&row.lastDelivery?.messageId&&resumed.agent.admission.status(row.lastDelivery.messageId)==='admitted')break;await new Promise(r=>setTimeout(r,25))}
  await resumed.agent.whenIdle()
  assert.equal((await b.ctx.schedule.history({sessionId:'relocation',id:task.id,limit:10})).records.length,1)
  const restoredHistory=await b.ctx.sessionPersistence.readNative('relocation',{requireComplete:true})
  assert.equal(restoredHistory.format,'pi-native-v1')
  assert.match(JSON.stringify(restoredHistory.context.projection),/portable assistant/)
  assert.match(JSON.stringify(restoredHistory.context.projection),/RELOCATED_TIMER_PROOF/)
  await b.close()
  const c=await createHost(configB,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});try{
    assert.equal((await c.ctx.sessionPersistence.stat('relocation')).header.cwd,paths.workspaces)
    assert.equal((await c.ctx.schedule.history({sessionId:'relocation',id:task.id,limit:10})).records.length,1)
    // The test Host owns this explicit user admission; the ordinary controller
    // intentionally admits only its registered scheduled inputs.
    const continued=await c.ctx.agents.resume({resumeSessionId:'relocation',agentOptions:configB.model,
      authorizeInput:packet=>packet.id==='relocation-continuation'&&JSON.stringify(packet.source)===JSON.stringify({kind:'user'})&&JSON.stringify(packet.content)===JSON.stringify([{type:'text',text:'continue after relocation'}]),
      setup:ctx=>ctx.get('agentPresets').mount(ctx,'night-bot')})
    try{
      await continued.enqueue({id:'relocation-continuation',source:{kind:'user'},content:[{type:'text',text:'continue after relocation'}]})
      await continued.deliver('relocation-continuation',{deliverAs:'followUp'});await continued.whenIdle()
      const native=await c.ctx.sessionPersistence.readNative('relocation',{requireComplete:true})
      assert.match(JSON.stringify(native.context.projection),/portable assistant/)
      assert.match(JSON.stringify(native.context.projection),/continue after relocation/)
    }finally{await continued.dispose()}
    assert.equal(restoredPiCwd,paths.workspaces)
  }finally{await c.close()}
})

test('initializer creates unique private generic configuration, honors install layout and never overwrites it',async t=>{
  const root=await fixture(t),run=()=>new Promise(resolve=>{const child=spawn(process.execPath,['bin/night-bot-init.js','--root',root,'--actor','my-own-id','--provider','fixture','--model','my-model','--key-env','MY_MODEL_KEY'],{stdio:['ignore','pipe','pipe']});let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);child.on('exit',code=>resolve({code,out,error}))})
  const first=await run();assert.equal(first.code,0,first.error);const file=JSON.parse(first.out).config,c=await loadConfig(file)
  assert.equal(c.installRoot,root);assert.equal(c.workspaceDir,join(root,'data/workspaces'));assert.equal(c.resident.taskSessions.ownerActorId,'my-own-id');assert.deepEqual(c.channelPlugins,[])
  assert.equal(c.model.model,'my-model');assert.equal(c.providers.fixture.apiKeyEnv,'MY_MODEL_KEY');assert.doesNotMatch(await readFile(file,'utf8'),/REPLACE_WITH|2026-11-04/)
  assert.notEqual((await run()).code,0)
})

test('credential values and environment files are confined to the separate private secrets directory',async t=>{
  const root=await fixture(t),c=config(root),p=runtimePaths(c);await prepareRuntimePaths(p)
  await writeFile(join(p.secrets,'.env'),'MODEL_LOCAL_KEY=fixture-only-key\n',{mode:0o644});await writeFile(join(p.config,'.env'),'UNEXPECTED_CONFIG_KEY=must-not-load\n')
  await prepareSecrets(p)
  const environment=await loadNativeEnvironment({...environmentPaths(c),inherited:{},materialize:false});assert.equal(environment.get('MODEL_LOCAL_KEY').value,'fixture-only-key');assert.equal(environment.get('UNEXPECTED_CONFIG_KEY'),undefined)
  if(process.platform!=='win32'){assert.equal((await stat(p.secrets)).mode&0o777,0o700);assert.equal((await stat(join(p.secrets,'.env'))).mode&0o777,0o600)}
  const outside=join(root,'external.env');await writeFile(outside,'not an app secret');await symlink(outside,join(p.secrets,'linked.env'));await assert.rejects(prepareSecrets(p),/SECRET_PATH_UNSAFE/)
})
