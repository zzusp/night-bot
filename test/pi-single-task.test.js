import {assertSharedCommunicationGuidance} from './fixtures/communication-guidance.js'
import {symlink} from './fixtures/filesystem-link.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises'
import {createHost} from '../src/host.js'
import {backupData,restoreData} from '../src/runtime/backup.js'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {requestEnvelope,requestTools,residentRouterHost,channelMessage,eventually} from './fixtures/resident-router-host.js'
import {readTaskEffectScope} from '../src/tasks/effect-scope.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function until(fn){for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20))}throw Error('single task timeout')}
async function closeAll(steps){
  const errors=[]
  for(const close of steps){try{await close()}catch(error){errors.push(error)}}
  if(errors.length)throw new AggregateError(errors,'Single task fixture cleanup failed')
}
function cleanupContext(t){
  const steps=[]
  // Node 在前一个 after 失败后不会执行后续 after；统一释放资源并保留全部原始错误。
  t.after(async()=>{
    try{await closeAll(steps)}catch(error){
      const detail=value=>({message:value?.message,code:value?.code,stack:value?.stack,cause:value?.cause&&detail(value.cause),errors:value?.errors?.map(detail)})
      t.diagnostic(JSON.stringify({singleTaskCleanup:detail(error)}));throw error
    }
  })
  return {after:close=>steps.push(close)}
}
async function serviceFor(f,initialize=true){const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'single-test',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...config,initialize});const service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external notifications')},readback:async()=>{throw Error('no external notifications')}}});return {service,store,async close(){await closeAll([()=>service.close(),()=>store.close(),()=>residentStore.close()])}}}
const result={tool:'task_result',args:{decision:{action:'complete',summary:'Read back local result',evidence:['local file evidence'],limitations:[]}}}
const taskSystemPrompt=body=>body.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
test('one task preserves its effect through a held missing result and explicit cold continuation, then completes and reflects',{timeout:nativeTestTimeout(20000)},async t=>{
  t=cleanupContext(t)
  let phase='write',readBack=false,reviews=0,h
  t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){reviews++;return {text:'{"lessons":[]}'}}
    if(!body.tools?.some(t=>t.function.name==='task_result'))return
    if(phase==='write'){phase='pause';return {tool:'write',args:{path:'work/proof.txt',content:'single-session-proof'}}}
    if(phase==='pause')return {text:'temporary provider interruption before final submission'}
    if(!readBack){readBack=true;return {tool:'read',args:{path:'work/proof.txt'}}}
    return {...result,args:{decision:{...result.args.decision,artifacts:["work/proof.txt"],deliveryFiles:[{path:"work/proof.txt",caption:"isolated proof"}]}}}
  })
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'direct-write',objective:'Create a local proof and read it back'})
  const interrupted=await until(async()=>{const taskNow=await h.store.query({kind:'task.get',taskId:task.taskId});return taskNow.drained&&taskNow.lastDecision?.limitations?.includes('TASK_SESSION_NO_SUBMISSION')&&taskNow})
  assert.equal(await readFile(join(task.session.workspaceDir,'work/proof.txt'),'utf8'),'single-session-proof')
  const sessionId=interrupted.sessionId;await h.close();await f.close();phase='finish';await f.boot();h=await serviceFor(f,false)
  const heldCalls=f.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(f.requests.length,heldCalls,'cold recovery cannot restart the exhausted/unfinished turn')
  assert.equal(interrupted.providerRecovery??null,null)
  // An explicit trusted Host continuation retains the original authorization
  // revisions. It is not an automatic provider retry or a fabricated user reply.
  await h.store.command({id:'explicit-host-continuation',kind:'task.wake',args:{taskId:task.taskId,kind:'operator.continue',payload:{requestId:'explicit-continuation'}}})
  await h.service.recover()
  const completed=await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained&&row})
  assert.equal(completed.completion.result.artifactFiles.length,1);assert.equal(completed.completion.result.artifactFiles[0].artifact.fileName,'proof.txt');
  assert.equal(completed.sessionId,sessionId);assert.equal((await h.store.query({kind:'execution.list'})).length,0)
  assert.ok(readBack,'continuation reads the completed original effect rather than issuing a new write');assert.match(JSON.stringify(f.requests),/single-session-proof/)
  assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,1)
  for(const body of f.requests)assert.ok(!body.tools?.some(t=>/^(subagent|task_delegate)/.test(t.function.name)))
  const stored=await f.host.ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})
  const officialResults=stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message);assert.equal(officialResults.filter(message=>message.toolName==='write'&&!message.isError).length,1);assert.ok(officialResults.some(message=>message.toolName==='read'&&!message.isError&&message.content.some(block=>block.type==='text'&&block.text.includes('single-session-proof'))),'continuation verifies the original file through an official read result')
  assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,1);assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-result').length,1)
  await f.host.ctx.reflection.whenIdle();assert.equal(reviews,1)
  const resume=await f.host.ctx.sessionController.resolveAgent(sessionId);assert.match(resume.error?.message??'',/TASK_OWNED/)
  await h.close();await f.close();const backup=join(f.root,'backups','single');await backupData(f.config,backup)
  const relocated=await mkdtemp(join(tmpdir(),'night-single-restored-'));t.after(()=>rm(relocated,{recursive:true,force:true}));const nextConfig={...f.config,installRoot:relocated};await restoreData(nextConfig,backup)
  const nextHost=await createHost(nextConfig,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});const next=await serviceFor({host:nextHost,config:nextConfig},false);try{await next.service.recover();await nextHost.ctx.reflection.whenIdle();assert.equal((await next.store.query({kind:'task.get',taskId:task.taskId})).status,'completed');const header=(await nextHost.ctx.sessionPersistence.stat(sessionId)).header;assert.ok(header.cwd.startsWith(relocated));assert.equal(await readFile(join(header.cwd,'work/proof.txt'),'utf8'),'single-session-proof');assert.equal(reviews,1)}finally{await next.close();await nextHost.close()}
})

test('a fresh task discovers and uses the original verified action from memory and a generated Skill',{timeout:nativeTestTimeout(60000)},async t=>{
  t=cleanupContext(t)
  const key='verify-copy-receipt',when='When a local file copy has a delayed receipt',changes='Read the saved checksum before repeating the copy',boundaries='Use only the current task workspace and do not repeat an unconfirmed copy'
  const readback='saved-checksum-fixture',path='work/checksum.txt',selected=[],seeded=Promise.withResolvers()
  let h,phase='producer',step=0;t.after(()=>{seeded.resolve();return h?.close()})
  const f=await memoryHost(t,body=>{
    const system=taskSystemPrompt(body),last=body.messages.at(-1),tool=last?.role==='tool'?JSON.stringify(last.content):''
    if(system.includes('NIGHT_BOT_SKILL_GENERATION'))return { ...(tool?{text:JSON.stringify({description:'Check prior results',body:'# Confirm a local result\n\nCheck the prior result on the current target.'})}:{tool:'skill',args:{name:'skill-creator'}}) }
    if(system.includes('NIGHT_BOT_TASK_REFLECTION')){
      if(phase!=='producer')return {text:'{"lessons":[]}'}
      const {eventId}=JSON.parse(body.messages.findLast(m=>m.role==='user').content)
      const use={action:'new',key,expectedRevision:0,category:'Local file copies',when,changes,boundaries,reason:'The completion records the checksum readback'}
      return {text:JSON.stringify({lessons:[{key,summary:'Verify a previous result before taking further action',why:use.reason,howToApply:'Use current evidence',evidenceIds:[eventId],memory:use,skillDecision:use,skill:{guidance:'Check the receipt and compare it with the available local result',reason:use.reason,applicability:'Check previous results',evidenceBacked:true}}]})}
    }
    const tools=requestTools(body)
    if(tools.includes('resident_router_settle')){
      const {events}=requestEnvelope(body,'Router 请求：'),eventIds=events.map(event=>event.id)
      return last?.role==='tool'?{text:'Task event settled'}:{tool:'resident_router_settle',args:{eventIds,operationId:`reuse-settle:${eventIds.join(',')}`}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff&&!tools.length)return {text:JSON.stringify({currentIntent:'Retain the current task and its evidence',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(!tools.includes('task_result'))return
    if(phase==='producer'){
      if(step++===0)return {tool:'write',args:{path,content:readback}}
      if(!tool.includes(readback))return {tool:'read',args:{path}}
      return {...result,args:{decision:{...result.args.decision,evidence:[`${when}: ${changes}. ${boundaries}. The saved checksum was read back.`]}}}
    }
    if(step++===0){
      const note=system.split('\n').find(line=>line.includes(`[${key}]`)&&line.includes(when)&&line.includes(changes))
      const skill=system.match(new RegExp(`<name>learned-${key}</name>\\s*<description>([^<]*)</description>`))?.[1]
      if(!note||!skill?.includes(when)||!skill.includes(changes)){
        selected.push({memoryCue:!!note,skillCue:skill??null})
        return {text:'No independently discoverable memory and Skill'}
      }
      selected.push('catalog');return {tool:'memory_read',args:{path:note.match(/\]\(([^)]+)\)/)[1]}}
    }
    if(step===2&&tool.includes(changes)&&tool.includes(boundaries)){selected.push('memory');return {tool:'skill',args:{name:`learned-${key}`},beforeFinish:()=>seeded.promise}}
    if(step===3&&tool.includes(changes)&&tool.includes(boundaries)){selected.push('skill');return {tool:'read',args:{path}}}
    if(step===4&&tool.includes(readback)){selected.push('verified');return result}
    return {text:'Learned operation or required boundary was lost'}
  })
  h=await serviceFor(f)
  const done=async task=>{
    await h.service.whenIdle()
    return until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.drained&&(row.status==='completed'||row.lastDecision||row.technicalFailure)&&row})
  }
  const first=await h.service.createTask({requestId:'learn-copy-check',objective:'Verify the local checksum file after a delayed receipt'})
  assert.equal((await done(first)).status,'completed');await f.host.ctx.reflection.whenIdle()
  await h.close();await f.close();await f.boot();h=await serviceFor(f,false)
  phase='consumer';step=0
  const second=await h.service.createTask({requestId:'reuse-copy-check',objective:'Resolve a delayed local copy receipt using the current workspace evidence',channel:{type:'chat',channelId:'local-adapter',conversationId:'another-conversation',senderId:'another-user',messageId:'continue-copy-check',text:'Check the delayed local copy receipt'}})
  await writeFile(join(second.session.workspaceDir,path),readback);seeded.resolve()
  assert.notEqual(second.session.sessionId,first.session.sessionId)
  assert.equal((await done(second)).status,'completed',JSON.stringify(selected))
  assert.deepEqual(selected,['catalog','memory','skill','verified'])
})

test('不同事项独立复用记忆或 Skill，同类新证据更新原条目，近似事项不套用',{timeout:nativeTestTimeout(150000)},async t=>{
  t=cleanupContext(t)
  const memoryKey='dispatch-crate-capacity',skillKey='photo-evidence-order',path='work/input.txt'
  const cases=[
    {id:'crate-policy',type:'producer',topic:'装箱报价',input:'capacity=7 quantity=16',summary:'需 3 箱'},
    {id:'photo-policy',type:'producer',topic:'档案照片核验',input:'priority=seal,weight,photo candidates=A:001,B:100,C:010',summary:'优先采用 B'},
    {id:'crate-estimate',type:'consumer',topic:'装箱报价',input:'quantity=23',summary:'需 4 箱',tools:['memory_read','read','task_result']},
    {id:'photo-review',type:'consumer',topic:'档案照片核验',input:'candidates=D:011,E:100,F:010',summary:'优先采用 E',tools:['skill','read','task_result']},
    {id:'inventory-count',type:'consumer',topic:'同批货物的实际库存登记，只记实数',input:'quantity=23',summary:'登记 23 件',tools:['read','task_result']},
    {id:'crate-policy-update',type:'producer',topic:'装箱报价',input:'capacity=9 quantity=21',summary:'需 3 箱'},
    {id:'photo-policy-update',type:'producer',topic:'档案照片核验',input:'priority=weight,seal,photo candidates=G:100,H:010,I:001',summary:'优先采用 H'},
    {id:'crate-estimate-updated',type:'consumer',topic:'装箱报价',input:'quantity=25',summary:'需 3 箱',tools:['memory_read','read','task_result']},
    {id:'photo-review-updated',type:'consumer',topic:'档案照片核验',input:'candidates=J:100,K:010,L:001',summary:'优先采用 K',tools:['skill','read','task_result']},
    {id:'crate-policy-repeat',type:'producer',skip:true,topic:'装箱报价',input:'capacity=9 quantity=37',summary:'需 5 箱'},
    {id:'photo-policy-repeat',type:'producer',skip:true,topic:'档案照片核验',input:'priority=weight,seal,photo candidates=M:001,N:100,O:010',summary:'优先采用 O'},
  ]
  let h,current,step,seeded
  t.after(()=>{seeded?.resolve();return h?.close()})
  const complete=(summary,evidence=[])=>({tool:'task_result',args:{decision:{action:'complete',summary,evidence,limitations:[]}}})
  const read=()=>({tool:'read',args:{path},beforeFinish:()=>seeded.promise})
  const f=await memoryHost(t,body=>{
    const system=taskSystemPrompt(body),last=body.messages.at(-1),tool=last?.role==='tool'?JSON.stringify(last.content):''
    if(system.includes('NIGHT_BOT_TASK_REFLECTION')){
      const {eventId,facts,details}=JSON.parse(body.messages.findLast(m=>m.role==='user').content)
      if(current.type!=='producer')return {text:'{"lessons":[]}'}
      const target=(key,kind)=>{const existing=details[kind].find(row=>row.key===key);return {action:existing?'update':'new',key,expectedRevision:existing?.revision??0}}
      const evidence=facts.find(fact=>fact.id===eventId)?.evidence?.[0]??''
      if(current.topic==='装箱报价'){
        const capacity=evidence.match(/capacity=(\d+)/)?.[1];if(!capacity)return {text:'{"lessons":[]}'}
        if(details.memories.some(row=>row.key===memoryKey&&row.text.includes(`capacity=${capacity} `)))return {text:'{"lessons":[]}'}
        const use={...target(memoryKey,'memories'),category:'发货报价',when:'装箱报价',changes:'按每箱容量预估整箱数',boundaries:'只用于报价，不改写实际库存登记',reason:'读取并核对了有效的报价规则'}
        return {text:JSON.stringify({lessons:[{key:memoryKey,summary:`耗用箱数按 quantity 除以 capacity=${capacity} 向上取整`,why:use.reason,howToApply:'以本次发货件数计算',evidenceIds:[eventId],memory:use,skillDecision:{action:'skip',reason:'一条短规则足够'}}]})}
      }
      const priority=evidence.match(/priority=([a-z,]+)/)?.[1];if(!priority)return {text:'{"lessons":[]}'}
      if(details.skills.some(row=>row.key===skillKey&&row.body.includes(`priority=${priority}。`)))return {text:'{"lessons":[]}'}
      const use={...target(skillKey,'skills'),category:'附件证据归档',when:'档案照片核验',changes:'比较各项证据后取排序最先的材料',boundaries:'只比较同一档案的三个核验位，材料不足不补造',reason:'已核对三种竞争的证据组合'}
      return {text:JSON.stringify({lessons:[{key:skillKey,summary:'不能只看附件数，应按证据可靠度排序',why:use.reason,howToApply:'三个核验位必须分别回读；排序办法见已验证的方法',evidenceIds:[eventId],memory:{...use,...target(skillKey,'memories')},skillDecision:use,skill:{guidance:`priority=${priority}。按优先级比较三项证据位；按第一处不同选较强的一份，不按通过项总数。`,reason:use.reason,applicability:use.when,evidenceBacked:true}}]})}
    }
    if(system.includes('NIGHT_BOT_SKILL_GENERATION'))return
    if(!requestTools(body).includes('task_result'))return
    const turn=step++
    if(turn===0){
      if(current.type==='producer'||current.id==='inventory-count')return read()
      if(current.topic==='装箱报价'){
        const link=system.split('\n').find(line=>line.includes('装箱报价')&&line.includes('预估整箱数'))?.match(/\]\(([^)]+)\)/)?.[1]
        return link?{tool:'memory_read',args:{path:link}}:{text:'未找到报价经验'}
      }
      const candidate=[...system.matchAll(/<name>([^<]+)<\/name>\s*<description>([^<]+)<\/description>/g)].find(([, ,description])=>description.includes('档案照片核验'))
      return candidate?{tool:'skill',args:{name:candidate[1]}}:{text:'未找到照片核验方法'}
    }
    const history=JSON.stringify(body.messages.filter(message=>message.role==='tool'))
    if(current.type==='consumer'&&current.id!=='inventory-count'&&turn===1)return read()
    if(current.topic==='装箱报价'){
      const capacity=Number(history.match(/capacity=(\d+)/)?.[1]),quantity=Number(tool.match(/quantity=(\d+)/)?.[1])
      if(capacity&&quantity)return complete(`需 ${Math.ceil(quantity/capacity)} 箱`,[`capacity=${capacity} quantity=${quantity} 已读回`])
    }else if(current.topic==='档案照片核验'){
      const priority=history.match(/priority=([a-z,]+)/)?.[1],rows=[...tool.matchAll(/([A-Z]):([01]{3})/g)]
      if(priority&&rows.length===3){
        const positions=['seal','weight','photo'],score=bits=>priority.split(',').map(name=>bits[positions.indexOf(name)]).join('')
        rows.sort((a,b)=>score(b[2]).localeCompare(score(a[2])))
        return complete(`优先采用 ${rows[0][1]}`,[`priority=${priority}；已比较本次三份材料`])
      }
    }else if(current.id==='inventory-count'){
      const quantity=tool.match(/quantity=(\d+)/)?.[1]
      if(quantity)return complete(`登记 ${quantity} 件`)
    }
    return {text:'缺少当前输入或已读取的规则正文'}
  })
  h=await serviceFor(f)
  const sessions=new Set(),memoryIds=new Map(),scope=await f.host.ctx.memory.scope((await f.agent('review-reader',{actorId:'owner'})).agent,{})
  for(current of cases){
    step=0;seeded=Promise.withResolvers()
    const requestStart=f.requests.length
    const task=await h.service.createTask({requestId:current.id,objective:`${current.topic}：读取本次 input.txt 并提交结果。`})
    await writeFile(join(task.session.workspaceDir,path),current.input);seeded.resolve()
    await h.service.whenIdle()
    const row=await h.store.query({kind:'task.get',taskId:task.taskId})
    assert.equal(row.drained,true,current.id)
    assert.equal(row.status,'completed',current.id);assert.equal(row.completion.result.summary,current.summary,current.id)
    assert.ok(!sessions.has(row.sessionId));sessions.add(row.sessionId)
    await f.host.ctx.reflection.whenIdle()
    const review=Object.values((await f.host.ctx.reflection.state(scope)).reviews).find(item=>item.taskId===task.taskId)
    assert.equal(review?.status,current.type==='producer'&&!current.skip?'done':'skipped',current.id)
    if(current.tools){
      const taskRequests=f.requests.slice(requestStart).filter(body=>requestTools(body).includes('task_result'))
      const incoming=JSON.stringify(taskRequests[0].messages.filter(message=>message.role==='user'))
      assert.doesNotMatch(incoming,/dispatch-crate-capacity|photo-evidence-order|capacity=\d|priority=|登记 23 件|需 [34] 箱|采用 [EK]/)
      const journal=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
      const receipts=journal.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
      assert.deepEqual(receipts.map(message=>[message.toolName,message.isError]),current.tools.map(name=>[name,false]),current.id)
      assert.deepEqual(review.destinations,[])
    }else if(current.skip){
      assert.deepEqual(review.destinations,[])
    }else{
      assert.equal(review.destinations.length,1)
      const photo=current.topic==='档案照片核验',key=photo?skillKey:memoryKey
      assert.equal(review.destinations[0].skill?.key,photo?skillKey:undefined)
      const memory=(await f.host.ctx.memory.store.read(scope,{topic:'experience',key,includePrevious:true})).entries[0]
      assert.equal(memory.source.messageId,review.eventId)
      if(current.id.endsWith('-update')){
        const first=memoryIds.get(key)
        assert.equal(memory.id,first.id);assert.equal(memory.revision,2)
        assert.equal(memory.originSource.messageId,first.source.messageId)
        if(!photo)assert.match(memory.previous.text,/capacity=7/)
      }else{
        assert.equal(memory.revision,1);memoryIds.set(key,memory)
      }
      if(photo){
        const skill=(await f.host.ctx.reflection.state(scope)).skills[key]
        assert.equal(skill.revision,memory.revision);assert.ok(skill.generation.creator.callId)
        if(skill.revision===2){assert.match(skill.previous.text,/priority=seal,weight,photo/);assert.equal(skill.supports.length,2)}
      }
    }
  }
  const entries=(await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries
  assert.deepEqual(entries.map(row=>[row.key,row.revision]).sort(),[[memoryKey,2],[skillKey,2]])
  assert.deepEqual(Object.keys((await f.host.ctx.reflection.state(scope)).skills),[skillKey])
})

test('native task overflow preserves the next verification and resumes without replaying completed writes',{timeout:nativeTestTimeout(30000)},async t=>{
  t=cleanupContext(t)
  let h,step=0;t.after(()=>h?.close())
  const proof='isolated-original-proof',checkpoint='NEXT_CHECK: read work/proof.txt before completing',summaries=[]
  let resumed=false
  const f=await memoryHost(t,body=>{
    const wire=JSON.stringify(body.messages)
    if(wire.includes('You are a context summarization assistant')){
      summaries.push(body)
      return {text:'# Goal\nRead back the original file.\n# Progress\nThe writes succeeded once.\n# Next Steps\n'+checkpoint}
    }
    if(!requestTools(body).includes('task_result'))return
    if(wire.includes(checkpoint)){
      resumed=true
      if(body.messages.at(-1)?.role==='tool'&&JSON.stringify(body.messages.at(-1)).includes(proof))return result
      return {tool:'read',args:{path:'work/proof.txt'}}
    }
    if(step++===0)return {tool:'write',args:{path:'work/proof.txt',content:proof}}
    if(step===2)return {tool:'write',args:{path:'work/background.txt',content:'synthetic prior evidence '.repeat(3600)}}
    if(step===3)return {error:'maximum context length is 64000 tokens'}
    return {text:'Missing the task continuation checkpoint'}
  },{hostConfig:config=>{config.providers.fixture.models[0].contextWindow=64000}})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'task-overflow',objective:'Write the fixture files, then verify the original proof by reading it back'})
  const row=await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.drained&&(row.lastDecision||row.status==='completed')&&row})
  assert.equal(summaries.length,1,'Pi performs its existing overflow compaction')
  const summaryRequest=JSON.stringify(summaries[0].messages)
  assert.ok(summaryRequest.includes('NIGHT_ROLE_SUMMARY=task'),'the compact request uses task-specific instructions')
  assert.ok(summaryRequest.includes('当前目标与验收要求')&&summaryRequest.includes('核验入口'),'the request tells Pi to retain verification criteria and evidence references')
  assert.ok(resumed,'the compacted checkpoint reaches task execution')
  const before=f.requests.find(body=>requestTools(body).includes('task_result'))
  const after=f.requests.find(body=>requestTools(body).includes('task_result')&&JSON.stringify(body.messages).includes(checkpoint))
  for(const request of [before,after]){
    assert.ok(request,'initial and resumed task both reach the provider')
    const method=taskSystemPrompt(request)
    assert.match(method,/For a straightforward task, act directly/)
    assert.match(method,/observable milestones, dependencies, and how to verify each required outcome/)
    assert.match(method,/resume at the first unfinished step/)
    assert.match(method,/check that could distinguish the plausible causes/)
    assert.match(method,/Verify the requested outcome on the actual target/)
    assert.doesNotMatch(method,/temporarily switch only the database name/)
  }
  assert.equal(row.status,'completed');assert.equal(row.sessionId,task.session.sessionId)
  const stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
  assert.ok(stored.entries.some(e=>e.type==='compaction'&&e.summary.includes(checkpoint)))
  const tools=stored.entries.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&!e.message.isError).map(e=>e.message)
  assert.equal(tools.filter(m=>m.toolName==='write').length,2,'no completed write is replayed')
  assert.ok(tools.some(m=>m.toolName==='read'&&m.content.some(block=>block.text?.includes(proof))))
})

test('comparison: two failed reads through a missing source do not prevent reading independent evidence',{timeout:nativeTestTimeout(20000)},async t=>{
  t=cleanupContext(t)
  let h,step=0;t.after(()=>h?.close())
  const proof='independent-observation-042',calls=[
    {tool:'read',args:{path:'work/unavailable/first.txt'}},
    {tool:'read',args:{path:'work/unavailable/second.txt'}},
    {tool:'read',args:{path:'work/independent.txt'}},
    {tool:'task_result',args:{decision:{action:'complete',summary:'Verified the value from the independent source',evidence:[proof],limitations:[]}}},
  ]
  const f=await memoryHost(t,async body=>{
    if(!requestTools(body).includes('task_result'))return
    const call=calls[step++]
    if(step===1){
      const [task]=await h.store.query({kind:'task.list'})
      await writeFile(join(f.host.ctx.runtimePaths.workspaces,'tasks',task.taskId,'work/independent.txt'),proof)
    }
    return call
  })
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'comparison-independent-source',objective:'Verify the value using the authorized local sources. The first two share one directory; independent.txt is a separate source.'})
  await h.service.whenIdle()
  const done=await h.store.query({kind:'task.get',taskId:task.taskId})
  assert.equal(done.status,'completed',done.lastDecision?.summary);assert.equal(done.drained,true);assert.equal(done.sessionId,task.session.sessionId)
  assert.deepEqual(done.completion.result.evidence,[proof])
  const stored=await f.host.ctx.sessionPersistence.readNative(done.sessionId,{requireComplete:true})
  const tools=stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
  assert.deepEqual(tools.filter(m=>m.toolName==='read').map(m=>m.isError),[true,true,false])
  assert.ok(tools.find(m=>m.toolName==='read'&&!m.isError).content.some(block=>block.text?.includes(proof)))
  assert.equal(step,calls.length)
})

test('comparison: a passed intermediate check is followed by a real final artifact readback',{timeout:nativeTestTimeout(20000)},async t=>{
  t=cleanupContext(t)
  let h,step=0;t.after(()=>h?.close())
  const proof='final-artifact-verified',path='work/final.txt',calls=[
    {tool:'write',args:{path:'work/staging.txt',content:'intermediate-check-passed'}},
    {tool:'read',args:{path:'work/staging.txt'}},
    {tool:'write',args:{path,content:proof}},
    {tool:'read',args:{path}},
    {tool:'task_result',args:{decision:{action:'complete',summary:'Generated and read back final.txt',evidence:[proof],artifacts:[path],limitations:[]}}},
  ]
  const f=await memoryHost(t,body=>{if(requestTools(body).includes('task_result'))return calls[step++]})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'comparison-final-verification',objective:'Check staging, then generate and independently read back the final artifact before submitting.'})
  await h.service.whenIdle()
  const done=await h.store.query({kind:'task.get',taskId:task.taskId})
  assert.equal(done.status,'completed',done.lastDecision?.summary);assert.equal(done.drained,true);assert.equal(done.sessionId,task.session.sessionId)
  assert.equal(await readFile(join(task.session.workspaceDir,path),'utf8'),proof)
  assert.deepEqual(done.completion.result.artifacts,[path])
  const stored=await f.host.ctx.sessionPersistence.readNative(done.sessionId,{requireComplete:true})
  const tools=stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
  assert.deepEqual(tools.slice(0,4).map(m=>[m.toolName,m.isError]),[['write',false],['read',false],['write',false],['read',false]])
  assert.ok(tools[1].content.some(block=>block.text?.includes('intermediate-check-passed')))
  assert.ok(tools[3].content.some(block=>block.text?.includes(proof)))
  assert.equal(step,calls.length)
})

for(const output of ['channel reply','Issue comment','PR review reply'])test(`official task ${output} request carries public communication and execution boundaries`,{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let h;t.after(()=>h?.close())
  let reads=0
  const f=await memoryHost(t,body=>{if(!requestTools(body).includes('task_result'))return;if(reads++===0)return {tool:'communication_guidance_read',args:{}};return result})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'public-communication-prompt',objective:`Draft a ${output} asking the reader to choose one of two display names; do not publish`})
  await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained})
  const request=f.requests.find(body=>requestTools(body).includes('task_result'))
  assert.ok(request,'execution must reach the local provider with task_result')
  const prompt=taskSystemPrompt(request)
  assert.match(prompt,/沟通规范索引/)
  assert.doesNotMatch(prompt,/NIGHT_NATURAL_CHANNEL_REPLY|NIGHT_TASK_PUBLIC_COMMUNICATION|好，我看看是什么原因/)
  const loaded=f.requests.find(body=>body.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('NIGHT_TASK_PUBLIC_COMMUNICATION')))
  assert.ok(loaded,'native tool result reaches the same execution session on demand')
  assertSharedCommunicationGuidance(request,loaded)
  const content=JSON.stringify(loaded.messages.filter(message=>message.role==='tool'))
  assert.match(content,/Issue\/PR 描述和评论、代码审查回复/)
  assert.match(content,/写草稿不等于获准发送/)
  assert.match(content,/未知提交结果先回读原效果/)
  assert.match(prompt,/Do not rely on the Router to direct the investigation or decide when to stop/)
  const tool=request.tools.find(tool=>tool.function.name==='task_result').function
  assert.equal(tool.parameters.properties.decision.properties.question,undefined)
  assert.equal(tool.parameters.properties.decision.properties.audience,undefined)
})
test('execution principles refresh within the same official task without restart',{timeout:nativeTestTimeout(30000)},async t=>{
  t=cleanupContext(t)
  let h,settings,first;t.after(()=>h?.close())
  const requests=[]
  const f=await memoryHost(t,async body=>{
    if(!requestTools(body).includes('task_result'))return
    requests.push(body)
    if(requests.length!==1)return result
    await settings.saveExecutionPrinciples({text:'EXECUTION_PRINCIPLES_UPDATED',expectedVersion:first.version})
    return {tool:'read',args:{path:'work/absent-proof.txt'}}
  })
  settings=f.host.ctx.get('operatorSettings')
  first=await settings.saveExecutionPrinciples({text:'EXECUTION_PRINCIPLES_INITIAL',expectedVersion:(await settings.executionPrinciples()).version})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'principles-refresh',objective:'Read isolated proof'})
  await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained})
  const system=request=>JSON.stringify(request.messages.filter(message=>['system','developer'].includes(message.role)))
  assert.equal(requests.length,2)
  assert.match(system(requests[0]),/EXECUTION_PRINCIPLES_INITIAL/)
  assert.match(system(requests[1]),/EXECUTION_PRINCIPLES_UPDATED/)
  for(const request of requests)assert.match(system(request),/沟通规范索引/)
  assert.doesNotMatch(system(requests[1]),/EXECUTION_PRINCIPLES_INITIAL/)
})
test('single task cancellation aborts the active turn, drains it and never creates a replacement execution',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let h;t.after(()=>h?.close())
  const entered=Promise.withResolvers(),release=Promise.withResolvers()
  const f=await memoryHost(t,async body=>{if(body.tools?.some(t=>t.function.name==='task_result')){entered.resolve();await release.promise;return result}})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'cancel-live',objective:'Wait for the local fixture'})
  await entered.promise;const cancelling=h.service.cancelTask({taskId:task.taskId,requestId:'cancel-1'});release.resolve();await cancelling
  const row=await h.store.query({kind:'task.get',taskId:task.taskId});assert.equal(row.status,'cancelled');assert.equal(row.drained,true)
  await h.service.recover();assert.equal((await h.store.query({kind:'execution.list'})).length,0);assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,1)
})

test('chat and chat-room task creation binds the correct memory scope without creating a coordinator',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let h;t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
    if(requestTools(body).includes('task_result'))return result
    if(requestTools(body).includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      return body.messages.at(-1)?.role==='tool'?{text:'本批任务事件已可靠结清'}:{tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'scope-settle:'+input.events.map(event=>event.id).join(',')}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'按当前会话与事项账本继续，不创建协调任务',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  });h=await serviceFor(f)
  for(const type of ['chat','chat-room']){
    const task=await h.service.createTask({requestId:'scope-'+type,objective:'Return the literal word verified',channel:{type,channelId:'local-adapter',conversationId:'conversation',senderId:'person',messageId:'request-'+type,text:'Return the literal word verified'}})
    const row=await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained&&row})
    const binding=f.host.ctx.memory.bindings.get(row.sessionId);assert.equal(!!binding.groupId,type==='chat-room');assert.equal(row.metadata.channelType,type);assert.equal(row.metadata.senderId,'person')
    assert.equal((await h.store.query({kind:'execution.list',taskId:row.taskId})).length,0)
  }
  await h.service.whenIdle()
  assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,2)
})

test('single-task delivery freezes only explicitly reported workspace files and rejects escapes',async t=>{
  const {mkdir,writeFile}=await import('node:fs/promises'),{freezeSingleTaskFiles}=await import('../src/tasks/delivery.js'),{createTaskArtifactFiles}=await import('../packages/dingtalk-core/task-artifact-files.js')
  const root=await mkdtemp(join(tmpdir(),'night-single-files-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'task');await mkdir(directory)
  await writeFile(join(directory,'proof.txt'),'immutable proof');await writeFile(join(root,'outside.txt'),'outside');await symlink(root,join(directory,'alias'),'dir')
  const files=createTaskArtifactFiles({root:join(root,'managed')}),task={taskId:'single-files',sessionId:'sole-session',requirementRevision:1},base={task,directory,files}
  await assert.rejects(freezeSingleTaskFiles({...base,reported:[],selected:[{path:'proof.txt'}]}),/NOT_REPORTED/)
  await assert.rejects(freezeSingleTaskFiles({...base,reported:['../outside.txt'],selected:[{path:'../outside.txt'}]}),/OUTSIDE_TASK/)
  await assert.rejects(freezeSingleTaskFiles({...base,reported:['alias/outside.txt'],selected:[{path:'alias/outside.txt'}]}),/SCOPE_DENIED/)
  const [frozen]=await freezeSingleTaskFiles({...base,reported:['proof.txt'],selected:[{path:'proof.txt'}]});await writeFile(join(directory,'proof.txt'),'changed later');assert.equal(await readFile((await files.resolve(frozen.artifact)).path,'utf8'),'immutable proof')
})

test('an uncertain default task effect releases its physically drained actor and writer while keeping reconciliation held',{timeout:nativeTestTimeout(15000)},async()=>{
  let effects=0
  const cleanups=[],f=await memoryHost({after:fn=>cleanups.push(fn)},body=>{if(body.tools?.some(tool=>tool.function.name==='fault_after_write'))return effects?{text:'The original effect is unverified.'}:{tool:'fault_after_write',args:{}}})
  const ctx=f.host.ctx;let h,task
  ctx.get('tools').register({name:'fault_after_write',description:'Local fixture effect with an uncertain response.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){
    effects++;await writeFile(join(exec.agent.metadata.cwd,'work','uncertain.txt'),'effect happened before response failed');throw Error('local effect response failed')
  }})
  try{
    h=await serviceFor(f)
    task=await h.service.createTask({requestId:'uncertain-effect',objective:'Record the local proof once'})
    await until(async()=>!!(await h.service.taskDialogue(task.taskId)).error)
    await h.service.whenIdle()
    const row=await h.store.query({kind:'task.get',taskId:task.taskId}),dialogue=await h.service.taskDialogue(task.taskId),stored=await ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
    assert.equal(await readFile(join(stored.header.cwd,'work','uncertain.txt'),'utf8'),'effect happened before response failed')
    assert.equal(effects,1);assert.equal(f.requests.length,2)
    assert.equal(row.drained,true,JSON.stringify({error:dialogue.error,actorLive:!!ctx.agents.get(row.sessionId),writerLive:!!ctx.piAuthority.describe(row.sessionId)}))
    assert.equal(ctx.agents.get(row.sessionId),undefined);assert.equal(ctx.piAuthority.describe(row.sessionId),undefined)
    await assert.rejects(stat(ctx.sessionPersistence.path(row.sessionId)+'.lock'),{code:'ENOENT'})
    assert.equal(dialogue.error,'TASK_EFFECT_UNCERTAIN_NO_REPLAY')
    assert.equal(row.lastDecision.action,'blocked');assert.ok(row.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'))
    assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,1)
    assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-result').length,0)
    await h.service.recover();await h.service.whenIdle()
    assert.equal(effects,1);assert.equal(f.requests.length,2)
  }finally{
    const id=task?.session?.sessionId
    await closeAll([()=>id?ctx.agents.get(id)?.dispose():undefined,()=>h?.close(),...cleanups.reverse()])
  }
})

test('a task rejects forged archive output and can still submit a legitimate work artifact',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let step=0,h;t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
    if(!body.tools?.some(tool=>tool.function.name==='task_result'))return
    if(step++===0)return {tool:'write',args:{path:'outputs/forged.txt',content:'forged archive'}}
    if(step===2)return {tool:'write',args:{path:'work/proof.txt',content:'legitimate work'}}
    return {...result,args:{decision:{...result.args.decision,artifacts:['work/proof.txt'],deliveryFiles:[{path:'work/proof.txt'}]}}}
  });h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'archive-forgery-denied',objective:'Return a legitimate work artifact'})
  await h.service.whenIdle()
  const row=await h.store.query({kind:'task.get',taskId:task.taskId}),dialogue=await h.service.taskDialogue(task.taskId)
  assert.equal(row.status,'completed',JSON.stringify({status:row.status,error:dialogue.error,decision:row.lastDecision}))
  assert.match(JSON.stringify(f.requests),/PERMISSION_PRIVATE_PATH_DENIED/)
  await assert.rejects(stat(join(task.session.workspaceDir,'outputs/forged.txt')),{code:'ENOENT'})
  assert.equal(await readFile(join(task.session.workspaceDir,'work/proof.txt'),'utf8'),'legitimate work')
  assert.equal(row.completion.result.artifactFiles.length,1)
})
test('single task native searches stay observational while a real write retains its effect receipts',async t=>{
 t=cleanupContext(t);let h,step=0;t.after(()=>h?.close())
 const calls=[{tool:'find',args:{pattern:'missing.txt'}},{tool:'write',args:{path:'work/search-proof.txt',content:'search-proof'}},{tool:'find',args:{pattern:'work/*.txt'}},...(process.platform==='win32'?[{tool:'grep',args:{pattern:'proof',path:'work'}}]:[]),{tool:'read',args:{path:'work/search-proof.txt'}},result]
 const f=await memoryHost(t,body=>requestTools(body).includes('task_result')?calls[step++]:{text:'{"lessons":[]}'})
 h=await serviceFor(f);const created=await h.service.createTask({requestId:'native-search-effects',objective:'Discover local files, observe any search refusal, then create and read back the bounded proof'})
 await h.service.whenIdle();const row=await h.store.query({kind:'task.get',taskId:created.taskId});assert.equal(row.status,'completed',JSON.stringify({status:row.status,drained:row.drained,step,decision:row.lastDecision,error:(await h.service.taskDialogue(row.taskId)).error,modelRequests:f.requests.length}));assert.equal(row.drained,true)
 const stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),effects=stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent')
 assert.deepEqual(effects.map(r=>r.payload.name),['write']);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1);assert.equal((await readTaskEffectScope(f.host.ctx,row,stored)).groupId,null)
 assert.equal(await readFile(join(stored.header.cwd,'work/search-proof.txt'),'utf8'),'search-proof')
 if(process.platform==='win32'){assert.match(JSON.stringify(f.requests),/MEMORY_PROCESS_PRIVACY_UNAVAILABLE/);assert.doesNotMatch(JSON.stringify(f.requests),/TASK_EFFECT_UNCERTAIN_NO_REPLAY/)}
})
test('a pre-write Pi edit error preserves its original result, accepts a corrected call and stays settled across cold continuation',{timeout:nativeTestTimeout(20000)},async t=>{
 t=cleanupContext(t);let h,task,step=0;t.after(()=>h?.close())
 const original='first = str(row[0])\nsecond = str(row[0])\n',corrected='first = str(row[1])\nsecond = str(row[0])\n'
 const calls=[{tool:'write',args:{path:'work/check.txt',content:original}},{tool:'read',args:{path:'work/check.txt'}},{tool:'edit',args:{path:'work/check.txt',edits:[{oldText:'str(row[0])',newText:'str(row[1])'}]}},{tool:'read',args:{path:'work/check.txt'}},{tool:'edit',args:{path:'work/check.txt',edits:[{oldText:'first = str(row[0])',newText:'first = str(row[1])'}]}},{tool:'task_result',args:{decision:{action:'wait',summary:'Corrected the ambiguous edit; wait for an explicit continuation',evidence:['read back original text and applied a unique edit'],limitations:[]}}},{tool:'read',args:{path:'work/check.txt'}},result]
 const f=await memoryHost(t,async body=>{
  if(!requestTools(body).includes('task_result'))return {text:'{"lessons":[]}'}
  if(step===3){assert.match(JSON.stringify(body),/Found 2 occurrences/);assert.doesNotMatch(JSON.stringify(body),/Error: TASK_EFFECT_UNCERTAIN_NO_REPLAY/);assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),original)}
  assert.ok(step<calls.length,'the task must finish without replaying an invocation');return calls[step++]
 })
 h=await serviceFor(f);task=await h.service.createTask({requestId:'ambiguous-edit',objective:'Correct one specific line, then wait for an explicit continuation'})
 await h.service.whenIdle();const paused=await h.store.query({kind:'task.get',taskId:task.taskId})
 assert.equal(paused.lastDecision.action,'wait');assert.deepEqual(paused.lastDecision.limitations,[]);assert.equal(paused.drained,true);assert.equal(step,6)
 assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),corrected)
 const before=await f.host.ctx.sessionPersistence.readNative(paused.sessionId,{requireComplete:true}),intent=before.auditEntries.find(row=>row.data.domain==='task'&&row.data.kind==='effect-intent'&&row.data.payload.name==='edit')
 const failed=before.entries.find(row=>row.type==='message'&&row.message.role==='toolResult'&&row.message.toolCallId===intent.data.payload.callId).message
 assert.equal(failed.isError,true);assert.match(failed.content[0].text,/Found 2 occurrences/)
 assert.deepEqual(before.audit.find(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.key===intent.data.payload.key).payload,{key:intent.data.payload.key,isError:true,effect:'not-started'})
 await assert.rejects(h.service.inspectTaskEffect({taskId:task.taskId,intentEntryId:intent.entryId}),{code:'TASK_EFFECT_ALREADY_SETTLED'})
 await h.close();await f.close();await f.boot();h=await serviceFor(f,false)
 await h.service.recover();await h.service.whenIdle();assert.equal(step,6,'cold recovery must not replay a failed edit')
 await h.store.command({id:'explicit-edit-continuation',kind:'task.wake',args:{taskId:task.taskId,kind:'operator.continue',payload:{requestId:'read-corrected-file'}}});await h.service.recover();await h.service.whenIdle()
 const done=await h.store.query({kind:'task.get',taskId:task.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(paused.sessionId,{requireComplete:true})
 assert.equal(done.status,'completed',JSON.stringify(done.lastDecision));assert.equal(done.sessionId,paused.sessionId);assert.equal(done.drained,true);assert.equal(step,8)
 assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),corrected)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,3)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.isError===false).length,2)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.effect==='not-started').length,1)
})
test('unobserved and stale native write rejections settle without replay across cold task continuation',{timeout:nativeTestTimeout(25000)},async t=>{
 t=cleanupContext(t);let h,task,step=0;t.after(()=>h?.close())
 const path='work/native-write.txt',calls=[{tool:'read',args:{path}},{tool:'write',args:{path,content:'unobserved replacement'}},{tool:'read',args:{path}},{tool:'write',args:{path,content:'stale replacement'}},{tool:'read',args:{path}},{tool:'write',args:{path,content:'corrected after current read'}},{tool:'task_result',args:{decision:{action:'wait',summary:'Both native guard failures were corrected',evidence:['read and version checked the retained file'],limitations:[]}}},{tool:'read',args:{path}},result]
 const f=await memoryHost(t,async body=>{
  if(!requestTools(body).includes('task_result'))return {text:'{"lessons":[]}'}
  if(step===1)await writeFile(join(task.session.workspaceDir,path),'created by another operation')
  if(step===2){assert.match(JSON.stringify(body),/Cannot overwrite an unobserved file/);assert.equal(await readFile(join(task.session.workspaceDir,path),'utf8'),'created by another operation')}
  if(step===3)await writeFile(join(task.session.workspaceDir,path),'changed after the tool read')
  if(step===4){assert.match(JSON.stringify(body),/File changed since its observation/);assert.equal(await readFile(join(task.session.workspaceDir,path),'utf8'),'changed after the tool read')}
  assert.doesNotMatch(JSON.stringify(body),/Error: TASK_EFFECT_UNCERTAIN_NO_REPLAY/)
  assert.ok(step<calls.length,'independent correction, never replay');return calls[step++]
 })
 h=await serviceFor(f);task=await h.service.createTask({requestId:'native-write-guards',objective:'Correct native file write admission failures without losing the original results'})
 await h.service.whenIdle();const paused=await h.store.query({kind:'task.get',taskId:task.taskId})
 assert.equal(paused.lastDecision.action,'wait',JSON.stringify(paused.lastDecision));assert.deepEqual(paused.lastDecision.limitations,[]);assert.equal(step,7);assert.equal(paused.drained,true)
 const stored=await f.host.ctx.sessionPersistence.readNative(paused.sessionId,{requireComplete:true})
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.effect==='not-started').length,2)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.isError===false).length,1)
 assert.equal(await readFile(join(task.session.workspaceDir,path),'utf8'),'corrected after current read')
 await h.close();await f.close();await f.boot();h=await serviceFor(f,false);await h.service.recover();await h.service.whenIdle();assert.equal(step,7)
 await h.store.command({id:'native-write-independent-continuation',kind:'task.wake',args:{taskId:task.taskId,kind:'operator.continue',payload:{requestId:'read-corrected-native-write'}}});await h.service.recover();await h.service.whenIdle()
 const done=await h.store.query({kind:'task.get',taskId:task.taskId});assert.equal(done.status,'completed');assert.equal(done.sessionId,paused.sessionId);assert.equal(step,9)
})
test('Router room unknown effect drains and inspects with distinct conversation and memory groups',async t=>{
 let f,effects=0
 f=await residentRouterHost(t,async body=>{
  const names=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
  if(names.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Perform the explicitly requested bounded local action'}))}}
  const handoff=requestEnvelope(body,'Router 交接请求：')
  if(!names.length&&handoff)return {text:JSON.stringify({currentIntent:'Retain authorized task evidence',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(names.includes('task_result'))return effects?{text:'The original effect is unverified.'}:{tool:'room_partial_effect',args:{}}
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),task=await f.query('task.get',{taskId:'room-effect-scope'})
   if(!task){const source=(await f.query('source.list')).find(source=>source.messageId==='scope-request');return {tool:'resident_task_plan',args:{operationId:'scope-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'room-effect-scope',handoff:'Perform the single local action requested for this conversation.',title:'Bounded room effect',objective:'Perform one local action without replay',requirements:[]}],dependencies:[]}}}
   if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Current batch settled'}
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'scope-settle:'+input.events.map(event=>event.id).join(',')}}
  }
 })
 f.host.ctx.tools.register({name:'room_partial_effect',description:'Write one isolated proof then lose its response',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/unknown.txt'),'one bounded partial effect');throw Error('response lost after local write')}})
 const settings=f.host.ctx.get('operatorSettings')
 await settings.saveExecutionPrinciples({text:'EXECUTION_ROOM_SCOPE_MARKER',expectedVersion:(await settings.executionPrinciples()).version})
 await f.receive(channelMessage('scope-request',{text:'Perform the bounded local scope verification'}))
 const row=await eventually(async()=>{const row=await f.query('task.get',{taskId:'room-effect-scope'});return row?.drained&&row.lastDecision?.limitations?.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY')&&row},'room unknown effect drain')
 await f.service.whenIdle();const stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(e=>e.data.domain==='task'&&e.data.kind==='effect-intent')
 for(const [tool,loaded] of [['resident_router_settle',false],['task_result',true]]){
  const requests=f.requests.filter(body=>requestTools(body).includes(tool));assert.ok(requests.length,tool)
  for(const request of requests)assert.equal(JSON.stringify(request.messages).includes('EXECUTION_ROOM_SCOPE_MARKER'),loaded,tool)
 }
 const binding=f.host.ctx.memory.bindings.get(row.sessionId);assert.equal(binding.actorId,row.ownerActorId);assert.equal(binding.groupId,row.metadata.memoryGroupId);assert.notEqual(binding.groupId,row.groupId)
 assert.equal(effects,1);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='owner-drained').length,1)
 const inspection=await f.service.inspectTaskEffect({taskId:row.taskId,intentEntryId:intent.entryId});assert.equal(inspection.scope.groupId,row.groupId)
 await assert.rejects(readTaskEffectScope(f.host.ctx,{...row,ownerActorId:'foreign-owner'},stored),{code:'TASK_EFFECT_MEMORY_SCOPE_MISMATCH'})
 await assert.rejects(readTaskEffectScope(f.host.ctx,{...row,metadata:{...row.metadata,memoryGroupId:'foreign-memory'}},stored),{code:'TASK_EFFECT_MEMORY_SCOPE_MISMATCH'})
 const count=f.requests.length;await f.service.recover();await f.service.whenIdle();assert.equal(effects,1);assert.equal(f.requests.length,count)
 t.diagnostic(JSON.stringify({case:'router-room-effect-scope',taskId:row.taskId,drained:row.drained,distinctMemoryGroup:true,ownerDrained:1,inspectSucceeded:true,effects}))
})
