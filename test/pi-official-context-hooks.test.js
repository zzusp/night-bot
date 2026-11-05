import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAgentSession,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent'
import {createNightOfficialContext} from '../src/runtime/pi-official-context.js'
import {OfficialPiModelRuntime} from '../src/pi-official-model-runtime.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
import {piRequestEvent} from '../src/runtime/pi-request-context.js'
import {officialSkillResources} from '../src/native-tool-skill.js'
import NativeSystemPrompt from '../src/native-system-prompt.js'
import {Context} from '@deepseek-ai/cordis'

async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'night-context-'));t.after(()=>rm(root,{recursive:true,force:true}));const agentDir=join(root,'agent');await mkdir(agentDir)
 const requests=[],profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'FIXTURE_KEY',models:[{id:'m',contextWindow:8192,maxTokens:64}]}})
 const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai')
 const profile=profiles.get('fixture'),model=profile.models[0];delete profile.api
 profile.baseProvider={id:'fixture',auth:{},getModels:()=>[model],streamSimple(_model,context){requests.push(context);const stream=createAssistantMessageEventStream(),message={role:'assistant',provider:'fixture',api:model.api,model:'m',content:[{type:'text',text:'DONE'}],stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)});return stream}}
 const runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'fixture-key'})),resolved=await runtime.resolve({provider:'fixture',model:'m'})
 let actor
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),bridge=createNightOfficialContext({cwd:root,agentDir,getActor:()=>actor,settingsManager:settings,...options})
 await bridge.resourceLoader.reload()
 const manager=SessionManager.inMemory(root),{session}=await createAgentSession({cwd:root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:'off',settingsManager:settings,resourceLoader:bridge.resourceLoader,sessionManager:manager,noTools:'all'})
 actor={id:'actor',ctx:{},piSession:session,admission:{current:()=>({id:'run',messages:[]})},audit:{}}
 t.after(()=>session.dispose())
 return {actor,session,requests,manager,root,bridge}
}
const text=context=>context.messages.filter(m=>m.role==='system').map(m=>JSON.stringify(m)).join('\n')
test('actual official AgentSession owns sections, resources, history and updates without Session facade',async t=>{
 let value='FIRST_POLICY',files=[{path:'/authorized/AGENTS.md',content:'AUTHORIZED_INSTRUCTIONS'}],skills=[];const lifecycle=[]
 const f=await fixture(t,{systemPrompt:{officialSections:async actor=>{assert.equal(actor.session,undefined);return {'night_task':value}}},instructions:async()=>files,skills:async()=>skills,memory:{beforeRun:()=>lifecycle.push('admission'),prompt:()=> 'MEMORY_POLICY',filter:async(_actor,request)=>request,turnEnd:(_actor,event)=>lifecycle.push(event.outcome),settled:()=>lifecycle.push('settled')}})
 assert.ok(f.bridge.resourceLoader.getExtensions().extensions.every(extension=>extension.path!=='builtin:mcp'))
 await f.session.prompt('ordinary first')
 assert.match(text(f.requests[0]),/FIRST_POLICY/);assert.match(text(f.requests[0]),/AUTHORIZED_INSTRUCTIONS/);assert.match(text(f.requests[0]),/MEMORY_POLICY/)
 value='SECOND_POLICY';files=[];await f.session.prompt('ordinary second')
 assert.match(text(f.requests[1]),/SECOND_POLICY/)
 const system=f.manager.buildSessionProjection().messages.filter(m=>m.role==='system').at(-1)
 assert.match(system.sections['night_task'],/SECOND_POLICY/);assert.ok(!JSON.stringify(system).includes('AUTHORIZED_INSTRUCTIONS'))
 assert.ok(f.manager.buildSessionProjection().messages.some(m=>m.role==='assistant'))
 assert.deepEqual(lifecycle,['admission','completed','settled','admission','completed','settled'])
})
test('context policy sees official sourceEntry only and does not grant injected metadata provenance',async t=>{
 let observed
 const f=await fixture(t,{memory:{filter:async(_actor,request)=>{observed=request.messages.map(message=>({message,event:piRequestEvent(request,message)}));return request}}})
 f.manager.appendCustomMessageEntry('night.user','trusted body',false,{event:{type:'user/message',data:{source:{kind:'user',principal:'verified'}}}})
 await f.session.prompt('unprivileged ordinary prompt')
 assert.equal(observed.find(item=>item.message.role==='custom').event.data.source.principal,'verified')
 assert.equal(observed.find(item=>item.message.role==='user').event,undefined)
})
test('skill bridge requires complete catalog and explicit authorized host path',async()=>{
 const skill={name:'example',description:'description',invocation:{modelInvocable:true,userInvocable:true}}
 await assert.rejects(officialSkillResources({complete:false,skills:[]}),{code:'PI_OFFICIAL_SKILL_SNAPSHOT_REQUIRED'})
 await assert.rejects(officialSkillResources({complete:true,skills:[skill]}),{code:'PI_OFFICIAL_SKILL_FILE_REQUIRED'})
 const resources=await officialSkillResources({complete:true,skills:[skill]},{resolveFilePath:()=>'/authorized/example/SKILL.md'})
 assert.equal(resources[0].filePath,'/authorized/example/SKILL.md');assert.equal(resources[0].disableModelInvocation,false)
})
test('prompt business adapter refuses legacy dynamic Session dependencies and accepts explicit actor callbacks',async()=>{
 const ctx=new Context();new NativeSystemPrompt(ctx,{})
 try{ctx.systemPrompt.context({name:'legacy',order:1,required:true,text:({agent})=>agent.session.id});await assert.rejects(ctx.systemPrompt.officialSections({id:'a',ctx}),{code:'PI_OFFICIAL_PROMPT_ADAPTER_REQUIRED'})}finally{await ctx.fiber.dispose()}
 const other=new Context();new NativeSystemPrompt(other,{})
 try{other.systemPrompt.context({name:'policy',order:1,required:true,officialText:({actor})=>'ACTOR '+actor.id,text:()=>{throw Error('legacy called')}});assert.equal((await other.systemPrompt.officialSections({id:'a',ctx:other}))['night_'+Buffer.from('policy').toString('hex')],'ACTOR a')}finally{await other.fiber.dispose()}
})

test('official context policy rejection aborts before provider dispatch rather than trusting swallowed hook exception',async t=>{
 const f=await fixture(t,{memory:{filter:async()=>{throw Object.assign(new Error('signed policy conflict'),{code:'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT'})}}})
 await f.session.prompt('must not dispatch').catch(()=>{})
 assert.equal(f.requests.length,0)
})
test('official before_agent_start rejection never dispatches a policy-less request',async t=>{
 const f=await fixture(t,{systemPrompt:{officialSections:()=>{throw Error('required policy unavailable')}}})
 await f.session.prompt('must not dispatch').catch(()=>{})
 assert.equal(f.requests.length,0)
})

test('real official hooks run immediate memory commands only from admitted authenticated packets and explicit write grant',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),host=await memoryHost(t),service=host.host.ctx.memory
 await service.bindSession('actor',{actorId:'alice'})
 let writable=true,admitted={id:'first',messages:[{id:'source-one',role:'user',source:{kind:'user'},content:'记住 preferences/style：官方短答'}]}
 const f=await fixture(t,{memory:service.official({authorizeWrite:()=>writable})});f.actor.admission.current=()=>admitted
 await f.session.prompt('model prompt is not consent')
 assert.equal((await service.read(f.actor,{topic:'preferences'})).entries[0].text,'官方短答')
 assert.match(text(f.requests.at(-1)),/Immediate command results/)
 writable=false;admitted={id:'second',messages:[{id:'source-two',role:'user',source:{kind:'user'},content:'忘记 preferences/style'}]}
 await f.session.prompt('model prompt is still not consent')
 assert.match(text(f.requests.at(-1)),/MEMORY_READ_ONLY/);assert.equal((await service.read(f.actor,{topic:'preferences'})).entries.length,1)
 writable=true;admitted={id:'third',messages:[{id:'source-three',role:'user',source:{kind:'user'},content:'忘记 preferences/style'}]}
 await f.session.prompt('forget via admitted source')
 assert.equal((await service.read(f.actor,{topic:'preferences'})).entries.length,0)
 assert.equal(f.actor.session,undefined)
})

test('real official signed memory revocation stops with typed conflict and zero provider dispatch',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),host=await memoryHost(t),service=host.host.ctx.memory
 await service.bindSession('actor',{actorId:'alice'})
 const f=await fixture(t,{memory:service.official({authorizeWrite:()=>true})})
 f.actor.admission.current=()=>({id:'remember-run',messages:[{id:'remember-source',source:{kind:'user'},content:'记住 preferences/style：原生签名测试'}]})
 await f.session.prompt('remember via admitted packet')
 const scope=await service.scope(f.actor),revision=(await service.store.index(scope)).revision
 f.requests.length=0
 f.actor.admission.current=()=>({id:'forget-run',messages:[{id:'forget-source',source:{kind:'user'},content:'忘记 preferences/style'}]})
 f.manager.appendMessage({role:'assistant',provider:'fixture',api:'openai-completions',model:'m',responseId:'native-response',content:[{type:'text',text:'NIGHT_LEARNED_SCOPE='+scope.kind+'/'+scope.id+';revision='+revision,textSignature:'original-signature'}],stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
 await f.session.prompt('ordinary request after revoked historical signature').catch(()=>{})
 assert.equal(f.requests.length,0)
 assert.equal(f.bridge.policyFailure.code,'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT')
 assert.equal((await service.read(f.actor,{topic:'preferences'})).entries.length,0,'forget commits while the signed replay request stays blocked')
 const retained=f.manager.buildSessionProjection().messages.find(m=>m.role==='assistant'&&m.responseId==='native-response')
 assert.equal(retained.responseId,'native-response');assert.equal(retained.content[0].textSignature,'original-signature')
})
test('official authorized instruction resources preserve current files and reject budget truncation',async t=>{
 const {officialInstructionFiles}=await import('../src/native-agent-instructions.js')
 const root=await mkdtemp(join(tmpdir(),'night-official-instructions-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await writeFile(join(root,'AGENTS.md'),'AUTHORIZED_CURRENT_SOURCE')
 const options={cwd:root,maxBytes:65536,maxSourceBytes:65536}
 assert.deepEqual(await officialInstructionFiles(options),[{path:join(root,'AGENTS.md'),content:'AUTHORIZED_CURRENT_SOURCE'}])
 await assert.rejects(officialInstructionFiles({...options,maxBytes:50}),{code:'PI_OFFICIAL_INSTRUCTION_BUDGET_EXCEEDED'})
})
