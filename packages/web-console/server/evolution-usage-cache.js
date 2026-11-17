import {DatabaseSync} from 'node:sqlite'
import {constants} from 'node:fs'
import {lstat, realpath, open} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {digest, fail} from './security.js'

const MAX_BYTES = 32 * 1024 * 1024
const MAX_RECORDS = 128
const recordHash = row => digest(JSON.stringify([row.source_key, row.journal_digest, row.context_hash, row.stats_version, row.entry_count, row.result_json]))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const time = value => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value))
const optionalCount = value => value === null || count(value)
const shape = (value, fields, required = Object.keys(fields)) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.entries(value).every(([key, value]) => Object.hasOwn(fields, key) && fields[key](value))
const access = value => value === null || shape(value, {
  counter: value => ['readCount', 'searchCount'].includes(value), at: value => value !== null && time(value), provenance: value => value === null,
})
const memoryFields = {readCount: optionalCount, searchCount: optionalCount, lastUsedAt: time, lastAccess: access, trackingSince: time, entryTrackingSince: time}
const skillFields = {modelUseCount: optionalCount, userUseCount: optionalCount, fileReadCount: optionalCount, lastUsedAt: time, lastInvocationAt: time, loadCount: optionalCount, trackingSince: time, callTrackingSince: time}
const memoryItemFields = {readCount: optionalCount, searchCount: optionalCount, lastAccess: access}
const skillItemFields = {modelUseCount: count, userUseCount: count, fileReadCount: count, lastUsedAt: time, lastInvocationAt: time, updatedSinceUse: value => typeof value === 'boolean'}
const usageValid = value => shape(value, {
  memory: value => shape(value, memoryFields), skills: value => shape(value, skillFields),
  items: value => object(value) && Object.entries(value).every(([id, row]) => !['__proto__', 'constructor', 'prototype'].includes(id)
    && (shape(row, {memoryUse: value => shape(value, memoryItemFields)})
      || shape(row, skillItemFields, ['modelUseCount', 'userUseCount', 'fileReadCount', 'lastUsedAt', 'updatedSinceUse']))),
  eventCount: count, oldestObservedAt: time, newestObservedAt: time,
  reasons: value => Array.isArray(value) && value.every(code => typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code)),
})

// 这里只保存计数和覆盖元数据；正文、来源路径、事件和权限事实仍由原存储持有。
export async function openEvolutionUsageCache({directory, identity, now = Date.now}) {
  directory = resolve(directory)
  const path = join(directory, `evolution-usage-${digest(identity)}.sqlite`)
  const privateStat = stat => process.platform === 'win32' || stat.uid === process.getuid() && (stat.mode & 0o077) === 0
  const safeFile = stat => {if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !privateStat(stat)) fail('EVOLUTION_USAGE_CACHE_PATH_UNSAFE', 503)}
  async function root() {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !privateStat(stat) || await realpath(directory) !== directory) fail('EVOLUTION_USAGE_CACHE_PATH_UNSAFE', 503)
    return stat
  }
  const rootStat = await root()
  async function files() {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {safeFile(await lstat(path + suffix))} catch (error) {if (error.code !== 'ENOENT') throw error}
    }
  }
  await files()
  try {const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); await file.close()}
  catch (error) {if (error.code !== 'EEXIST') throw error}
  await files()
  const fileStat = await lstat(path)
  let db, closed = false
  try {
    db = new DatabaseSync(path)
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (![0, 1].includes(version)) fail('EVOLUTION_USAGE_CACHE_VERSION_INVALID', 503)
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA auto_vacuum=FULL;
      CREATE TABLE IF NOT EXISTS session_usage (
        source_key TEXT PRIMARY KEY, journal_digest TEXT NOT NULL, context_hash TEXT NOT NULL,
        stats_version INTEGER NOT NULL, entry_count INTEGER NOT NULL, result_json TEXT NOT NULL,
        result_hash TEXT NOT NULL, computed_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS usage_lru ON session_usage(last_used_at,source_key);
      PRAGMA user_version=1;`)
  } catch (error) {db?.close(); if (error.code?.startsWith('EVOLUTION_USAGE_')) throw error; fail('EVOLUTION_USAGE_CACHE_INVALID', 503)}
  try {
    const get = db.prepare('SELECT * FROM session_usage WHERE source_key=? AND context_hash=? AND stats_version=?')
    const put = db.prepare(`INSERT INTO session_usage VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET
      journal_digest=excluded.journal_digest,context_hash=excluded.context_hash,stats_version=excluded.stats_version,
      entry_count=excluded.entry_count,result_json=excluded.result_json,result_hash=excluded.result_hash,
      computed_at=excluded.computed_at,last_used_at=excluded.last_used_at`)
    const touch = db.prepare('UPDATE session_usage SET last_used_at=? WHERE source_key=?')
    const size = db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(result_json AS BLOB))),0) AS bytes FROM session_usage')
    const oldest = db.prepare('DELETE FROM session_usage WHERE source_key=(SELECT source_key FROM session_usage ORDER BY last_used_at,source_key LIMIT 1)')
    return {
      path,
      async check() {
        if (closed) fail('EVOLUTION_USAGE_CACHE_CLOSED', 503)
        const current = await root()
        if (current.dev !== rootStat.dev || current.ino !== rootStat.ino) fail('EVOLUTION_USAGE_CACHE_PATH_UNSAFE', 503)
        await files()
        const currentFile = await lstat(path)
        if (currentFile.dev !== fileStat.dev || currentFile.ino !== fileStat.ino) fail('EVOLUTION_USAGE_CACHE_PATH_UNSAFE', 503)
      },
      get({sourceKey, contextHash, statsVersion}) {
        let row
        try {row = get.get(sourceKey, contextHash, statsVersion)} catch {fail('EVOLUTION_USAGE_CACHE_INVALID', 503)}
        if (!row || !count(row.entry_count) || Buffer.byteLength(row.result_json) > MAX_BYTES || recordHash(row) !== row.result_hash) return null
        try {
          const usage = JSON.parse(row.result_json)
          if (!usageValid(usage) || usage.eventCount > row.entry_count) return null
          return {journalDigest: row.journal_digest, entryCount: row.entry_count, usage}
        } catch {return null}
      },
      commit({records, accessed}) {
        const stamp = now()
        db.exec('BEGIN IMMEDIATE')
        try {
          for (const key of accessed) touch.run(stamp, key)
          for (const row of records) {
            if (!usageValid(row.usage)) fail('EVOLUTION_USAGE_CACHE_RESULT_INVALID', 503)
            const json = JSON.stringify(row.usage)
            if (Buffer.byteLength(json) > MAX_BYTES) continue
            put.run(row.sourceKey, row.journalDigest, row.contextHash, row.statsVersion, row.entryCount, json, recordHash({source_key: row.sourceKey, journal_digest: row.journalDigest, context_hash: row.contextHash, stats_version: row.statsVersion, entry_count: row.entryCount, result_json: json}), stamp, stamp)
          }
          let total = size.get()
          while (total.n > MAX_RECORDS || total.bytes > MAX_BYTES) {oldest.run(); total = size.get()}
          db.exec('COMMIT')
        } catch (error) {db.exec('ROLLBACK'); throw error}
      },
      close() {if (!closed) {closed = true; db.close()}},
    }
  } catch {db.close(); fail('EVOLUTION_USAGE_CACHE_INVALID', 503)}
}
