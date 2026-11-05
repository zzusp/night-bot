import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {convertToLlm} from '@earendil-works/pi-coding-agent'
import {createAssistantMessageEventStream,getCurrentTools,normalizeContext} from '@earendil-works/pi-ai'
import {nativeRuntimeHost,latestInput,topicTaskCalls,modelToolValues,waitUntil} from './runtime-official-host.js'
import {officialRetrySettings} from '../../src/runtime/pi-official-settings.js'
export {latestInput,waitUntil,topicTaskCalls,modelToolValues}
export const taskRequest=request=>request.tools.some(tool=>tool.name==='task_result')
export const result=(action='wait',summary='Preserve original task evidence')=>({name:'task_result',args:{decision:{action,summary,evidence:['native evidence'],limitations:[]}}})
export const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
export async function providerHost(t,{root,initialize=true,retry={enabled:true,maxRetries:1,baseDelayMs:2,maxAgentDelayMs:5,provider:{maxRetries:0}},decide=()=>[result()],intercept,route,config={},models=[]}={}){
 const owned=!root;root??=await mkdtemp(join(tmpdir(),'night-provider-single-'))
 const h=await nativeRuntimeHost(root,(request,host)=>taskRequest(request)?decide(request,host):route?.(request,host)??topicTaskCalls(request),{initialize,config,models})
 t.after(async()=>{await h.close();if(owned)await rm(root,{recursive:true,force:true})})
 h.events=[];h.actors=[];h.effects=0;h.taskRequests=()=>h.requests.filter(taskRequest)
 h.ctx.on('agent/created',({agent})=>{h.actors.push(agent);agent.piSession.subscribe(event=>{if(['auto_retry_start','auto_retry_end'].includes(event.type))h.events.push({actorId:agent.id,...event})})})
 h.profile=h.ctx.get('nativePiProvider').profiles().get('native-task-test');h.profile.retrySettings=officialRetrySettings(retry).retry
 const original=h.profile.baseProvider
 if(intercept)h.profile.baseProvider={...original,streamSimple(model,context,options){
  const request={provider:model.provider,model:model.id,messages:convertToLlm(context.messages),tools:getCurrentTools(normalizeContext(context).messages)}
  const override=intercept(request,h,options)
  if(override===undefined)return original.streamSimple(model,context,options)
  h.requests.push(structuredClone(request));const stream=createAssistantMessageEventStream()
  Promise.resolve(override).then(input=>{const message={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[],usage,timestamp:Date.now(),...input};if(['error','aborted'].includes(message.stopReason))stream.push({type:'error',reason:message.stopReason,error:message});else stream.push({type:'done',reason:message.stopReason,message});stream.end(message)},error=>{const message={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[],usage,timestamp:Date.now(),stopReason:options.signal?.aborted?'aborted':'error',errorMessage:error.message};stream.push({type:'error',reason:message.stopReason,error:message});stream.end(message)})
  return stream
 }}
 h.ctx.get('tools').register({name:'provider_effect_once',description:'Fixture local effect with a real durable task receipt',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[{type:'text',text:'ORIGINAL_PROVIDER_EFFECT_RECEIPT'}]},async execute(_args,exec){h.effects++;await writeFile(join(exec.agent.metadata.cwd,'work/provider-effect.txt'),'one original effect');return {done:true}}})
 h.create=async(id='provider-case')=>(await h.service.createTask({groupId:'native-group',requestId:id,objective:'Keep one authorized task and preserve original effect receipts'})).taskId
 h.stored=async taskId=>{const task=await h.query('task.get',{taskId});return {task,...await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})}}
 return h
}
