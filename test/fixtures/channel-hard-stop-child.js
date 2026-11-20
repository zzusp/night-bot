// Isolated real Host/Pi child. Parent SIGKILL deliberately bypasses every close hook.
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {piJournalFilename} from '../../src/runtime/pi-journal.js'
const fixture=process.argv[5]?pathToFileURL(join(process.argv[5],'test/fixtures/resident-router-host.js')):new URL('./resident-router-host.js',import.meta.url)
const {residentRouterHost,channelMessage,requestTools,requestEnvelope,requestText,eventually}=await import(fixture)
const [root,role,phase]=process.argv.slice(2),cleanups=[]
const t={after:fn=>cleanups.push(fn),diagnostic:()=>{}}
let held=false,queried=false,replied=false,recoveryStep=0,planned=false
const hold=async()=>{
 const actor=h.host.ctx.agents.list().find(actor=>actor.metadata.runtimeOwner===(role==='triage'?'channel-triage':'conversation-router'))
 const native=await h.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 process.send({type:'held',sessionId:actor.id,entries:native.entries,file:join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(actor.id)),sent:h.sent,notifications:await h.query('notification.list'),inbox:await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(channelMessage('hard-stop')).sessionId})})
 await new Promise(()=>{})
}
const h=await residentRouterHost(t,async body=>{
 const tools=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
 if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic safe task completed',evidence:['Isolated fixture outcome'],limitations:[]}}}
 const isTriage=tools.includes('channel_triage_submit'),isRouter=tools.includes('resident_router_settle')
 if(phase==='seed'&&!held&&((role==='triage'&&isTriage)||(['router','fails','unreadable','slow','retry-new'].includes(role)&&isRouter)||(['query','reply-query'].includes(role)&&isRouter&&queried))){
  held=true
  await hold()
 }
 if(isTriage)return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:role!=='triage'&&!(role==='slow'&&source.messageId==='same-safe'),reason:'Synthetic recovery verification'}))}}
 if(isRouter){
  if(phase==='recover'&&role==='slow'&&requestEnvelope(body,'Router 请求：').events.some(event=>event.source?.messageId==='hard-stop'))await new Promise(()=>{})
  if(phase==='recover'&&(role==='fails'||role==='retry-new'&&recoveryStep++===0))return {error:'SYNTHETIC_CONTINUATION_FAILURE'}
  if(phase==='seed'&&['unknown','unfrozen'].includes(role)){const source=requestEnvelope(body,'Router 请求：').events[0].source;return {tool:'resident_router_reply',args:{operationId:'synthetic-unknown-send',sourceId:source.sourceId,messageVersion:source.version,text:'Synthetic delivery only'}}}
  if(phase==='seed'&&role==='reply-query'&&!replied){replied=true;const source=requestEnvelope(body,'Router 请求：').events[0].source;return {tool:'resident_router_reply',args:{operationId:'synthetic-delivery',sourceId:source.sourceId,messageVersion:source.version,text:'Synthetic delivered reply'}}}
  if(phase==='seed'&&['query','reply-query'].includes(role)&&!queried){queried=true;return {tool:'resident_task_query',args:{}}}
  const packets=requestText(body).filter(text=>text.startsWith('Router 请求：')).map(text=>JSON.parse(text.slice('Router 请求：'.length)))
  const input={events:[...new Map(packets.flatMap(packet=>packet.events).map(event=>[event.id,event])).values()]}
  const pendingIds=new Set((await h.query('router.inbox',{conversationId:requestEnvelope(body,'Router 请求：').conversationId})).map(event=>event.id));input.events=input.events.filter(event=>pendingIds.has(event.id))
  if(role==='unreadable'&&!planned){const source=input.events.find(event=>event.source?.messageId==='same-new')?.source;if(source){planned=true;return {tool:'resident_task_plan',args:{operationId:'new-safe-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'safe-after-recovery',title:'Synthetic safe follow-up',objective:'Complete the isolated fixture without external effects',requirements:[],handoff:'Complete the later same-channel fixture work without external effects.'}],dependencies:[]}}}}
  if(!input.events.length)return {text:'Settled'}
  if(phase==='recover'&&['unknown','unfrozen'].includes(role)){
   const source=input.events[0].source
   if(recoveryStep++===0)return {tool:'resident_reply_query',args:{sourceId:source.sourceId}}
   if(recoveryStep===2&&role==='unfrozen')return {tool:'resident_router_reply',args:{operationId:'different-key-must-not-repeat',sourceId:source.sourceId,messageVersion:source.version,text:'Synthetic duplicate must be refused'}}
  }
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  return {tool:'resident_router_settle',args:{operationId:'synthetic-settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:role==='reply-query'?'handled-inline':'not-assigned',reason:'Synthetic fixture requires no task',sourceQuote:event.source.text}))}}
 }
 return {text:'No other work'}
},{hostOptions:{callIdPrefix:phase+'-',hostConfig:{installRoot:root}},wrapStore:store=>({...store,command:async command=>{
 if(phase==='seed'&&role==='unfrozen'&&command.kind==='notification.prepare'){
  for(let index=0;index<11;index++)await h.receive(channelMessage('later-'+index,{text:'Synthetic later item '+index}))
  await eventually(async()=>await h.query('router.inbox-count',{conversationId:h.host.ctx.channels.identity(channelMessage('hard-stop')).sessionId})===12,'eleven durable old-version events')
  await hold()
 }
 return store.command(command)
}}),send:async()=>{if(phase==='seed'&&role==='unknown')await hold();return {messageId:'synthetic-visible'}}})
if(phase==='seed')void h.receive(channelMessage('hard-stop',{text:'Synthetic hard-stop verification only'})).catch(error=>process.send({type:'error',error:error.stack}))
else if(role==='slow'){
 await h.service.recover({waitForRouter:false})
 await eventually(()=>h.requests.some(body=>requestTools(body).includes('resident_router_settle')),'old Router inference started')
 await h.receive(channelMessage('same-safe',{text:'Synthetic reply-free safe triage'}))
 await h.receive(channelMessage('other-safe',{conversationId:'independent-room',text:'Synthetic independent routing'}))
 const otherId=h.host.ctx.channels.identity(channelMessage('other-safe',{conversationId:'independent-room'})).sessionId
 await eventually(async()=>{const row=await h.query('router.get',{conversationId:otherId});return row?.cursor===1},'independent conversation routed while old inference hangs')
 await eventually(async()=>(await h.query('source.list')).find(source=>source.messageId==='same-safe')?.routed,'same conversation triage remains available')
 process.send({type:'ready-isolated',other:await h.query('router.get',{conversationId:otherId}),sent:h.sent})
 for(const cleanup of cleanups.toReversed())await cleanup()
 process.disconnect()
}
else{
 await h.service.recover();await h.service.whenIdle().catch(error=>{if(!['fails','retry-new'].includes(role)||error.code!=='ROUTER_BATCH_UNSETTLED')throw error})
 const requestsBefore=h.requests.length;await h.service.recover();await h.service.whenIdle().catch(error=>{if(!['fails','retry-new'].includes(role)||error.code!=='ROUTER_BATCH_UNSETTLED')throw error});if(h.requests.length!==requestsBefore)throw Error('Recovery loop repeated inference')
 if(role==='retry-new'){await h.receive(channelMessage('new-after-failure',{text:'Synthetic new work after failed continuation'}));await h.service.whenIdle()}
 const actors=h.host.ctx.agents.list().filter(actor=>actor.metadata.runtimeOwner===(role==='triage'?'channel-triage':'conversation-router'))
 const conversationId=h.host.ctx.channels.identity(channelMessage('hard-stop')).sessionId
 if(['unfrozen','unreadable'].includes(role)){await h.receive(channelMessage('same-new',{text:'Synthetic safe later same-channel work'}));await h.receive(channelMessage('other-new',{conversationId:'other-room',text:'Synthetic independent channel work'}));await h.service.whenIdle()}
 const native=await h.host.ctx.sessionPersistence.readNative(actors[0].id,{requireComplete:true})
 process.send({type:'recovered',sessionId:actors[0].id,entries:native.entries,requests:h.requests,inbox:await h.query('router.inbox',{conversationId}),pending:await h.query('triage.pending'),sent:h.sent,alerts:h.service.listAlerts(),notifications:await h.query('notification.list'),routerRows:await h.query('router.list'),rotations:await h.query('router.rotations',{conversationId}),tasks:await h.query('task.list')})
 for(const cleanup of cleanups.toReversed())try{await cleanup()}catch(error){if(role!=='fails')throw error}
 process.disconnect()
}
