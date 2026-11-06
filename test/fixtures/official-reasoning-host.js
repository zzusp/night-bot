import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHost} from '../../src/host.js'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {openResidentStore} from '../../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../../packages/dingtalk-core/task-session-service.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
export async function officialReasoningHost(t,decide){
 const root=await mkdtemp('/tmp/night-official-reasoning-'),requests=[];let host,service,resident,sequence=0
 const providers=Object.fromEntries(['primary','task-route'].map(provider=>[provider,{api:'openai-completions',baseURL:'http://127.0.0.1:1/never-dispatch',apiKeyEnv:'REASONING_FIXTURE_KEY',retry:{enabled:false,provider:{maxRetries:0}},models:[{id:provider==='primary'?'global-model':'task-model',reasoningEfforts:{off:null,low:'low',medium:'medium',high:'high'},contextWindow:32000,maxTokens:1024},{id:'high-only',reasoningEfforts:{high:'enabled'},contextWindow:32000,maxTokens:1024}]}]))
 const config={installRoot:root,model:{provider:'primary',model:'global-model',reasoningEffort:'low'},providers,memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false}
 const boot=async()=>{
  host=await createHost(config,{environmentOptions:{inherited:{REASONING_FIXTURE_KEY:'scripted-only'}}})
  for(const profile of host.ctx.get('nativePiProvider').profiles().values()){
   delete profile.api
   profile.baseProvider={id:profile.provider,name:profile.provider,auth:{},getModels:()=>profile.models,streamSimple(model,context,options){
    const stream=createAssistantMessageEventStream(),request={provider:model.provider,model:model.id,reasoning:options.reasoning,context,signal:options.signal}
    requests.push(request)
    Promise.resolve().then(()=>decide(request)).then(answer=>{
     const aborted=options.signal?.aborted,content=aborted?[]:answer?.calls?answer.calls.map(call=>({type:'toolCall',id:'reasoning-call-'+(++sequence),name:call.name,arguments:call.args})):[{type:'text',text:answer?.text??'verified'}]
     const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,usage,timestamp:Date.now(),stopReason:aborted?'aborted':answer?.calls?'toolUse':'stop',...aborted?{errorMessage:'fixture cancelled'}:{}}
     stream.push(aborted?{type:'error',reason:'aborted',error:message}:{type:'done',reason:message.stopReason,message});stream.end(message)
    },error=>{const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],usage,timestamp:Date.now(),stopReason:'error',errorMessage:error.message};stream.push({type:'error',reason:'error',error:message});stream.end(message)})
    return stream
   }}
  }
 }
 await boot()
 const close=async()=>{await service?.close();service=undefined;await resident?.close();resident=undefined;await host.close()}
 t.after(async()=>{try{await close()}finally{await rm(root,{recursive:true,force:true})}})
 return {root,requests,config,get host(){return host},async cold(){await close();await boot()},async service(agentConfig){
  const ctx=host.ctx;resident=await openResidentStore(ctx.storageDomain)
  service=await openTaskSessionService({ctx,residentStore:resident,legacy:{getAgentConfig:()=>agentConfig,getGroup:id=>resident.getGroup(id)},config:{workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'reasoning-tasks.sqlite'),instanceId:'reasoning-test',initialize:true,ownerActorId:'fixture-owner',webActorId:'fixture-owner',...config.model},notifications:{async send(){throw Error('No external notifications')},async readback(){throw Error('No external notifications')}}})
  return service
 },async agent(id,selection,resume=false){return host.ctx.agents[resume?'resume':'create']({sessionId:id,agentOptions:selection,...resume?{}:{meta:{cwd:host.ctx.runtimePaths.workspaces}},authorizeInput:packet=>packet.source.kind==='fixture-user'})}}
}
export async function send(handle,id){await handle.enqueue({id,source:{kind:'fixture-user'},content:'Verify the exact configured model and reasoning route'});await handle.deliver(id);await handle.whenIdle()}
