import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {setTimeout as delay} from 'node:timers/promises'
import {Context} from '@deepseek-ai/cordis'
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader,ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import NativeTools from '../../src/native-tools.js'
import {createPiOfficialTools} from '../../src/runtime/pi-official-tools.js'

export const definition=(name,execute,extra={})=>({name,description:name,parameters:{type:'object',additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute,...extra})
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
export async function officialToolsFixture(t,register){
 const root=await mkdtemp(join(tmpdir(),'night-official-tools-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const ctx=new Context(),requests=[],receipts=[],results=[],cleanups=[]
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0})
 new NativeTools(ctx)
 const manager=SessionManager.create(root,join(root,'sessions')),owner={id:manager.getSessionId(),metadata:Object.freeze({id:manager.getSessionId()}),ctx}
 const businessAudit={isLive:()=>true,flush:async()=>{}}
 let adapter,session,plan,served
 t.after(async()=>{try{for(const cleanup of cleanups.toReversed())await cleanup();await adapter?.close();session?.dispose();await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 await register({ctx,owner,businessAudit,receipts,manager,root})
 adapter=createPiOfficialTools({registry:ctx.tools,owner,businessAudit,maxParallelToolCalls:2})
 ctx.on('tools/execute',async(exec,next)=>{
  manager.appendCustomEntry('night-effect',{callId:exec.callId,state:'started'})
  const result=await next()
  manager.appendCustomEntry('night-effect',{callId:exec.callId,state:exec.signal.aborted?'unknown':'settled'})
  await businessAudit.flush();receipts.push(exec.callId)
  return result
 })
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(model=>model.provider==='openai')??runtime.getModels()[0]
 await runtime.setRuntimeApiKey(model.provider,'local-fixture')
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  requests.push(structuredClone(context.messages));const stream=createAssistantMessageEventStream()
  queueMicrotask(()=>{const calls=served?[]:plan;served=true;const message={role:'assistant',content:calls.length?calls.map(call=>({type:'toolCall',id:call.id,name:call.name,arguments:call.args??{}})):[{type:'text',text:'official response'}],api:model.api,provider:model.provider,model:model.id,usage,timestamp:Date.now(),stopReason:calls.length?'toolUse':'stop'};stream.push({type:'done',reason:message.stopReason,message});stream.end(message)})
  return stream
 }})
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}})
 const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 ;({session}=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model,thinkingLevel:'off',settingsManager:settings,resourceLoader:loader,sessionManager:manager,noTools:'builtin',tools:adapter.customTools.map(tool=>tool.name),customTools:adapter.customTools}))
 owner.piSession=session
 session.agent.toolExecution='parallel';session.agent.finishTurn=adapter.finishTurn
 session.subscribe(event=>{if(event.type==='tool_execution_end')results.push(event)})
 return{ctx,owner,adapter,session,requests,receipts,results,manager,businessAudit,runtime,model,settings,loader,root,agentDir,deferCleanup:cleanup=>cleanups.push(cleanup),run(calls){adapter.beginTurn();plan=calls;served=false;return session.prompt('exercise official tools')}}
}

