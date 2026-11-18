import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ModelRuntime,SettingsManager,SessionManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {registerSessionResourceCleanup} from '@earendil-works/pi-ai/compat'
import {compactPiCandidate,snapshotPiCompaction} from '../src/runtime/pi-background-candidate.js'

async function fixture(t,{onStream}={}){
 const cwd=await mkdtemp(join(tmpdir(),'night-compaction-candidate-'));t.after(()=>rm(cwd,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai')??runtime.getModels()[0]
 await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 let calls=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  calls++;assert.equal(context.tools?.length??0,0)
  const stream=createAssistantMessageEventStream()
  const message={role:'assistant',content:[{type:'text',text:'Preserved facts and remaining work.'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:100,output:10,cacheRead:0,cacheWrite:0,totalTokens:110,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  if(onStream)onStream({stream,message,options,context})
  else queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)})
  return stream
 }})
 const manager=SessionManager.inMemory(cwd)
 for(let i=0;i<12;i++){
  manager.appendMessage({role:'user',content:'Source '+i+' '+('retained information '.repeat(100)),timestamp:i*2})
  manager.appendMessage({role:'assistant',content:[{type:'text',text:'Response '+i+' '+('useful details '.repeat(100))}],api:model.api,provider:model.provider,model:model.id,timestamp:i*2+1,stopReason:'stop',usage:{input:5000,output:1000,cacheRead:0,cacheWrite:0,totalTokens:6000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
 }
 return {manager,args:{cwd,agentDir:join(cwd,'agent'),resolved:{modelRuntime:runtime,model,thinkingLevel:'off'},settingsManager:SettingsManager.inMemory({packages:[],compaction:{keepRecentTokens:500,reserveTokens:1024},retry:{enabled:false}})},calls:()=>calls}
}

test('native candidate compact leaves live journal untouched and tail can be published through Pi',async t=>{
 const f=await fixture(t),snapshot=snapshotPiCompaction(f.manager)
 const cleaned=[]
 const unregister=registerSessionResourceCleanup(id=>cleaned.push(id));t.after(unregister)
 const result=await compactPiCandidate({...f.args,snapshot,signal:new AbortController().signal})
 assert.equal(cleaned.length,1,'only candidate disposal cleans provider resources')
 assert.notEqual(cleaned[0],snapshot.header.id,'candidate must not dispose foreground provider session')
 assert.equal(result.summary,'Preserved facts and remaining work.')
 assert.ok(f.calls()>0)
 assert.deepEqual(snapshotPiCompaction(f.manager),snapshot)
 assert.ok(snapshot.entries.some(e=>e.id===result.firstKeptEntryId))
 f.manager.appendCompaction(result.summary,result.firstKeptEntryId,result.tokensBefore,result.details,false,result.usage)
 assert.ok(f.manager.buildSessionProjection().messages.some(m=>JSON.stringify(m).includes(result.summary)))
})

test('aborted candidate cannot return a late provider result or alter original history',async t=>{
 const controller=new AbortController()
 const f=await fixture(t,{onStream:({stream,message})=>queueMicrotask(()=>{controller.abort(new Error('new input'));stream.push({type:'done',reason:'stop',message});stream.end(message)})})
 const snapshot=snapshotPiCompaction(f.manager)
 await assert.rejects(compactPiCandidate({...f.args,snapshot,signal:controller.signal}))
 assert.deepEqual(snapshotPiCompaction(f.manager),snapshot)
 assert.ok(f.calls()>0)
})

test('already cancelled candidate does not dispatch or copy a changed live tail',async t=>{
 const f=await fixture(t),snapshot=snapshotPiCompaction(f.manager)
 f.manager.appendMessage({role:'user',content:'new incoming work',timestamp:999})
 const changed=snapshotPiCompaction(f.manager)
 await assert.rejects(compactPiCandidate({...f.args,snapshot,signal:AbortSignal.abort(new Error('preempted'))}),/preempted/)
 assert.equal(f.calls(),0)
 assert.deepEqual(snapshotPiCompaction(f.manager),changed)
})

for(const [role,marker] of [['channel-triage','triage'],['conversation-router','router'],['task','task']])test(`detached ${role} uses native role instructions without live journal mutation`,async t=>{
 const f=await fixture(t,{onStream:({stream,message,context})=>{
  assert.match(JSON.stringify(context),new RegExp('NIGHT_ROLE_SUMMARY='+marker))
  assert.match(JSON.stringify(context),/standingInstructions/)
  assert.match(JSON.stringify(context),/NIGHT_CONTEXT_RETENTION/)
  assert.match(JSON.stringify(context),/未验证/)
  assert.match(JSON.stringify(context),/不删除或改写Pi原始会话/)
  assert.match(JSON.stringify(context),/一次要求或批准不得变为长期偏好或持续授权/)
  if(role==='conversation-router'){assert.match(JSON.stringify(context),/可选项待确认或已获用户同意/);assert.match(JSON.stringify(context),/既往明确要求的来源\/版本引用/)}
  queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)})
 }}),snapshot=snapshotPiCompaction(f.manager)
 const result=await compactPiCandidate({...f.args,snapshot,role,signal:new AbortController().signal})
 assert.ok(result.summary);assert.deepEqual(snapshotPiCompaction(f.manager),snapshot)
})

test('role summary failure cancels native compaction without generic fallback or journal edits',async t=>{
 const f=await fixture(t,{onStream:({stream,message})=>queueMicrotask(()=>{
  const failed={...message,content:[],stopReason:'error',errorMessage:'fixture summary unavailable'}
  stream.push({type:'error',reason:'error',error:failed});stream.end(failed)
 })}),snapshot=snapshotPiCompaction(f.manager)
 await assert.rejects(compactPiCandidate({...f.args,snapshot,role:'conversation-router',signal:new AbortController().signal}),/Compaction cancelled/)
 assert.equal(f.calls(),1,'role summary failure must not dispatch a generic fallback')
 assert.deepEqual(snapshotPiCompaction(f.manager),snapshot)
})
