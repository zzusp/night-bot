import {randomBytes, timingSafeEqual, createHash} from 'node:crypto'
import {mkdir, open, lstat, realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join, resolve, relative} from 'node:path'

export function fail(code, status = 400) {
  throw Object.assign(new Error(code), {code, status})
}

export const digest = value => createHash('sha256').update(value).digest('hex')
const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
  && timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)))

// Host 先准备 data/secrets；Windows 子目录继承其 ACL，POSIX 仅允许所有者访问。
// 路径别名直接拒绝，不能顺着链接写入安装目录之外。
export async function controlledDirectory(root, name) {
  if (typeof root !== 'string' || !root) fail('WEB_STORAGE_ROOT_REQUIRED')
  const base = resolve(root)
  const rootStat = await lstat(base)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || relative(base, await realpath(base)) !== '') fail('WEB_STORAGE_ALIAS_UNSAFE')
  const directory = join(base, name)
  await mkdir(directory, {recursive: true, mode: 0o700})
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || relative(directory, await realpath(directory)) !== '') fail('WEB_STORAGE_ALIAS_UNSAFE')
  if (process.platform !== 'win32' && ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid())) fail('WEB_STORAGE_PERMISSIONS_UNSAFE')
  return directory
}

export async function accessCredential(directory) {
  const path = join(directory, 'access-token')
  let handle
  try {
    handle = await open(path, 'wx', 0o600)
    await handle.writeFile(randomBytes(32).toString('base64url') + '\n')
    await handle.sync()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  } finally {
    await handle?.close()
  }
  const safe = stat => {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 44
      || process.platform !== 'win32' && ((stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid())) fail('WEB_ACCESS_TOKEN_UNSAFE')
  }
  const before = await lstat(path); safe(before)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = await file.stat(); safe(actual)
    if (actual.ino !== before.ino || actual.dev !== before.dev) fail('WEB_ACCESS_TOKEN_UNSAFE')
    const raw = await file.readFile('utf8')
    if (!/^[A-Za-z0-9_-]{43}\n$/.test(raw)) fail('WEB_ACCESS_TOKEN_INVALID')
    const after = await lstat(path); safe(after)
    if (after.ino !== actual.ino || after.dev !== actual.dev) fail('WEB_ACCESS_TOKEN_UNSAFE')
    return {path, token: raw.slice(0, -1)}
  } finally {await file.close()}
}

export function browserSessions({token, channelId, now = Date.now}) {
  const sessions = new Map()
  const cookieName = 'night_web_' + digest(channelId).slice(0, 16)
  let failures = 0, retryAt = 0
  const cookie = (value, age) => `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`
  const clean = () => {for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key)}
  const read = request => {
    clean()
    const value = String(request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    return value && sessions.get(digest(value))
  }
  return {
    login(value, response) {
      if (now() < retryAt) {response.setHeader('retry-after', Math.ceil((retryAt - now()) / 1000)); fail('AUTH_RATE_LIMITED', 429)}
      if (!equal(value, token)) {
        if (++failures >= 5) {retryAt = now() + 30_000; failures = 0}
        fail('AUTH_INVALID', 401)
      }
      failures = 0
      clean()
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value)
      const secret = randomBytes(32).toString('base64url')
      const session = {key: digest(secret), csrfToken: randomBytes(32).toString('base64url'), expiresAt: now() + 12 * 60 * 60 * 1000}
      sessions.set(session.key, session)
      response.setHeader('set-cookie', cookie(secret, 12 * 60 * 60))
      return session
    },
    require(request, mutation = false) {
      const session = read(request)
      if (!session) fail('AUTH_REQUIRED', 401)
      if (mutation && !equal(request.headers['x-csrf-token'], session.csrfToken)) fail('CSRF_INVALID', 403)
      return session
    },
    logout(session, response) {sessions.delete(session.key); response.setHeader('set-cookie', cookie('', 0))},
    close() {sessions.clear()},
  }
}

export function webListenOptions(config) {
  const host = config.host ?? '127.0.0.1', port = config.port ?? 3080
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535) fail('WEB_LISTEN_INVALID')
  if (host === '0.0.0.0' && !config.publicOrigin) fail('WEB_PUBLIC_ORIGIN_REQUIRED')
  if (config.publicOrigin !== undefined) {
    let url
    try {url = new URL(config.publicOrigin)} catch {fail('WEB_PUBLIC_ORIGIN_INVALID')}
    if (typeof config.publicOrigin !== 'string' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '0' || url.origin !== config.publicOrigin) fail('WEB_PUBLIC_ORIGIN_INVALID')
  }
  return {host, port, publicOrigin: config.publicOrigin, allowRemote: host === '0.0.0.0'}
}

export function requireLocalRequest(request, origin, {allowRemote = false} = {}) {
  const expected = new URL(origin)
  if (!allowRemote && !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    || request.headers.host !== expected.host
    || request.headers.origin !== undefined && request.headers.origin !== origin
    || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) fail('ORIGIN_FORBIDDEN', 403)
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin) fail('ORIGIN_REQUIRED', 403)
}

export async function jsonBody(request, fields, maxBytes = 132_000) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail('JSON_REQUIRED', 415)
  const chunks = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) fail('REQUEST_TOO_LARGE', 413)
    chunks.push(chunk)
  }
  let value
  try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'))} catch {fail('JSON_INVALID')}
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !fields.includes(key))) fail('REQUEST_INVALID')
  return value
}
