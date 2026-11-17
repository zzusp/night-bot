import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, rm, readFile, writeFile, appendFile, stat, utimes, link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Context} from '@deepseek-ai/cordis'
import PiPersistence from '../../../src/pi-session-persistence.js'
import * as Authority from '../../../src/pi-authority.js'
import {queryEvolutionUsage} from '../server/evolution-usage.js'
import {openEvolutionUsageCache} from '../server/evolution-usage-cache.js'
import {digest} from '../server/security.js'

const scope = 'bot/shared'
const auditKinds = {'task/identity': value => typeof value.taskId === 'string' && typeof value.sessionId === 'string'}
const memoryResources = [{scopeToken: scope, storageId: 'memory-one', itemId: 'public-memory'}]
const skillResources = [{itemId: 'public-skill', name: 'check', provider: 'filesystem', path: '/install/skills/check/SKILL.md', resourceBasePath: '/install/skills/check', contentVersion: digest('body')}]
const usage = {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}
async function fixture(t, ids = ['source-a', 'source-b']) {
  const root = await mkdtemp(join(tmpdir(), 'night-usage-sqlite-')), directory = join(root, 'cache')
  await mkdir(directory, {mode: 0o700})
  const ctx = new Context(); await ctx.plugin(Authority)
  const backend = new PiPersistence(ctx, {root: join(root, 'sessions')})
  let clock = 1700000000000, cache
  const reads = [], digests = [], readNative = backend.readNative.bind(backend), readDigest = backend.readNativeDigest.bind(backend)
  backend.readNative = async (...args) => {reads.push(args[0]); return readNative(...args)}
  backend.readNativeDigest = async (...args) => {digests.push(args[0]); return readDigest(...args)}
  const createCache = () => openEvolutionUsageCache({directory, identity: 'fixture-reader', now: () => ++clock})
  cache = await createCache()
  t.after(async () => {cache.close(); await ctx.fiber.dispose(); await rm(root, {recursive: true, force: true})})
  const addUse = (writer, {invalidTime = false} = {}) => {
    const append = (name, args, value) => {
      const id = 'call-' + writer.manager.getEntries().length
      writer.manager.appendMessage({role: 'assistant', content: [{type: 'toolCall', id, name, arguments: args}], api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'toolUse', timestamp: ++clock, usage})
      writer.manager.appendMessage({role: 'toolResult', toolName: name, toolCallId: id, isError: false, timestamp: invalidTime ? 'invalid' : ++clock, content: [{type: 'text', text: JSON.stringify(value)}], details: {nativeResult: {value}}})
    }
    append('memory_read', {}, {kind: 'night-memory-result', scopeToken: scope, revision: 1, entries: [{id: 'memory-one'}]})
    append('skill', {name: 'check'}, {name: 'check', provider: 'filesystem', resourceBase: {kind: 'directory', path: '/install/skills/check'}, content: 'body'})
  }
  for (const id of ids) {
    const writer = await backend.createNative({version: 4, id, createdAt: clock, isSeeded: false, cwd: root}, {auditKinds})
    writer.appendAudit({version: 1, domain: 'task', kind: 'identity', payload: {taskId: 'task-' + id, sessionId: id}})
    writer.manager.appendMessage({role: 'user', content: 'PRIVATE_JOURNAL_BODY', timestamp: ++clock})
    addUse(writer); await writer.close()
  }
  const targets = ids.map(id => ({taskId: 'task-' + id, sessionId: id, sessionBound: true}))
  const application = {tasks: {store: {query: async q => q.kind === 'observer.page' ? {items: targets, total: targets.length, nextOffset: null, revision: '1'} : []}}}
  const run = options => queryEvolutionUsage({application, sessionPersistence: backend, allowedScopeTokens: [scope], memoryResources, skillResources, usageCache: cache, ...options})
  const inspect = (sql = 'SELECT * FROM session_usage') => {const db = new DatabaseSync(cache.path, {readOnly: true}); try {return db.prepare(sql).all()} finally {db.close()}}
  return {root, directory, backend, reads, digests, targets, application, run, inspect, get cache() {return cache},
    async reopen() {cache.close(); cache = await createCache()},
    async append(id, options) {const writer = await backend.openNative(id, {auditKinds}); addUse(writer, options); await writer.close()},
    mutate(sql, ...args) {const db = new DatabaseSync(cache.path); try {db.prepare(sql).run(...args)} finally {db.close()}},
  }
}

function sameUsage(actual, expected) {
  for (const field of ['items', 'memory', 'skills']) assert.deepEqual(actual[field], expected[field])
  assert.deepEqual({...actual.coverage, sessionsReused: 0}, {...expected.coverage, sessionsReused: 0})
}

test('real journals persist per-source results, survive restart and only rescan changed files', async t => {
  const f = await fixture(t), cold = await f.run()
  assert.equal(cold.memory.readCount, 2); assert.equal(cold.skills.modelUseCount, 2)
  assert.deepEqual(f.reads.toSorted(), ['source-a', 'source-b'])
  const saved = f.inspect()
  assert.equal(saved.length, 2)
  for (const row of saved) {
    const value = JSON.parse(row.result_json)
    assert.equal(value.memory.readCount, 1, 'aggregate merging must not mutate a cached source result')
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_JOURNAL_BODY|memory-one|bot\/shared|\/install|source-a|source-b/)
  }
  await f.reopen(); f.reads.length = 0
  const warm = await f.run(); sameUsage(warm, cold)
  assert.equal(warm.coverage.sessionsReused, 2); assert.equal(f.reads.length, 0); assert.equal(f.digests.length, 2)
  assert.deepEqual(f.inspect().map(row => row.computed_at), saved.map(row => row.computed_at))
  await f.append('source-a'); const changed = await f.run()
  assert.equal(changed.memory.readCount, 3); assert.equal(changed.skills.modelUseCount, 3)
  assert.equal(changed.coverage.sessionsReused, 1); assert.deepEqual(f.reads, ['source-a']); assert.equal(f.inspect().length, 2)
  const unchanged = f.inspect().filter(row => row.computed_at === saved.find(old => old.source_key === row.source_key).computed_at)
  assert.equal(unchanged.length, 1)
  const again = await f.run(); sameUsage(again, changed); assert.equal(again.coverage.sessionsReused, 2)
  t.diagnostic('cold: 2 native decodes; warm after reopen: 0 native decodes + 2 current-byte digests; single append: 1 native decode')
})

test('warm cache cannot hide uncommitted tails, equal-length corruption, missing files or hard links', async t => {
  const f = await fixture(t, ['source-a']); await f.run()
  const path = f.backend.path('source-a'), original = await readFile(path), info = await stat(path)
  await appendFile(path, '{"torn":')
  let result = await f.run(); assert.equal(result.memory.readCount, null); assert.ok(result.coverage.reasons.includes('SESSION_UNAVAILABLE'))
  assert.equal((await readFile(path)).length, original.length + 8)
  const tampered = original.toString().replace('PRIVATE_JOURNAL_BODY', 'CHANGED_JOURNAL_BODY')
  assert.equal(Buffer.byteLength(tampered), original.length)
  await writeFile(path, tampered); await utimes(path, info.atime, info.mtime)
  result = await f.run(); assert.equal(result.coverage.status, 'partial'); assert.equal(result.memory.readCount, null)
  await rm(path); result = await f.run(); assert.equal(result.memory.readCount, null)
  await writeFile(path, original); await link(path, path + '.alias')
  result = await f.run(); assert.equal(result.memory.readCount, null); assert.equal(result.coverage.sessionsReused, 0)
})

test('resource versions, authorized scopes, resource identities and task binding invalidate old statistics', async t => {
  const f = await fixture(t, ['source-a']); await f.run(); f.reads.length = 0
  const changed = await f.run({skillResources: [{...skillResources[0], contentVersion: digest('new body')}]})
  assert.equal(changed.items['public-skill'].updatedSinceUse, true); assert.equal(changed.coverage.sessionsReused, 0)
  const revoked = await f.run({allowedScopeTokens: []})
  assert.equal(revoked.memory.readCount, null); assert.equal(revoked.items['public-memory'], undefined); assert.equal(revoked.coverage.sessionsReused, 0)
  const rebound = await f.run({memoryResources: [{...memoryResources[0], itemId: 'new-public-memory'}]})
  assert.equal(rebound.items['public-memory'], undefined); assert.equal(rebound.items['new-public-memory'].memoryUse.readCount, 1)
  f.targets[0].taskId = 'foreign-task'
  const denied = await f.run()
  assert.equal(denied.memory.readCount, null); assert.ok(denied.coverage.reasons.includes('SESSION_IDENTITY_INVALID'))
  assert.equal(denied.coverage.sessionsReused, 0)
})

test('cached partial evidence retains reasons, null times and existing entry budgets', async t => {
  const f = await fixture(t, ['source-a']); await f.append('source-a', {invalidTime: true})
  const cold = await f.run(), warm = await f.run()
  assert.equal(cold.coverage.status, 'partial'); assert.ok(cold.coverage.reasons.includes('INVALID_EVENT_TIME'))
  sameUsage(warm, cold); assert.equal(warm.coverage.sessionsReused, 1)
  const limited = await f.run({limits: {maxEntriesPerSession: 1}})
  assert.equal(limited.memory.readCount, null); assert.ok(limited.coverage.reasons.includes('ENTRY_LIMIT'))
  assert.equal(limited.coverage.sessionsRead, 0); assert.equal(f.inspect().length, 1, 'not scanned is not deleted')
  const total = await f.run({limits: {maxEntries: 1}})
  assert.equal(total.memory.readCount, null); assert.ok(total.coverage.reasons.includes('ENTRY_LIMIT'))
})

test('bad rows and old rules rebuild from journals; removing a source does not retain its old contribution', async t => {
  const f = await fixture(t); await f.run()
  f.mutate("UPDATE session_usage SET result_json='{}'")
  f.reads.length = 0; const repaired = await f.run()
  assert.equal(repaired.memory.readCount, 2); assert.equal(f.reads.length, 2); assert.equal(repaired.coverage.sessionsReused, 0)
  f.mutate('UPDATE session_usage SET entry_count=0')
  assert.equal((await f.run()).memory.readCount, 2, 'metadata corruption cannot bypass validation or budgets')
  f.mutate('UPDATE session_usage SET stats_version=0')
  assert.equal((await f.run()).coverage.sessionsReused, 0)
  f.targets.splice(0, 1)
  const removed = await f.run()
  assert.equal(removed.memory.readCount, 1); assert.equal(removed.coverage.sessionsRead, 1)
  const noDiscovery = {tasks: {store: {query: async () => {throw Error('unavailable')}}}}
  const failed = await f.run({application: noDiscovery})
  assert.equal(failed.memory.readCount, null); assert.equal(failed.coverage.status, 'partial')
})

test('cache and auxiliary hard links are rejected without modifying their targets', async t => {
  const f = await fixture(t, ['source-a']), outside = join(f.root, 'outside')
  await writeFile(outside, 'DO_NOT_TOUCH')
  await link(outside, f.cache.path + '-journal')
  await assert.rejects(f.run(), {code: 'EVOLUTION_USAGE_CACHE_PATH_UNSAFE'})
  assert.equal(await readFile(outside, 'utf8'), 'DO_NOT_TOUCH')
  await rm(f.cache.path + '-journal'); f.cache.close()
  await rm(f.cache.path); await link(outside, f.cache.path)
  await assert.rejects(f.reopen(), {code: 'EVOLUTION_USAGE_CACHE_PATH_UNSAFE'})
  assert.equal(await readFile(outside, 'utf8'), 'DO_NOT_TOUCH')
})

test('LRU bounds row growth without treating discovery gaps as deletion and releases pages', async t => {
  const f = await fixture(t, ['source-a']); await f.run()
  const original = f.inspect()[0], value = JSON.parse(original.result_json)
  const record = sourceKey => ({sourceKey, journalDigest: original.journal_digest, contextHash: original.context_hash, statsVersion: original.stats_version, entryCount: original.entry_count, usage: value})
  f.cache.commit({records: Array.from({length: 127}, (_, i) => record('row-' + String(i).padStart(3, '0'))), accessed: []})
  assert.equal(f.inspect().length, 128)
  f.cache.commit({records: [record('new-row')], accessed: [original.source_key]})
  const rows = f.inspect()
  assert.equal(rows.length, 128); assert.ok(rows.some(row => row.source_key === original.source_key))
  assert.ok(rows.some(row => row.source_key === 'new-row')); assert.ok(!rows.some(row => row.source_key === 'row-000'))
  assert.equal(f.inspect('PRAGMA auto_vacuum')[0].auto_vacuum, 1)
  const db = new DatabaseSync(f.cache.path)
  try {db.exec('DELETE FROM session_usage')} finally {db.close()}
  assert.equal(f.inspect('PRAGMA freelist_count')[0].freelist_count, 0)
})
