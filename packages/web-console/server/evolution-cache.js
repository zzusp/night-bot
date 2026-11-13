import {constants} from 'node:fs'
import {lstat, realpath, open, rename, unlink} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export const EVOLUTION_REFRESH_MS = 5 * 60 * 1000
const MAX_BYTES = 32 * 1024 * 1024
const MAX_HEADER_BYTES = 8 * 1024 * 1024
const PREFIX_BYTES = 9
const sha = value => createHash('sha256').update(value).digest('hex')
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
  && optional(item.summary, string)
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
  const path = join(directory, `evolution-${fingerprint}.pages`)
  let snapshot = null, updatedAt = null, inFlight = null, timer = null, closed = false, lastAttempt = -Infinity, errorCode = null, lastFailure = null, revoked = null
  let publication = null, resumePages = null
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
  async function readBytes(handle, length, position) {
    const buffer = Buffer.alloc(length)
    let done = 0
    while (done < length) {
      const {bytesRead} = await handle.read(buffer, done, length - done, position + done)
      if (!bytesRead) throw failure('EVOLUTION_CACHE_INVALID')
      done += bytesRead
    }
    return buffer
  }
  function headerValid(value, size) {
    if (value?.version !== 2 || value.identity !== fingerprint || !count(value.updatedAt)
      || value.updatedAt > now() || !object(value.summary) || 'items' in value.summary
      || !snapshotValid({...value.summary, items: []}) || !Array.isArray(value.rows)) return false
    let end = 0
    for (const row of value.rows) {
      if (!object(row) || !['memory', 'skill'].includes(row.kind) || row.offset !== end
        || !count(row.length) || row.length === 0 || !/^[a-f0-9]{64}$/.test(row.hash)) return false
      end += row.length
      if (!Number.isSafeInteger(end) || end > MAX_BYTES) return false
    }
    return end === size
  }
  function generation(handle, header, start, stat) {
    // Only summary, offsets and hashes are resident. Item DTOs are read on demand.
    const byKind = {all: header.rows, memory: [], skill: []}
    for (const row of header.rows) byKind[row.kind].push(row)
    return {handle, summary: header.summary, byKind, start, stat, readers: 0, retired: false, idle: null}
  }
  async function retire(value) {
    if (!value) return
    value.retired = true
    if (!value.readers) await value.handle.close()
  }
  async function reopen(value) {
    await checkRoot()
    const expected = await targetStat()
    const matches = stat => stat && ['dev', 'ino', 'size', 'mtimeMs'].every(key => stat[key] === value.stat[key])
    if (!matches(expected)) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat(); checkFile(stat)
      if (!matches(stat)) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
      return handle
    } catch (error) {await handle.close(); throw error}
  }
  const existing = await targetStat()
  if (existing && existing.size >= PREFIX_BYTES && existing.size <= MAX_BYTES) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let retained = false
    try {
      const stat = await handle.stat(); checkFile(stat)
      if (stat.dev !== existing.dev || stat.ino !== existing.ino) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
      // Restart loads just the bounded index. It does not parse all item DTOs.
      const prefix = (await readBytes(handle, PREFIX_BYTES, 0)).toString('ascii')
      if (/^[0-9a-f]{8}\n$/.test(prefix)) {
        const length = Number.parseInt(prefix, 16), start = PREFIX_BYTES + length
        if (length > 0 && length <= MAX_HEADER_BYTES && start <= stat.size) {
          let header
          try {header = JSON.parse((await readBytes(handle, length, PREFIX_BYTES)).toString('utf8'))} catch {}
          if (headerValid(header, stat.size - start)) {
            snapshot = generation(handle, header, start, stat); updatedAt = header.updatedAt; retained = true
          }
        }
      }
    } finally {if (!retained) await handle.close()}
  }
  async function persist(next, stamp) {
    const {items, ...summary} = next
    const buffers = [], rows = []
    let offset = 0
    for (const item of items) {
      const buffer = Buffer.from(JSON.stringify(item) + '\n')
      rows.push({kind: item.kind, offset, length: buffer.length, hash: sha(buffer)})
      buffers.push(buffer); offset += buffer.length
      if (offset > MAX_BYTES) throw failure('EVOLUTION_CACHE_TOO_LARGE')
    }
    const header = {version: 2, identity: fingerprint, updatedAt: stamp, summary, rows}
    const encoded = Buffer.from(JSON.stringify(header)), start = PREFIX_BYTES + encoded.length
    if (encoded.length > MAX_HEADER_BYTES || start + offset > MAX_BYTES) throw failure('EVOLUTION_CACHE_TOO_LARGE')
    const prefix = Buffer.from(encoded.length.toString(16).padStart(8, '0') + '\n')
    await checkRoot(); await targetStat()
    const temporary = join(directory, `.evolution-${randomUUID()}.tmp`)
    let handle, reader
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
      await handle.writeFile(Buffer.concat([prefix, encoded, ...buffers])); await handle.sync(); await handle.close(); handle = null
      reader = await open(temporary, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const stat = await reader.stat(); checkFile(stat)
      // Windows cannot replace an open target. Pause new pages only for publication;
      // existing pages finish on their pinned generation before its handle closes.
      publication = new Promise(resolve => {resumePages = resolve})
      const previous = snapshot
      if (previous?.readers) await new Promise(resolve => {previous.idle = resolve})
      await checkRoot(); await targetStat()
      if (previous) await previous.handle.close()
      try {await rename(temporary, path)}
      catch (error) {
        if (previous) {
          try {previous.handle = await reopen(previous)}
          catch {snapshot = null}
        }
        throw error
      }
      const value = generation(reader, header, start, stat); reader = null
      return value
    } finally {
      await handle?.close(); await reader?.close()
      await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error})
    }
  }
  async function page(value, {kind, offset, limit}) {
    value.readers++
    try {
      await checkRoot()
      const stat = await value.handle.stat()
      // An atomic replacement may unlink this generation during an in-flight GET.
      if (!stat.isFile() || stat.nlink > 1 || !privateStat(stat) || stat.size !== value.stat.size
        || stat.mtimeMs !== value.stat.mtimeMs) throw failure('EVOLUTION_CACHE_PATH_UNSAFE')
      const index = value.byKind[kind], items = []
      for (let i = offset; i < Math.min(offset + limit, index.length); i++) {
        const row = index[i], bytes = await readBytes(value.handle, row.length, value.start + row.offset)
        if (sha(bytes) !== row.hash) throw failure('EVOLUTION_CACHE_INVALID')
        let item
        try {item = JSON.parse(bytes.toString('utf8'))} catch {throw failure('EVOLUTION_CACHE_INVALID')}
        if (!itemValid(item) || item.kind !== row.kind || !metadataOnly(item)) throw failure('EVOLUTION_CACHE_INVALID')
        items.push(item)
      }
      return {...structuredClone(value.summary), items, kind, offset, limit, total: index.length,
        hasMore: offset + limit < index.length, nextOffset: offset + limit < index.length ? offset + limit : null}
    } finally {
      value.readers--
      if (!value.readers) {value.idle?.(); value.idle = null}
      if (value.retired && !value.readers) await value.handle.close()
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
        const stored = await persist(next, stamp), previous = snapshot
        snapshot = stored; updatedAt = stamp; errorCode = null; lastFailure = null; revoked = null
        await retire(previous)
      } catch (error) {
        errorCode = 'EVOLUTION_CACHE_REFRESH_FAILED'
        const status = error?.status ?? error?.statusCode
        if ([401, 403].includes(status)) revoked = {status, code: status === 401 ? 'AUTH_REQUIRED' : 'EVOLUTION_FORBIDDEN'}
        if (revoked) throw failure(revoked.code, revoked.status)
        // Keep only safe, actionable cold-load codes; never expose source errors.
        lastFailure = ['EVOLUTION_BUSY', 'BOT_NOT_READY'].includes(error?.code) ? error.code : errorCode
        throw failure(lastFailure)
      } finally {
        // Publish or restore the handle before admitting waiting page reads.
        const resume = resumePages
        publication = null; resumePages = null; inFlight = null
        resume?.()
      }
    })()
    return inFlight
  }
  const expired = () => updatedAt === null || now() - updatedAt >= EVOLUTION_REFRESH_MS || now() < updatedAt
  const retryDue = () => now() - lastAttempt >= EVOLUTION_REFRESH_MS || now() < lastAttempt
  return {
    async read({force = false, kind = 'all', offset = 0, limit = 10} = {}) {
      if (!['all', 'memory', 'skill'].includes(kind) || !count(offset) || !count(limit) || limit < 1 || limit > 50) throw failure('PAGE_INVALID', 400)
      if (closed) throw failure('EVOLUTION_CACHE_CLOSED')
      if (revoked && !force) throw failure(revoked.code, revoked.status)
      if (force || !snapshot) {
        // Startup readiness can change independently of the five-minute refresh clock.
        if (!force && !snapshot && !inFlight && errorCode && lastFailure !== 'BOT_NOT_READY' && !retryDue()) throw failure(lastFailure ?? errorCode)
        try {await refresh()} catch (error) {if (!snapshot || revoked) throw error}
      } else if (expired() && retryDue()) {
        void refresh().catch(() => {})
      }
      if (publication) await publication
      if (revoked) throw failure(revoked.code, revoked.status)
      if (!snapshot) throw failure(lastFailure ?? 'EVOLUTION_CACHE_REFRESH_FAILED')
      const current = snapshot, cache = {updatedAt: new Date(updatedAt).toISOString(),
        stale: expired() || Boolean(errorCode), refreshing: Boolean(inFlight), ...(errorCode ? {error: errorCode} : {})}
      const result = await page(current, {kind, offset, limit})
      if (revoked) throw failure(revoked.code, revoked.status)
      return {snapshot: result, cache}
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
      await retire(snapshot)
    },
  }
}
