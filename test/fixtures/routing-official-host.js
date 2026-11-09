import {convertToLlm,estimateTokens} from '@earendil-works/pi-coding-agent'
import {createHost} from '../../src/host.js'
import {createAssistantMessageEventStream,getCurrentTools,getCurrentSystemPrompt,normalizeContext} from '@earendil-works/pi-ai'
import {openResidentStore} from '../../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../../packages/dingtalk-core/task-session-service.js'
import {registerNativeCleanup,nativeLifecycleSignal} from './native-lifecycle.js'
import {latestInput,contextReadCalls,topicTaskCalls,modelToolValues} from './routing-official-model.js'
export {latestInput,modelToolValues,topicTaskCalls,waitUntil} from './routing-official-model.js'
export const available=true,reason=undefined
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}

/** Routing business scripts run against the actual installed official factory.
 * No Session/steer facade or Host message/request conversion is installed. */
export async function nativeTaskHost(root,decide,options={}){
 let host,closing,sequence=0
 const requests=[],auxiliaryRequests=[],sent=[],readbacks=[],toolResults=[],signal=nativeLifecycleSignal(),h={root,requests,auxiliaryRequests,sent,readbacks,toolResults}
 h.close=()=>closing??=(async()=>{if(process.env.NIGHT_BOT_TEST_DEBUG)console.error('ROUTING_FIXTURE',JSON.stringify({requests:requests.length,toolResults:toolResults.map(item=>({name:item.name,error:item.result.error,status:item.result.value?.status})),alerts:h.service?.listAlerts()}));try{await h.service?.close()}finally{try{await h.residentStore?.close()}finally{await host?.close()}}})()
 registerNativeCleanup(()=>h.close())
 try{
  host=await createHost({installRoot:root,dataDir:'data',model:{provider:'native-task-test',model:'controlled'},providers:{'native-task-test':{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'ROUTING_FIXTURE_KEY',models:[{id:'controlled',reasoningEfforts:{off:null,low:'low'},input:['text'],contextWindow:32000,maxTokens:1024}]}},skillDirs:options.skillDirs??[],memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false},{environmentOptions:{inherited:{ROUTING_FIXTURE_KEY:'local-fixture-only'}}})
  h.ctx=host.ctx
  const profile=host.ctx.get('nativePiProvider').profiles().get('native-task-test');delete profile.api
  profile.baseProvider={id:'native-task-test',name:'Scripted routing model',auth:{},getModels:()=>profile.models,streamSimple(model,context,callOptions){
   const stream=createAssistantMessageEventStream()
   queueMicrotask(async()=>{
    const request={provider:model.provider,model:model.id,messages:convertToLlm(context.messages),tools:getCurrentTools(normalizeContext(context).messages)}
    let result
    if(process.env.NIGHT_BOT_TEST_DEBUG)for(const message of request.messages.filter(message=>message.role==='toolResult'&&message.isError).slice(-1))console.error('ROUTING_SDK_TOOL_ERROR',JSON.stringify(message))
    try{
     signal?.throwIfAborted();callOptions.signal?.throwIfAborted()
     const compaction=request.tools.length===0&&getCurrentSystemPrompt(normalizeContext(context).messages).startsWith('You are a context summarization assistant.')
     if(compaction){
      if(typeof options.compactionSummary!=='string'||!options.compactionSummary.trim())throw Error('Official compaction fixture requires an explicit summary response')
      auxiliaryRequests.push(structuredClone({...request,purpose:'compaction'}))
      result={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[{type:'text',text:options.compactionSummary}],usage,timestamp:Date.now(),stopReason:'stop'}
     }else{
     let input;try{input=latestInput(request)}catch(error){if(!error.contextReads)throw error}
     const auxiliary=input?.requestId?.startsWith('coord-summary-')===true
     ;(auxiliary?auxiliaryRequests:requests).push(structuredClone(request))
     const handoffText=input?.handoffId&&request.tools.length===0?JSON.stringify({currentIntent:'Preserve the original task intent and current ledger references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff}):undefined
     let calls=handoffText?[]:contextReadCalls(request)
     if(!calls&&(auxiliary||request.tools.some(tool=>tool.name==='resident_router_settle')&&input.events.every(event=>!event.source)))calls=topicTaskCalls(request,{replyRecipients:options.routerReplyRecipients,signature:options.agentConfig?.replySignature?String.fromCharCode(10,10)+options.agentConfig.replySignature:''})
     if(!calls){
      // These routing scenarios request no preliminary send. Explicit silence
      // is a valid first-tier disposition; the real tool validates every source.
      const pages=modelToolValues(request),unread=(Array.isArray(input.messages)?input.messages:[]).find(message=>message.metadataReadCall&&!pages.some(page=>page.requestId===input.requestId&&page.section==='messageMetadata'&&page.text?.includes('"messageId":"'+message.messageId+'"')))
      const accepted=new Set(request.messages.filter(message=>message.role==='toolResult'&&!message.isError&&message.toolName==='group_topic_initial_reply').map(message=>message.toolCallId))
      const acknowledged=request.messages.filter(message=>message.role==='assistant').flatMap(message=>message.content??[]).some(part=>part.type==='toolCall'&&accepted.has(part.id)&&part.name==='group_topic_initial_reply'&&input.messages?.every(message=>part.arguments.silent?.some(source=>source.messageId===message.messageId&&source.messageVersion===message.messageVersion)))
      if(unread)calls=[{name:'group_topic_route_context_get',args:unread.metadataReadCall.arguments}]
      else if(Array.isArray(input.messages)&&request.tools.some(tool=>tool.name==='group_topic_initial_reply')&&!acknowledged)calls=[{name:'group_topic_initial_reply',args:{requestId:input.requestId,replies:[],silent:input.messages.map(message=>({messageId:message.messageId,messageVersion:message.messageVersion,reason:'This scenario tests routing and later business replies.'}))}}]
      else calls=auxiliary?topicTaskCalls(request):await decide(request,h)
      callOptions.signal?.throwIfAborted()
     }
     const failure=options.providerError?.(request)
     result={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:failure?[]:handoffText?[{type:'text',text:handoffText}]:calls.map(call=>({type:'toolCall',id:'routing-call-'+(++sequence),name:call.name,arguments:call.args})),usage,timestamp:Date.now(),stopReason:failure?'error':calls.length?'toolUse':'stop',...failure?{errorMessage:failure.message??String(failure)}:{}}
     }
    }catch(error){if(process.env.NIGHT_BOT_TEST_DEBUG)console.error('ROUTING_MODEL_ERROR',error);result={role:'assistant',provider:model.provider,model:model.id,api:model.api,content:[],usage,timestamp:Date.now(),stopReason:callOptions.signal?.aborted?'aborted':'error',errorMessage:error.stack??error.message}}
    if(options.estimateUsage===true){
     const input=context.messages.reduce((total,message)=>total+estimateTokens(message),0)
     result.usage={...usage,input,totalTokens:input+usage.output}
    }
    if(['error','aborted'].includes(result.stopReason))stream.push({type:'error',reason:result.stopReason,error:result});else stream.push({type:'done',reason:result.stopReason,message:result})
    stream.end(result)
   });return stream
  }}
  host.ctx.on('tools/result',(exec,result)=>{if(process.env.NIGHT_BOT_TEST_DEBUG&&result.isError)console.error('ROUTING_TOOL_ERROR',exec.name,result.error);toolResults.push({name:exec.name,sessionId:exec.agent?.id,result:structuredClone(result)})})
  if(options.resident)return h
  h.residentStore=await openResidentStore(host.ctx.storageDomain)
  await h.residentStore.subscribe({groupId:'native-group',name:'真实服务测试群',responsibility:'处理明确交办给测试助手的工作'});await h.residentStore.setAgentNames(['测试助手'])
  const workspaceDir=host.ctx.runtimePaths.workspaces,agentConfig={...options.agentConfig,workspaceDir,provider:'native-task-test',model:'controlled',agentPreset:'night-bot',agentNames:options.agentConfig?.agentNames??['测试助手']}
  const legacy={getAgentConfig:()=>agentConfig,getGroup:id=>h.residentStore.getGroup(id)}
  h.service=await (options.serviceFactory??openTaskSessionService)({ctx:host.ctx,legacy,residentStore:h.residentStore,...options.store?{store:options.store}:{},config:{workspaceDir,dbPath:root+'/dynamic.db',instanceId:'native-test',initialize:options.initialize!==false,ownerActorId:'native-user',webActorId:'native-user',provider:'native-task-test',model:'controlled',...options.config},notifications:options.notifications??{async send(notification){sent.push(structuredClone(notification));return {messageId:'native-notification-'+sent.length}},async readback(notification){readbacks.push(structuredClone(notification));return {messageId:notification.ack.messageId,visible:true}}}})
  h.query=(kind,args={})=>h.service.store.query({kind,...args});return h
 }catch(error){await h.close();throw error}
}
