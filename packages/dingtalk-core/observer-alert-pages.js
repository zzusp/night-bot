import {ObserverMemoryPages} from './observer-memory-pages.js'
import {hasRestartIsolation} from './native-restart-isolation.js'
export function createObserverAlertPages({failures,tasks,operations,notifications,groups=()=>[]}){
 const effectHold=item=>item.lastDecision?.limitations?.find(code=>['TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(code))
 const runtimeHold=item=>effectHold(item)||item.sessionFailure?.code||item.technicalFailure?.code||item.providerRecovery||item.lastDecision?.limitations?.includes('TASK_SESSION_NO_SUBMISSION')
 const index=new ObserverMemoryPages(),firstSeen=new Map(),groupFailures=new WeakMap();let signature='',readers=new Map()
 const collect=()=>{
  const descriptors=[]
  const add=(id,stamp,read,type='runtime')=>{if(!firstSeen.has(id))firstSeen.set(id,new Date().toISOString());descriptors.push({id,stamp:stamp??firstSeen.get(id),type,read:()=>({...read(),type})})}
  for(const group of groups()){
   if(!groupFailures.has(group))groupFailures.set(group,group.messages.find(message=>['failed','decision-failed','decision-commit-failed'].includes(message.agentDeliveryStatus))??null)
   const failed=groupFailures.get(group)
   if(failed)add(`coordination:${group.groupId}`,failed.agentDeliveryAt,()=>({alertId:`coordination:${group.groupId}`,fingerprint:`coordination:${group.groupId}`,detail:failed.agentDeliveryError??'群消息归类或协调失败，原消息尚未处理。',status:'active',lastSeenAt:failed.agentDeliveryAt??firstSeen.get(`coordination:${group.groupId}`)}))
  }
  for(const item of failures.values())add(`failure:${item.id}`,item.at,()=>({alertId:`failure:${item.id}`,taskId:tasks.has(item.id)?item.id:undefined,fingerprint:`task-session:${item.id}`,detail:item.code,status:'active',lastSeenAt:item.at??firstSeen.get(`failure:${item.id}`)}))
  for(const item of operations.values())if(item.state==='unknown'&&!hasRestartIsolation(item))add(`operation:${item.id??item.operationId}`,item.updatedAt??item.createdAt,()=>({alertId:`operation:${item.id??item.operationId}`,taskId:item.taskId,fingerprint:`unknown-operation:${item.id??item.operationId}`,detail:'执行效果未知，已阻止后续操作；须核实原始效果。',status:'active',lastSeenAt:item.updatedAt??item.createdAt}))
  for(const item of notifications.values())if(item.state==='unknown')add(`notification:${item.id}`,item.updatedAt,()=>({alertId:`notification:${item.id}`,taskId:item.taskId,fingerprint:`unknown-notification:${item.id}`,detail:'群通知发送结果尚未回读确认。',status:'active',lastSeenAt:item.updatedAt}))
  // 分类只读投影 Host 故障字段；模型正文不能解除未知效果或恢复告警。
  for(const item of tasks.values())if(item.status==='active'&&(runtimeHold(item)||item.lastDecision?.action==='blocked'||item.lastDecision?.action==='wait'&&!!item.lastDecision?.question?.trim()))add(`task-blocked:${item.taskId}`,item.updatedAt,()=>({alertId:`task-blocked:${item.taskId}`,taskId:item.taskId,fingerprint:`task-blocked:${item.taskId}`,detail:effectHold(item)?`任务仍有未结清效果：${effectHold(item)}；请核验原调用，禁止重放。`:item.sessionFailure?.code??item.technicalFailure?.code??item.lastDecision?.summary??'任务恢复受阻，请核验原始记录。',status:'active',lastSeenAt:item.updatedAt}),runtimeHold(item)?'runtime':'task')
  return descriptors
 }
 return {all:()=>collect().map(item=>item.read()),async page({offset=0,limit=10,view='active',type='all',revision}={}){
  const descriptors=collect(),next=JSON.stringify(descriptors.map(({id,stamp,type})=>[id,stamp,type]))
  readers=new Map(descriptors.map(item=>[item.id,item.read]))
  if(next!==signature||!index.collections.has('alerts')){signature=next;index.replace('alerts',next,descriptors.map(item=>({id:item.id,sort:item.stamp,filters:['active:all','active:'+item.type]})))}
  return index.page('alerts',{offset,limit,revision,filter:`${view}:${type}`},id=>readers.get(id)())
 }}
}
