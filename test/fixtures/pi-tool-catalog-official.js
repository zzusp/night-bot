import {tmpdir} from 'node:os'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader,ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
export const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
export const catalogTool=name=>({name,label:name,description:'Execute '+name,parameters:{type:'object',properties:{value:{type:'string'}},additionalProperties:false},async execute(){return {content:[{type:'text',text:name}],details:{name}}}})
export async function catalogSession(t,{resolved,active=['a'],tools=['a','b'].map(catalogTool),prepare,reply,compat={}}={}){
 const root=await mkdtemp(join(tmpdir(),'night-tool-catalog-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const manager=SessionManager.inMemory(root),requests=[]
 await prepare?.(manager)
 let runtime=resolved?.modelRuntime,model=resolved?.model
 if(!runtime){
  runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
  model={id:'m',name:'Catalog fixture',api:'openai-completions',provider:'catalog-fixture',baseUrl:'http://127.0.0.1:1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:8192,maxTokens:128,compat}
  runtime.registerNativeProvider({id:model.provider,name:model.provider,auth:{apiKey:{name:'fixture',async check(){return {type:'api_key',source:'test'}},async resolve(){return {auth:{apiKey:'local-fixture-only'},source:'test'}}}},getModels:()=>[model],streamSimple(_model,context){
   requests.push(structuredClone(context));const stream=createAssistantMessageEventStream(),message={role:'assistant',provider:model.provider,api:model.api,model:model.id,content:[{type:'text',text:'catalog accepted'}],usage,timestamp:Date.now(),stopReason:'stop',...reply?.(context,requests.length-1)}
   queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
  }})
  await runtime.setRuntimeApiKey(model.provider,'local-fixture-only')
 }
 const settings=SettingsManager.inMemory({packages:[],retry:{enabled:false,provider:{maxRetries:0}},compaction:{enabled:false}})
 const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model,thinkingLevel:'off',settingsManager:settings,resourceLoader:loader,sessionManager:manager,noTools:'builtin',tools:tools.map(tool=>tool.name),customTools:tools})
 session.setActiveToolsByName(active)
 t.after(async()=>{await session.abort();session.dispose();await rm(root,{recursive:true,force:true})})
 return {session,manager,requests,tools}
}
