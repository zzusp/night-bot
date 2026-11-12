import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {symlink} from './fixtures/filesystem-link.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,readFile,writeFile,readdir,stat,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {pathToFileURL} from 'node:url'
import {acquireLock,withLock,atomicWrite,readRegular} from '../src/runtime/files.js'
import {runtimePaths,prepareRuntimePaths,prepareSecrets,environmentPaths,pathInventory} from '../src/runtime/paths.js'
import {backupData,restoreData,sanitizedConfig} from '../src/runtime/backup.js'
import {loadConfig} from '../src/config.js'
import {loadNativeEnvironment} from '../src/native-environment.js'
import {createHost} from '../src/host.js'
import {memoryHost} from './fixtures/memory-host.js'
import {requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
const config=root=>({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}})
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-data-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
async function initialize(root,{actor='fixture',model='m',keyEnv='MY_MODEL_KEY'}={}){
  const child=spawn(process.execPath,['bin/night-bot-init.js','--root',root,'--actor',actor,'--provider','fixture','--model',model,'--api','openai-completions','--base-url','http://127.0.0.1:1/v1','--key-env',keyEnv],{stdio:['ignore','pipe','pipe']})
  let out='',error='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>error+=chunk)
  const [code]=await once(child,'close');return {code,out,error}
}
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
test('directory lease handoff preserves a live cross-process owner, reaps a dead owner and serializes real writers',{timeout:nativeTestTimeout(15000)},async t=>{
  let child,closed,output=''
  t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed})
  const root=await fixture(t),path=join(root,'writer.lock'),counter=join(root,'counter.json')
  const script='import {acquireLock} from '+JSON.stringify(new URL('../src/runtime/files.js',import.meta.url).href)+';await acquireLock('+JSON.stringify(path)+');process.on("message",()=>{});process.send("LOCK_HELD");'
  child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe','ipc']});child.stdout.resume();child.stderr.on('data',chunk=>output+=chunk);closed=once(child,'close')
  const [message]=await Promise.race([once(child,'message',{signal:t.signal}),closed.then(result=>assert.fail(JSON.stringify(result)+output))])
  assert.equal(message,'LOCK_HELD');await assert.rejects(acquireLock(path,{timeoutMs:0}),{code:'NIGHT_DATA_IN_USE'})
  child.kill('SIGTERM');await closed
  const release=await acquireLock(path);await release();await release()
  await atomicWrite(counter,'0')
  const rejected=new Error('transaction work rejected')
  await assert.rejects(withLock(path,async()=>{throw rejected}),error=>error===rejected)
  const results=await Promise.allSettled(Array.from({length:16},()=>withLock(path,async()=>{
    const value=Number(await readRegular(counter));await atomicWrite(counter,String(value+1))
  },{timeoutMs:nativeTestTimeout(5000)})))
  for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.stack)
  assert.equal(await readRegular(counter),'16');assert.deepEqual(await readdir(root),['counter.json'])
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
test('initialized default CLI completes a real local task without loading a vendor plugin or probing DWS',{timeout:nativeTestTimeout(60000)},async t=>{
  let child,exited,f,output=''
  const progress={phase:'setup'}
  t.signal.addEventListener('abort',()=>{const reply=f?.requests.flatMap(body=>body.messages).find(message=>message.role==='tool'&&/TASK_|[Ee]rror|validation/.test(String(message.content)));t.diagnostic(JSON.stringify({case:'default-cli-interrupted',progress,modelRequests:f?.requests.length,firstToolErrorCodes:reply?String(reply.content).match(/[A-Z][A-Z0-9_]{5,}/g):undefined,firstToolError:reply?.content,serviceOutput:output}))},{once:true})
  t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null){progress.phase='shutdown-cleanup';child.send({type:'night-bot-shutdown'});await exited}})
  const root=await fixture(t),initialized=await initialize(root,{actor:'cli-owner'})
  assert.equal(initialized.code,0,initialized.error)
  const file=JSON.parse(initialized.out).config,c=await loadConfig(file),p=runtimePaths(c)
  assert.ok(c.channelPlugins.every(plugin=>plugin.enabled===false),'disabled optional metadata must not activate any channel')
  progress.phase='initialized'
  f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'The local task is complete; retain its original ledger references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(requestTools(body).includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：');assert.ok(input)
      if(body.messages.at(-1)?.role==='tool')return {text:'The local task completion event is committed.'}
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'cli-settle:'+input.events.map(event=>event.id).join(',')}}
    }
    if(requestTools(body).includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Default CLI local task verified',evidence:['original HTTP objective'],limitations:[]}}}
    assert.fail('Unexpected default CLI model role')
  })
  await f.close()
  const http=await import('node:http'),reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r))
  const stored=JSON.parse(await readFile(file,'utf8'));stored.providers.fixture=f.config.providers.fixture;stored.providers.fixture.apiKeyEnv='MY_MODEL_KEY';stored.resident.port=port
  await writeFile(file,JSON.stringify(stored,null,2)+'\n')
  const probeDirectory=join(p.temp,'default-cli-probe'),probe=join(probeDirectory,'observe.mjs');await mkdir(probeDirectory)
  await writeFile(probe,String.raw`
import childProcess from 'node:child_process'
import {registerHooks,syncBuiltinESMExports} from 'node:module'
import {writeFileSync} from 'node:fs'
import {basename,join} from 'node:path'
const directory=${JSON.stringify(probeDirectory)},repository=${JSON.stringify(new URL('../',import.meta.url).href)}
const trace={pid:process.pid,entry:basename(process.argv[1]??''),phase:'started',modules:[],processCalls:0,dwsCalls:0}
const save=()=>writeFileSync(join(directory,process.pid+'.json'),JSON.stringify(trace))
const isDwsCommand=value=>/(?:^|[\/\s"'])dws(?:\.(?:exe|cmd|bat))?(?=$|[\s"'])/i.test(String(value).replaceAll(String.fromCharCode(92),'/'))
registerHooks({load(url,context,nextLoad){if(['src/','packages/','bin/'].some(prefix=>url.startsWith(repository+prefix)))trace.modules.push(url.slice(repository.length));return nextLoad(url,context)}})
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){
  const original=childProcess[method]
  childProcess[method]=function(command,...args){trace.processCalls++;if(isDwsCommand(command)||Array.isArray(args[0])&&args[0].some(isDwsCommand))trace.dwsCalls++;return Reflect.apply(original,this,[command,...args])}
}
syncBuiltinESMExports();save();process.once('exit',()=>{trace.phase='closed';save()})
`)
  child=spawn(process.execPath,['bin/night-bot-run.js',file],{env:{...process.env,MY_MODEL_KEY:'local-fixture',NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+pathToFileURL(probe).href].filter(Boolean).join(' ')},stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output+=chunk)
  exited=once(child,'close');progress.phase='cli-spawned'
  const base=`http://127.0.0.1:${port}`,poll=async read=>{for(;;){t.signal.throwIfAborted();const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30))}}
  const health=await poll(async()=>{
    if(child.exitCode!==null||child.signalCode!==null)assert.fail(output||await readFile(join(p.logs,'service.log'),'utf8'))
    let response;try{response=await fetch(base+'/health',{signal:t.signal})}catch{return}
    assert.equal(response.status,200);return response.json()
  })
  assert.equal(health.status,'ok');assert.equal(health.transport,'channels');assert.equal(health.outboundAuthorized,false);progress.phase='http-ready'
  const response=await fetch(base+'/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'default-cli-task',groupId:'local-cli-scope',title:'Local CLI verification',objective:'Return the exact local verification result without sending a channel message.'}),signal:t.signal})
  const created=await response.json();assert.equal(response.status,200,JSON.stringify(created));assert.ok(created.taskId);progress.phase='task-created'
  const detail=await poll(async()=>{const response=await fetch(base+'/state/tasks/'+created.taskId+'/detail',{signal:t.signal});assert.equal(response.status,200);const value=await response.json();return value.status==='completed'&&value.drained?value:undefined})
  assert.equal(detail.completion.result.summary,'Default CLI local task verified');assert.equal(detail.ownerActorId,'cli-owner');assert.equal(detail.runSequence,1);assert.equal(detail.session.role,'execution');assert.deepEqual(detail.executions,[])
  assert.ok(f.requests.some(body=>body.tools?.some(tool=>tool.function.name==='task_result')),'the real CLI must reach the local model/task tool loop')
  assert.ok((await readdir(p.logs)).includes('service.log'));assert.ok(Array.isArray(await readdir(p.temp)))
  progress.phase='task-completed-shutdown';child.send({type:'night-bot-shutdown'});assert.deepEqual(await exited,[0,null],output||await readFile(join(p.logs,'service.log'),'utf8'))
  const traces=await Promise.all((await readdir(probeDirectory)).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await readFile(join(probeDirectory,name),'utf8'))))
  assert.equal(traces.length,2,'both the actual launcher and its service child must have loaded the observation hook')
  assert.deepEqual(traces.map(trace=>trace.entry).sort(),['night-bot-run.js','night-bot.js']);assert.ok(traces.every(trace=>trace.phase==='closed'))
  assert.ok(traces.find(trace=>trace.entry==='night-bot-run.js').processCalls>0,'actual launcher spawn is the process observation positive control')
  const modules=[...new Set(traces.flatMap(trace=>trace.modules))],vendorModules=modules.filter(name=>name==='src/channels/plugins/dingtalk-dws.js'||name==='src/channels/plugins/dws-environment.js'||name==='packages/dingtalk-core/dws-runner.js')
  assert.ok(modules.includes('src/application.js'));assert.ok(modules.includes('src/host.js'));assert.deepEqual(vendorModules,[]);assert.equal(traces.reduce((sum,trace)=>sum+trace.dwsCalls,0),0)
  const moduleLoads=Object.fromEntries(['src/channels/plugins/dingtalk-dws.js','packages/dingtalk-core/dws-runner.js','packages/dingtalk-core/dws-bridge.js','packages/dingtalk-core/dws-adapter.js','packages/dingtalk-core/group-message.js'].map(name=>[name,traces.flatMap(trace=>trace.modules).filter(value=>value===name).length]))
  t.diagnostic(JSON.stringify({case:'initialized-default-cli',taskStatus:detail.status,drained:detail.drained,enabledChannels:c.channelPlugins.filter(plugin=>plugin.enabled).length,observedProcesses:traces.length,moduleLoads,dwsProcessCalls:traces.reduce((sum,trace)=>sum+trace.dwsCalls,0),naturalExit:0,realVendorExecuted:false}))
  assert.equal(moduleLoads['packages/dingtalk-core/dws-bridge.js'],0);assert.equal(moduleLoads['packages/dingtalk-core/dws-adapter.js'],0)
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
  const root=await fixture(t),run=()=>initialize(root,{actor:'my-own-id',model:'my-model'})
  const first=await run();assert.equal(first.code,0,first.error);const file=JSON.parse(first.out).config,c=await loadConfig(file)
  assert.equal(c.installRoot,root);assert.equal(c.workspaceDir,join(root,'data/workspaces'));assert.equal(c.resident.taskSessions.ownerActorId,'my-own-id');assert.equal(c.resident.taskSessions.webActorId,'my-own-id')
  assert.ok(c.channelPlugins.every(plugin=>plugin.enabled===false));assert.ok(Number.isFinite(Date.parse(c.resident.taskSessions.ingressEpoch)))
  assert.equal(c.model.model,'my-model');assert.equal(c.providers.fixture.apiKeyEnv,'MY_MODEL_KEY');assert.doesNotMatch(await readFile(file,'utf8'),/REPLACE_WITH_OWNER_ID|SET_CURRENT_UTC_TIMESTAMP|2026-11-04/)
  assert.notEqual((await run()).code,0)
})

test('credential values and environment files are confined to the separate private secrets directory',async t=>{
  const root=await fixture(t),c=config(root),p=runtimePaths(c);await prepareRuntimePaths(p)
  await writeFile(join(p.secrets,'.env'),'MODEL_LOCAL_KEY=fixture-only-key\n',{mode:0o644});await writeFile(join(p.config,'.env'),'UNEXPECTED_CONFIG_KEY=must-not-load\n')
  await prepareSecrets(p)
  const environment=await loadNativeEnvironment({...environmentPaths(c),inherited:{},materialize:false});assert.equal(environment.get('MODEL_LOCAL_KEY').value,'fixture-only-key');assert.equal(environment.get('UNEXPECTED_CONFIG_KEY'),undefined)
  if(process.platform!=='win32'){assert.equal((await stat(p.secrets)).mode&0o777,0o700);assert.equal((await stat(join(p.secrets,'.env'))).mode&0o777,0o600)}
  const outside=join(root,'external.env');if(process.platform==='win32')await mkdir(outside);else await writeFile(outside,'not an app secret');await symlink(outside,join(p.secrets,'linked.env'));await assert.rejects(prepareSecrets(p),/SECRET_PATH_UNSAFE/)
})


test('Windows 原子替换等待短暂共享占用，持续占用仍失败并保留原文件',{skip:process.platform!=='win32',timeout:nativeTestTimeout(15000)},async t=>{
 for(const transient of [true,false]){
  const root=await fixture(t),file=join(root,'ingress.json'),probe=join(root,'probe.json')
  await atomicWrite(file,'original');await writeFile(probe,'probe')
  const code='param($path) $file=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }'
  const child=spawn('pwsh',['-NoProfile','-NonInteractive','-CommandWithArgs',code,file],{stdio:['pipe','pipe','pipe']})
  const closed=once(child,'close');let error='',output='',timer
  child.stderr.on('data',chunk=>error+=chunk)
  const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCKED'))resolve()});child.on('error',reject);closed.then(([exit])=>{if(!output.includes('LOCKED'))reject(Error('File holder exited '+exit+': '+error))})})
  try{
   await ready
   await assert.rejects(rename(probe,file),error=>['EPERM','EACCES','EBUSY'].includes(error.code))
   assert.equal(await readFile(file,'utf8'),'original')
   if(transient){timer=setTimeout(()=>child.stdin.end(String.fromCharCode(10)),200);await atomicWrite(file,'updated');assert.equal(await readFile(file,'utf8'),'updated')}
   else{await assert.rejects(atomicWrite(file,'must-not-replace'),error=>['EPERM','EACCES','EBUSY'].includes(error.code));assert.equal(await readFile(file,'utf8'),'original')}
   assert.deepEqual((await readdir(root)).sort(),['ingress.json','probe.json'])
  }finally{clearTimeout(timer);if(!child.stdin.destroyed)child.stdin.end(String.fromCharCode(10));await closed}
 }
})
