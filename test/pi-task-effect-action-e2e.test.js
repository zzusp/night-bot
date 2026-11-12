import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {createServer,request as httpRequest} from 'node:http'
import {spawn} from 'node:child_process'
import {handleRequest} from '../packages/dingtalk-core/http.js'
import {createEffectOperatorAuth,readEffectOperatorToken} from '../src/tasks/effect-operator-auth.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {memoryHost} from './fixtures/memory-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function until(fn){for(let n=0;n<400;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('effect reconciliation timeout')}
async function open(f,{initialize=true,failProjection=false,failAction}={}){
 const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'effect-e2e',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...config,initialize})
 let trip=failProjection,actionTrip=failAction
 const port={...store,command:async command=>{if(trip===true&&command.kind==='task.effect-reconciliation.commit'){trip=false;throw Object.assign(Error('injected SQL projection interruption'),{code:'FIXTURE_PROJECTION_INTERRUPTED'})}if(actionTrip==='before-activate'&&command.id.startsWith('effect-action-activate:')){actionTrip=false;throw Object.assign(Error('activation interrupted'),{code:'FIXTURE_ACTION_INTERRUPTED'})}const result=await store.command(command);if((actionTrip==='after-pause'&&command.id.startsWith('effect-action-pause:'))||(actionTrip==='after-source'&&command.id.startsWith('source:effect-action:'))||(actionTrip==='after-revise'&&command.id.startsWith('effect-action-revise:'))||(actionTrip==='after-activate'&&command.id.startsWith('effect-action-activate:'))){actionTrip=false;throw Object.assign(Error('revision response lost'),{code:'FIXTURE_ACTION_INTERRUPTED'})}if(trip==='prepared-only'&&command.kind==='task.effect-reconciliation.prepare'){trip=false;throw Object.assign(Error('injected interruption after SQL prepare'),{code:'FIXTURE_PREPARE_INTERRUPTED'})}return result}}
 const service=await openTaskSessionService({ctx,config,store:port,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external sends')},readback:async()=>{throw Error('no external readback')}}})
 let closed=false;return {service,store,async close(){if(closed)return;closed=true;await service.close();await store.close();await residentStore.close()}}
}
async function proposal(service,inspection){
 const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Trusted operator read back work/uncertain.txt. It exists; the failed attempt may have partial effects.',outcome:'partial-or-unknown',noReplay:true}
 const bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json'
 await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
 return {...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'operator-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'I inspected the actual output and close this failed attempt with possible partial effects. Do not replay or continue.'}
}

async function post(port,path,body,headers={}){return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path,method:'POST',headers:{'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}))});req.on('error',reject);req.end(JSON.stringify(body))})}
async function cli(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['bin/night-bot-effects.js',...args],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']}),chunks=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>chunks.push(chunk));child.on('error',reject);child.on('close',code=>resolve({code,text:Buffer.concat(chunks).toString('utf8')}))})}
for(const {failure,active=false} of [...[undefined,'after-source','after-revise','before-activate','after-activate'].map(failure=>({failure})),...[undefined,'after-pause','after-source','after-revise'].map(failure=>({failure,active:true}))])test('operator explicitly authorizes a distinct same-args action after closure: '+(active?'active: ':'')+(failure??'normal'),{timeout:nativeTestTimeout(25000)},async t=>{
 let effects=0,phase='unknown',newCalls=0,h
 t.after(()=>h?.close())
 const f=await memoryHost(t,body=>{if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return;if(phase==='unknown')return {tool:'partial_write',args:{}};if(phase==='new'&&newCalls++===0)return {tool:'partial_write',args:{}};return {tool:'task_result',args:{decision:{action:!failure&&effects===2?'complete':'wait',summary:!failure&&effects===2?'Completed only the new separately authorized objective; the prior attempt remains failed with possible partial effects.':'New separately authorized action finished; prior closed attempt remains closed.',evidence:['new native invocation'],limitations:[]}}}})
 f.host.ctx.get('tools').register({name:'partial_write',description:'A real local fixture effect with loss of first response',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'actual effect '+effects);if(effects===1)throw Error('response lost');return {ok:true}}})
 h=await open(f,{failAction:failure})
 const created=await h.service.createTask({requestId:'initial',objective:'Perform a bounded original effect once'});await until(async()=>!!(await h.service.taskDialogue(created.taskId)).error);await h.service.whenIdle()
 const original=await h.store.query({kind:'task.get',taskId:created.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(row=>row.data.kind==='effect-intent'),inspection=await h.service.inspectTaskEffect({taskId:created.taskId,intentEntryId:intent.entryId})
 await h.service.reconcileTaskEffect(await proposal(h.service,inspection));let closed=await h.store.query({kind:'task.get',taskId:created.taskId})
 if(!failure||active){
  phase='new';await h.store.command({id:'bare-unpause',kind:'task.control',args:{taskId:created.taskId,control:'active'}});await h.service.recover();await h.service.whenIdle()
  assert.equal(effects,1,'A distinct official call after bare unpause is not new operator authorization');assert.match(JSON.stringify(f.requests),/TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED/)
  if(!active)await h.store.command({id:'pause-after-no-grant',kind:'task.control',args:{taskId:created.taskId,control:'paused'}});closed=await h.store.query({kind:'task.get',taskId:created.taskId});newCalls=0
 }
 const authorization={taskId:created.taskId,requestId:'new-explicit-action',closedIntentEntryIds:[intent.entryId],objective:'Operator explicitly requests a new bounded action, accepting possible earlier partial effects.',expectedRequirementRevision:closed.requirementRevision,expectedControlRevision:closed.controlRevision,operatorText:'I accept the retained prior partial-effect uncertainty and separately authorize one new invocation within the unchanged scope.'}
 await assert.rejects(h.service.authorizeTaskEffectAction({...authorization,closedIntentEntryIds:['foreign']}))
 assert.equal((await h.store.query({kind:'task.get',taskId:created.taskId})).control,closed.control,'Invalid grant cannot pause or activate the task')
 await assert.rejects(h.service.authorizeTaskEffectAction({...authorization,expectedRequirementRevision:999}),{code:'TASK_EFFECT_AUTHORIZATION_STALE'})
 const caller=await f.agent('model-cannot-authorize-effect');await assert.rejects(f.host.ctx.agents.withInitiator(caller.agent,()=>h.service.authorizeTaskEffectAction(authorization)),{code:'TASK_SESSION_HOST_CONTEXT_REQUIRED'})
 phase='new'
 if(failure){await assert.rejects(h.service.authorizeTaskEffectAction(authorization),{code:'FIXTURE_ACTION_INTERRUPTED'});const held=await h.store.query({kind:'task.get',taskId:created.taskId});assert.equal(held.control,failure==='after-activate'?'active':'paused');assert.equal(held.requirementRevision,closed.requirementRevision+(['after-source','after-pause'].includes(failure)?0:1));const recorded=(await h.store.query({kind:'source.list'})).find(source=>source.requestIdentity?.effectAuthorization);if(failure==='after-pause'){
  assert.equal(recorded,undefined)
  await assert.rejects(h.service.authorizeTaskEffectAction({...authorization,objective:'Changed while paused'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
  const {operatorText,...identity}=authorization
  await assert.rejects(h.store.command({id:'forged-post-pause-source',kind:'source.record',args:{sourceId:'forged',messageId:'forged',groupId:closed.groupId??'task:'+closed.taskId,actorId:'owner',channel:'web',text:operatorText+' changed',requestIdentity:{effectAuthorization:identity}}}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
 }else{assert.equal(recorded.routed,true);assert.equal(recorded.processingPending,false);}if(failure==='after-activate'){await h.service.whenIdle();assert.equal(effects,2,'Durably activated SQLite work drains without waiting for a recovery timer');const count=f.requests.length;await h.service.authorizeTaskEffectAction(authorization);await h.service.whenIdle();assert.equal(f.requests.length,count,'Same-process retry cannot enqueue the already acknowledged action')}else assert.equal(effects,1);if(failure!=='after-activate'){await h.close();h=await open(f,{initialize:false});await h.service.recover();await h.service.whenIdle();assert.equal(effects,1)}}
 let authorized
 if(!failure){
  const auth=await createEffectOperatorAuth(f.host.ctx.runtimePaths),token=await readEffectOperatorToken(f.host.ctx.runtimePaths),server=createServer((req,res)=>handleRequest(req,res,{authorizeTaskEffectAction:h.service.authorizeTaskEffectAction},{effectOperatorAuth:auth}).catch(()=>{res.writeHead(500);res.end('{}')}))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port,path='/tasks/'+created.taskId+'/effects/new-action'
  assert.equal((await post(port,path,authorization)).status,403)
  assert.equal((await post(port,path,{...authorization,actor:'forged'},{authorization:'Bearer '+token})).status,400)
  const configFile=join(f.root,'effect-action-config.json'),proposalFile=join(f.root,'effect-action.json'),noteFile=join(f.root,'effect-action-note.txt'),{operatorText,...identity}=authorization
  await writeFile(configFile,JSON.stringify({...f.config,resident:{host:'127.0.0.1',port}}));await writeFile(proposalFile,JSON.stringify(identity));await writeFile(noteFile,operatorText)
  const result=await cli([configFile,'new-action',proposalFile,'--operator-text-file',noteFile]);assert.equal(result.code,0,result.text);assert.ok(!result.text.includes(token));authorized=JSON.parse(result.text)
 }else authorized=await h.service.authorizeTaskEffectAction(authorization)
 assert.equal(authorized.state,'authorized');await h.service.whenIdle()
 const task=await h.store.query({kind:'task.get',taskId:created.taskId}),native=await f.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.equal(effects,2,JSON.stringify({alerts:h.service.listAlerts(),requests:f.requests}));assert.equal(task.sessionId,original.sessionId);assert.equal(task.requirementRevision,closed.requirementRevision+1);assert.equal(task.control,'active');assert.equal(task.controlRevision,closed.controlRevision+(active?2:1));assert.equal(task.effectReconciliations.length,1)
 assert.equal(task.effectReconciliations[0].receipt.payload.outcome,'closed-with-possible-partial-effects');assert.equal(task.effectReconciliations[0].receipt.payload.noReplay,true);assert.equal(task.effectReconciliations[0].receipt.payload.intentEntryId,intent.entryId)
 if(!failure){assert.equal(task.status,'completed');assert.equal(task.objective,authorization.objective);assert.equal(task.completion.requirementRevision,closed.requirementRevision+1);assert.match(task.completion.summary,/Completed only the new separately authorized objective/);const events=(await h.store.query({kind:'task.events'})).events.filter(event=>event.kind==='task.completed');assert.equal(events.length,1);assert.equal(events[0].requirementRevision,task.requirementRevision)}else assert.equal(task.status,'active')
 const source=await h.store.query({kind:'source.get',sourceId:authorized.sourceId});assert.equal(source.channel,'web');assert.equal(source.actorId,'owner');assert.equal(source.groupId,'task:'+task.taskId);assert.equal(source.routed,true);assert.equal(source.processingPending,false);assert.equal(source.requestIdentity.effectAuthorization.objective,authorization.objective)
 assert.equal(native.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,2);assert.equal(native.audit.filter(row=>row.domain==='task'&&row.kind==='effect-reconciled').length,1)
 const count=f.requests.length;await h.service.authorizeTaskEffectAction(authorization);await h.service.recover();await h.service.whenIdle();assert.equal(effects,2);assert.equal(f.requests.length,count);assert.equal((await h.store.query({kind:'task.get',taskId:task.taskId})).requirementRevision,task.requirementRevision)
 await assert.rejects(h.service.authorizeTaskEffectAction({...authorization,objective:'Changed request replay'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
})
