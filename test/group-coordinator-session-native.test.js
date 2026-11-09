import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ModelRuntime,SettingsManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import NativeAgents from '../src/native-agents.js'
import NativeSystemPrompt from '../src/native-system-prompt.js'
import NativeTools from '../src/native-tools.js'
import NativeApproval from '../src/native-approval.js'
import NativePolicy from '../src/native-policy.js'
import NativePermissions from '../src/native-permission-presets.js'
import PiPersistence from '../src/pi-session-persistence.js'
import * as Authority from '../src/pi-authority.js'
import OfficialAgentFactory from '../src/pi-official-agent-factory.js'
import {officialRetrySettings} from '../src/runtime/pi-official-settings.js'
import {createGroupCoordinatorSessions} from '../packages/dingtalk-core/group-coordinator-session.js'

const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const decision={message:'accepted'}
const decisionSchema={type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false}
async function fixture(t,respond,{root:existingRoot}={}){
 const root=existingRoot??await mkdtemp(join(tmpdir(),'night-official-group-')),agentDir=join(root,'agent');await mkdir(agentDir,{recursive:true})
 const ctx=new Context();new NativeAgents(ctx);new NativeSystemPrompt(ctx,{includeHarnessIdentity:false});new NativeTools(ctx);new NativeApproval(ctx,{policy:'ask'});new NativePolicy(ctx,{mode:'read-only',workspaceRoot:root});ctx.provide('shell',{sandboxMode:'read-only'});new NativePermissions(ctx,{defaultPreset:'workspace-write'})
 await ctx.plugin(Authority);const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const attachments=[];ctx.provide('workspaceRegistry',{resolveByPath:async()=>({attachSession:async id=>attachments.push(id)})})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false}),model=runtime.getModels().find(m=>m.provider==='openai')??runtime.getModels()[0]
 await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 const requests=[],toolNames=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  requests.push(structuredClone(context.messages));toolNames.push((context.tools??[]).map(tool=>tool.name));const stream=createAssistantMessageEventStream()
  queueMicrotask(()=>{const response=respond?.(context,requests.length)??{calls:[{name:'group_coordinator_submit',args:{decision}}]},calls=response.calls??[]
   const message={role:'assistant',content:calls.length?calls.map((call,index)=>({type:'toolCall',name:call.name,id:call.id??'call-'+requests.length+'-'+index,arguments:call.args??{}})):[{type:'text',text:response.text??'no submission'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:calls.length?'toolUse':'stop',usage}
   stream.push({type:'done',reason:message.stopReason,message});stream.end(message)})
  return stream
 }})
 const handles=new Set();let lease=1,cwd=root
 const retrySettings={enabled:false,maxRetries:0,provider:{maxRetries:0}}
 const factory=new OfficialAgentFactory(ctx,{store:backend,
  // This fixture registers no process/job producers; SDK tools drain before this
  // capability is invoked. Actual platform observation has separate root tests.
  drainBusiness:async()=>({processes:0,jobs:0}),
  resolveResources:async({actor})=>({resolved:{modelRuntime:runtime,model,thinkingLevel:'off',requestOptions:{maxRetries:0},retrySettings},agentDir,registry:actor.ctx.get('tools'),maxParallelToolCalls:2,settingsManager:SettingsManager.inMemory({...officialRetrySettings(retrySettings),packages:[],compaction:{enabled:false}}),context:{systemPrompt:ctx.systemPrompt}}),
 })
 ctx.agents.setFactory(factory)
 const sessions=createGroupCoordinatorSessions({ctx,isCurrent:async binding=>binding.leaseEpoch===lease,getWorkspaceDir:async()=>cwd,getGroupName:()=> 'Conversation title',contentRoot:join(root,'content')})
 let closing;const close=()=>closing??=(async()=>{await sessions.close();await ctx.fiber.dispose()})();t.after(async()=>{await close();if(!existingRoot)await rm(root,{recursive:true,force:true})})
 const run=(extra={})=>sessions.run({binding:{conversationId:'group',sessionId:'group-session',turnId:'turn-'+lease,leaseEpoch:lease,sessionBound:lease>1},input:{sources:[{sourceKey:'message',sourceVersion:1,body:'authorized original',context:{channel:'fixture'}}]},provider:'fixture',model:model.id,decisionSchema,onSessionBound:async()=>{},onCandidate:async value=>assert.deepEqual(value,decision),...extra})
 return{root,ctx,backend,requests,toolNames,sessions,run,attachments,close,setLease:value=>{lease=value},setCwd:value=>{cwd=value}}
}

test('official group coordinator commits identity and candidate receipts, resumes same session and never replays accepted effects',async t=>{
 const f=await fixture(t);let effects=0
 assert.equal((await f.run({onCandidate:async()=>{effects++}})).status,'submitted');assert.equal(effects,1);assert.equal(f.ctx.agents.get('group-session'),undefined)
 let cold=await f.backend.readNative('group-session',{requireComplete:true})
 assert.equal(cold.audit.filter(r=>r.domain==='group-coordinator'&&r.kind==='identity').length,1)
 assert.equal(cold.audit.filter(r=>r.domain==='group-coordinator'&&r.kind==='candidate-result'&&r.payload.outcome==='accepted').length,1)
 assert.equal(cold.context.piMessages.filter(m=>m.role==='custom'&&m.customType==='night.business-input').length,1)
 assert.equal(await f.sessions.prepare({conversationId:'group',sessionId:'group-session',leaseEpoch:1,sessionBound:true}),null)
 f.setLease(2);assert.equal((await f.run({onCandidate:async()=>{effects++}})).status,'submitted');assert.equal(effects,2)
 cold=await f.backend.readNative('group-session',{requireComplete:true});assert.equal(cold.context.piMessages.filter(m=>m.role==='custom'&&m.customType==='night.business-input').length,2)
 assert.ok(cold.context.projection.entries.some(row=>row.sourceEntry.type==='session_info'&&row.sourceEntry.name==='Conversation title'))
 await assert.rejects(f.run(),{code:'GROUP_COORDINATOR_SESSION_LEASE_NOT_ADVANCED'})
 assert.equal(effects,2);assert.equal(f.requests.length,2)
})

test('unknown candidate result remains held across reopen and cannot repeat the business callback',async t=>{
 const f=await fixture(t);let effects=0
 await assert.rejects(f.run({onCandidate:async()=>{effects++;throw Object.assign(new Error('result unknown'),{code:'BUSINESS_EFFECT_UNKNOWN'})}}))
 assert.equal(effects,1);assert.equal(f.requests.length,1)
 const cold=await f.backend.readNative('group-session',{requireComplete:true})
 assert.ok(cold.audit.some(row=>row.domain==='group-coordinator'&&row.kind==='candidate-result'&&row.payload.outcome==='unknown'))
 f.setLease(2)
 await assert.rejects(f.run({onCandidate:async()=>{effects++}}),{code:'GROUP_COORDINATOR_CANDIDATE_RECONCILIATION_REQUIRED'})
 assert.equal(effects,1);assert.equal(f.requests.length,1)
})

test('known rejected decision can be revised through official tools without a new session or extra accepted effect',async t=>{
 const f=await fixture(t);let attempts=0
 const result=await f.run({onCandidate:async()=>{if(++attempts===1)throw Object.assign(Error('version changed'),{code:'TASK_VERSION_STALE'})}})
 assert.equal(result.status,'submitted');assert.equal(attempts,2);assert.equal(f.requests.length,2)
 const cold=await f.backend.readNative('group-session',{requireComplete:true})
 assert.deepEqual(cold.audit.filter(row=>row.domain==='group-coordinator'&&row.kind==='candidate-result').map(row=>row.payload.outcome),['rejected','accepted'])
})

test('read tool body drains on cancellation and the candidate callback is never admitted',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await fixture(t,()=>({calls:[{name:'read_material',args:{}}]}));let effects=0,bodyDone=false
 const running=f.run({readTools:[{name:'read_material',effectClass:'read',description:'authorized read',parameters:{type:'object',additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){entered.resolve();await release.promise;bodyDone=true;return{read:true}}}],onCandidate:async()=>{effects++}})
 await entered.promise
 await assert.rejects(f.backend.openNative('group-session'),{name:'SessionAlreadyOwnedError'})
 await assert.rejects(f.run(),{code:'GROUP_COORDINATOR_BUSY'})
 let cancelled=false;const cancelling=f.sessions.cancel('group').then(()=>{cancelled=true})
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(cancelled,false);assert.equal(bodyDone,false);await assert.rejects(f.backend.openNative('group-session'),{name:'SessionAlreadyOwnedError'})
 release.resolve();await cancelling;assert.equal((await running).status,'cancelled');assert.equal(bodyDone,true);assert.equal(effects,0)
 const released=await f.backend.openNative('group-session');await released.close()
})

test('workspace relocation fails explicitly without copying history or activating a model',async t=>{
 const f=await fixture(t);await f.run();const requests=f.requests.length
 const other=join(f.root,'other');await mkdir(other);f.setCwd(other)
 await assert.rejects(f.sessions.prepare({conversationId:'group',sessionId:'group-session',leaseEpoch:1,sessionBound:true}),{code:'GROUP_COORDINATOR_NATIVE_RELOCATION_REQUIRED'})
 assert.equal(f.requests.length,requests)
})

test('dynamic triage keeps the three-attempt business limit while Pi owns the tool loop',async t=>{
 const f=await fixture(t);let attempts=0
 const result=await f.run({dynamic:true,onCandidate:async()=>{attempts++;throw Object.assign(Error('revise decision'),{code:'GROUP_COORDINATOR_REVISE_DECISION'})}})
 assert.equal(result.status,'no_submission');assert.equal(attempts,3);assert.equal(f.requests.length,3)
})

test('triage enforces 15-source batches and preserves channel/source metadata in the admitted packet',async t=>{
 const f=await fixture(t)
 const source={sourceKey:'message',sourceVersion:7,actorId:'alice',body:'original body',context:{channel:'dws',conversationId:'group',messageId:'m',sender:{id:'alice'},subscription:{scope:'peer',peerId:'group'}}}
 assert.equal((await f.run({input:{sources:[source]}})).status,'submitted')
 const cold=await f.backend.readNative('group-session',{requireComplete:true})
 const packet=cold.audit.find(row=>row.domain==='admission'&&row.kind==='enqueued').payload
 assert.deepEqual(JSON.parse(packet.content[0].text).sources[0],source)
 f.setLease(2)
 const fifteen=Array.from({length:15},(_,index)=>({...source,sourceKey:'m'+index}))
 assert.equal((await f.run({input:{sources:fifteen}})).status,'submitted')
 f.setLease(3)
 const sources=Array.from({length:16},(_,index)=>({...source,sourceKey:'m'+index}))
 await assert.rejects(f.run({input:{sources}}),{code:'GROUP_COORDINATOR_BATCH_LIMIT'})
 assert.equal(f.requests.length,2)
})

test('authorized material read precedes candidate submission using the official tool result',async t=>{
 const f=await fixture(t,(_context,count)=>count===1?{calls:[{name:'read_material',args:{ref:'file'}}]}:undefined);let reads=0,candidates=0
 const readTools=[{name:'read_material',effectClass:'read',description:'read authorized material',parameters:{type:'object',properties:{ref:{type:'string'}},required:['ref'],additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async({ref})=>{assert.equal(ref,'file');reads++;return{text:'actual material',version:3}}}]
 assert.equal((await f.run({readTools,onCandidate:async()=>{assert.equal(reads,1);candidates++}})).status,'submitted')
 assert.equal(reads,1);assert.equal(candidates,1)
 const result=f.requests[1].find(message=>message.role==='toolResult'&&message.toolName==='read_material')
 assert.deepEqual(JSON.parse(result.content[0].text),{text:'actual material',version:3})
})

test('a model attempting a global write tool gets a real SDK error and cannot execute it',async t=>{
 const f=await fixture(t,(_context,count)=>count===1?{calls:[{name:'forbidden_write',args:{}}]}:undefined);let writes=0
 f.ctx.tools.register({name:'forbidden_write',description:'must never be callable',parameters:{type:'object',additionalProperties:false},output:{schema:{type:'object'},render:()=>[{type:'text',text:'written'}]},execute:async()=>{writes++;return{}}})
 assert.equal((await f.run()).status,'submitted');assert.equal(writes,0)
 assert.equal(f.toolNames[0].includes('forbidden_write'),false)
 const failure=f.requests[1].find(message=>message.role==='toolResult'&&message.toolName==='forbidden_write')
 assert.equal(failure.isError,true)
})

test('a stale source lease stops before another provider request or candidate effect',async t=>{
 const f=await fixture(t,()=>({calls:[{name:'read_material',args:{}}]}));let candidates=0
 const readTools=[{name:'read_material',effectClass:'read',description:'read',parameters:{type:'object',additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async()=>{f.setLease(2);return{read:true}}}]
 const result=await f.run({readTools,onCandidate:async()=>{candidates++}})
 assert.equal(result.status,'stale');assert.equal(candidates,0);assert.equal(f.requests.length,1)
})

test('non-dynamic coordinator can revise beyond 32 legal feedback rounds through Pi',async t=>{
 const f=await fixture(t);let attempts=0
 assert.equal((await f.run({onCandidate:async()=>{if(++attempts<34)throw Object.assign(Error('current facts changed'),{code:'TASK_VERSION_STALE'})}})).status,'submitted')
 assert.equal(attempts,34);assert.equal(f.requests.length,34)
})

test('official normal completion without submit remains no_submission and permits a later lease',async t=>{
 const f=await fixture(t,()=>({text:'no candidate decision'}))
 assert.equal((await f.run()).status,'no_submission');f.setLease(2);assert.equal((await f.run()).status,'no_submission')
 assert.equal(f.requests.length,2)
 const cold=await f.backend.readNative('group-session',{requireComplete:true})
 assert.equal(cold.audit.filter(r=>r.domain==='group-coordinator'&&r.kind==='candidate-intent').length,0)
})

test('cross-conversation receipts fail identity checks before any model or candidate activation',async t=>{
 const f=await fixture(t);await f.run();const count=f.requests.length
 const {groupCoordinatorAuditKinds}=await import('../packages/dingtalk-core/group-coordinator-session.js')
 const store=await f.backend.openNative('group-session',{auditKinds:groupCoordinatorAuditKinds})
 store.appendAudit({version:1,domain:'group-coordinator',kind:'identity',payload:{version:1,conversationId:'other-group',sessionId:'group-session',creationLease:1}});await store.close()
 f.setLease(2);await assert.rejects(f.run(),{code:'GROUP_COORDINATOR_SESSION_IDENTITY_MISMATCH'});assert.equal(f.requests.length,count)
})

test('a fresh Host context restores group identity and file references without activating old effects',async t=>{
 const first=await fixture(t);let effects=0
 await first.run({onCandidate:async()=>{effects++}});const root=first.root
 await first.close();assert.equal(effects,1)
 const second=await fixture(t,undefined,{root});second.setLease(2)
 assert.equal(second.requests.length,0)
 assert.equal((await second.run({onCandidate:async()=>{effects++}})).status,'submitted')
 assert.equal(effects,2);assert.equal(second.requests.length,1)
 const cold=await second.backend.readNative('group-session',{requireComplete:true})
 assert.equal(cold.audit.filter(row=>row.domain==='group-coordinator'&&row.kind==='identity').length,1)
 assert.equal(cold.context.piMessages.filter(message=>message.role==='custom'&&message.customType==='night.business-input').length,2)
})

test('exact source file pages retain author, version and nested quotes across reopen',async t=>{
 const original='A'.repeat(2000)+' FINAL_EXACT_SOURCE_TEXT '+ 'B'.repeat(2000)
 let ref,firstPage,readBack
 const f=await fixture(t,(context,count)=>{
  if(count===1){const packet=context.messages.findLast(message=>message.role==='user'),input=JSON.parse(packet.content[0].text);ref=input.sources[0].body;return{calls:[{name:'model_content_read',args:{contentRef:ref.contentRef,offset:1950,limit:100}}]}}
  if(count===2){firstPage=JSON.parse(context.messages.findLast(message=>message.role==='toolResult').content[0].text);return undefined}
  if(count===3)return{calls:[{name:'model_content_read',args:{contentRef:ref.contentRef,offset:1950,limit:100}}]}
  if(count===4){readBack=JSON.parse(context.messages.findLast(message=>message.role==='toolResult').content[0].text);return undefined}
 })
 const source={sourceKey:'original',sourceVersion:3,actorId:'author-one',body:original,context:{quotes:[{actorId:'quoted-author',version:9,text:'exact quote'}],channelMetadata:{groupId:'group',accountId:'account'}}}
 assert.equal((await f.run({input:{sources:[source]}})).status,'submitted')
 assert.equal(firstPage.text,original.slice(1950,2050));assert.ok(firstPage.text.includes('FINAL_EXACT_SOURCE_TEXT'))
 const cold=await f.backend.readNative('group-session',{requireComplete:true}),packet=cold.audit.find(row=>row.domain==='admission'&&row.kind==='enqueued').payload
 const input=JSON.parse(packet.content[0].text)
 assert.equal(input.sources[0].actorId,'author-one');assert.equal(input.sources[0].sourceVersion,3);assert.deepEqual(input.sources[0].context,source.context)
 f.setLease(2)
 const before=f.requests.length
 assert.equal((await f.run()).status,'submitted');assert.equal(f.requests.length,before+2);assert.equal(readBack.text,firstPage.text)
})

for(const [code,fragment]of [['TASK_STAGE_AUTHORIZATION_SOURCE_INVALID','sourceQuote'],['WORKFLOW_TASK_FORBIDDEN','公共事实']])test('candidate feedback preserves original scope and permits correction: '+code,async t=>{
 const f=await fixture(t);let attempts=0
 assert.equal((await f.run({onCandidate:async()=>{if(++attempts===1)throw Object.assign(new Error('original scope invalid'),{code})}})).status,'submitted')
 assert.equal(attempts,2)
 const feedback=f.requests[1].findLast(message=>message.role==='toolResult'&&message.toolName==='group_coordinator_submit')
 assert.ok(JSON.parse(feedback.content[0].text).feedback.includes(fragment))
 const cold=await f.backend.readNative('group-session',{requireComplete:true})
 assert.equal(cold.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued').length,1,'correction never impersonates another source')
})

test('a torn native group journal is rejected without model activation or rewriting evidence',async t=>{
 const f=await fixture(t);await f.run();const count=f.requests.length,path=f.backend.path('group-session')
 await appendFile(path,'{"torn":');const original=await readFile(path)
 f.setLease(2);await assert.rejects(f.run(),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.equal(f.requests.length,count);assert.deepEqual(await readFile(path),original)
})

test('cancelling before durable business delivery does not activate a model and closes the owned writer',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers()
 const running=f.run({onSessionBound:async()=>{entered.resolve();await release.promise}})
 await entered.promise
 const cancellation=f.sessions.cancel('group')
 await assert.rejects(f.backend.openNative('group-session'),{name:'SessionAlreadyOwnedError'})
 release.resolve();await cancellation
 assert.equal((await running).status,'cancelled');assert.equal(f.requests.length,0)
 const released=await f.backend.openNative('group-session');await released.close()
})

test('default Host factory runs the group setup through scoped explicit service reads',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const f=await memoryHost(t,()=>({tool:'group_coordinator_submit',args:{decision}}))
 const ctx=f.host.ctx,sessions=createGroupCoordinatorSessions({ctx,isCurrent:async()=>true,getWorkspaceDir:async()=>join(f.root,'data','workspaces'),getGroupName:()=> 'Actual Host group'})
 t.after(()=>sessions.close());let accepted=0
 const result=await sessions.run({binding:{conversationId:'host-group',sessionId:'host-group-session',turnId:'host-turn',leaseEpoch:1,sessionBound:false},input:{sources:[{sourceKey:'host-message',sourceVersion:1,actorId:'alice',body:'authorized Host source',context:{channel:'dws',messageId:'message'}}]},provider:'fixture',model:'m',decisionSchema,onSessionBound:async()=>{},onCandidate:async value=>{assert.deepEqual(value,decision);accepted++},dynamic:true})
 assert.equal(result.status,'submitted');assert.equal(accepted,1);assert.equal(f.requests.length,1)
 const cold=await ctx.get('sessionPersistence').readNative('host-group-session',{requireComplete:true})
 assert.ok(cold.audit.some(record=>record.domain==='group-coordinator'&&record.kind==='candidate-result'&&record.payload.outcome==='accepted'))
})
