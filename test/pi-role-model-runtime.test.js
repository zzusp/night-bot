import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile,mkdir} from 'node:fs/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

const reasoningEfforts={off:null,low:'low',medium:'medium',high:'high'}
const profileModels=['m','quick','arrange','execute'].map(id=>({id,input:['text'],reasoningEfforts,contextWindow:32000,maxTokens:1024,compat:{supportsReasoningEffort:true}}))
const hostConfig=config=>({reflection:{enabled:false},providers:{fixture:{...config.providers.fixture,models:profileModels}},roleModels:{triage:{provider:'fixture',model:'quick',reasoningEffort:'low'},router:{provider:'fixture',model:'arrange',reasoningEffort:'high'},task:{provider:'fixture',model:'execute',reasoningEffort:'medium'}}})
const taskInput=body=>{for(const text of requestText(body).toReversed())try{const value=JSON.parse(text);if(value.task)return value}catch{}}

test('headless actual ingress sends only Router and single-task models and efforts independently; restart consumes env overrides without history loss',{timeout:nativeTestTimeout(90000)},async t=>{
 let h,round=1
 const seen=[]
 const environment={NIGHT_BOT_ROUTER_REASONING_EFFORT:'medium'}
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body),first=requestEnvelope(body,'一级分诊请求：'),handoff=requestEnvelope(body,'Router 交接请求：')
  assert.ok(!tools.includes('channel_triage_submit'),'retired triage model must not run')
  if(handoff)return {text:JSON.stringify({currentIntent:'Keep original synthetic intent',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(tools.includes('task_result')){const input=taskInput(body);seen.push({role:'task',model:body.model,effort:body.reasoning_effort,round,taskId:input.task.taskId});return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic task complete',evidence:['local model request captured'],limitations:[]}}}}
  if(tools.includes('resident_router_settle')){
   if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1).result.isError)return {text:'Batch committed'}
   seen.push({role:'router',model:body.model,effort:body.reasoning_effort,round})
   const input=requestEnvelope(body,'Router 请求：'),source=(await h.query('source.list')).find(row=>row.messageId==='models-'+round),task=await h.query('task.get',{taskId:'role-task-'+round})
   assert.ok(input,'Router original input remains present')
   if(source&&!task)return {tool:'resident_task_plan',args:{operationId:'role-plan-'+round,sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'role-task-'+round,handoff:'Capture the official request and verify which model executes it.',title:'Synthetic role '+round,objective:'Verify selected model',requirements:['Capture the official request']}],dependencies:[]}}
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'role-settle:'+input.events.map(event=>event.id).join(',')}}
  }
  return {text:'No further work'}
 },{hostOptions:{hostConfig,inheritedEnvironment:environment}})
 assert.equal(h.host.ctx.channels.plugins.size,0,'No Web or external plugin is required')
 await h.receive(channelMessage('models-1'));await h.service.whenIdle()
 assert.equal((await h.query('task.get',{taskId:'role-task-1'})).status,'completed')
 for(const role of ['router','task']){const rows=seen.filter(row=>row.role===role);assert.ok(rows.length,role);assert.ok(rows.every(row=>row.model===({triage:'quick',router:'arrange',task:'execute'})[role]&&row.effort===({triage:'low',router:'medium',task:'medium'})[role]),JSON.stringify(rows))}
 const oldTask=await h.query('task.get',{taskId:'role-task-1'}),oldJournal=await h.host.ctx.sessionPersistence.readNative(oldTask.sessionId,{requireComplete:true})
 environment.NIGHT_BOT_ROUTER_REASONING_EFFORT='low'
 environment.NIGHT_BOT_TASK_REASONING_EFFORT='high'
 round=2;await h.restart();await h.receive(channelMessage('models-2'));await h.service.whenIdle()
 assert.equal((await h.query('task.get',{taskId:'role-task-2'})).status,'completed')
 for(const role of ['router','task']){const rows=seen.filter(row=>row.round===2&&row.role===role);assert.ok(rows.length,role);assert.ok(rows.every(row=>row.effort===({triage:'low',router:'low',task:'high'})[role]),JSON.stringify(rows))}
 const retained=await h.host.ctx.sessionPersistence.readNative(oldTask.sessionId,{requireComplete:true})
 assert.deepEqual(retained.entries,oldJournal.entries,'Restart must preserve already committed task history')
 assert.equal(h.requests.filter(body=>requestTools(body).includes('task_result')&&taskInput(body)?.task.taskId==='role-task-1').length,1,'Finished task is not replayed')
})

test('explicit model-default resets a resumed Pi session instead of retaining historical effort',{timeout:nativeTestTimeout(30000)},async t=>{
 const f=await memoryHost(t,()=>({text:'Synthetic reply'}),{hostConfig})
 let handle=await f.host.ctx.agents.create({sessionId:'role-default-resume',agentOptions:f.host.ctx.get('roleModels').router,meta:{cwd:f.host.ctx.runtimePaths.workspaces,agentPreset:'night-bot'},authorizeInput:packet=>packet.source.kind==='user',setup:ctx=>f.host.ctx.agentPresets.mount(ctx,'night-bot')})
 await f.say(handle.agent,'First');assert.equal(f.requests.at(-1).reasoning_effort,'high');const before=handle.agent.piSession.sessionManager.getEntries().filter(entry=>entry.type==='message')
 await handle.dispose();await f.close();delete f.config.roleModels.router.reasoningEffort;await f.boot()
 assert.equal(f.host.ctx.get('roleModels').router.reasoningEffort,'medium')
 handle=await f.host.ctx.agents.resume({resumeSessionId:'role-default-resume',agentOptions:f.host.ctx.get('roleModels').router,authorizeInput:packet=>packet.source.kind==='user',setup:ctx=>f.host.ctx.agentPresets.mount(ctx,'night-bot')})
 t.after(()=>handle.dispose())
 await f.say(handle.agent,'Second');assert.equal(f.requests.at(-1).reasoning_effort,'medium')
 assert.deepEqual(handle.agent.piSession.sessionManager.getEntries().filter(entry=>entry.type==='message').slice(0,before.length),before)
})

for(const mode of [undefined,'ask','auto','full'])test('Host uses full access without approval for legacy mode '+mode,{timeout:nativeTestTimeout(30000)},async t=>{
 let target,called=false
 const f=await memoryHost(t,()=>!called?(called=true,{tool:'write',args:{path:target,content:'direct external write'}}):{text:'Done'},{hostConfig:{permissionMode:mode}})
 assert.equal(f.host.ctx.get('toolPermissions').mode,'full')
 assert.equal(f.host.ctx.get('approval'),undefined)
 await mkdir(join(f.root,'external'));target=join(f.root,'external','business.txt')
 const handle=await f.agent('full-default-write');t.after(()=>handle.dispose())
 const shell=f.host.ctx.tools.schemas(handle.agent).find(tool=>tool.name===(process.platform==='win32'?'pwsh':'bash'))
 for(const key of ['sandbox_permissions','permission_scope','justification'])assert.equal(Object.hasOwn(shell.parameters.properties,key),false)
 await f.say(handle.agent,'Write the synthetic fixture file outside its workspace')
 assert.equal(await readFile(target,'utf8'),'direct external write')
 assert.equal(f.requests.length,2,'one tool-producing response and one terminal response, no approval model')
 const audit=(await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true})).audit
 assert.ok(audit.every(row=>row.domain!=='approval'))
})

test('initialization omits permission mode and rejects the removed option',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url')
 const root=await mkdtemp(join(tmpdir(),'night-default-init-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const install=join(root,'default')
 const init=fileURLToPath(new URL('../bin/night-bot-init.js',import.meta.url))
 await promisify(execFile)(process.execPath,[init,'--actor','fixture-owner','--root',install])
 const config=join(install,'data','config','config.json')
 assert.equal(Object.hasOwn(JSON.parse(await readFile(config,'utf8')),'permissionMode'),false)
 await assert.rejects(promisify(execFile)(process.execPath,[init,'--actor','fixture-owner','--root',join(root,'retired'),'--permission-mode','ask']))
 await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../bin/night-bot-config.js',import.meta.url)),config,'permissions','--permission-mode','auto']))
})
