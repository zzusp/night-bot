// Isolated real Host/Pi child. Parent SIGKILL deliberately bypasses every close hook.
import {residentRouterHost,channelMessage,requestTools,requestEnvelope} from './resident-router-host.js'
const [root,role,phase]=process.argv.slice(2),cleanups=[]
const t={after:fn=>cleanups.push(fn),diagnostic:()=>{}}
let held=false,queried=false,replied=false
const hold=async()=>{
 const actor=h.host.ctx.agents.list().find(actor=>actor.metadata.runtimeOwner===(role==='triage'?'channel-triage':'conversation-router'))
 const native=await h.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 process.send({type:'held',sessionId:actor.id,entries:native.entries,sent:h.sent})
 await new Promise(()=>{})
}
const h=await residentRouterHost(t,async body=>{
 const tools=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
 const isTriage=tools.includes('channel_triage_submit'),isRouter=tools.includes('resident_router_settle')
 if(phase==='seed'&&!held&&((role==='triage'&&isTriage)||(['router','fails'].includes(role)&&isRouter)||(['query','reply-query'].includes(role)&&isRouter&&queried))){
  held=true
  await hold()
 }
 if(isTriage)return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:role!=='triage',reason:'Synthetic recovery verification'}))}}
 if(isRouter){
  if(phase==='recover'&&role==='fails')return {error:'SYNTHETIC_CONTINUATION_FAILURE'}
  if(phase==='seed'&&role==='unknown'){const source=requestEnvelope(body,'Router 请求：').events[0].source;return {tool:'resident_router_reply',args:{operationId:'synthetic-unknown-send',sourceId:source.sourceId,messageVersion:source.version,text:'Synthetic delivery only'}}}
  if(phase==='seed'&&role==='reply-query'&&!replied){replied=true;const source=requestEnvelope(body,'Router 请求：').events[0].source;return {tool:'resident_router_reply',args:{operationId:'synthetic-delivery',sourceId:source.sourceId,messageVersion:source.version,text:'Synthetic delivered reply'}}}
  if(phase==='seed'&&['query','reply-query'].includes(role)&&!queried){queried=true;return {tool:'resident_task_query',args:{}}}
  const input=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  return {tool:'resident_router_settle',args:{operationId:'synthetic-settle',eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:role==='reply-query'?'handled-inline':'not-assigned',reason:'Synthetic fixture requires no task',sourceQuote:event.source.text}))}}
 }
 return {text:'No other work'}
},{hostOptions:{hostConfig:{installRoot:root}},send:async()=>{if(phase==='seed'&&role==='unknown')await hold();return {messageId:'synthetic-visible'}}})
if(phase==='seed')void h.receive(channelMessage('hard-stop',{text:'Synthetic hard-stop verification only'})).catch(error=>process.send({type:'error',error:error.stack}))
else{
 await h.service.recover();await h.service.whenIdle().catch(error=>{if(!['unknown','fails'].includes(role)||error.code!=='ROUTER_BATCH_UNSETTLED')throw error})
 const requestsBefore=h.requests.length;await h.service.recover();await h.service.whenIdle().catch(error=>{if(!['unknown','fails'].includes(role)||error.code!=='ROUTER_BATCH_UNSETTLED')throw error});if(h.requests.length!==requestsBefore)throw Error('Recovery loop repeated inference')
 const actors=h.host.ctx.agents.list().filter(actor=>actor.metadata.runtimeOwner===(role==='triage'?'channel-triage':'conversation-router'))
 const native=await h.host.ctx.sessionPersistence.readNative(actors[0].id,{requireComplete:true})
 const conversationId=h.host.ctx.channels.identity(channelMessage('hard-stop')).sessionId
 process.send({type:'recovered',sessionId:actors[0].id,entries:native.entries,requests:h.requests,inbox:await h.query('router.inbox',{conversationId}),pending:await h.query('triage.pending'),sent:h.sent,alerts:h.service.listAlerts()})
 for(const cleanup of cleanups.toReversed())try{await cleanup()}catch(error){if(!['unknown','fails'].includes(role))throw error}
 process.disconnect()
}
