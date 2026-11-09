import {createServer} from 'node:http'
import {readFile, lstat, realpath} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve, join, relative, isAbsolute, sep} from 'node:path'
import {accessCredential, browserSessions, controlledDirectory, digest, fail, jsonBody, requireLocalRequest, webListenOptions} from './security.js'
import {openWebLedger} from './ledger.js'
import {configuredChannels, conversationMessages, conversations, recentConversations, permissionsView, taskDialogueView, taskView} from './views.js'
import {visibleText,taskSessionView,taskSessionMessageView,routerSessionView,routerSessionMessageView} from './session-view.js'

export const inject = ['channels', 'runtimePaths', 'sessionPersistence']
const defaultDist = fileURLToPath(new URL('../dist', import.meta.url))
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/
const identifier = value => {if (typeof value !== 'string' || !idPattern.test(value)) fail('IDENTIFIER_INVALID'); return value}
const pageNumber = (query, key, fallback, max = 1_000_000) => {
  const raw = query.get(key)
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw) || Number(raw) > max || key === 'limit' && Number(raw) < 1) fail('PAGE_INVALID')
  return Number(raw)
}
const send = (response, status, body) => {
  if (response.destroyed) return
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'})
  response.end(JSON.stringify(body))
}
const headers = response => {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
}

async function staticResponse(pathname, request, response, dist) {
  let decoded
  try {decoded = decodeURIComponent(pathname)} catch {fail('PATH_INVALID')}
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) fail('PATH_INVALID')
  const resource = decoded === '/' || !decoded.split('/').at(-1).includes('.') ? 'index.html' : decoded.slice(1)
  const path = resolve(dist, resource), rel = relative(dist, path)
  if (rel.startsWith('..' + sep) || isAbsolute(rel)) fail('PATH_INVALID')
  const stat = await lstat(path).catch(error => {if (error.code !== 'ENOENT') throw error})
  if (!stat) fail(resource === 'index.html' ? 'WEB_ASSETS_NOT_BUILT' : 'NOT_FOUND', resource === 'index.html' ? 503 : 404)
  const actual = relative(await realpath(dist), await realpath(path))
  if (!stat.isFile() || stat.isSymbolicLink() || actual.startsWith('..' + sep) || isAbsolute(actual)) fail('PATH_INVALID')
  const type = {html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2'}[resource.split('.').at(-1)]
  if (!type) fail('NOT_FOUND', 404)
  if (resource !== 'index.html' && /[-.][A-Za-z0-9_-]{8,}\./.test(resource)) response.setHeader('cache-control', 'public,max-age=31536000,immutable')
  response.writeHead(200, {'content-type': type})
  response.end(request.method === 'HEAD' ? undefined : await readFile(path))
}

// 仅作为可选适配器：不导入核心实现，不扩展领域 schema，也不引入模型调用或任务调度。
export async function createWebConsole({channels, paths, config, getApplication, getSessionPersistence = () => undefined, getReflection = () => undefined, getMemory = () => undefined, getPermissions = () => undefined, getChannelConfiguration = () => undefined, getOperatorSettings = () => undefined, dist = defaultDist, listen = true}) {
  const channelId = identifier(config.channelId ?? 'web-console')
  const senderId = identifier(config.senderId)
  const operatorName = (typeof config.operatorName === 'string' ? config.operatorName.trim().slice(0, 256).trim() : '') || '本机操作者'
  const network = webListenOptions(config), {port} = network
  const namespace = 'web-console-' + digest(channelId).slice(0, 16)
  const secrets = await controlledDirectory(paths.secrets, namespace)
  const state = await controlledDirectory(paths.state, namespace)
  const credential = await accessCredential(secrets)
  const sessions = browserSessions({token: credential.token, channelId})
  const ledger = await openWebLedger(state, {channelId, senderId})
  const inflight = new Set()
  let origin, stopped = false, closePromise, startPromise
  const sessionView = session => ({authenticated: true, csrfToken: session.csrfToken, operator: {name: operatorName}, channelId})
  const application = () => {const value = getApplication(); if (!value) fail('BOT_NOT_READY', 503); return value}
  const permissions = () => {const value = getPermissions(); if (!value) fail('PERMISSIONS_UNAVAILABLE', 503); return value}
  const permissionView = value => permissionsView(value, [credential.token])
  const channelView = async (app = application()) => {
    const configuration = getChannelConfiguration()
    return configuredChannels(app, channels, configuration ? await configuration.read() : undefined)
  }
  const chatContext = id => {
    const chat = ledger.chat(identifier(id))
    if (!chat) fail('CHAT_NOT_FOUND', 404)
    const conversationId = channels.identity({type: 'chat', channelId, senderId, conversationId: id, messageId: 'session-view', text: 'session-view'}).sessionId
    return {chat, conversationId}
  }
  const executionContext = (kind, id) => {
    if (kind === 'chat') return chatContext(id).conversationId
    if (!application().tasks.listObserverGroups().some(group => group.groupId === id)) fail('CONVERSATION_NOT_FOUND', 404)
    return id
  }
  const page = query => ({offset: pageNumber(query, 'offset', 0), limit: pageNumber(query, 'limit', 30, 100)})
  const taskOptions = query => {
    const state = query.get('state') || undefined
    if (state && !['queued', 'running', 'waiting', 'completed'].includes(state)) fail('TASK_FILTER_INVALID')
    return {...page(query), state, archived: query.get('archived') === 'all' ? 'all' : query.get('archived') === 'true',
      ...(query.get('revision') ? {revision: query.get('revision')} : {}), ...(query.get('groupId') ? {groupId: query.get('groupId')} : {})}
  }
  const tasks = async options => {
    const value = await application().tasks.boardTasks(options)
    return {...value, items: value.items.map(task => taskView(task, [credential.token]))}
  }
  async function route(request, response) {
    headers(response)
    requireLocalRequest(request, origin, network)
    if (stopped) fail('WEB_STOPPING', 503)
    const url = new URL(request.url, origin), path = url.pathname
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) fail('METHOD_NOT_ALLOWED', 405)
      return staticResponse(path, request, response, resolve(dist))
    }
    if(request.method==='GET'&&path==='/api/appearance') {
      // Public presentation only: never expose configuration or credential metadata.
      let value={name:'Night Bot',icon:'moon'}
      try {const settings=getOperatorSettings();if(settings?.appearance)value=await settings.appearance()}catch{}
      return send(response,200,value)
    }
    if (request.method === 'POST' && path === '/api/login') {
      const body = await jsonBody(request, ['token'], 1024)
      return send(response, 200, sessionView(sessions.login(body.token, response)))
    }
    const session = sessions.require(request, !['GET', 'HEAD'].includes(request.method))
    if (request.method === 'GET' && path === '/api/session') return send(response, 200, sessionView(session))
    if (request.method === 'POST' && path === '/api/logout') {await jsonBody(request, []); sessions.logout(session, response); return send(response, 200, {ok: true})}
    if (path === '/api/settings' || path.startsWith('/api/settings/')) {
      const settings=getOperatorSettings()
      if(!settings) fail('SETTINGS_UNAVAILABLE',503)
      try {
        if(request.method==='GET'&&path==='/api/settings') return send(response,200,await settings.view())
        if(request.method==='GET'&&path==='/api/settings/channels') return send(response,200,await settings.plugins())
        if(request.method==='PUT'&&path==='/api/settings/appearance') return send(response,200,await settings.saveAppearance(await jsonBody(request,['name','icon','expectedVersion'],4096)))
        if(request.method==='PUT'&&path==='/api/settings/model') return send(response,200,await settings.saveModel(await jsonBody(request,['model','api','baseURL','expectedVersion'],4096)))
        const secret=/^\/api\/settings\/secrets\/(model|github)$/.exec(path)
        if(request.method==='PUT'&&secret) return send(response,200,await settings.saveSecret(secret[1],await jsonBody(request,['action','value','confirm','expectedVersion'],16384)))
        if(request.method==='POST'&&path==='/api/settings/channels') return send(response,200,await settings.saveChannel(await jsonBody(request,['type','channelId','enabled','config','expectedVersion'],16384)))
        fail('NOT_FOUND',404)
      } catch(error) {
        const codes={SETTINGS_INPUT_INVALID:400,SETTINGS_VERSION_CONFLICT:409,SETTINGS_SECRET_READ_ONLY:409,CHANNEL_WEB_CONFIGURATION_UNSUPPORTED:409,CHANNEL_EDIT_REQUIRES_STOP:409}
        if(codes[error.code]) fail(error.code,codes[error.code])
        if(['JSON_REQUIRED','REQUEST_TOO_LARGE','JSON_INVALID','REQUEST_INVALID','NOT_FOUND'].includes(error.code))throw error
        fail('SETTINGS_SAVE_UNAVAILABLE',503)
      }
    }
    if (request.method === 'GET' && path === '/api/permissions') return send(response, 200, permissionView(permissions().view()))
    if (request.method === 'PUT' && path === '/api/permissions') {
      const body = await jsonBody(request, ['mode'], 1024)
      if (!['ask', 'auto', 'full'].includes(body.mode)) fail('PERMISSION_MODE_INVALID')
      return send(response, 200, permissionView(await permissions().setMode(body.mode)))
    }
    const permissionRequest = /^\/api\/permissions\/requests\/([A-Za-z0-9-]{1,128})$/.exec(path)
    if (request.method === 'POST' && permissionRequest) {
      const body = await jsonBody(request, ['decision'], 1024)
      if (!['allow', 'reject', 'revoke'].includes(body.decision)) fail('PERMISSION_DECISION_INVALID')
      return send(response, 200, permissionView(await permissions().respond(permissionRequest[1], body.decision)))
    }
    if (request.method === 'GET' && path === '/api/channels') return send(response, 200, await channelView())
    const dingtalkDetail=/^\/api\/channels\/dingtalk\/([^/]+)$/.exec(path)
    if(dingtalkDetail&&['GET','PATCH'].includes(request.method)){
      const app=application(),configuration=getChannelConfiguration()
      if(!configuration)fail('CHANNEL_CONFIGURATION_UNAVAILABLE',503)
      let channelId;try{channelId=decodeURIComponent(dingtalkDetail[1])}catch{fail('DINGTALK_CHANNEL_REQUEST_INVALID',400)}
      try{
        if(request.method==='GET')return send(response,200,await configuration.getDingtalk(channelId))
        const body=await jsonBody(request,['expectedVersion','name','prompt','conversationType','targetKind','target','writesAuthorized'])
        const result=await configuration.editDingtalk(channelId,body),channel=configuredChannels(app,channels,[result.channel]).items[0]
        return send(response,200,{ok:true,changed:result.changed,restartRequired:channel.restartRequired,liveApplied:channel.liveApplied,channel,detail:result.detail})
      }catch(error){
        const status={DINGTALK_CHANNEL_NOT_FOUND:404,DINGTALK_CHANNEL_VERSION_CONFLICT:409,DINGTALK_CHANNEL_SWITCH_BLOCKED:409,DINGTALK_CHANNEL_REQUEST_INVALID:400,DINGTALK_CONFIG_INVALID:400,CHANNEL_CONFIGURATION_UNAVAILABLE:503,CHANNEL_CONFIGURATION_OPERATOR_REQUIRED:403}[error.code]
        if(status)fail(error.code,status)
        if(error.code?.startsWith('DINGTALK_'))fail('DINGTALK_CONFIG_INVALID',400)
        throw error
      }
    }
    if (request.method === 'POST' && path === '/api/channels/dingtalk') {
      const app = application()
      const body = await jsonBody(request, ['channelId', 'conversationType', 'targetKind', 'target', 'name', 'prompt', 'writesAuthorized'])
      const configuration = getChannelConfiguration()
      if (!configuration) fail('CHANNEL_CONFIGURATION_UNAVAILABLE', 503)
      let result
      try {result = await configuration.addDingtalk(body)} catch (error) {
        const status = {DINGTALK_CHANNEL_EXISTS: 409, DINGTALK_CHANNEL_REQUEST_INVALID: 400, DINGTALK_CONFIG_INVALID: 400,
          DINGTALK_AUTH_REQUIRED: 409, DINGTALK_CURRENT_PROFILE_NOT_FOUND: 409, DINGTALK_CURRENT_PROFILE_AMBIGUOUS: 409,
          DINGTALK_CLI_UNAVAILABLE: 503, DINGTALK_PROFILE_LOOKUP_FAILED: 503, DINGTALK_PROFILE_RESPONSE_INVALID: 502,
          DINGTALK_QUERY_INVALID_JSON: 502, DINGTALK_QUERY_INCOMPLETE: 502, DINGTALK_QUERY_FAILED: 502,
          CHANNEL_CONFIGURATION_UNAVAILABLE: 503, CHANNEL_CONFIGURATION_OPERATOR_REQUIRED: 403}[error.code]
        if (status) fail(error.code, status)
        throw error
      }
      return send(response, 200, {ok: true, changed: result.changed, restartRequired: true, liveApplied: false,
        channel: configuredChannels(app, channels, [result.channel]).items[0]})
    }
    if (request.method === 'GET' && path === '/api/conversations') return send(response, 200, conversations(application(), channels))
    if (request.method === 'GET' && path === '/api/tasks') return send(response, 200, await tasks(taskOptions(url.searchParams)))
    if (request.method === 'GET' && path === '/api/overview') {
      const app = application()
      const sections = {
        tasks: () => tasks({offset: 0, limit: 12, archived: false}),
        running: () => tasks({offset: 0, limit: 8, state: 'running', archived: false}),
        waiting: () => tasks({offset: 0, limit: 8, state: 'waiting', archived: false}),
        channels: async () => (await channelView(app)).items,
        conversations: () => conversations(app, channels).items,
      }
      const keys = Object.keys(sections), outcomes = await Promise.allSettled(Object.values(sections).map(read => Promise.resolve().then(read)))
      const values = Object.fromEntries(keys.map((key, index) => [key, outcomes[index].status === 'fulfilled' ? outcomes[index].value : null]))
      const sectionErrors = Object.fromEntries(keys.flatMap((key, index) => outcomes[index].status === 'rejected' ? [[key, 'SECTION_UNAVAILABLE']] : []))
      return send(response, 200, {status: 'connected', timestamp: new Date().toISOString(), ...values, sectionErrors})
    }
    if (request.method === 'GET' && path === '/api/evolution') {
      if ([...url.searchParams.keys()].some(key => !['kind', 'offset', 'limit'].includes(key))) fail('PAGE_INVALID')
      const kind = url.searchParams.get('kind') ?? 'all'
      if (!['all', 'memory', 'skill'].includes(kind)) fail('PAGE_INVALID')
      const options = {kind, offset: pageNumber(url.searchParams, 'offset', 0), limit: pageNumber(url.searchParams, 'limit', 20, 50)}
      application()
      const memory = getMemory()
      if (!memory?.inspectEvolution) return send(response, 200, {status: 'unavailable', reason: 'EVOLUTION_UNAVAILABLE'})
      const identity = channels.identity({type: 'chat', channelId, senderId, conversationId: 'evolution-view', messageId: 'evolution-view', text: 'evolution-view'})
      let value
      try {value = await memory.inspectEvolution(identity.binding, options)} catch {fail('EVOLUTION_UNAVAILABLE', 503)}
      return send(response, 200, {...value, items: value.items.map(item => ({...item, name: visibleText(item.name, [credential.token]).text}))})
    }
    const learning = /^\/api\/tasks\/([^/]+)\/learning(?:\/changes\/([^/]+))?$/.exec(path)
    if (request.method === 'GET' && learning) {
      const body = learning[2] !== undefined, allowed = body ? ['version'] : []
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key)) || body && !/^[a-f0-9]{64}$/.test(url.searchParams.get('version') ?? '')) fail('PAGE_INVALID')
      const app = application(), taskId = decodeURIComponent(learning[1])
      const task = app.tasks.store?.query ? await app.tasks.store.query({kind: 'task.get', taskId}) : await app.tasks.taskDetail(taskId)
      if (!task) fail('TASK_NOT_FOUND', 404)
      const reflection = getReflection()
      if (!reflection?.inspectTask || !app.tasks.store?.query) {
        if (body) fail('LEARNING_UNAVAILABLE', 503)
        return send(response, 200, {status: 'unavailable', reason: 'LEARNING_UNAVAILABLE', reviews: null, changes: null})
      }
      const identity = channels.identity({type: 'chat', channelId, senderId, conversationId: 'learning-view', messageId: 'learning-view', text: 'learning-view'})
      let value
      try {value = await reflection.inspectTask(task, identity.binding, {store: app.tasks.store,
        ...(body ? {changeId: decodeURIComponent(learning[2]), version: url.searchParams.get('version')} : {})})}
      catch (error) {
        const status = {LEARNING_CHANGE_NOT_FOUND: 404, LEARNING_BODY_FORBIDDEN: 403, LEARNING_VERSION_STALE: 409, LEARNING_UNAVAILABLE: 503}[error.code]
        if (status) fail(error.code, status)
        throw error
      }
      if (body) value = {...value, ...visibleText(value.text, [credential.token], {maxLength: Infinity})}
      else value = {...value, reviews: value.reviews.map(row => ({...row, summary: visibleText(row.summary, [credential.token]).text})),
        changes: value.changes.map(row => ({...row, name: visibleText(row.name, [credential.token]).text}))}
      return send(response, 200, value)
    }
    const bodyOptions = query => {
      if ([...query.keys()].some(key => !['offset', 'limit', 'revision'].includes(key)) || !query.get('revision')) fail('PAGE_INVALID')
      return {offset: pageNumber(query, 'offset', 0, Number.MAX_SAFE_INTEGER), limit: pageNumber(query, 'limit', 16000, 16000), revision: query.get('revision'), secrets: [credential.token]}
    }
    const taskBody = /^\/api\/tasks\/([^/]+)\/session\/messages\/([^/]+)$/.exec(path)
    if (request.method === 'GET' && taskBody) {
      const value = await application().tasks.taskDetail(decodeURIComponent(taskBody[1]))
      if (!value) fail('TASK_NOT_FOUND', 404)
      return send(response, 200, await taskSessionMessageView({...bodyOptions(url.searchParams), task: value, persistence: getSessionPersistence(), messageId: decodeURIComponent(taskBody[2])}))
    }
    const task = /^\/api\/tasks\/([^/]+)(?:\/(dialogue|executions|session))?$/.exec(path)
    if (request.method === 'GET' && task) {
      const id = decodeURIComponent(task[1]), app = application()
      if (task[2] === 'dialogue') return send(response, 200, taskDialogueView(await app.tasks.taskDialogue(id), [credential.token]))
      if (task[2] === 'executions') return send(response, 200, await app.tasks.taskExecutions(id, {...page(url.searchParams), summary: true}))
      const value = await app.tasks.taskDetail(id)
      if (!value) fail('TASK_NOT_FOUND', 404)
      if (task[2] === 'session') {
        if ([...url.searchParams.keys()].some(key => !['offset', 'limit', 'revision'].includes(key))) fail('PAGE_INVALID')
        return send(response, 200, await taskSessionView({task: value, persistence: getSessionPersistence(),
          offset: pageNumber(url.searchParams, 'offset', 0), limit: pageNumber(url.searchParams, 'limit', 50, 50),
          revision: url.searchParams.get('revision'), secrets: [credential.token]}))
      }
      return send(response, 200, taskView(value, [credential.token]))
    }
    const conversation = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path)
    if (request.method === 'GET' && conversation) {
      const params = url.searchParams, offset = pageNumber(params, 'offset', 0)
      return send(response, 200, await conversationMessages(application(), decodeURIComponent(conversation[1]), {
        limit: pageNumber(params, 'limit', 50, 100), messageOffset: pageNumber(params, 'messageOffset', offset), outboxOffset: pageNumber(params, 'outboxOffset', offset),
        messageRevision: params.get('messageRevision'), outboxRevision: params.get('outboxRevision'),
      }, channels))
    }
    if (request.method === 'GET' && path === '/api/recent-conversations') return send(response, 200, recentConversations(application(), channels, ledger, channelId, page(url.searchParams)))
    if (request.method === 'GET' && path === '/api/chat-current') return send(response, 200, {conversationId: ledger.canonical()})
    if (request.method === 'GET' && path === '/api/chat') return send(response, 200, ledger.chats(page(url.searchParams)))
    const conversationTasks = /^\/api\/conversations\/([^/]+)\/tasks$/.exec(path)
    if (request.method === 'GET' && conversationTasks) {
      const conversationId = executionContext('conversations', decodeURIComponent(conversationTasks[1]))
      const store = application().tasks.store
      if (!store?.query) return send(response, 200, {taskIds: null, taskHistoryStatus: 'unavailable'})
      const tasks = await store.query({kind: 'task.list', groupId: conversationId, archived: 'all'})
      return send(response, 200, {taskIds: [...new Set(tasks.filter(task => task.groupId === conversationId).map(task => task.taskId))], taskHistoryStatus: 'ready'})
    }
    const chatTask = /^\/api\/(chat|conversations)\/([^/]+)\/tasks\/([^/]+)\/session(?:\/messages\/([^/]+))?$/.exec(path)
    if (request.method === 'GET' && chatTask) {
      const conversationId = executionContext(chatTask[1], decodeURIComponent(chatTask[2])), taskId = decodeURIComponent(chatTask[3])
      const store = application().tasks.store
      if (!store?.query) fail('SESSION_UNAVAILABLE', 503)
      const value = await store.query({kind: 'task.get', taskId})
      if (!value || value.taskId !== taskId || value.groupId !== conversationId) fail('CHAT_TASK_NOT_FOUND', 404)
      const task = {taskId, session: {sessionId: value.sessionId, sessionBound: value.sessionBound}}
      const options = {task, persistence: getSessionPersistence(), secrets: [credential.token]}
      if (chatTask[4]) return send(response, 200, await taskSessionMessageView({...options, ...bodyOptions(url.searchParams), messageId: decodeURIComponent(chatTask[4])}))
      if ([...url.searchParams.keys()].some(key => !['offset', 'limit', 'revision'].includes(key))) fail('PAGE_INVALID')
      return send(response, 200, await taskSessionView({...options, offset: pageNumber(url.searchParams, 'offset', 0), limit: pageNumber(url.searchParams, 'limit', 50, 50), revision: url.searchParams.get('revision')}))
    }
    const chatSession = /^\/api\/(chat|conversations)\/([^/]+)\/session(?:\/messages\/([^/]+))?$/.exec(path)
    if (request.method === 'GET' && chatSession) {
      const conversationId = executionContext(chatSession[1], decodeURIComponent(chatSession[2]))
      const store = application().tasks.store
      if (!store?.query) fail('SESSION_UNAVAILABLE', 503)
      const options = {conversationId, readRouter: () => store.query({kind: 'router.get', conversationId}), readRotations: () => store.query({kind: 'router.rotations', conversationId}), persistence: getSessionPersistence(), secrets: [credential.token]}
      if (chatSession[3]) return send(response, 200, await routerSessionMessageView({...options, ...bodyOptions(url.searchParams), messageId: decodeURIComponent(chatSession[3])}))
      if ([...url.searchParams.keys()].some(key => !['offset', 'limit', 'revision'].includes(key))) fail('PAGE_INVALID')
      return send(response, 200, await routerSessionView({...options, offset: pageNumber(url.searchParams, 'offset', 0), limit: pageNumber(url.searchParams, 'limit', 50, 50), revision: url.searchParams.get('revision')}))
    }
    const chat = /^\/api\/chat\/([^/]+)$/.exec(path)
    if (request.method === 'GET' && chat) {
      const {chat: value, conversationId} = chatContext(decodeURIComponent(chat[1]))
      const store = application().tasks.store
      if (!store?.query) return send(response, 200, {...value, taskIds: null, taskHistoryStatus: 'unavailable', taskHistoryReason: 'TASK_HISTORY_UNAVAILABLE'})
      const tasks = await store.query({kind: 'task.list', groupId: conversationId, archived: 'all'})
      return send(response, 200, {...value, taskIds: [...new Set(tasks.map(task => task.taskId))], taskHistoryStatus: 'ready'})
    }
    const requestMatch = /^\/api\/requests\/([^/]+)$/.exec(path)
    if (request.method === 'GET' && requestMatch) {
      const value = ledger.request(identifier(decodeURIComponent(requestMatch[1])))
      if (!value) fail('CHAT_REQUEST_NOT_FOUND', 404)
      return send(response, 200, value)
    }
    if (request.method === 'POST' && path === '/api/chat') {
      application()
      const body = await jsonBody(request, ['conversationId', 'requestId', 'text'])
      const requestId = identifier(body.requestId), previous = ledger.request(requestId)
      let conversationId = identifier(body.conversationId ?? previous?.conversationId ?? ledger.canonical())
      // Historical URLs remain normal entry points; new messages continue the one
      // current conversation. Exact old receipts retain their original scope.
      if (!previous || previous.conversationId !== conversationId) {
        const existing = ledger.hasChat(conversationId) ? ledger.chat(conversationId) : null
        if (existing) conversationId = existing.canonicalConversationId
      }
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 32000) fail('CHAT_TEXT_INVALID')
      const envelope = {type: 'chat', channelId, senderId, senderName: operatorName, conversationId, messageId: requestId, text: body.text}
      const groupId = channels.identity(envelope).sessionId
      const reservation = ledger.reserve({requestId, conversationId, groupId, text: body.text, senderId, channelId})
      if (reservation.duplicate) return send(response, reservation.status === 'unknown' ? 409 : reservation.status === 'rejected' ? 422 : 202, {...reservation, accepted: reservation.status === 'accepted'})
      try {
        // 浏览器断开没有取消已接纳业务的权限。
        const result = await channels.receive(envelope)
        if (result?.accepted === false) return send(response, 422, {...ledger.settle(requestId, 'rejected'), accepted: false, error: 'CHAT_ADMISSION_REJECTED'})
        if (result?.accepted !== true) return send(response, 409, {...ledger.settle(requestId, 'unknown'), accepted: false, error: 'CHAT_ADMISSION_UNCERTAIN'})
        return send(response, 202, {...ledger.settle(requestId, 'accepted'), accepted: true})
      } catch {
        return send(response, 409, {...ledger.settle(requestId, 'unknown'), accepted: false, error: 'CHAT_ADMISSION_UNCERTAIN'})
      }
    }
    fail('NOT_FOUND', 404)
  }
  const server = createServer((request, response) => {
    const pending = route(request, response).catch(error => {
      if (response.headersSent) {response.end(); return}
      const known = error.status || error.code === 'OBSERVER_PAGE_STALE'
      send(response, error.status ?? (error.code === 'OBSERVER_PAGE_STALE' ? 409 : 500), {error: known ? error.code : 'WEB_REQUEST_FAILED'})
    }).finally(() => inflight.delete(pending))
    inflight.add(pending)
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxConnections = 64
  const transport = ledger.transport(channelId, senderId)
  let unregisterTransport, unregisterPlugin
  const start = () => {
    if (stopped) fail('WEB_STOPPING', 503)
    return startPromise ??= (async () => {
      await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, network.host, () => {server.off('error', reject); resolve()})})
      origin = network.publicOrigin ?? 'http://127.0.0.1:' + server.address().port
      return origin
    })()
  }
  try {
    unregisterTransport = channels.registerTransport(channelId, transport)
    unregisterPlugin = channels.registerPlugin(channelId, {get health() {return {healthy: !!origin && !stopped}}})
    if (listen) await start()
  } catch (error) {
    unregisterPlugin?.(); unregisterTransport?.(); ledger.close(); sessions.close(); throw error
  }
  return {
    get origin() {return origin}, credentialPath: credential.path, start,
    close() {
      return closePromise ??= (async () => {
        stopped = true
        await startPromise?.catch(() => {})
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        await Promise.allSettled([...inflight])
        unregisterPlugin?.(); unregisterTransport?.(); sessions.close(); ledger.close()
      })()
    },
  }
}

export async function apply(ctx, config) {
  if (config.enabled !== true) return
  let application, stopping
  const prepared = createWebConsole({channels: ctx.channels, paths: ctx.runtimePaths, config, getApplication: () => application,
    getSessionPersistence: () => ctx.sessionPersistence, getReflection: () => ctx.get('reflection'), getMemory: () => ctx.get('memory'), getPermissions: () => ctx.get('toolPermissions'), getChannelConfiguration: () => ctx.get('channelConfiguration'), getOperatorSettings: () => ctx.get('operatorSettings'), listen: false})
  const stop = () => stopping ??= prepared.then(web => web.close(), () => undefined)
  ctx.effect(() => stop, 'optional Web console shutdown')
  ctx.on('night/stopping', stop)
  // 恢复可能先于 night/ready 发送待交付通知，因此先注册耐久传输，仅 HTTP 入站等待应用就绪。
  const web = await prepared
  if (stopping) return
  ctx.on('night/ready', async ready => {
    application = ready
    await web.start()
    ctx.logger.info(`Web console: ${web.origin}; access credential: ${web.credentialPath}`)
  })
}
