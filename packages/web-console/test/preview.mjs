// 仅供本地浏览器验收的隔离样例。真实 HTTP/鉴权/SQLite/静态资源由生产插件提供；
// 渠道和任务服务是明确标注的 fixture，不接入真实账号、模型或外部消息系统。
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, relative, isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {createWebConsole} from '../server/plugin.js'
import {openWebLedger} from '../server/ledger.js'
import {digest} from '../server/security.js'

export const FIXTURE_TOKEN = 'night-web-fixture-only-00000000000000000000'
const CHANNEL_ID = 'web-preview'
const SENDER_ID = 'fixture-operator'
const at = minutes => new Date(Date.now() - minutes * 60_000).toISOString()
const pageOf = (items, {offset = 0, limit = 30} = {}, revision = 'fixture-revision-1') => ({items: items.slice(offset, offset + limit), total: items.length, offset, limit, nextOffset: offset + limit < items.length ? offset + limit : null, revision})

function sampleTasks() {
  const samples = [
    ['task-research', '整理本周产品调研', 'running', '对比三个候选方案，整理功能差异和待确认问题。', 8],
    ['task-documents', '检查接口文档与实现的一致性', 'running', '核对已有接口说明，记录需要修订的段落和依据。', 16],
    ['task-schedule', '准备下周的会议安排', 'waiting', '整理会议目标与备选时段，等待确认参会人。', 40],
    ['task-summary', '汇总团队讨论的行动项', 'completed', '从讨论记录中提取行动项、负责人和时间约定。', 90],
    ['task-review', '审阅新版入门说明', 'completed', '检查安装流程是否完整，标记含糊或缺失的步骤。', 140],
    ['task-inventory', '整理资料目录', 'completed', '按主题归纳已有资料，输出便于查找的目录。', 180],
    ...Array.from({length: 17}, (_, i) => [`task-history-${i + 1}`, `历史资料核对 · 第 ${i + 1} 批`, 'completed', '已完成这一批样例资料的整理与核对。', 240 + i * 30]),
  ]
  return samples.map(([taskId, title, state, objective, age]) => ({
    taskId, title, state, objective, controlState: state === 'completed' ? 'completed' : 'active',
    groupId: 'room-product', createdAt: at(Number(age) + 45), updatedAt: at(Number(age)),
    session: {role: 'execution', sessionId: `fixture-pi-${taskId}`, status: state === 'completed' ? 'idle' : state},
    result: state === 'completed' ? {summary: '已整理完成，结果可在执行记录中查看。此数据为本地验收样例。'} : undefined,
    blockers: {executions: [], operations: state === 'waiting' ? [
      {operationId: 'fixture-block', state: 'unknown', definition: {toolName: 'pwsh', input: {private: 'SECRET_OPERATION_INPUT_FIXTURE'}}},
    ] : [], legacy: []},
    timeline: {version: 1, task: {status: state, startedAt: at(Number(age) + 45), events: [
      {kind: 'created', at: at(Number(age) + 45)},
      ...(state === 'completed' ? [{kind: 'completed', at: at(Number(age))}] : []),
    ]}, executions: [{id: `exec-${taskId}`, status: state, milestones: [
      {id: `milestone-${taskId}-1`, at: at(Number(age) + 35), summary: '已确认任务范围，开始检查已有材料'},
      {id: `milestone-${taskId}-2`, at: at(Number(age) + 15), summary: '完成第一轮资料比对，正在整理差异与证据'},
    ], segments: []}], human: {segments: state === 'waiting' ? [{id: `human-${taskId}`, startedAt: at(Number(age)), status: 'waiting-reply', label: '等待确认参会人', description: '请补充参会人名单。'}] : []}},
    notifications: state === 'completed' ? [{id: `delivery-${taskId}`, state: 'delivered', kind: 'completion', createdAt: at(Number(age)), payload: {text: '整理结果已送达。'}}] : [],
  }))
}

// 明确的 official projection 形状样例；真实 Host/Pi 集成另由 host.test.js 验证。
function sampleSession(task) {
  const sessionId = task.session.sessionId
  const projected = [
    {sourceEntry: {id: 'fixture-source', type: 'message', timestamp: at(45)}, messages: [
      {role: 'user', content: [{type: 'text', text: task.objective}]},
    ]},
    {sourceEntry: {id: 'fixture-assistant', type: 'message', timestamp: at(43)}, messages: [
      {role: 'assistant', content: [
        {type: 'text', text: '已开始核对现有资料。先读取材料，再逐项比对来源与结论。'},
        {type: 'thinking', thinking: 'SECRET_THINKING_FIXTURE'},
        {type: 'toolCall', id: 'fixture-read-call', name: 'read', arguments: {path: '/not/browser-safe', token: 'SECRET_ARGUMENT_FIXTURE'}},
      ], stopReason: 'toolUse'},
    ]},
    {sourceEntry: {id: 'fixture-tool-result', type: 'message', timestamp: at(42)}, messages: [
      {role: 'toolResult', toolName: 'read', toolCallId: 'fixture-read-call', content: [{type: 'text', text: '已读取 3 份资料，发现 2 处待确认差异。'}], isError: false},
    ]},
    {sourceEntry: {id: 'fixture-conclusion', type: 'message', timestamp: at(40)}, messages: [
      {role: 'assistant', content: [{type: 'text', text: '资料读取完成。接下来核对差异，保留来源与证据；未确认的问题仍会明确标注。'}], stopReason: 'stop'},
    ]},
  ]
  return {
    header: {id: sessionId},
    audit: [{domain: 'task', kind: 'identity', version: 1, payload: {taskId: task.taskId, sessionId}}],
    entries: [{id: 'fixture-commit-last'}],
    context: {projection: {entries: projected}},
  }
}

export async function startPreview({port = 3080, empty = false, replyDelayMs = 500} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'night-web-browser-fixture-'))
  const paths = {secrets: join(root, 'secrets'), state: join(root, 'state')}
  for (const path of Object.values(paths)) await mkdir(path, {mode: 0o700})
  const credentialDir = join(paths.secrets, 'web-console-' + digest(CHANNEL_ID).slice(0, 16))
  await mkdir(credentialDir, {mode: 0o700})
  await writeFile(join(credentialDir, 'access-token'), FIXTURE_TOKEN + '\n', {mode: 0o600})
  const transports = new Map(), plugins = new Map(), replies = new Set(), received = []
  const rooms = empty ? [] : [
    {groupId: 'room-product', name: '产品协作', updatedAt: at(8)},
    {groupId: 'room-notes', name: '资料整理', updatedAt: at(60)},
    {groupId: 'room-empty', name: '新建讨论组', updatedAt: at(120)},
  ]
  const channels = {
    plugins, transports,
    identity: envelope => ({sessionId: `fixture-${envelope.channelId}-${envelope.conversationId}`}),
    groupContext: id => rooms.some(room => room.groupId === id) ? {channelId: 'dingtalk-work', type: 'chat-room', conversationId: id} : undefined,
    registerTransport(id, value) {if (transports.has(id)) throw Error('duplicate fixture transport'); transports.set(id, value); return () => transports.delete(id)},
    registerPlugin(id, value) {if (plugins.has(id)) throw Error('duplicate fixture plugin'); plugins.set(id, value); return () => plugins.delete(id)},
    async receive(envelope) {
      received.push(envelope)
      const response = delay(replyDelayMs).then(async () => {
        const text = `已收到你的消息：**${envelope.text}**\n\n这是本地隔离验收回复，用于检查消息展示、发送回执和历史恢复。\n\n- 消息经过真实 Web 渠道接口\n- 回复写入独立的 SQLite 交付账本\n- 没有调用真实模型或发送外部消息`
        await transports.get(CHANNEL_ID).send({...envelope, deliveryKey: `fixture-reply-${envelope.messageId}`, replyToMessageId: envelope.messageId, text})
      }).finally(() => replies.delete(response))
      replies.add(response)
      return {accepted: true}
    },
  }
  plugins.set('dingtalk-work', {health: {healthy: true}})
  const tasks = empty ? [] : sampleTasks()
  const snapshots = new Map(tasks.map(task => [task.session.sessionId, sampleSession(task)]))
  const persistence = {async readNative(sessionId, options) {
    if (options?.requireComplete !== true) throw Error('fixture requires complete Pi context')
    if (sessionId === 'fixture-pi-task-schedule') throw Object.assign(Error('fixture commit pending'), {code: 'PI_SESSION_UNCOMMITTED_TAIL'})
    if (sessionId === 'fixture-pi-task-inventory') throw Object.assign(Error('fixture session unavailable'), {code: 'FIXTURE_UNAVAILABLE'})
    const snapshot = snapshots.get(sessionId)
    if (!snapshot) throw Error('unknown fixture session')
    return snapshot
  }}
  const app = {
    config: {channelPlugins: empty ? [] : [
      {type: 'web-console', channelId: CHANNEL_ID, enabled: true},
      {type: 'dingtalk-dws', channelId: 'dingtalk-work', enabled: true, config: {
        dingtalk_profile: 'fixture-corp:fixture-user', dingtalk_conversation_type: 'chat-room',
        dingtalk_group_id: 'fixture-running-room', dingtalk_prompt: `原始渠道职责
保留换行`, dingtalk_writes_authorized: false,
      }},
      {type: 'sample-channel', channelId: '备用渠道', enabled: false},
    ]},
    tasks: {
      async boardTasks(query) {return pageOf(tasks.filter(task => !query.state || task.state === query.state), query)},
      listObserverGroups() {return rooms},
      async taskDetail(id) {return tasks.find(task => task.taskId === id)},
      async taskDialogue(id) {return {taskId: id, sessionId: `fixture-pi-${id}`, writable: false, messages: [
        {id: `${id}-input`, role: 'user', text: tasks.find(task => task.taskId === id)?.objective ?? '请核对这项任务。', createdAt: at(45)},
        {id: `${id}-response`, role: 'assistant', text: 'TASK_DIALOGUE_NOT_EXECUTION：任务对话不能冒充执行上下文。', createdAt: at(42)},
      ]}},
      async taskExecutions(id, query) {return {...pageOf([], query), executions: []}},
      async observerGroupPage(id, query) {
        if (!rooms.some(room => room.groupId === id)) return null
        const items = id === 'room-empty' ? [] : query.collection === 'messages' ? [
          {messageId: `${id}-in-1`, senderName: '团队成员', text: '请把今天讨论的事项整理一下，保留需要进一步确认的问题。', occurredAt: at(30), processingState: 'processed', taskSessionRefs: ['task-summary']},
          {messageId: `${id}-in-2`, senderName: '讨论参与者', text: '我补充一点：调研要区分已经确认的事实和仍待验证的假设。', occurredAt: at(21), processingState: 'processed', taskSessionRefs: ['task-research']},
        ] : [
          {outboundId: `${id}-out-1`, text: '已整理出 3 项行动：\n\n1. 完成候选方案比较。\n2. 核对接口说明。\n3. 确认下周会议参与人。\n\n尚待确认的内容已单独列出。', sentAt: at(25), notificationState: 'delivered', taskIds: ['task-summary']},
          {outboundId: `${id}-out-2`, text: '收到，正在按这个口径整理调研结果。', sendStartedAt: at(20), notificationState: 'unknown', taskIds: ['task-research']},
        ]
        return pageOf(items, query, `${id}-${query.collection}-r1`)
      },
    },
  }
  // 浏览器夹具只模拟已保存配置；真实安装落盘/锁/水位由 Host 集成测试验证。
  const savedRows = structuredClone(app.config.channelPlugins)
  const channelError = code => Object.assign(Error(code), {code})
  const rowFor = channelId => {
    const row = savedRows.find(row => row.type === 'dingtalk-dws' && row.channelId === channelId)
    if (!row) throw channelError('DINGTALK_CHANNEL_NOT_FOUND')
    return row
  }
  const detailFor = row => {
    const config = row.config, conversationType = config.dingtalk_conversation_type
    const prefix = 'dingtalk_' + (conversationType === 'chat-room' ? 'group_' : 'user_')
    const targetKind = Object.hasOwn(config, prefix + 'id') ? 'id' : 'name'
    return {channelId: row.channelId, version: digest(JSON.stringify(row)), name: config.dingtalk_name ?? '',
      prompt: config.dingtalk_prompt ?? '', conversationType, targetKind, target: config[prefix + targetKind], writesAuthorized: config.dingtalk_writes_authorized === true}
  }
  const channelConfiguration = {
    async read() {return structuredClone(savedRows)},
    async getDingtalk(channelId) {return detailFor(rowFor(channelId))},
    async editDingtalk(channelId, input) {
      const row = rowFor(channelId), current = detailFor(row)
      if (input.expectedVersion !== current.version) throw channelError('DINGTALK_CHANNEL_VERSION_CONFLICT')
      const targetChanged = ['conversationType', 'targetKind', 'target'].some(key => input[key] !== current[key])
      if (targetChanged && input.writesAuthorized === true) throw channelError('DINGTALK_CHANNEL_REQUEST_INVALID')
      const fields = {name: input.name.trim(), prompt: input.prompt, conversationType: input.conversationType,
        targetKind: input.targetKind, target: input.target.trim(), writesAuthorized: targetChanged ? false : input.writesAuthorized ?? current.writesAuthorized}
      if (Object.entries(fields).every(([key, value]) => current[key] === value)) return {changed: false, channel: structuredClone(row), detail: current}
      const config = {...row.config, dingtalk_conversation_type: fields.conversationType, dingtalk_writes_authorized: fields.writesAuthorized}
      for (const field of ['dingtalk_group_id', 'dingtalk_group_name', 'dingtalk_user_id', 'dingtalk_user_name']) delete config[field]
      config['dingtalk_' + (fields.conversationType === 'chat-room' ? 'group_' : 'user_') + fields.targetKind] = fields.target
      for (const field of ['name', 'prompt']) {
        if (fields[field] === '') delete config['dingtalk_' + field]
        else config['dingtalk_' + field] = fields[field]
      }
      const updated = {...row, config}
      savedRows[savedRows.indexOf(row)] = updated
      return {changed: true, channel: structuredClone(updated), detail: detailFor(updated)}
    },
    async addDingtalk(input) {
      if (savedRows.some(row => (row.channelId ?? row.type) === input.channelId)) throw Object.assign(Error('DINGTALK_CHANNEL_EXISTS'), {code: 'DINGTALK_CHANNEL_EXISTS', status: 409})
      const targetField = 'dingtalk_' + (input.conversationType === 'chat-room' ? 'group_' : 'user_') + input.targetKind
      const row = {type: 'dingtalk-dws', channelId: input.channelId, enabled: true, config: {
        dingtalk_profile: 'fixture-corp:fixture-user', dingtalk_conversation_type: input.conversationType,
        [targetField]: input.target, dingtalk_writes_authorized: input.writesAuthorized === true,
        ...(input.name === undefined ? {} : {dingtalk_name: input.name}),
        ...(input.prompt === undefined ? {} : {dingtalk_prompt: input.prompt}),
      }}
      savedRows.push(row)
      return {changed: true, restartRequired: true, liveApplied: false, channel: structuredClone(row)}
    },
  }
  let web
  try {
    // Simulate a pre-singleton installation without relaxing the production API.
    if (!empty) {
      const state = join(paths.state, 'web-console-' + digest(CHANNEL_ID).slice(0, 16))
      await mkdir(state, {recursive: true, mode: 0o700})
      const legacy = await openWebLedger(state)
      for (const [conversationId, text] of [['sample-plan', '帮我梳理一下这周的工作'], ['sample-notes', '整理一份清晰的会议提纲']]) {
        legacy.reserve({conversationId, requestId: `seed-${conversationId}`, text, channelId: CHANNEL_ID, senderId: SENDER_ID, groupId: `fixture-${CHANNEL_ID}-${conversationId}`})
        legacy.settle(`seed-${conversationId}`, 'accepted')
      }
      legacy.close()
    }
    web = await createWebConsole({channels, paths, config: {channelId: CHANNEL_ID, senderId: SENDER_ID, operatorName: '本地验收（隔离样例）', port}, getApplication: () => app, getSessionPersistence: () => persistence, getChannelConfiguration: () => channelConfiguration})
    if (!empty) {
      const login = await fetch(web.origin + '/api/login', {method: 'POST', headers: {origin: web.origin, 'content-type': 'application/json'}, body: JSON.stringify({token: FIXTURE_TOKEN})})
      if (!login.ok) throw Error('fixture login failed')
      const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0]
      for (const [conversationId, text] of [['sample-plan', '帮我梳理一下这周的工作'], ['sample-notes', '整理一份清晰的会议提纲']]) {
        const response = await fetch(web.origin + '/api/chat', {method: 'POST', headers: {origin: web.origin, cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken}, body: JSON.stringify({conversationId, requestId: `seed-${conversationId}`, text})})
        if (response.status !== 202) throw Error('fixture chat admission failed')
        await channels.receive({type: 'chat', channelId: CHANNEL_ID, senderId: SENDER_ID, conversationId, messageId: `seed-${conversationId}`, text})
      }
      await Promise.all([...replies])
    }
  } catch (error) {
    await web?.close()
    await rm(root, {recursive: true, force: true})
    throw error
  }
  let closing
  return {origin: web.origin, token: FIXTURE_TOKEN, received, async close() {
    return closing ??= (async () => {
      await Promise.allSettled([...replies])
      await web.close()
      const withinTemp = relative(resolve(tmpdir()), resolve(root))
      if (!withinTemp || withinTemp.startsWith('..') || isAbsolute(withinTemp) || !withinTemp.startsWith('night-web-browser-fixture-')) throw Error('fixture cleanup boundary invalid')
      await rm(root, {recursive: true, force: true})
    })()
  }}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--empty' && !/^--port=\d+$/.test(arg))) throw Error('Usage: node test/preview.mjs [--port=3080] [--empty]')
  const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 3080)
  const preview = await startPreview({port, empty: args.includes('--empty')})
  console.log(`隔离样例 Web 已启动：${preview.origin}`)
  console.log(`仅测试令牌：${FIXTURE_TOKEN}`)
  console.log('不连接真实 Bot、模型或外部渠道。Ctrl+C 结束并清理本次临时数据。')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {void preview.close().then(() => {process.exitCode = 0}).catch(error => {console.error(error); process.exitCode = 1})})
}
