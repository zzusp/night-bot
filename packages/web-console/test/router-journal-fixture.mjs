import {buildSessionProjection} from '@earendil-works/pi-coding-agent'
import {GLOBAL_ROUTER_SCOPE,GLOBAL_ROUTER_SESSION} from '../../../src/channels/router-identity.js'

export function routerJournal(){
 const rows=[],audit=[]
 let parentId=null
 const add=(id,type,fields)=>{
   const row={id,parentId,type,timestamp:new Date(1764200000000+rows.length*1000).toISOString(),...fields}
   rows.push(row);parentId=id;return row
 }
 const packet=(id,conversationId,events,admitted=true)=>{
   const source={kind:'conversation-router',conversationId,generation:1,eventIds:events.map(event=>event.id)}
   const content=[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId,generation:1,events})}]
   add(id,'custom_message',{customType:'night.business-input',display:true,details:{source,packetId:id+'-packet'},content})
   if(admitted){
     audit.push({domain:'admission',version:1,kind:'enqueued',payload:{id:id+'-packet',source,content}})
     audit.push({domain:'admission',version:1,kind:'admitted',payload:{id:id+'-packet',entryId:id}})
   }
 }
 const input=(id,conversationId,text)=>packet(id,conversationId,[{id:id+'-event',kind:'source.message',source:{sourceId:id+'-source',version:1,conversationId,text}}])
 const reply=(id,text)=>add(id,'message',{message:{role:'assistant',stopReason:'stop',content:[{type:'text',text}]}})
 input('alpha','room-product','产品渠道：压缩前的记录')
 reply('alpha-reply','先核对产品资料。')
 add('compact','compaction',{firstKeptEntryId:'alpha-reply',tokensBefore:4000,summary:'private synthetic summary'})
 input('beta','room-notes','资料渠道：压缩后的记录')
 reply('beta-reply','已经登记资料查询。')
 packet('unadmitted','room-notes',[{id:'unadmitted-event',kind:'source.message',source:{sourceId:'hidden',version:1,conversationId:'room-notes',text:'unadmitted private packet'}}],false)
 reply('unadmitted-reply','unadmitted model receipt')
 packet('check','night-bot-self-check-standalone',[{id:'check-event',kind:'router.self-check'}])
 reply('check-reply','本轮自检已结束。')
 add('discarded','message',{message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'discarded branch model output'}]}})
 parentId='check-reply'
 add('finish','label',{targetId:'check-reply',label:'sealed'})
 return {header:{id:GLOBAL_ROUTER_SESSION,runtimeOwner:'conversation-router',conversationId:GLOBAL_ROUTER_SCOPE,generation:1},
  entries:rows,audit,context:{projection:buildSessionProjection(rows,rows.at(-1).id)}}
}
