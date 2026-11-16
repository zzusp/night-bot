import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname,relative,isAbsolute} from 'node:path'
import {parseArgs} from 'node:util'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {loadConfig} from '../../../../src/config.js'
import {runtimePaths} from '../../../../src/runtime/paths.js'
import {parseCredentialsDocument} from '../../../../src/native-credentials.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from '../../../../test/fixtures/resident-router-host.js'

const {values}=parseArgs({options:{config:{type:'string'},output:{type:'string'},case:{type:'string',default:'all'},check:{type:'boolean',default:false}}})
assert.ok(['all','running'].includes(values.case),'--case must be all or running')
assert.ok(values.config,'--config must explicitly select the existing installation')
const config=await loadConfig(resolve(values.config)),selection=config.roleModels?.router??config.model
const profile=structuredClone(config.providers[selection.provider])
assert.ok(profile.apiKeyEnv,'This acceptance uses an explicitly configured API-key reference')
const credentials=parseCredentialsDocument(await readFile(runtimePaths(config).credentials,'utf8'))
const key=process.env[profile.apiKeyEnv]??credentials.refs.get(profile.apiKeyEnv)
assert.ok(key,'The selected installation credential reference is unavailable')
profile.apiKeyEnv='ROUTER_ACCEPTANCE_KEY'
profile.models=profile.models.filter(model=>model.id===selection.model)
assert.equal(profile.models.length,1)
if(values.check){console.log(JSON.stringify({check:true,networkRequests:0,temporaryRootsCreated:0,realChannelMessages:0,modelConfigured:true,credentialAvailable:true}));process.exit(0)}
assert.ok(values.output,'--output is required')
const output=resolve(values.output),bucket=resolve('docs/acceptance/router-progress-followup'),outputRelative=relative(bucket,output)
assert.ok(outputRelative&&!outputRelative.startsWith('..')&&!isAbsolute(outputRelative),'Evidence must stay in the feature acceptance directory')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const report={startedAt:new Date().toISOString(),mode:'real-router-model/isolated-host/fake-channel/scripted-triage-and-executor',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),routerSourceSha256:hash(await readFile('src/channels/resident-router-business.js')),cases:[],realChannelMessages:0}
const cleanup=[],t={after:fn=>cleanup.push(fn),diagnostic:()=>{}}
let h,live=false
const toolResults=[]
let releaseExecution,executionEntered
const executionGate=new Promise(resolve=>{releaseExecution=resolve})
const entered=new Promise(resolve=>{executionEntered=resolve})
let holdExecution=false
const responsibility='本群助手叫小助手，协作员是其绑定操作者。负责演示项目。消息明确要求小助手或协作员处理，或已有对应任务的追问，应处理；只有提及姓名但没有交办，也没有关联助手事项时不介入。查询进度不授权新的发布。'
const taskId='synthetic-release-progress'
const sourceByMessage=async messageId=>(await h.query('source.list')).find(source=>source.messageId===messageId)
try{
  // 分诊与执行只提供已知输入/进展，实际 Router 的语义选择全部交给所选模型。
  h=await residentRouterHost(t,async body=>{
    const tools=requestTools(body)
    if(tools.includes('channel_triage_submit')){
      const input=requestEnvelope(body,'一级分诊请求：')
      return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Synthetic current-source handling; Router makes the semantic decision',...['progress','running-progress'].includes(source.messageId)?{reply:'我查下这次联合发布的合并、代码包构建和部署进度，把具体进展和卡点报给你。'}:{}}))}}
    }
    if(tools.includes('task_result')){
      if(holdExecution){console.log(JSON.stringify({stage:'original-session-running'}));executionEntered();await executionGate}
      return {tool:'task_result',args:{decision:{action:'wait',...holdExecution?{}:{audience:'operator',question:'演示构建条件何时就绪？'},summary:'候选核对已完成；代码包尚未构建，未执行上线。',evidence:['fixture:candidate-reviewed'],limitations:['演示构建条件未就绪']}}}
    }
    if(tools.includes('resident_router_settle')){
      assert.equal(live,false,'Actual Router decisions must not use the scripted endpoint')
      const input=requestEnvelope(body,'Router 请求：')
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1).result.isError)return {text:'Seed batch settled'}
      const source=input.events.find(event=>event.source)?.source
      if(source&&!(await h.query('task.get',{taskId})))return {tool:'resident_task_plan',args:{operationId:'seed-task',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId,title:'演示项目联合发布',objective:'合并演示修复并上线',requirements:['使用本地代码包上传的构建方式','此夹具只记录模拟进展，不连接真实业务服务']}],dependencies:[]}}
      return {tool:'resident_router_settle',args:{operationId:'seed-settle-'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
    }
    return {text:'No additional synthetic execution'}
  },{hostOptions:{inheritedEnvironment:{ROUTER_ACCEPTANCE_KEY:key},hostConfig:{reflection:{enabled:false}}}})
  h.host.ctx.on('tools/result',(execution,result)=>toolResults.push({name:execution.name,isError:!!result.isError,...execution.name==='resident_task_action'?{kind:execution.arguments.kind}:{},...execution.name==='resident_task_query'?{taskId:execution.arguments.taskId,detail:execution.arguments.detail}:{}}))
  await h.receive(channelMessage('seed',{text:'小助手，合并演示修复，发线上。走本地代码包上传构建，不等自动构建。'}))
  await h.service.whenIdle()
  const seed=await sourceByMessage('seed'),initial=await h.query('task.get',{taskId})
  assert.equal(initial.lastDecision.action,'wait')
  await h.residentStore.updateGroup({groupId:seed.groupId,responsibility})
  h.config.providers['acceptance-router']=profile
  h.config.roleModels={router:{...selection,provider:'acceptance-router'}}
  live=true
  await h.restart()
  h.host.ctx.on('tools/result',(execution,result)=>toolResults.push({name:execution.name,isError:!!result.isError,...execution.name==='resident_task_action'?{kind:execution.arguments.kind}:{},...execution.name==='resident_task_query'?{taskId:execution.arguments.taskId,detail:execution.arguments.detail}:{}}))
  // 只在本次进度来源已结清后释放原会话，内部事件的 settle 不能提前结束运行态。
  h.host.ctx.on('tools/result',async(execution,result)=>{
    if(!holdExecution||execution.name!=='resident_router_settle'||result.isError)return
    const source=await sourceByMessage('running-progress')
    if(source&&(await h.query('router.source-status',{sourceId:source.sourceId})).event?.state==='consumed')releaseExecution()
  })
  h.host.ctx.on('agent/error',()=>releaseExecution())
  async function runCase(id,message,{needsReply=true}={}){
    const before={tools:toolResults.length,sent:h.sent.length,readbacks:h.readbacks.length},beforeTask=await h.query('task.get',{taskId})
    console.log(JSON.stringify({stage:'receiving',case:id}))
    await h.receive(channelMessage(id,{text:message}))
    await h.service.whenIdle()
    const source=await sourceByMessage(id)
    const tools=toolResults.slice(before.tools)
    const notices=(await h.query('notification.list')).filter(row=>row.kind==='router-reply'&&row.payload.sourceId===source.sourceId)
    const tasks=await h.query('task.list'),afterTask=await h.query('task.get',{taskId})
    const disposition=(await h.query('router.source-status',{sourceId:source.sourceId})).event
    const row={id,message,sourceState:disposition?.state,outcome:disposition?.noTaskDisposition?.outcome??null,startedWithRunningExecution:!beforeTask.drained,tools,taskCount:tasks.length,taskSessionPreserved:afterTask.sessionId===beforeTask.sessionId,replyCount:notices.length,replies:notices.map(n=>({state:n.state,text:n.payload.text})),inboxPending:(await h.query('router.inbox',{conversationId:source.groupId})).length}
    report.cases.push(row)
    assert.equal(tasks.length,1,'Progress checks and third-party messages must not create tasks')
    assert.equal(row.taskSessionPreserved,true)
    assert.equal(afterTask.requirementRevision,beforeTask.requirementRevision,'A status question must not change the business goal')
    assert.equal(tools.some(tool=>tool.name==='resident_task_plan'||tool.name==='resident_task_action'&&tool.kind!=='supplement'),false,'A status question must not restart, revise or create business execution')
    assert.equal(row.sourceState,'consumed')
    assert.notEqual(row.outcome,needsReply?'not-assigned':'handled-inline')
    assert.equal(row.inboxPending,0,'The current source must reach its business terminal state')
    if(needsReply){
      assert.ok(tools.some(tool=>tool.name==='resident_task_query'&&!tool.isError),'The model must read current task evidence')
      assert.equal(notices.length,1,'Exactly one substantive Router reply, not only triage acknowledgement')
      assert.equal(notices[0].state,'delivered','Fake-channel readback must confirm the reply')
      assert.ok(h.sent.length>before.sent&&h.readbacks.length>before.readbacks,'The registered fake transport must send and read back the reply')
    }else assert.equal(notices.length,0,'An explicit request to another person must not produce an unsolicited reply')
    row.passed=true
    console.log(JSON.stringify({case:id,passed:true,routerTools:tools.map(tool=>tool.name),replyCount:row.replyCount}))
  }
  if(values.case==='all'){
  await runCase('progress','@协作员(协作员) 进度如何')
  const progress=report.cases.at(-1).replies[0].text
  assert.match(progress,/未|尚|还没|没有|等待/)
  assert.match(progress,/构建|代码包/)
  await runCase('third-party','@其他同事 请你独立处理另一个演示项目，小助手不用参与。',{needsReply:false})
  await runCase('evidence-gap','小助手，刚才那个演示发布线上业务验收都通过了吗？')
  const gap=report.cases.at(-1).replies[0].text
  assert.match(gap,/未|尚|没有|不能|无法/,'No production acceptance evidence exists')
  assert.doesNotMatch(gap,/(?:已|全部|均已)(?:经)?(?:完成|通过)(?:线上|生产|业务)?验收/,'The answer must not fabricate acceptance')
  }
  holdExecution=true
  await h.service.sendTaskDialogue({taskId,requestId:'running-progress-proof',text:'继续核对演示构建状态，不进行任何真实发布。'})
  await entered
  assert.equal((await h.query('task.get',{taskId})).drained,false,'The original execution really owns an active lease')
  await runCase('running-progress','@协作员(协作员) 进度如何')
  assert.equal(report.cases.at(-1).startedWithRunningExecution,true)
  const beforeRestart={sent:h.sent.length,results:h.results.length}
  await h.restart();await h.service.whenIdle()
  assert.equal(h.sent.length,beforeRestart.sent,'Restart must not resend settled replies')
  assert.equal(h.results.length,beforeRestart.results,'Restart must not rerun settled tools')
  assert.equal(h.errors.length,0,'The isolated Host must not hide model or execution failures')
  report.coldRestartNoReplay=true;report.passed=true
}catch(error){report.passed=false;report.error={name:error.name,code:error.code??null,message:String(error.message).replaceAll(key,'[redacted]')};process.exitCode=1}
finally{
  releaseExecution()
  for(const close of cleanup)try{await close()}catch(error){report.passed=false;report.cleanupErrors??=[];report.cleanupErrors.push(String(error.message).replaceAll(key,'[redacted]'));process.exitCode=1}
  report.completedAt=new Date().toISOString()
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(row=>({id:row.id,passed:!!row.passed})),error:report.error}))
}
