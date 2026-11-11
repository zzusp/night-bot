import {constants} from 'node:fs'
import {lstat, realpath, open, rename, unlink} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export const EVOLUTION_REFRESH_MS = 5 * 60 * 1000
const MAX_BYTES = 32 * 1024 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const failure = (code, status = 503) => Object.assign(new Error(code), {code, status})
const count = value => Number.isSafeInteger(value) && value >= 0
const optional = (value, check) => value == null || check(value)
const string = value => typeof value === 'string'
const strings = value => Array.isArray(value) && value.every(string)
const provenance = value => object(value) && Object.values(value).every(value => optional(value, string))
const access = value => object(value) && string(value.counter) && string(value.at) && optional(value.provenance, provenance)
const counters = value => Object.entries(value).every(([key, value]) => !key.endsWith('Count') || optional(value, count))
const times = value => Object.entries(value).every(([key, value]) => !/(?:At|Since)$/.test(key) || optional(value, string))
const privateKeys = new Set(['memoryResources', 'skillResources', 'allowedScopeTokens', 'scopeToken', 'storageId', 'contentVersion', 'resourceBasePath', 'body', 'current', 'previous', 'text', '__proto__', 'prototype', 'constructor'])
function metadataOnly(value, depth = 0) {
  if (depth > 16) return false
  if (Array.isArray(value)) return value.every(row => metadataOnly(row, depth + 1))
  if (object(value)) return Object.entries(value).every(([key, row]) => !privateKeys.has(key) && metadataOnly(row, depth + 1))
  return value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)
}
const itemValid = item => object(item) && string(item.id) && item.id.length > 0
  && ['memory', 'skill'].includes(item.kind) && string(item.name)
  && ['applied', 'candidate', 'disabled', 'invalid', 'shadowed', 'undiscovered', 'unsupported'].includes(item.status)
  && optional(item.scope, value => ['bot', 'personal', 'group', 'project'].includes(value))
  && optional(item.origin, value => ['installed', 'learned'].includes(value))
  && optional(item.revision, value => string(value) || count(value)) && optional(item.location, string)
  && optional(item.taskIds, strings) && optional(item.provenance, provenance)
  && optional(item.origins, value => Array.isArray(value) && value.every(row => optional(row, provenance)))
  && optional(item.migration, value => object(value) && optional(value.conflict, row => typeof row === 'boolean'))
  && optional(item.memoryUse, value => object(value) && optional(value.readCount, count)
    && optional(value.searchCount, count) && optional(value.lastAccess, access))
  && counters(item) && times(item)
const snapshotValid = value => object(value) && value.status === 'ready' && object(value.memory)
  && count(value.memory.acceptedCount) && count(value.memory.candidateCount)
  && object(value.skills) && count(value.skills.activeCount) && count(value.skills.candidateCount)
  && counters(value.memory) && counters(value.skills) && times(value.memory) && times(value.skills)
  && optional(value.memory.lastAccess, access) && optional(value.skills.inventoryIssues, strings)
  && object(value.usageCoverage) && ['ready', 'partial', 'unrecorded'].includes(value.usageCoverage.status)
  && Array.isArray(value.items) && value.items.every(itemValid) && metadataOnly(value)

/** Rebuildable, Web-owned DTO cache. collect must return only a sanitized full DTO,
 * never source bodies, private matching keys, or a paginated subset. The caller
 * must revalidate authorization before reading, including a cached response. */
export async function openEvolutionCache({directory, identity, collect, now = Date.now,
  setInterval: schedule = globalThis.setInterval, clearInterval: cancel = globalThis.clearInterval,
  sleep = (ms, {signal}) => delay(ms, undefined, {signal})}) {
  if (typeof directory !== 'string' || !directory || typeof identity !== 'string' || !identity || typeof collect !== 'function') throw failure('EVOLUTION_CACHE_OPTIONS_INVALID')
  directory = resolve(directory)
  const fingerprint = createHash('sha256').update(identity).digest('hex')
  const path = join(directory, `evolution-${fingerprint}.json`)
  let snapshot = null, updatedAt = null, inFlight = null, timer = null, closed = false, lastAttempt = -Infinity, errorCode = null, lastFailure = null, revoked = null
  const shutdown = new AbortController()
  const privateStat = stat => process.platform === 'win32' || (stat.uid === process.getuid() && (stat.mode & 0o077) === 0)
  async function checkDirectory() {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !privateStat(stat) || await realpath(directory) !== directory) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
    return stat
  }
  function checkFile(stat) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !privateStat(stat)) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
  }
  async function targetStat() {
    try {const stat = await lstat(path); checkFile(stat); return stat}
    catch (error) {if (error.code === 'ENOENT') return null; throw error}
  }
  const directoryStat = await checkDirectory()
  async function checkRoot() {
    const stat = await checkDirectory()
    if (stat.dev !== directoryStat.dev || stat.ino !== directoryStat.ino) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
  }
  const existing = await targetStat()
  if (existing && existing.size <= MAX_BYTES) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat(); checkFile(stat)
      if (stat.dev !== existing.dev || stat.ino !== existing.ino) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
      // One bounded read also protects against concurrent file growth.
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead <= MAX_BYTES) {
        let value
        try {value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))} catch {}
        if (value?.version === 1 && value.identity === fingerprint && Number.isSafeInteger(value.updatedAt)
          && value.updatedAt >= 0 && value.updatedAt <= now() && snapshotValid(value.snapshot)) {
          snapshot = value.snapshot; updatedAt = value.updatedAt
        }
      }
    } finally {await handle.close()}
  }
  async function persist(next, stamp) {
    const text = JSON.stringify({version: 1, identity: fingerprint, updatedAt: stamp, snapshot: next})
    if (Buffer.byteLength(text) > MAX_BYTES) throw failure('EVOLUTION_CACHE_TOO_LARGE')
    await checkRoot(); await targetStat()
    const temporary = join(directory, `.evolution-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
      await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null
      await checkRoot(); await targetStat()
      await rename(temporary, path)
    } finally {
      await handle?.close()
      await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error})
    }
  }
  async function collectWithRetries() {
    for (let attempt = 0;; attempt++) {
      try {return await Promise.resolve().then(collect)}
      catch (error) {
        const terminal = error instanceof SyntaxError || [401, 403].includes(error?.status ?? error?.statusCode)
          || /AUTH|FORBIDDEN|INVALID|UNSAFE|DENIED/.test(String(error?.code ?? ''))
        if (closed || terminal || attempt === 3) throw error
        await sleep(1000 * 2 ** attempt, {signal: shutdown.signal})
        if (closed) throw failure('EVOLUTION_CACHE_CLOSED')
      }
    }
  }
  function refresh() {
    if (inFlight) return inFlight
    if (closed) return Promise.reject(failure('EVOLUTION_CACHE_CLOSED'))
    lastAttempt = now()
    inFlight = (async () => {
      try {
        const result = await collectWithRetries()
        if (!snapshotValid(result)) throw failure('EVOLUTION_CACHE_SNAPSHOT_INVALID')
        // Detach from collector/caller mutation and validate the JSON representation.
        const next = JSON.parse(JSON.stringify(result))
        if (!snapshotValid(next)) throw failure('EVOLUTION_CACHE_SNAPSHOT_INVALID')
        const stamp = now()
        await persist(next, stamp)
        snapshot = next; updatedAt = stamp; errorCode = null; lastFailure = null; revoked = null
      } catch (error) {
        errorCode = 'EVOLUTION_CACHE_REFRESH_FAILED'
        const status = error?.status ?? error?.statusCode
        if ([401, 403].includes(status)) revoked = {status, code: status === 401 ? 'AUTH_REQUIRED' : 'EVOLUTION_FORBIDDEN'}
        if (revoked) throw failure(revoked.code, revoked.status)
        // Keep only safe, actionable cold-load codes; never expose source errors.
        lastFailure = ['EVOLUTION_BUSY', 'BOT_NOT_READY'].includes(error?.code) ? error.code : errorCode
        throw failure(lastFailure)
      } finally {inFlight = null}
    })()
    return inFlight
  }
  const expired = () => updatedAt === null || now() - updatedAt >= EVOLUTION_REFRESH_MS || now() < updatedAt
  const retryDue = () => now() - lastAttempt >= EVOLUTION_REFRESH_MS || now() < lastAttempt
  return {
    async read({force = false} = {}) {
      if (closed) throw failure('EVOLUTION_CACHE_CLOSED')
      if (revoked && !force) throw failure(revoked.code, revoked.status)
      if (force || !snapshot) {
        // Startup readiness can change independently of the five-minute refresh clock.
        if (!force && !snapshot && !inFlight && errorCode && lastFailure !== 'BOT_NOT_READY' && !retryDue()) throw failure(lastFailure ?? errorCode)
        try {await refresh()} catch (error) {if (!snapshot || revoked) throw error}
      } else if (expired() && retryDue()) {
        void refresh().catch(() => {})
      }
      if (revoked) throw failure(revoked.code, revoked.status)
      return {snapshot: structuredClone(snapshot), cache: {updatedAt: new Date(updatedAt).toISOString(),
        stale: expired() || Boolean(errorCode), refreshing: Boolean(inFlight), ...(errorCode ? {error: errorCode} : {})}}
    },
    start() {
      if (closed || timer !== null) return
      if (expired()) void refresh().catch(() => {})
      timer = schedule(() => {void refresh().catch(() => {})}, EVOLUTION_REFRESH_MS)
      timer?.unref?.()
    },
    async close() {
      closed = true
      shutdown.abort()
      if (timer !== null) {cancel(timer); timer = null}
      await inFlight?.catch(() => {})
    },
  }
}
