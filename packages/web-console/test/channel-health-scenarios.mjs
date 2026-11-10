// Explicit isolated adapter inputs, not a representation of the user's accounts.
// Every case is passed through createWebConsole + GET /api/channels unchanged.
export const healthScenarios = [
  {id:'normal',title:'正常',health:{healthy:true,state:'listening'},bindingActive:true,kind:'normal',label:'健康检查正常'},
  {id:'abnormal',title:'异常',health:{healthy:false,state:'error',lastError:'DINGTALK_CURSOR_PERSIST_FAILED'},bindingActive:true,kind:'abnormal',label:'健康检查异常'},
  {id:'not-ready',title:'未就绪',health:{healthy:false,state:'starting'},bindingActive:true,kind:'not-ready',label:'健康检查未就绪'},
  {id:'missing',title:'未报告',health:{},bindingActive:true,kind:'unknown',label:'健康状态未报告'},
  {id:'history-conflict',title:'历史冲突',health:{healthy:false,state:'recovering',conversations:[{conversationId:'PRIVATE_TARGET',backfill:{state:'failed',lastError:'CHANNEL_MESSAGE_ID_CONFLICT',lastErrorMessageId:'PRIVATE_MESSAGE'}}]},bindingActive:true,kind:'abnormal',label:'健康检查异常'},
  {id:'blocked',title:'切换阻断',health:{healthy:false,state:'error',lastError:'DINGTALK_CHANNEL_SWITCH_BLOCKED'},bindingActive:false,kind:'abnormal',label:'健康检查异常'},
];
