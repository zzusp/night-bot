import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {taskModelSelection} from '../packages/dingtalk-core/task-model-config.js'
import {officialReasoningHost,send} from './fixtures/official-reasoning-host.js'

// Owner/delegated routing was cancelled with the split execution architecture.
// Former Owner depth becomes official session route/default/lifetime evidence.
// Former delegated isolation becomes sole-task versus an independent actor;
// it does not assert that a child execution or an Owner role still exists.
test('official actor snapshots inherited reasoning in flight and applies explicit changes only on same-session resume',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let first=true
 const f=await officialReasoningHost(t,async()=>{if(first){first=false;entered.resolve();await release.promise}return {text:'route verified'}})
 const global={provider:'primary',model:'global-model',reasoningEffort:'low'},configured={provider:'task-route',model:'task-model',reasoningMode:'inherit'}
 let handle=await f.agent('reasoning-binding',taskModelSelection(global,configured));t.after(()=>handle.dispose());assert.ok(handle.session instanceof AgentSession)
 const running=send(handle,'first');await entered.promise
 configured.reasoningMode='explicit';configured.reasoningEffort='high';release.resolve();await running
 assert.equal(f.requests[0].provider,'task-route');assert.equal(f.requests[0].model,'task-model');assert.equal(f.requests[0].reasoning,'low');assert.equal(handle.session.thinkingLevel,'low')
 await handle.dispose();handle=await f.agent('reasoning-binding',taskModelSelection(global,configured),true);await send(handle,'second')
 assert.equal(handle.session.thinkingLevel,'high');assert.equal(f.requests.at(-1).reasoning,'high');assert.equal(f.requests.length,2);assert.equal(global.reasoningEffort,'low')
 const before=await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true});await handle.dispose()
 configured.reasoningEffort='ultra';await assert.rejects(f.agent('reasoning-binding',taskModelSelection(global,configured),true),{code:'UNSUPPORTED_REASONING_EFFORT'})
 assert.deepEqual((await f.host.ctx.sessionPersistence.readNative('reasoning-binding',{requireComplete:true})).entries,before.entries)
})

test('model-default reasoning is selected by official SDK support, independently of global low',{timeout:15000},async t=>{
 const f=await officialReasoningHost(t,()=>({text:'official default verified'})),selection=taskModelSelection(f.config.model,{provider:'task-route',model:'high-only',reasoningMode:'model-default'})
 assert.equal(selection.reasoningEffort,undefined)
 const handle=await f.agent('official-model-default',selection);t.after(()=>handle.dispose());assert.equal(handle.session.thinkingLevel,'high');await send(handle,'default-input')
 assert.equal(f.requests[0].reasoning,'high');assert.equal(f.requests[0].model,'high-only');assert.equal(f.config.model.reasoningEffort,'low')
})

test('cancel and a full cold resume preserve exact session model identity without reusing a cancelled request',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=true
 const f=await officialReasoningHost(t,async()=>{if(hold){entered.resolve();await release.promise}return {text:'cold route verified'}})
 let handle=await f.agent('cancelled-model',{provider:'task-route',model:'task-model',reasoningEffort:'high'});t.after(()=>handle.dispose())
 const running=send(handle,'cancelled-request'),outcome=running.catch(error=>error);await entered.promise
 const cancelling=handle.cancel();release.resolve();await cancelling;await outcome;assert.equal(f.requests[0].signal.aborted,true)
 await handle.dispose();hold=false;await f.cold()
 // No model override: official persisted model/thinking entries are authority.
 handle=await f.agent('cancelled-model',{},true);assert.equal(handle.session.model.provider,'task-route');assert.equal(handle.session.model.id,'task-model');assert.equal(handle.session.thinkingLevel,'high')
 const count=f.requests.length;await send(handle,'fresh-after-cold');assert.equal(f.requests.length,count+1);assert.equal(f.requests.at(-1).provider,'task-route');assert.equal(f.requests.at(-1).reasoning,'high')
})

test('Single task uses its explicit model/depth while an independent official actor retains the global route',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false
 const f=await officialReasoningHost(t,async request=>{
  if(request.provider==='task-route'){if(!held){held=true;entered.resolve();await release.promise}return {calls:[{name:'task_result',args:{decision:{action:'wait',summary:'Verified the sole task model route',evidence:[],limitations:[]}}}]}}
  return {text:'independent global route verified'}
 })
 const agentConfig={...f.config.model,agentPreset:'night-bot',taskSessionModel:{provider:'task-route',model:'task-model',reasoningMode:'explicit',reasoningEffort:'high'}},service=await f.service(agentConfig)
 const task=await service.createTask({requestId:'single-model-route',objective:'Verify the sole task model and depth'})
 await entered.promise;agentConfig.taskSessionModel.reasoningEffort='low';release.resolve();await service.whenIdle()
 assert.equal(f.requests.filter(request=>request.provider==='task-route').length,1);assert.equal(f.requests.find(request=>request.provider==='task-route').reasoning,'high')
 const global=await f.agent('independent-global',f.config.model);try{await send(global,'global-input');assert.equal(f.requests.at(-1).provider,'primary');assert.equal(f.requests.at(-1).model,'global-model');assert.equal(f.requests.at(-1).reasoning,'low')}finally{await global.dispose()}
 await service.sendTaskDialogue({taskId:task.taskId,requestId:'next-depth',text:'Verify the current configured task depth without new effects'});await service.whenIdle()
 const taskRequests=f.requests.filter(request=>request.provider==='task-route');assert.equal(taskRequests.length,2);assert.equal(taskRequests[1].reasoning,'low')
 const stored=await f.host.ctx.sessionPersistence.readNative(task.session.sessionId,{requireComplete:true});assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='identity').length,1);assert.equal((await service.store.query({kind:'execution.list'})).length,0)
})


test('an explicit same-model route with no effort uses direct official SDK defaults rather than deployment low',{timeout:15000},async t=>{
 const {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader}=await import('@earendil-works/pi-coding-agent')
 const {mkdir}=await import('node:fs/promises'),{join}=await import('node:path')
 const f=await officialReasoningHost(t,()=>({text:'same-model default verified'})),route={provider:'primary',model:'global-model'}
 const resolved=await f.host.ctx.get('nativePiProvider').official.resolve(route),agentDir=join(f.root,'official-default-reference');await mkdir(agentDir)
 const settings=SettingsManager.inMemory(),loader=new DefaultResourceLoader({cwd:f.root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const {session}=await createAgentSession({cwd:f.root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,sessionManager:SessionManager.inMemory(f.root),settingsManager:settings,resourceLoader:loader,noTools:'all'})
 const expected=session.thinkingLevel;session.dispose()
 const handle=await f.agent('same-model-default',route);t.after(()=>handle.dispose())
 assert.equal(handle.session.thinkingLevel,expected);assert.equal(f.requests.length,0)
 await send(handle,'same-model-input');assert.equal(f.requests[0].reasoning,expected)
})
