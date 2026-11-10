import test from 'node:test'
import assert from 'node:assert/strict'
import {configuredChannels} from '../server/views.js'

const row={type:'dingtalk-dws',channelId:'team-channel',enabled:true,config:{dingtalk_name:'协作助手',dingtalk_conversation_type:'chat-room',dingtalk_group_id:'PRIVATE_TARGET',dingtalk_prompt:'PRIVATE_RESPONSIBILITY'}}
const view=(health,{running=row,saved=row}={})=>configuredChannels({config:{channelPlugins:[running]}},{plugins:new Map(health===undefined?[]:[['team-channel',{health,bindingActive:true}]])},[saved]).items[0]

test('card health reports the loaded adapter rather than enabled configuration',()=>{
  const item=view({healthy:true,state:'ready'})
  assert.equal(item.runningConnected,true);assert.equal(item.connected,true)
})
test('unhealthy and missing health are not converted to success',()=>{
  assert.equal(view({healthy:false,state:'recovering'}).runningConnected,false)
  assert.equal(Object.hasOwn(view(undefined),'runningConnected'),false)
  assert.equal(Object.hasOwn(view({state:'ready'}),'runningConnected'),false)
})
test('blocked runtime states cannot report healthy even if plugin says healthy',()=>{
  for(const state of ['waiting-auth','error','stopped'])assert.equal(view({healthy:true,state}).runningConnected,false,state)
})
test('pending configuration keeps runtime health distinct from saved status',()=>{
  const item=view({healthy:true,state:'listening'},{saved:{...row,config:{...row.config,dingtalk_name:'新名称'}}})
  assert.equal(item.restartRequired,true);assert.equal(item.connected,false);assert.equal(item.runningConnected,true)
})
test('list returns no rejected target, responsibility or private config fields',()=>{
  const item=view({healthy:true,state:'ready'})
  assert.equal(item.name,'协作助手');assert.equal(item.conversationType,'chat-room')
  for(const field of ['targetKind','target','responsibility','responsibilityTruncated','config'])assert.equal(Object.hasOwn(item,field),false,field)
  assert.equal(JSON.stringify(item).includes('PRIVATE_'),false)
})

test('health label distinguishes actual runtime error, not-ready, and missing values',async()=>{
  const {channelHealthPresentation:present}=await import('../src/channel-health.ts')
  assert.equal(present(view({healthy:true,state:'listening'})).label,'健康检查正常')
  assert.equal(present(view({healthy:false,state:'error'})).label,'健康检查异常')
  assert.equal(present(view({healthy:false,state:'starting'})).label,'健康检查未就绪')
  assert.equal(present(view({})).label,'健康状态未报告')
  assert.equal(present(view({healthy:false})).label,'健康检查未就绪')
})
test('auth, stopped, blocked and contradictory health cannot show success',async()=>{
  const {channelHealthPresentation:present}=await import('../src/channel-health.ts')
  for(const state of ['waiting-auth','stopped'])assert.equal(present(view({healthy:true,state})).kind,'not-ready')
  assert.equal(present(view({healthy:false,state:'error',lastError:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})).kind,'abnormal')
  assert.equal(present({...view({healthy:true,state:'ready'}),runningConnectionState:'error'}).kind,'abnormal')
})
test('saved lifecycle failure does not falsify the old adapter health',async()=>{
  const {channelHealthPresentation:present}=await import('../src/channel-health.ts')
  for(const errorCode of ['CHANNEL_DRAIN_FAILED','CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN'])assert.equal(present({...view({healthy:true,state:'listening'}),errorCode,connectionState:'error'}).kind,'normal')
  assert.equal(present({...row,runningConnectionState:'unknown',connected:true}).kind,'unknown')
  assert.equal(present({...row,connectionState:'listening',connected:true}).kind,'normal')
})

test('补拉错误按白名单投影，不泄露消息、账号、正文或任意原始异常',async()=>{
 const {channelHealthPresentation:present,channelRecoveryError}=await import('../src/channel-health.ts')
 for(const [lastError,expected] of [['CHANNEL_MESSAGE_ID_CONFLICT','CHANNEL_MESSAGE_ID_CONFLICT'],['DINGTALK_DEFERRED_HISTORY_INCOMPLETE','CHANNEL_HISTORY_INCOMPLETE'],['DINGTALK_HISTORY_INCOMPLETE','CHANNEL_HISTORY_INCOMPLETE'],['PRIVATE_ACCOUNT native-message secret-body','CHANNEL_HISTORY_RECOVERY_FAILED']]){
  const item=view({healthy:false,state:'recovering',conversations:[{conversationId:'PRIVATE_TARGET',backfill:{state:'failed',lastError,lastErrorMessageId:'PRIVATE_MESSAGE'}}]})
  assert.equal(item.runningErrorCode,expected);assert.equal(item.errorCode,expected);assert.equal(present(item).kind,'abnormal');assert.ok(channelRecoveryError(item.runningErrorCode));assert.equal(item.runningConnected,false)
  assert.doesNotMatch(JSON.stringify(item),/PRIVATE_|native-message|secret-body/)
 }
 assert.equal(view({healthy:true,state:'recovering',conversations:[{backfill:{state:'failed',lastError:'CHANNEL_MESSAGE_ID_CONFLICT'}}]}).runningConnected,false,'补拉失败不能被矛盾的 healthy=true 掩盖')
 for(const state of ['running','ok'])assert.equal(view({healthy:false,state:'recovering',conversations:[{backfill:{state,lastError:'CHANNEL_MESSAGE_ID_CONFLICT'}}]}).runningErrorCode,null,'旧失败文本不能覆盖当前补拉状态')
})
