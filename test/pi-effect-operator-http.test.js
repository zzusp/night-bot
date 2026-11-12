import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {symlink} from './fixtures/filesystem-link.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,link,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {handleRequest} from '../packages/dingtalk-core/http.js'
import {createEffectOperatorAuth,readEffectOperatorToken,EFFECT_OPERATOR_TOKEN_FILE} from '../src/tasks/effect-operator-auth.js'
import {memoryHost} from './fixtures/memory-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function until(fn){for(let n=0;n<400;n++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('operator fixture timed out')}
async function post(port,path,body,headers={}){return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path,method:'POST',headers:{'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString('utf8'),body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}))});req.on('error',reject);req.end(JSON.stringify(body))})}
async function cli(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['bin/night-bot-effects.js',...args],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']}),chunks=[];child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>chunks.push(c));child.on('error',reject);child.on('close',code=>resolve({code,text:Buffer.concat(chunks).toString('utf8')}))})}
test('portable operator credential rejects unsafe files and legacy authority',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-operator-token-'));t.after(()=>rm(root,{recursive:true,force:true}));const secrets=join(root,'secrets');await mkdir(secrets,{mode:0o700});const paths={mode:'portable',secrets},file=join(secrets,EFFECT_OPERATOR_TOKEN_FILE),auth=await createEffectOperatorAuth(paths),token=await readEffectOperatorToken(paths)
 assert.equal(await auth.authorize({headers:{authorization:'Bearer '+token}}),true);assert.equal(await auth.authorize({headers:{authorization:'Bearer '+'0'.repeat(64)}}),false);if(process.platform!=='win32')assert.equal((await lstat(file)).mode&0o777,0o600)
 if(process.platform!=='win32'){await chmod(file,0o644);assert.equal(await auth.authorize({headers:{authorization:'Bearer '+token}}),false);await assert.rejects(readEffectOperatorToken(paths),{code:'EFFECT_OPERATOR_SECRET_UNSAFE'});await chmod(file,0o600)}
 await link(file,join(secrets,'second'));await assert.rejects(readEffectOperatorToken(paths),{code:'EFFECT_OPERATOR_SECRET_UNSAFE'});await rm(join(secrets,'second'));await rm(file)
 await symlink(join(secrets,'missing'),file,process.platform==='win32'?'junction':'file');await assert.rejects(createEffectOperatorAuth(paths),{code:process.platform==='win32'?'EFFECT_OPERATOR_SECRET_UNAVAILABLE':'EFFECT_OPERATOR_SECRET_UNSAFE'});await assert.rejects(readEffectOperatorToken(paths),{code:'EFFECT_OPERATOR_SECRET_UNSAFE'});await rm(file);await writeFile(file,'{"version":1,',{mode:0o600});await assert.rejects(createEffectOperatorAuth(paths),{code:'EFFECT_OPERATOR_SECRET_INVALID'})
 assert.equal((await createEffectOperatorAuth({mode:'legacy'})).available,false);await assert.rejects(readEffectOperatorToken({mode:'legacy'}),{code:'EFFECT_OPERATOR_PRIVACY_UNAVAILABLE'})
})
test('actual portable Host refuses weak preexisting operator token before repairing permissions',{skip:process.platform==='win32'?'POSIX chmod privacy bits do not exist on Windows; Windows ACL certification is separate':false},async t=>{
 const f=await memoryHost(t);await f.close();const file=join(f.root,'data/secrets',EFFECT_OPERATOR_TOKEN_FILE);await writeFile(file,JSON.stringify({version:1,token:'1'.repeat(64)})+'\n',{mode:0o644});await chmod(file,0o644)
 await assert.rejects(f.boot(),error=>error.code==='NIGHT_BOT_DATA_DIRECTORY_UNAVAILABLE'&&error.cause?.code==='EFFECT_OPERATOR_SECRET_UNSAFE');assert.equal((await lstat(file)).mode&0o777,0o644)
})
test('actual HTTP operator capability closes unknown effects paused and CLI never starts another model',{timeout:nativeTestTimeout(20000)},async t=>{
 let effects=0,service,store,residentStore
 t.after(async()=>{await service?.close();await store?.close();await residentStore?.close?.()})
 const f=await memoryHost(t,body=>body.tools?.some(tool=>tool.function.name==='partial_operator_write')?{tool:'partial_operator_write',args:{}}:undefined),ctx=f.host.ctx
 ctx.get('tools').register({name:'partial_operator_write',description:'Fixture writes then fails',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'one effect');throw Error('lost response')}})
 const config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'operator-http',ownerActorId:'owner',webActorId:'real-operator',agentPreset:'night-bot',reasoningMode:'inherit'};residentStore=await openResidentStore(ctx.storageDomain);store=await openDynamicTaskStore({...config,initialize:true});let commands=0
 service=await openTaskSessionService({ctx,config,store:{...store,command:command=>{commands++;return store.command(command)}},residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no sends')},readback:async()=>{throw Error('no readback')}}})
 const task=await service.createTask({requestId:'unknown',objective:'Perform the authorized local effect once'});await until(async()=>!!(await service.taskDialogue(task.taskId)).error);await service.whenIdle()
 const row=await store.query({kind:'task.get',taskId:task.taskId}),native=await ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),intent=native.auditEntries.find(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-intent'),auth=await createEffectOperatorAuth(ctx.runtimePaths),token=await readEffectOperatorToken(ctx.runtimePaths),runtime={inspectTaskEffect:service.inspectTaskEffect,reconcileTaskEffect:service.reconcileTaskEffect}
 const server=createServer((req,res)=>handleRequest(req,res,runtime,{effectOperatorAuth:auth}).catch(()=>{res.writeHead(500);res.end('{}')}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port,path=`/tasks/${task.taskId}/effects/${intent.entryId}`,headers={authorization:'Bearer '+token},before=commands,modelRequests=f.requests.length
 for(const extra of [{},{authorization:'Bearer '+'0'.repeat(64)},{...headers,host:'foreign.example:'+port},{...headers,origin:'https://foreign.example'}]){const result=await post(port,path+'/inspect',{},extra);assert.equal(result.status,403);assert.ok(!result.text.includes(token))}
 assert.equal((await post(port,path+'/inspect',{actor:'forged'},headers)).status,400);assert.equal(commands,before)
 const inspectionResponse=await post(port,path+'/inspect',{},headers);assert.equal(inspectionResponse.status,200);assert.equal(inspectionResponse.body.outcome,'unknown');const inspection=inspectionResponse.body
 const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Operator read back uncertain.txt; partial effects remain possible.',outcome:'partial-or-unknown',noReplay:true},bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),evidencePath='materials/runtime-evidence/effects/'+sha256+'.json'
 await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,evidencePath),bytes)
 const proposal={...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'operator-http-close',evidenceRefs:[{path:evidencePath,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true},closeBefore=commands
 for(const bad of [{...proposal,operatorText:'real check',actor:'forged'},{...proposal,operatorText:'real check',source:{actorId:'forged'}},{...proposal,operatorText:token}]){const result=await post(port,path+'/close',bad,headers);assert.equal(result.status,400);assert.ok(!result.text.includes(token))}assert.equal(commands,closeBefore)
 const configFile=join(f.root,'operator-config.json'),proposalFile=join(f.root,'proposal.json'),note=join(f.root,'operator-note.txt');await writeFile(configFile,JSON.stringify({...f.config,resident:{host:'127.0.0.1',port}}));await writeFile(proposalFile,JSON.stringify(proposal));await writeFile(note,'Operator confirms retained readback and closes possible partial effects without replay.')
 const rejectedSecret=await cli([configFile,'close',proposalFile,'--operator-text-file',join(ctx.runtimePaths.secrets,EFFECT_OPERATOR_TOKEN_FILE)]);assert.equal(rejectedSecret.code,1);assert.match(rejectedSecret.text,/EFFECT_OPERATOR_SECRET_IN_REQUEST/);assert.ok(!rejectedSecret.text.includes(token));assert.equal(commands,closeBefore)
 const inspected=await cli([configFile,'inspect',task.taskId,intent.entryId]);assert.equal(inspected.code,0,inspected.text);assert.equal(JSON.parse(inspected.text).outcome,'unknown');assert.ok(!inspected.text.includes(token))
 const closed=await cli([configFile,'close',proposalFile,'--operator-text-file',note]);assert.equal(closed.code,0,closed.text);assert.equal(JSON.parse(closed.text).state,'committed');assert.ok(!closed.text.includes(token))
 const final=await store.query({kind:'task.get',taskId:task.taskId});assert.equal(final.control,'paused');assert.equal(final.effectReconciliations[0].state,'committed');assert.equal(final.effectReconciliations[0].receipt.payload.operatorActorId,'real-operator');assert.equal(effects,1);assert.equal(f.requests.length,modelRequests);assert.ok(!JSON.stringify(final).includes(token));const stored=await ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.ok(!JSON.stringify(stored).includes(token));assert.ok(!JSON.stringify(f.requests).includes(token))
})

test('default portable backup and source manifest exclude the operator credential',async t=>{
 const f=await memoryHost(t),paths=f.host.ctx.runtimePaths;await createEffectOperatorAuth(paths);const token=await readEffectOperatorToken(paths),privacyHandle=await f.agent('operator-secret-privacy'),actor=privacyHandle.agent;await assert.rejects(f.host.ctx.agents.withInitiator(actor,async()=>{const fs=actor.ctx.get('fs'),target=await fs.resolve(join(paths.secrets,EFFECT_OPERATOR_TOKEN_FILE));return fs.readText(target)}),{code:'FS_SANDBOX_DENIED'});await f.close()
 const {backupData}=await import('../src/runtime/backup.js'),destination=join(f.root,'backups','operator-proof');await backupData(f.config,destination)
 const manifest=JSON.parse(await readFile(join(destination,'manifest.json'),'utf8'));assert.ok(manifest.excludedRoots.includes('secrets'));assert.ok(!manifest.files.some(file=>file.path.includes(EFFECT_OPERATOR_TOKEN_FILE)));assert.ok(!JSON.stringify(manifest).includes(token));await assert.rejects(readFile(join(destination,'secrets',EFFECT_OPERATOR_TOKEN_FILE)),{code:'ENOENT'})
 for(const file of ['src/tasks/effect-operator-auth.js','src/application.js','packages/dingtalk-core/http.js','bin/night-bot-effects.js','docs/source-manifest.json'])assert.ok(!(await readFile(new URL('../'+file,import.meta.url),'utf8')).includes(token))
})

test('actual application publishes the protected operator routes with its private capability',{timeout:15000},async t=>{
 const f=await memoryHost(t),reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve))
 const application=await import('../src/application.js'),config={...f.config,resident:{host:'127.0.0.1',port,taskSessions:{initialize:true,instanceId:'operator-app',ownerActorId:'owner',webActorId:'operator',ingressEpoch:new Date().toISOString()}}};await f.host.ctx.plugin(application,config)
 const token=await readEffectOperatorToken(f.host.ctx.runtimePaths),path='/tasks/nonexistent/effects/nonexistent/inspect';assert.equal((await post(port,path,{})).status,403)
 const result=await post(port,path,{}, {authorization:'Bearer '+token});assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.error,'TASK_EFFECT_TASK_NOT_QUIESCENT');assert.ok(!result.text.includes(token));assert.equal(f.requests.length,0)
 const actionResponse=await post(port,'/tasks/nonexistent/effects/new-action',{}, {authorization:'Bearer '+token});assert.equal(actionResponse.status,410);assert.equal(f.requests.length,0)
})
