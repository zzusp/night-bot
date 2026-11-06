import {createEffectOperatorAuth} from './tasks/effect-operator-auth.js'
import {createServer} from 'node:http'
import {join} from 'node:path'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskResidentRuntime} from '../packages/dingtalk-core/task-resident-runtime.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {handleRequest,applyResidentCorsHeaders,residentErrorStatus} from '../packages/dingtalk-core/http.js'
/** Channel-neutral composition. Attributed Topic/HTTP domain code is reused;
 * this entry does not construct a vendor client, probe CLI login or start DWS. */
export const inject=['runtimePaths','storage','storageDomain','credentials','agents','agentDefaultModel','agentPresets','permissionPresets','officialAgentFactory','sessionCatalog','sessionPersistence','workspaceRegistry','tools','nativeModelRoutes','systemPrompt','attachments','channels','jobs','subprocess']
export async function apply(ctx,config){
  const paths=ctx.get('runtimePaths'),resident=config.resident??{},taskConfig={...config.model,...resident.taskSessions,workspaceDir:paths.workspaces,dbPath:join(paths.state,'tasks.sqlite')}
  for(const field of ['instanceId','ownerActorId','webActorId'])if(typeof taskConfig[field]!=='string'||!taskConfig[field].trim())throw Error('TASK_SESSION_CONFIGURATION_REQUIRED:'+field)
  if(!Number.isFinite(Date.parse(taskConfig.ingressEpoch)))throw Error('TASK_SESSION_INGRESS_EPOCH_INVALID')
  const store=await openResidentStore(ctx.storageDomain),runtime=await openTaskResidentRuntime(ctx,store,paths.workspaces,{agentPreset:'night-bot',agentWorkspaceDir:paths.workspaces,taskSessionModel:taskConfig,maxConcurrentTasks:resident.maxConcurrentTasks??5})
  runtime.setGroupMessageReader((...args)=>ctx.get('channels').readResource('readMessage',...args));runtime.setGroupResourceReader(async(...args)=>{const value=await ctx.get('channels').readResource('readResource',...args);if(!value?.image)return value;return {...value,imageRefs:await ctx.attachments.saveImages([value.image])}})
  let tasks,server,timer,closing
  const close=()=>closing??=(async()=>{clearInterval(timer);await ctx.parallel('night/stopping');if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await tasks?.close();await runtime.close?.()})()
  ctx.effect(()=>close,'application shutdown')
  const unsupported=()=>{throw Object.assign(Error('CHANNEL_TRANSPORT_UNAVAILABLE'),{code:'CHANNEL_TRANSPORT_UNAVAILABLE'})}
  const operatorNotifications=ctx.get('channels').operatorNotifications
  tasks=await openTaskSessionService({ctx,config:taskConfig,legacy:runtime,residentStore:store,
    readMessage:(...args)=>ctx.get('channels').readResource('readMessage',...args),
    readResource:(...args)=>ctx.get('channels').readResource('readResource',...args),
    readMentioned:(...args)=>ctx.get('channels').readResource('readMentioned',...args),
    notifications:operatorNotifications??{canDisclose:()=>false,send:unsupported,readback:unsupported}})
  const effectOperatorAuth=await createEffectOperatorAuth(paths)
  const bindings={inspectTaskEffect:'inspectTaskEffect',reconcileTaskEffect:'reconcileTaskEffect',authorizeTaskEffectAction:'authorizeTaskEffectAction',listAlertPage:'listAlertPage',listAlerts:'listAlerts',listActivities:'listActivities',listTaskTimings:'listTaskTimings',listPerformance:'listPerformance',getActivityAuditStatus:'getActivityAuditStatus',ingest:'ingest',isOwnNotification:'isOwnNotification',listObserverGroups:'listObserverGroups',observerGroupPage:'observerGroupPage',listTaskView:'boardTasks',hasPendingTopicFacts:'hasPendingTopicFacts',messageProcessingSources:'messageProcessingSources',messageProcessingRequests:'messageProcessingRequests',getTaskSessionDetail:'taskDetail',getTaskSessionIdentity:'taskIdentity',getTaskSessionExecutions:'taskExecutions',getTaskSessionDecisions:'taskDecisions',createTask:'createTask',appendTaskContext:'appendTaskContext',reopenTask:'reopenTask',getTaskDialogue:'taskDialogue',sendTaskDialogue:'sendTaskDialogue',cancelTask:'cancelTask',archiveTask:'archiveTask',listAuthorizationRequests:'listAuthorizationRequests',respondTaskHumanRequest:'respondHumanRequest',reconcileWebTaskTopics:'reconcileWebTaskTopics',respondTaskPrivateHumanReply:'respondPrivateHumanReply',retryDecisionFailedMessage:'retryMessageProcessing',updateMessageRoutingHold:'updateMessageRoutingHold',retryNotification:'retryNotification'}
  for(const [target,source]of Object.entries(bindings))runtime[target]=tasks[source]
  runtime.isTaskSessionMode=()=>true;runtime.getTopicTasksPage=options=>tasks.boardTasks({...options,archived:'all'})
  const oldIssues=runtime.listRecoveryIssues.bind(runtime);runtime.listRecoveryIssues=()=>[...oldIssues(),...tasks.listAlerts().map(alert=>({kind:'task',...alert,error:alert.detail}))]
  const application={runtime,tasks,store,config,close};ctx.provide('application',application)
  timer=setInterval(()=>void tasks.recover().catch(error=>ctx.logger.warn(error.code??'TASK_RECOVERY_FAILED')),taskConfig.recoveryIntervalMs??5000);timer.unref()
  server=createServer((request,response)=>handleRequest(request,response,runtime,{transport:'channels',outboundAuthorized:ctx.get('channels').transports.size>0,modelMode:'real',effectOperatorAuth}).catch(error=>{applyResidentCorsHeaders(request,response);if(!response.headersSent)response.writeHead(residentErrorStatus(error),{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify({error:error.code??error.message}))}))
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(resident.port??18998,resident.host??'127.0.0.1',resolve)})
  await tasks.recover();await ctx.parallel('night/ready',application)
}
