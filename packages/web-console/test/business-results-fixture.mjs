import {GLOBAL_ROUTER_SESSION,GLOBAL_ROUTER_SCOPE} from '../../../src/channels/router-identity.js'
import {startPreview} from './preview.mjs'

// Synthetic Pi projection through production HTTP/auth/paging; no model or delivery.
export async function resultPreview({router = false, rounds = 3, long = false} = {}) {
  const sessionId = router ? GLOBAL_ROUTER_SESSION : 'fixture-pi-task-research'
  const conversationId = 'fixture-web-preview-sample-plan'
  const toolName = router ? 'resident_router_reply' : 'task_result'
  const rows = []
  const entry = (id, message) => rows.push({sourceEntry:{id,timestamp:'2026-11-18T07:00:00Z'},messages:[message]})
  const tool = (id, name, args, output = '{}') => {
    entry(id, {role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]})
    entry(id+'-receipt',{role:'toolResult',toolCallId:id,toolName:name,isError:false,content:[{type:'text',text:output}]})
  }
  for (let i = 0; i < rounds; i++) {
    tool(`read-${i}-a`,'read',{path:'fixture-a.txt'},'已读取第一份资料')
    tool(`read-${i}-b`,'read',{path:'fixture-b.txt'},'已读取第二份资料')
    const text = long && i === rounds - 1 ? '长结果正文。'.repeat(4000)+'正文终点' : i < 2 ? '资料核对完成，保留待确认事项。' : `第 ${i+1} 轮核对完成。`
    tool(`report-${i}`,toolName,router ? {text} : {decision:{action:'wait',summary:text,question:i === 1 ? '请确认下一步范围。' : '',evidence:['不展示的依据'],limitations:['不展示的限制']}},router ? '{"accepted":true}' : '{"received":true}')
    tool(`bash-${i}-a`,'bash',{command:'echo fixture-a'},'第一项核验通过')
    tool(`bash-${i}-b`,'bash',{command:'echo fixture-b'},'第二项核验通过')
  }
  const source={kind:'conversation-router',conversationId,generation:1,eventIds:[]}
  const content=[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId,generation:1,events:[]})}]
  const packet={id:'readback-input',parentId:null,type:'custom_message',customType:'night.business-input',timestamp:'2026-11-18T07:00:00Z',display:true,details:{source,packetId:'readback-packet'},content}
  const native=router?[packet,...rows.map((row,index)=>({...row.sourceEntry,type:'message',parentId:index?rows[index-1].sourceEntry.id:packet.id,message:row.messages[0]}))]:rows.map(row=>({id:row.sourceEntry.id}))
  const snapshot = {
    header: router ? {id:sessionId,conversationId:GLOBAL_ROUTER_SCOPE,runtimeOwner:'conversation-router',generation:1} : {id:sessionId},
    entries:native,
    audit:router ? [{domain:'admission',kind:'enqueued',version:1,payload:{id:'readback-packet',source,content}},{domain:'admission',kind:'admitted',version:1,payload:{id:'readback-packet',entryId:packet.id}}] : [{domain:'task',kind:'identity',version:1,payload:{taskId:'task-research',sessionId}}],
    context:{projection:{entries:rows}},
  }
  const fixture = await startPreview({port:0,sessionRecords:router,
    persistenceOverride:{readNative:async id=>{if(id!==sessionId)throw Error('unexpected synthetic session '+id);return snapshot}},
    configureTasks:tasks=>{const task=tasks.find(row=>row.taskId==='task-research');task.state='waiting';task.session.status='idle';task.result={summary:long ? '长结果正文。'.repeat(4000)+'正文终点' : `第 ${rounds} 轮核对完成。`}},
  })
  return {...fixture,snapshot,sessionId}
}
