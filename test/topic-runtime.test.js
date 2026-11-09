import {pendingBusinessInputs,officialBusinessProjection,visibleBusinessInputs} from '../src/runtime/pi-business-inputs.js'
import {visibilityFixture,visibilityAgent,appendVisible,compactVisible,restoreVisibility} from './fixtures/pi-coordination-visibility.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import {nativeResidentSnapshot} from './fixtures/native-domain-snapshot.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {boundedTopicContext,projectTopicContext,topicHistoryPage,resolveRouteBatch} from '../packages/dingtalk-core/topic-model.js'
import {visiblePromptRefs,visibleSectionLength,compactSectionValue} from '../packages/dingtalk-core/coordination-context.js'

async function historyFixture(t) {
  const storage=await nativeResidentSnapshot(),store=await openResidentStore(storage.domains)
  await store.subscribe({groupId:'g'})
  t.after(async()=>{await store.close();await storage.close()})
  const add=async(messageId,text,topicId)=>{
    await store.ingest({groupId:'g',messageId,text,senderOpenDingTalkId:'od-a',occurredAt:'2026-09-07T00:00:00Z'})
    const result=await store.routeMessages({groupId:'g',routeId:'history-'+messageId,routingRevision:store.getGroup('g').routingRevision,routes:[{messageId,messageVersion:1,topics:[topicId?{topicId}:{newTopicKey:'history',title:'导出核验'}]}]})
    return topicId??result.topicIdsByKey.history
  }
  return {store,add}
}

function visibleTool(session, name, result) {
  const id = `call-${session.manager.getEntries().length}`
  appendVisible(session,{role:'assistant',content:[{type:'toolCall',id,name,arguments:{}}]})
  appendVisible(session,{role:'toolResult',toolCallId:id,toolName:name,isError:false,content:[{type:'text',text:JSON.stringify(result)}]})
}

function compactSurface(session) { compactVisible(session) }

test('Topic 固定版本投影在摘要缺失时仍是无损 JSON', () => {
  const projected = projectTopicContext({
    groupId: 'g', topicId: 'topic-a', revision: 1, messages: [{ messageId: 'm', quotedMessage: undefined, imageRefs: [{ id: 'a', optional: undefined }] }], total: 1, offset: 0, limit: 50, taskRefs: [],
    topic: { topicId: 'topic-a', title: 'A', revision: 1, processedRevision: 0, status: 'active', summary: undefined, summaryRevision: 0, openQuestions: [], decisions: [] },
  })
  assert.equal('summary' in projected.topic, false)
  assert.equal('quotedMessage' in projected.messages[0], false)
  assert.equal('optional' in projected.messages[0].imageRefs[0], false)
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), projected)
})

test('历史超长单消息按连续UTF-16片段完整读回且保持40k预算',async t=>{
 const {store,add}=await historyFixture(t),original='长😀'.repeat(30000)
 const topicId=await add('long-message',original)
 let offset=0,textOffset=0,restored='',calls=0
 do{
  const context=store.getTopicContext({groupId:'g',topicId,revision:1,offset,limit:10})
  const page=boundedTopicContext(context,{textOffset})
  assert.ok(JSON.stringify(page).length<=40000)
  assert.equal(page.messages[0].textOffset??0,textOffset)
  restored+=page.messages[0].text;calls++
  assert.ok(page.nextOffset>offset||(page.nextTextOffset??0)>textOffset)
  offset=page.nextOffset;textOffset=page.nextTextOffset??0
 }while(offset<1)
 assert.ok(calls>=3);assert.equal(restored,original)
})

test('话题上下文剩余预算连一个字符也装不下时保留已装入消息', () => {
  const first = { messageId: 'first', unitId: 'unit-first', unitRevision: 1, text: '已读消息' }
  const second = { messageId: 'second', unitId: 'unit-second', unitRevision: 1, text: '后续消息' }
  const context = { topic: {}, messages: [first, second], offset: 0, total: 2, taskRefs: [] }
  const budget = JSON.stringify(boundedTopicContext({ ...context, messages: [first] })).length
  const result = boundedTopicContext(context, { maxChars: budget })
  assert.deepEqual(result.messages.map(message => message.messageId), ['first'])
  assert.equal(result.nextOffset, 1)
  assert.equal(result.nextTextOffset, undefined)
  assert.equal(result.hasMoreMessages, true)
  assert.ok(JSON.stringify(result).length <= budget)
})

test('历史Topic搜索分页及固定版本读回，跨群与越界拒绝',async t=>{
 const {store,add}=await historyFixture(t),topicId=await add('a','@助理 a')
 await add('b','@助理 b',topicId)
 const list=args=>topicHistoryPage(store.listTopics('g'),args)
 const context=args=>boundedTopicContext(store.getTopicContext({groupId:'g',topicId,...args}),{textOffset:args?.textOffset??0})
 assert.equal(list({}).limit,50);assert.equal(list({limit:100}).limit,100)
 assert.equal(context({}).limit,100);assert.equal(context({limit:500}).limit,500)
 for(const limit of [0,101,10000])assert.throws(()=>list({limit}),/topic_page_invalid/)
 for(const limit of [0,501,10000])assert.throws(()=>context({limit}),/topic_page_invalid/)
 for(const revision of [0,3])assert.throws(()=>context({revision}),/topic_revision_invalid/)
 for(const textOffset of [-1,10000])assert.throws(()=>context({textOffset}),/topic_text_offset_invalid/)
 assert.throws(()=>context({offset:-1}),/topic_page_invalid/)
 const index=list({query:'导出',offset:0,limit:1})
 assert.equal(index.total,1);assert.equal(index.topics[0].topicId,topicId)
 const page=context({revision:1,offset:0,limit:1})
 assert.equal(page.total,1);assert.equal(page.messages[0].messageId,'a')
 assert.throws(()=>store.getTopicContext({groupId:'foreign',topicId,revision:1}),/topic_not_found/)
 assert.throws(()=>list({offset:-1}),/topic_page_invalid/)
})

test('取消控制可越过已阻塞保留，普通上下文和进行中保留仍拒绝', async t => {
  const h = await historyFixture(t), topicId = await h.add('a1', '@助理 a1')
  await h.store.acceptTopicDecision({ groupId: 'g', topicId, revision: 1, decisionId: 'history-task-ready', decision: { actions: [], reason: '历史任务材料已冻结' } })
  await h.store.completeTopicDecision({ groupId: 'g', topicId, decisionId: 'history-task-ready' })
  const { task } = await h.store.createTask({ groupId: 'g', topicRefs: [{ topicId, revision: 1 }], title: '核验 A', objective: '核验 A', acceptanceCriteria: ['结果有证据'] })
  const cancel = { kind: 'task-cancel', taskId: task.taskId, inputVersion: task.inputVersion, runSequence: task.runSequence, reason: '明确撤销' }
  const first = await h.store.submitWebTaskInput({ groupId: 'g', requestId: 'cancel-first', text: '停止任务', action: cancel })
  assert.equal(first.status, 'accepted')
  assert.equal((await h.store.submitWebTaskInput({ groupId: 'g', requestId: 'cancel-busy', text: '停止任务', action: cancel })).status, 'task-busy')
  await h.store.updateTopicDecision({ groupId: 'g', topicId: first.topicId, decisionId: first.record.decisionId, patch: { status: 'blocked' } })
  assert.equal((await h.store.submitWebTaskInput({ groupId: 'g', requestId: 'context-busy', text: '继续核验', action: { ...cancel, kind: 'task-context', context: '继续核验' } })).status, 'task-busy')
  const next = await h.store.submitWebTaskInput({ groupId: 'g', requestId: 'cancel-again', text: '明确停止', action: cancel })
  assert.equal(next.status, 'accepted')
  assert.equal(h.store.getTopic('g', first.topicId).decisions[0].status, 'blocked')
  assert.equal(h.store.getGroup('g').taskReservations.filter(item => item.taskId === task.taskId).length, 2)
})

test('原生 surface 流程正文与连续页跨请求复用，压缩后历史日志不能冒充可见', async t => {
  const session = await visibilityFixture(t), agent = visibilityAgent(session)
  const prompt = { id: 'release', revision: 1, name: '发布', description: '发布校验', prompt: '核对批准原文' }
  visibleTool(session, 'pwsh', { prompts: [prompt] })
  assert.deepEqual(visiblePromptRefs(agent, [prompt]), [])
  visibleTool(session, 'group_task_prompt_get', { prompts: [prompt] })
  assert.deepEqual(visiblePromptRefs(agent, [prompt]), [{ id: 'release', revision: 1 }])
  assert.deepEqual(visiblePromptRefs(agent, [{ ...prompt, revision: 2 }]), [])
  const text = '当前完整证据原文'
  visibleTool(session, 'group_task_review_context_get', { requestId: 'old', section: 'messages', offset: 4, nextOffset: text.length, text: text.slice(4) })
  assert.equal(visibleSectionLength(agent, text), 0)
  visibleTool(session, 'group_task_review_context_get', { requestId: 'old', section: 'messages', offset: 0, nextOffset: 4, text: text.slice(0, 4) })
  assert.equal(visibleSectionLength(agent, text), text.length)
  const reopened = await restoreVisibility(session,t)
  assert.equal(visiblePromptRefs(visibilityAgent(reopened), [prompt]).length, 1)
  compactSurface(reopened)
  assert.ok(reopened.manager.getEntries().some(entry=>entry.type==='message'&&entry.message.role==='toolResult'))
  assert.deepEqual(visiblePromptRefs(visibilityAgent(reopened), [prompt]), [])
  assert.equal(visibleSectionLength(visibilityAgent(reopened), text), 0)
})

test('官方 Pi 未接纳原文与恢复提示保留一份，SDK入站后仅修复提交收据', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-pending-input-'))
  let native, handle
  t.after(async () => { try { await handle?.dispose(); await native?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  native = await nativeRuntimeHost(root, async () => { throw new Error('parked official input must not start inference') }, { resident: true })
  handle = await native.ctx.agents.create({ sessionId: 'session-pending-body', meta: { cwd: native.ctx.runtimePaths.workspaces, agentPreset: 'night-bot' }, authorizeInput: packet => packet.source.kind === 'test-input' && packet.source.principal === 'authorized-fixture' })
  const actor = handle.actor
  assert.equal(actor.session, undefined); assert.equal(actor.inbox, undefined)
  const packets = [
    { id: 'pending-original', source: { kind: 'test-input', principal: 'authorized-fixture' }, content: [{ type: 'text', text: 'PENDING_ORIGINAL_BODY' }] },
    { id: 'pending-reminder', source: { kind: 'test-input', principal: 'authorized-fixture' }, content: [{ type: 'text', text: 'PENDING_RECOVERY_NOTICE' }] },
  ]
  for (const packet of packets) await handle.enqueue(packet)
  assert.equal((await handle.enqueue(packets[0])).duplicate, true)
  const stored = await native.ctx.sessionPersistence.readNative(actor.id, { requireComplete: true }), inputs = actor.admission.pending().map(id => actor.admission.lookupPacket(id))
  assert.equal(inputs.length, 2)
  for (const packet of packets) assert.equal(inputs.filter(entry => entry.id === packet.id && entry.content[0].text === packet.content[0].text).length, 1)
  assert.equal(stored.audit.filter(row => row.domain === 'admission' && row.kind === 'admitted').length, 0)
  assert.equal(stored.entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'night.business-input').length, 0)
  assert.deepEqual(stored.audit.filter(row => row.domain === 'admission' && row.kind === 'enqueued').map(row => row.payload.id), packets.map(packet => packet.id))
  assert.equal(native.requests.length, 0, '未接纳的原文和提示不得触发模型回合')
  assert.throws(() => pendingBusinessInputs({ ...actor }), { code: 'BUSINESS_INPUT_ACTOR_NOT_LIVE' })
  for (const packet of inputs) await actor.piSession.sendCustomMessage({ customType: 'night.business-input', content: packet.content, display: false, details: { packetId: packet.id, source: packet.source } }, { triggerTurn: false })
  await handle.deliver(inputs[0].id)
  assert.deepEqual(pendingBusinessInputs(actor), [], '只有已提交的Pi入站才能清除业务pending')
  const admitted = await native.ctx.sessionPersistence.readNative(actor.id, { requireComplete: true }), official = admitted.entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'night.business-input')
  assert.equal(official.length, 2)
  for (const packet of packets) assert.equal(official.filter(entry => entry.details.packetId === packet.id && entry.content[0].text === packet.content[0].text).length, 1)
  assert.deepEqual(admitted.audit.filter(row => row.domain === 'admission' && row.kind === 'admitted').map(row => row.payload.id), packets.map(packet => packet.id))
  assert.equal(native.requests.length, 0)
})

test('同请求材料只保留一份正文，跨请求或内容变化不复用', () => {
  const text = '需要完整保留的授权及业务要求'.repeat(20)
  const request = { requestId: 'r1' }
  assert.equal(compactSectionValue(request, 'objective', text), text)
  const value = compactSectionValue(request, 'value', { objective: text, reason: '当前报告' })
  assert.deepEqual(value.objective.materialRef.path, [])
  assert.equal(value.objective.materialRef.section, 'objective')
  assert.equal(value.objective.materialRef.requestId, 'r1')
  assert.equal(compactSectionValue({ requestId: 'r2' }, 'value', text), text)
  assert.equal(compactSectionValue(request, 'updated', text + '撤销授权'), text + '撤销授权')
})

test('结构校验一次返回全部引用歧义及字段位置，整批零副作用',async t=>{
 const {store}=await historyFixture(t)
 await store.ingest({groupId:'g',messageId:'multiple-errors',text:'甲 甲 乙 乙',senderOpenDingTalkId:'od-a',occurredAt:'2026-09-07T00:00:00Z'})
 const input={groupId:'g',routeId:'multiple-errors',routes:[{messageId:'multiple-errors',messageVersion:1,units:[{
  unitKey:'a',summary:'两处重复引用',sourceRefs:[{quote:'甲'}],contextRefs:[{quote:'乙',purpose:'共享要求'}],topics:[{newTopicKey:'a',title:'不能写入'}]
 }]}]}
 const before=structuredClone(store.getGroup('g'))
 const check=error=>{
  assert.ok(error.issues.some(issue=>issue.field==='routes.0.units.0.sourceRefs.0'&&issue.candidates.length===2))
  assert.ok(error.issues.some(issue=>issue.field==='routes.0.units.0.contextRefs.0'&&issue.candidates.length===2))
  return true
 }
 assert.throws(()=>resolveRouteBatch(before,input),check)
 await assert.rejects(store.routeMessages({...input,routingRevision:before.routingRevision}),check)
 assert.deepEqual(store.getGroup('g'),before);assert.equal(store.listTasks().length,0)
})

test('遗漏范围按 UTF-16 保留 emoji 和多个独立事项的原文',async t=>{
 const {store}=await historyFixture(t),text='你好😀 第一事项 第二事项'
 await store.ingest({groupId:'g',messageId:'uncovered-emoji',text,senderOpenDingTalkId:'od-a',occurredAt:'2026-09-07T00:00:00Z'})
 const before=structuredClone(store.getGroup('g'))
 const input={groupId:'g',routeId:'uncovered-emoji',routes:[{messageId:'uncovered-emoji',messageVersion:1,units:[],ignoredRefs:[{quote:'你好',reason:'问候'}]}]}
 const check=error=>{
  const issue=error.issues.find(item=>item.code==='topic_route_uncovered_text')
  assert.deepEqual(issue?.uncoveredRanges,[{start:2,end:4,quote:'😀'},{start:5,end:9,quote:'第一事项'},{start:10,end:14,quote:'第二事项'}])
  return true
 }
 assert.throws(()=>resolveRouteBatch(before,input),check)
 await assert.rejects(store.routeMessages({...input,routingRevision:before.routingRevision}),check)
 assert.deepEqual(store.getGroup('g'),before);assert.equal(store.getGroup('g').topics.length,0)
})

test('historical presentation folds omitted fields and explicit clears across revisions',async t=>{
 const {store,add}=await historyFixture(t),topicId=await add('history-first','First source')
 const finish=async(revision,topicUpdate)=>{
  const decisionId='history-decision-'+revision
  await store.acceptTopicDecision({groupId:'g',topicId,revision,decisionId,decision:{actions:[],reason:'Historical audit',topicUpdate}})
  await store.completeTopicDecision({groupId:'g',topicId,decisionId})
 }
 await finish(1,{summary:'First factual summary',openQuestions:['Pending evidence']})
 await add('history-second','Second source',topicId);await finish(2,{status:'active'})
 await add('history-third','Third source',topicId);await finish(3,{summary:'New factual summary',openQuestions:[]})
 const historical=store.getTopicContext({groupId:'g',topicId,revision:2})
 assert.equal(historical.topic.summary,'First factual summary')
 assert.deepEqual(historical.topic.openQuestions,['Pending evidence'])
 assert.deepEqual(store.getTopic('g',topicId).openQuestions,[])
})

test('Pi writer failure blocks official business visibility instead of skipping gates',async t=>{
 const failure=new Error('PI_SESSION_WRITER_REQUIRED:topic-fixture'),visibility=await visibilityFixture(t)
 appendVisible(visibility,{id:'writer-lost',role:'user',source:{kind:'user'},content:[{type:'text',text:'Exact authorized source'}]})
 assert.equal(visibleBusinessInputs(visibility.actor).length,1)
 t.mock.method(visibility.manager,'buildSessionProjection',()=>{throw failure})
 assert.throws(()=>officialBusinessProjection(visibility.actor),error=>error===failure)
 assert.throws(()=>visibleBusinessInputs(visibility.actor),error=>error===failure)
})
