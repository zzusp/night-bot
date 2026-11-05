import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {createSingleTaskSessions} from '../src/tasks/single-session.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {taskWorkspace} from '../packages/dingtalk-core/session-workspaces.js'
import {registerTaskSession} from '../src/tasks/session-routes.js'

const call=(tool,args)=>({tool,args})
const wait=(summary,extra={})=>call('task_result',{decision:{action:'wait',summary,evidence:['original source and conditions read'],limitations:[],...extra}})
const remember=()=>call('memory_remember',{topic:'preferences',key:'review-bypass',text:'must not be written',sourceMessageId:'forged-human',sourceQuote:'remember this'})

test('actual Host human review and dialogue stay read-only, record real SQL source evidence, then resume standing authorization',{timeout:20000},async()=>{
 const cleanups=[],bodyCalls={write:0,bash:0,memory_remember:0},scopes=[],observations=[]
 let stage='initial',step=0,requestId='business-question',candidate='fact-source',review,taskId='review-task',binding,sessions,store
 const f=await memoryHost({after:fn=>cleanups.push(fn)},body=>{
  if(!body.tools?.some(tool=>tool.function.name==='task_result'))return
  if(['dialogue','followup','answer'].includes(stage))for(const name of ['write','bash','memory_remember'])assert.ok(body.tools.some(tool=>tool.function.name===name),'review must deny an actual available tool: '+name)
  const n=step++
  if(stage==='initial')return call('task_result',{decision:{action:'blocked',summary:'Original work waits for the designated business owner’s conditions.',question:'Please confirm the UAT2-only scope and persistence condition.',audience:'requester',evidence:['original authorized objective'],limitations:[],attemptedActions:['Read the original scope']}})
  if(stage==='dialogue')return [call('write',{file_path:'work/dialogue-forbidden.txt',content:'forbidden'}),call('bash',{command:'touch work/dialogue-shell-forbidden.txt',description:'Must not run in dialogue'}),remember(),wait('Current facts only; the original business question remains pending.')][n]
  if(stage==='followup')return [call('write',{file_path:'work/review-forbidden.txt',content:'forbidden'}),call('bash',{command:'touch work/review-shell-forbidden.txt',description:'Must not run in review'}),remember(),wait('A fact reply cannot resolve the original business approval.',{replySourceId:'foreign-source'}),wait('Read evidence is necessary.',{replySourceId:candidate,evidence:[]}),wait('Only existing local evidence is known; no implementation approval was inferred.',{replySourceId:candidate})][n]
  if(stage==='answer')return [call('task_human_resolve',{requestId:'foreign-request',sourceId:candidate,reason:'not the current question',evidence:['not authority']}),call('task_human_resolve',{requestId,sourceId:'foreign-source',reason:'not a candidate',evidence:['not authority']}),call('task_human_resolve',{requestId,sourceId:candidate,reason:'empty evidence cannot authorize',evidence:[]}),call('task_human_resolve',{requestId,sourceId:candidate,reason:'business-person is designated by the original objective; the full reply answers this question and preserves the UAT2-only condition.',evidence:['business-person: UAT2 only; edits must persist on save. No other environment is approved.']}),call('write',{file_path:'work/after-resolve-forbidden.txt',content:'forbidden'}),remember(),wait('The original reply and all conditions were recorded; this review remains read-only.')][n]
  if(stage==='normal')return n===0?call('write',{file_path:'work/authorized.txt',content:'original authorized local work'}):call('task_result',{decision:{action:'complete',summary:'Original local work verified.',evidence:['work/authorized.txt'],limitations:[]}})
  throw Error('unexpected stage')
 })
 const ctx=f.host.ctx
 ctx.on('tools/execute',async(exec,next)=>{if(Object.hasOwn(bodyCalls,exec.name))bodyCalls[exec.name]++;return next()})

 let sequence=0
 const command=async(kind,args)=> (await store.command({id:'review-test-'+(++sequence),kind,args})).result
 const row=()=>store.query({kind:'task.get',taskId})
 const finish=async claimed=>{await command('wake.ack',{binding:claimed.binding,wakeIds:claimed.wakeIds});await command('task.drained',{binding:claimed.binding})}
 const source=async(id,text,actorId='business-person')=>{await command('source.record',{sourceId:id,groupId:'review-group',messageId:id,actorId,channel:'im',text});return store.query({kind:'source.get',sourceId:id})}
 async function execute(claimed,extra={}){
  binding=claimed.binding;const task=await row(),sources=await Promise.all(task.sourceRefs.map(sourceId=>store.query({kind:'source.get',sourceId})))
  await ctx.get('memory').bindSession(binding.sessionId,{actorId:'owner',groupId:'review-group',groupWrite:true})
  const input={task,sources,materials:[],blockers:[],...extra}
  const result=await sessions.run({binding,input,...f.config.model,onSessionBound:async()=>{const agent=ctx.get('agents').get(binding.sessionId);assert.ok(agent?.piSession);const memory=await ctx.get('memory').read(agent,{scope:'group',topic:'preferences'});scopes.push({stage,mode:ctx.get('sandboxPolicy').resolve({actor:agent}).mode,approval:ctx.get('approval').policyForActor(agent),preset:ctx.get('permissionPresets').current(agent),memoryWrite:ctx.get('permissionPresets').authorizeMemoryWrite(agent),memoryEntries:memory.entries.length});return command('task.sessionBound',{binding})},
   resolveHuman:async args=>{observations.push({kind:'resolve',stage,args});return command('task.human.resolve',{binding,...args})},
   submit:async decision=>{
    observations.push({kind:'submit',stage,decision})
    if(extra.dialogue)return command('task.dialogue.reply',{binding,messageId:extra.dialogue.id,reply:decision.summary,decision})
    if(decision.action==='complete')return command('task.complete',{binding,summary:decision.summary,result:decision})
    const replySource=decision.replySourceId?sources.find(source=>source.sourceId===decision.replySourceId):undefined
    const notification=replySource?{conversationId:replySource.groupId,sourceMessageId:replySource.messageId,actorId:replySource.actorId,sourceId:replySource.sourceId,sourceVersion:replySource.version,replyToMessageId:replySource.messageId,replyToSenderOpenDingTalkId:replySource.actorId,atOpenDingTalkIds:[replySource.actorId],text:decision.summary}:undefined
    return command('task.wait',{binding,...decision,...decision.question?{humanRequest:{requestId,reason:decision.summary,audience:decision.audience}}:{},...decision.replySourceId?{humanReply:{requestId,sourceId:decision.replySourceId,notification}}:{}})
   },
  })
  assert.equal(result.status,'submitted');await finish(claimed)
 }
 try{
  store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'review-tasks.sqlite'),workspaceDir:ctx.runtimePaths.workspaces,instanceId:'review-test',ownerActorId:'owner',webActorId:'owner',initialize:true})
  const original='After business-person confirms the existing UAT2-only conditions, create the original local proof under work/. No other environment or objective is authorized.'
  await command('task.create',{taskId,groupId:'review-group',ownerActorId:'owner',objective:original,request:original})
  sessions=createSingleTaskSessions({ctx,isCurrent:async expected=>{const task=await row();return task.status==='active'&&task.control==='active'&&!task.drained&&task.leaseEpoch===expected.leaseEpoch&&task.requirementRevision===expected.requirementRevision&&task.controlRevision===expected.controlRevision&&(task.contextRevision??0)===(expected.contextRevision??0)},getWorkspaceDir:async()=>{const task=await row();await taskWorkspace(ctx.runtimePaths.workspaces,taskId);await registerTaskSession(ctx.runtimePaths,ctx.get('taskSessionRoutes'),task);return taskWorkspace(ctx.runtimePaths.workspaces,taskId)}})
  await execute(await command('task.claim',{taskId}))
  const initial=await ctx.sessionPersistence.readNative((await row()).sessionId,{requireComplete:true}),standing=initial.audit.filter(receipt=>['permission','sandbox','approval'].includes(receipt.domain))
  assert.ok(standing.some(receipt=>receipt.domain==='permission'&&receipt.payload.sandbox==='workspace-write'))
  await command('task.dialogue.add',{taskId,requestId:'dialogue-one',text:'What is currently known?',actorId:'owner'})
  stage='dialogue';step=0;const dialogueClaim=await command('task.claim',{taskId,dialogue:true});await execute(dialogueClaim,{dialogue:(await row()).dialogue[0]})
  assert.equal((await row()).humanRequests[0].status,'waiting-reply');assert.equal((await row()).dialogue[0].reply,'Current facts only; the original business question remains pending.')
  await source(candidate,'What is already implemented? This is a factual question, not approval.')
  let current=await row();await command('task.supplement',{taskId,expectedRequirementRevision:current.requirementRevision,expectedControlRevision:current.controlRevision,messageId:'fact-supplement',text:'A factual follow-up',sourceRefs:[candidate]})
  stage='followup';step=0;const followup=await command('task.claim',{taskId,humanReview:true});review=followup.humanReview;await execute(followup,{humanReview:review})
  current=await row();assert.equal(current.humanRequests[0].status,'waiting-reply');assert.equal(current.humanRequests[0].followupReplies.length,1);assert.equal(current.humanRequests[0].followupReplies[0].sourceId,candidate)
  candidate='answer-source';const reply='business-person: UAT2 only; edits must persist on save. No other environment is approved.'
  await source(candidate,reply);await source('foreign-source','A different message with no review binding.','foreign-person')
  current=await row();await command('task.supplement',{taskId,expectedRequirementRevision:current.requirementRevision,expectedControlRevision:current.controlRevision,messageId:'answer-supplement',text:'The designated business reply',sourceRefs:[...current.sourceRefs,candidate]})
  stage='answer';step=0;const answer=await command('task.claim',{taskId,humanReview:true});review=answer.humanReview
  await assert.rejects(command('task.human.resolve',{binding:answer.binding,requestId,sourceId:'foreign-source',reason:'foreign',evidence:['foreign']}),{code:'DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID'})
  await execute(answer,{humanReview:review})
  current=await row();assert.equal(current.humanRequests[0].status,'answered');assert.equal(current.humanRequests[0].sourceId,candidate);assert.equal(current.humanRequests[0].actorId,'business-person');assert.equal(current.humanRequests[0].reply,reply);assert.match(current.humanRequests[0].resolution.reason,/designated by the original objective/)
  assert.equal(observations.filter(value=>value.kind==='resolve').length,1,'foreign and empty evidence calls never invoke the SQL resolution capability')
  assert.deepEqual(bodyCalls,{write:0,bash:0,memory_remember:0})
  const beforeNormal=await ctx.sessionPersistence.readNative(current.sessionId,{requireComplete:true})
  const denied=beforeNormal.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&['write','bash','memory_remember'].includes(entry.message.toolName)).map(entry=>entry.message)
  assert.equal(denied.length,8)
  assert.ok(denied.every(result=>result.isError&&result.content.some(block=>block.type==='text'&&/DYNAMIC_HUMAN_REVIEW_READ_ONLY|TASK_DIALOGUE_REPLY_ONLY/.test(block.text))),'valid advertised tools must be refused by the review boundary, not missing arguments or missing tools')
  assert.deepEqual(beforeNormal.audit.filter(receipt=>['permission','sandbox','approval'].includes(receipt.domain)),standing,'review overlays never rewrite standing policy facts')
  assert.ok(scopes.every(scope=>scope.memoryEntries===0))
  assert.equal(beforeNormal.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,0)
  for(const file of ['dialogue-forbidden.txt','dialogue-shell-forbidden.txt','review-forbidden.txt','review-shell-forbidden.txt','after-resolve-forbidden.txt'])await assert.rejects(stat(join(beforeNormal.header.cwd,'work',file)),{code:'ENOENT'})
  stage='normal';step=0;await execute(await command('task.claim',{taskId}))
  current=await row();assert.equal(current.status,'completed');assert.equal(current.objective,original);assert.equal(current.requirementRevision,1);assert.equal(current.controlRevision,1)
  assert.equal(await readFile(join(beforeNormal.header.cwd,'work','authorized.txt'),'utf8'),'original authorized local work')
  assert.deepEqual(bodyCalls,{write:1,bash:0,memory_remember:0})
  assert.deepEqual(scopes.map(value=>[value.stage,value.mode,value.approval,value.preset,value.memoryWrite]),[['initial','workspace-write','never','workspace-write',true],['dialogue','read-only','never','read-only',false],['followup','read-only','never','read-only',false],['answer','read-only','never','read-only',false],['normal','workspace-write','never','workspace-write',true]])
 }finally{await sessions?.close();await store?.close();for(const cleanup of cleanups.reverse())await cleanup()}
})
