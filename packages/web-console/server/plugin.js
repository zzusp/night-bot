import {createServer} from 'node:http'
import {readFile, lstat, realpath} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve, join, relative, isAbsolute, sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {accessCredential, browserSessions, controlledDirectory, digest, fail, jsonBody, requireLocalRequest} from './security.js'
import {openWebLedger} from './ledger.js'
import {configuredChannels, conversationMessages, conversations, taskDialogueView, taskView} from './views.js'
import {taskSessionView} from './session-view.js'

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
export async function createWebConsole({channels, paths, config, getApplication, getSessionPersistence = () => undefined, dist = defaultDist, listen = true}) {
  const channelId = identifier(config.channelId ?? 'web-console')
  const senderId = identifier(config.senderId)
  const port = config.port ?? 3080
  if (!Number.isInteger(port) || port < 0 || port > 65535 || config.host !== undefined && config.host !== '127.0.0.1') fail('WEB_LISTEN_INVALID')
  const namespace = 'web-console-' + digest(channelId).slice(0, 16)
  const secrets = await controlledDirectory(paths.secrets, namespace)
  const state = await controlledDirectory(paths.state, namespace)
  const credential = await accessCredential(secrets)
  const sessions = browserSessions({token: credential.token, channelId})
  const ledger = await openWebLedger(state)
  const inflight = new Set()
  let origin, stopped = false, closePromise, startPromise
  const sessionView = session => ({authenticated: true, csrfToken: session.csrfToken, operator: {name: config.operatorName ?? '本机操作者'}, channelId})
  const application = () => {const value = getApplication(); if (!value) fail('BOT_NOT_READY', 503); return value}
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
    requireLocalRequest(request, origin)
    if (stopped) fail('WEB_STOPPING', 503)
    const url = new URL(request.url, origin), path = url.pathname
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) fail('METHOD_NOT_ALLOWED', 405)
      return staticResponse(path, request, response, resolve(dist))
    }
    if (request.method === 'POST' && path === '/api/login') {
      const body = await jsonBody(request, ['token'], 1024)
      return send(response, 200, sessionView(sessions.login(body.token, response)))
    }
    const session = sessions.require(request, !['GET', 'HEAD'].includes(request.method))
    if (request.method === 'GET' && path === '/api/session') return send(response, 200, sessionView(session))
    if (request.method === 'POST' && path === '/api/logout') {await jsonBody(request, []); sessions.logout(session, response); return send(response, 200, {ok: true})}
    if (request.method === 'GET' && path === '/api/channels') return send(response, 200, configuredChannels(application(), channels))
    if (request.method === 'GET' && path === '/api/conversations') return send(response, 200, conversations(application(), channels))
    if (request.method === 'GET' && path === '/api/tasks') return send(response, 200, await tasks(taskOptions(url.searchParams)))
    if (request.method === 'GET' && path === '/api/overview') {
      const app = application()
      const sections = {
        tasks: () => tasks({offset: 0, limit: 12, archived: false}),
        running: () => tasks({offset: 0, limit: 8, state: 'running', archived: false}),
        waiting: () => tasks({offset: 0, limit: 8, state: 'waiting', archived: false}),
        channels: () => configuredChannels(app, channels).items,
        conversations: () => conversations(app, channels).items,
      }
      const keys = Object.keys(sections), outcomes = await Promise.allSettled(Object.values(sections).map(read => Promise.resolve().then(read)))
      const values = Object.fromEntries(keys.map((key, index) => [key, outcomes[index].status === 'fulfilled' ? outcomes[index].value : null]))
      const sectionErrors = Object.fromEntries(keys.flatMap((key, index) => outcomes[index].status === 'rejected' ? [[key, 'SECTION_UNAVAILABLE']] : []))
      return send(response, 200, {status: 'connected', timestamp: new Date().toISOString(), ...values, sectionErrors})
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
      }))
    }
    if (request.method === 'GET' && path === '/api/chat') return send(response, 200, ledger.chats(page(url.searchParams)))
    const chat = /^\/api\/chat\/([^/]+)$/.exec(path)
    if (request.method === 'GET' && chat) {
      const value = ledger.chat(identifier(decodeURIComponent(chat[1])))
      if (!value) fail('CHAT_NOT_FOUND', 404)
      return send(response, 200, value)
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
      const conversationId = identifier(body.conversationId ?? previous?.conversationId ?? randomUUID())
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 32000) fail('CHAT_TEXT_INVALID')
      const envelope = {type: 'chat', channelId, senderId, conversationId, messageId: requestId, text: body.text}
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
      await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', () => {server.off('error', reject); resolve()})})
      origin = 'http://127.0.0.1:' + server.address().port
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
    getSessionPersistence: () => ctx.sessionPersistence, listen: false})
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
