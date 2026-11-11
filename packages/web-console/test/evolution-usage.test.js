import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {queryEvolutionUsage} from '../server/evolution-usage.js'
const hash = value => createHash('sha256').update(value).digest('hex')
const scope = 'bot/shared', memoryResources = [{scopeToken: scope, storageId: 'memory-one', itemId: 'public-memory'}]
const skillResources = [{itemId: 'public-skill', name: 'check', provider: 'filesystem', path: '/install/skills/check/SKILL.md', resourceBasePath: '/install/skills/check', contentVersion: hash('body')}]
function journal(sessionId = 'session-one', taskId = 'task-one') {
 const entries = [], audit = []; let serial = 0
 const add = (body, parentId = entries.at(-1)?.id ?? null) => {const entry = {id: 'e' + ++serial, parentId, timestamp: new Date(1700000000000 + serial * 1000).toISOString(), ...body}; entries.push(entry); return entry}
 const receipt = (domain, kind, payload) => {const data = {version: 1, domain, kind, payload}; audit.push(data); return add({type: 'custom', customType: 'night.audit', data})}
 receipt('task', 'identity', {taskId, sessionId})
 const call = (name, args, id = 'vendor-id', parent) => add({type: 'message', message: {role: 'assistant', content: [{type: 'toolCall', id, name, arguments: args}]}}, parent)
 const result = (name, value, {id = 'vendor-id', parent, error = false} = {}) => add({type: 'message', message: {role: 'toolResult', toolName: name, toolCallId: id, isError: error, content: [{type: 'text', text: JSON.stringify(value)}], details: {nativeResult: {value}}}}, parent)
 return {snapshot: {header: {id: sessionId}, entries, audit}, add, receipt, call, result}
}
function options(j) {return {application: {tasks: {store: {query: async q => q.kind === 'observer.page' ? {items: [{taskId: 'task-one', sessionId: 'session-one', sessionBound: true}], total: 1, nextOffset: null, revision: '1'} : []}}}, sessionPersistence: {readNative: async (id, opts) => {assert.equal(id, 'session-one'); assert.deepEqual(opts, {requireComplete: true}); return j.snapshot}}, allowedScopeTokens: [scope], memoryResources, skillResources}}
const memoryValue = (ids = ['memory-one']) => ({kind: 'night-memory-result', scopeToken: scope, revision: 1, entries: ids.map(id => ({id}))})
const skillValue = () => ({name: 'check', provider: 'filesystem', resourceBase: {kind: 'directory', path: '/install/skills/check'}, content: 'body'})

function failedScan(sessionId = 'session-one', taskId = 'task-one') {
 const j = journal(sessionId, taskId)
 j.call('memory_read', {}); j.result('memory_read', memoryValue())
 j.call('skill', {name: 'check'}); j.result('skill', skillValue())
 j.receipt('admission', 'enqueued', {id: 'packet', content: '/skill:check'})
 j.receipt('admission', 'command-started', {id: 'packet', name: 'check', beforeEntryIds: {}})
 const user = j.add({type: 'message', message: {role: 'user', content: 'hello'}})
 j.receipt('admission', 'command-admitted', {id: 'packet', entryId: user.id, bodyDigest: hash(JSON.stringify(user.message.content))})
 return j
}
function multiple(journals) {
 const o = options(journals[0])
 o.application.tasks.store.query = async q => q.kind === 'observer.page' ? {items: journals.map(j => j.snapshot.audit[0].payload), total: journals.length, nextOffset: null, revision: '1'} : []
 o.sessionPersistence.readNative = async id => journals.find(j => j.snapshot.header.id === id).snapshot
 return o
}

test('failed scans discard all observations but retain the failure and consumed read budget', async () => {
 const j = failedScan(), result = await queryEvolutionUsage(options(j))
 const empty = await queryEvolutionUsage(options(journal()))
 assert.equal(result.coverage.sessionsRead, 0)
 assert.deepEqual(result.coverage.reasons, ['SESSION_EVIDENCE_INVALID'])
 assert.equal(result.coverage.entriesRead, j.snapshot.entries.length)
 assert.deepEqual(result.memory, empty.memory); assert.deepEqual(result.skills, empty.skills)
 assert.deepEqual(Object.keys(result.items), [])
 assert.equal(result.coverage.oldestObservedAt, null); assert.equal(result.coverage.newestObservedAt, null)
})
for (const failedId of ['session-a', 'session-z']) test(`failed ${failedId} cannot alter another session's valid observations`, async () => {
 const valid = journal('session-m', 'task-m')
 valid.call('memory_search', {}); valid.result('memory_search', memoryValue())
 valid.call('skill', {name: 'check'}); valid.result('skill', {...skillValue(), content: 'old body'})
 for (const entry of valid.snapshot.entries) entry.timestamp = '2026-11-01T00:00:00.000Z'
 const bad = failedScan(failedId, 'task-bad'), expected = await queryEvolutionUsage(multiple([valid]))
 const result = await queryEvolutionUsage(multiple([valid, bad]))
 assert.equal(result.coverage.sessionsDiscovered, 2); assert.equal(result.coverage.sessionsRead, 1)
 assert.deepEqual(result.coverage.reasons, ['SESSION_EVIDENCE_INVALID'])
 assert.deepEqual(result.memory, expected.memory); assert.deepEqual(result.skills, expected.skills); assert.deepEqual(result.items, expected.items)
 assert.equal(result.coverage.oldestObservedAt, expected.coverage.oldestObservedAt)
 assert.equal(result.coverage.newestObservedAt, expected.coverage.newestObservedAt)
 assert.equal(result.coverage.entriesRead, valid.snapshot.entries.length + bad.snapshot.entries.length)
})
test('successful sessions merge counts and chronology without replacing latest invocation metadata', async () => {
 const newer = journal('session-a', 'task-a'), older = journal('session-z', 'task-z')
 for (const j of [newer, older]) {
  j.call('memory_read', {}); j.result('memory_read', memoryValue())
  j.call('memory_search', {}); j.result('memory_search', memoryValue())
  j.call('skill', {name: 'check'}); j.result('skill', {...skillValue(), content: j === newer ? 'new body' : 'body'})
  for (const entry of j.snapshot.entries) entry.timestamp = j === newer ? '2026-11-02T00:00:00.000Z' : '2026-11-01T00:00:00.000Z'
 }
 const result = await queryEvolutionUsage(multiple([newer, older]))
 assert.equal(result.coverage.sessionsRead, 2); assert.equal(result.coverage.status, 'ready')
 assert.equal(result.memory.readCount, 2); assert.equal(result.memory.searchCount, 2); assert.equal(result.skills.modelUseCount, 2)
 assert.equal(result.items['public-memory'].memoryUse.readCount, 2); assert.equal(result.items['public-memory'].memoryUse.searchCount, 2)
 assert.equal(result.items['public-skill'].modelUseCount, 2); assert.equal(result.items['public-skill'].updatedSinceUse, true)
 for (const stats of [result.memory, result.skills]) {assert.equal(stats.trackingSince, '2026-11-01T00:00:00.000Z'); assert.equal(stats.lastUsedAt, '2026-11-02T00:00:00.000Z')}
 assert.equal(result.memory.lastAccess.at, '2026-11-02T00:00:00.000Z')
 assert.equal(result.coverage.oldestObservedAt, '2026-11-01T00:00:00.000Z'); assert.equal(result.coverage.newestObservedAt, '2026-11-02T00:00:00.000Z')
})

test('memory uses committed returned IDs, deduplicates a hit, separates read/search, never mutates snapshots', async () => {
 const j = journal(); j.call('memory_read', {topic: 'facts'}); j.result('memory_read', memoryValue(['memory-one', 'memory-one']))
 j.call('memory_search', {query: 'fact'}); const last = j.result('memory_search', memoryValue())
 const before = JSON.stringify(j.snapshot), result = await queryEvolutionUsage(options(j))
 assert.equal(result.memory.readCount, 1); assert.equal(result.memory.searchCount, 1)
 assert.equal(result.items['public-memory'].memoryUse.readCount, 1); assert.equal(result.items['public-memory'].memoryUse.lastAccess.at, last.timestamp)
 assert.equal(result.coverage.status, 'ready'); assert.equal(result.skills.loadCount, null)
 assert.equal(JSON.stringify(j.snapshot), before); assert.doesNotMatch(JSON.stringify(result), /memory-one|vendor-id|\/install/)
})
test('same-version skill results count repeatedly even without new observation receipts', async () => {
 const j = journal(); j.call('skill', {name: 'check'}); j.result('skill', skillValue()); j.call('skill', {name: 'check'}); const last = j.result('skill', skillValue())
 const result = await queryEvolutionUsage(options(j)); assert.equal(result.skills.modelUseCount, 2); assert.equal(result.items['public-skill'].lastUsedAt, last.timestamp); assert.equal(result.items['public-skill'].updatedSinceUse, false)
})
test('a result cannot pair with a sibling branch, duplicate pending ID, or different tool name', async () => {
 const j = journal(), root = j.snapshot.entries[0]; j.call('memory_read', {}, 'a', root.id); j.result('memory_read', memoryValue(), {id: 'a', parent: root.id})
 j.call('memory_read', {}, 'dup'); j.call('memory_read', {}, 'dup'); j.result('memory_read', memoryValue(), {id: 'dup'})
 j.call('skill', {name: 'check'}, 'wrong'); j.result('memory_read', memoryValue(), {id: 'wrong'})
 const result = await queryEvolutionUsage(options(j)); assert.equal(result.memory.readCount, null); assert.equal(result.coverage.status, 'partial'); assert.deepEqual(Object.keys(result.items), [])
})
test('errors, foreign scopes, candidate tools and arbitrary textual mentions do not count', async () => {
 const j = journal(); j.call('memory_read', {}); j.result('memory_read', memoryValue(), {error: true}); j.call('memory_search', {}); j.result('memory_search', {ok: false})
 j.call('memory_read', {}); j.result('memory_read', {...memoryValue(), scopeToken: 'foreign'}); j.call('memory_candidates', {}); j.result('memory_candidates', memoryValue())
 j.add({type: 'message', message: {role: 'user', content: '/skill:check'}})
 const result = await queryEvolutionUsage(options(j)); assert.equal(result.memory.readCount, null); assert.equal(result.skills.userUseCount, null); assert.equal(result.coverage.status, 'unrecorded')
})
test('absolute successful skill entry reads count; relative or different files do not', async () => {
 const j = journal(); j.call('read', {path: skillResources[0].path}); j.result('read', {text: 'body', images: []}); j.call('read_window', {path: 'SKILL.md'}); j.result('read_window', {}); j.call('read', {path: '/other/SKILL.md'}); j.result('read', {})
 const result = await queryEvolutionUsage(options(j)); assert.equal(result.skills.fileReadCount, 1)
})
test('user invocation requires admitted host command, exact expanded body and real resource location', async () => {
 const j = journal(), name = 'check'; j.receipt('admission', 'enqueued', {id: 'packet', source: {kind: 'user'}, content: '/skill:check use'})
 j.receipt('admission', 'command-started', {id: 'packet', name, beforeEntryIds: j.snapshot.entries.map(e => e.id)})
 const content = '<skill name="check" location="/install/skills/check/SKILL.md">\nReferences are relative to /install/skills/check.\n\nbody\n</skill>\n\nuse'
 const user = j.add({type: 'message', message: {role: 'user', content}})
 j.receipt('admission', 'command-admitted', {id: 'packet', entryId: user.id, bodyDigest: hash(JSON.stringify(content))})
 const result = await queryEvolutionUsage(options(j)); assert.equal(result.skills.userUseCount, 1); assert.equal(result.items['public-skill'].lastUsedAt, user.timestamp)
 j.snapshot.entries.at(-1).data.payload.bodyDigest = 'wrong'
 assert.equal((await queryEvolutionUsage(options(j))).skills.userUseCount, null)
})
test('identity mismatch, missing journals and budgets are explicit partial, not fabricated zero', async () => {
 const j = journal(); j.snapshot.header.id = 'foreign'; assert.equal((await queryEvolutionUsage(options(j))).coverage.status, 'partial')
 const o = options(j); o.sessionPersistence.readNative = async () => {throw Error('private path')}; const failed = await queryEvolutionUsage(o); assert.equal(failed.memory.readCount, null); assert.doesNotMatch(JSON.stringify(failed), /private path/)
 const big = journal(); big.call('skill', {name: 'check'}); big.result('skill', skillValue()); const limited = await queryEvolutionUsage({...options(big), limits: {maxEntriesPerSession: 1}}); assert.ok(limited.coverage.reasons.includes('ENTRY_LIMIT')); assert.equal(limited.skills.modelUseCount, null)
})
test('query concurrency is bounded to two and session counts disclose truncation', async () => {
 let active = 0, max = 0; const o = options(journal()); o.application.tasks.store.query = async q => q.kind === 'observer.page' ? {items: Array.from({length: 5}, (_, i) => ({taskId: 'task-' + i, sessionId: 'session-' + i})).slice(q.offset, q.offset + q.limit), total: 5, nextOffset: q.offset + q.limit < 5 ? q.offset + q.limit : null, revision: '1'} : []
 o.sessionPersistence.readNative = async id => {active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return journal(id, id.replace('session', 'task')).snapshot}
 const result = await queryEvolutionUsage({...o, limits: {maxSessions: 3}}); assert.equal(max, 2); assert.equal(result.coverage.sessionsRead, 3); assert.ok(result.coverage.reasons.includes('SESSION_LIMIT'))
})
test('same-name resource ambiguity is not guessed, and changed version is reported only with content', async () => {
 const j = journal(); j.call('skill', {name: 'check'}); j.result('skill', skillValue())
 const ambiguous = await queryEvolutionUsage({...options(j), skillResources: [...skillResources, {...skillResources[0], itemId: 'other'}]}); assert.equal(ambiguous.skills.modelUseCount, null); assert.ok(ambiguous.coverage.reasons.includes('UNRESOLVED_SKILL_RESOURCE'))
 const changed = await queryEvolutionUsage({...options(j), skillResources: [{...skillResources[0], contentVersion: hash('new')}]}); assert.equal(changed.items['public-skill'].updatedSinceUse, true)
})
test('raw committed branches are counted without depending on compacted current context', async () => {
 const j = journal(); j.call('memory_read', {}); j.result('memory_read', memoryValue()); j.snapshot.context = {projection: {entries: []}}
 assert.equal((await queryEvolutionUsage(options(j))).memory.readCount, 1)
})
test('authenticated channel descriptors cover standalone hosts and reject unrelated channel headers', async () => {
 const descriptor = {type: 'chat', channelId: 'web', conversationId: 'one', senderId: 'operator'}
 descriptor.sessionId = 'conversation-' + hash(JSON.stringify(['chat', 'web', 'one', 'operator']))
 const j = journal(descriptor.sessionId); j.snapshot.audit = []; j.snapshot.entries = []; // Keep builder's retained entries; replace the task audit with channel evidence below.
 const source = {kind: 'user', channelType: 'chat', channelId: 'web', conversationId: 'one', senderId: 'operator', principal: 'channel-actor-' + hash(JSON.stringify(['web', 'operator']))}
 const entry = {id: 'channel-root', parentId: null, type: 'custom', customType: 'night.audit', timestamp: '2026-01-01T00:00:00Z', data: {version: 1, domain: 'admission', kind: 'enqueued', payload: {id: 'channel-packet', source, content: 'hello'}}}
 j.snapshot.entries = [entry, {id: 'call', parentId: entry.id, type: 'message', timestamp: entry.timestamp, message: {role: 'assistant', content: [{type: 'toolCall', id: 'c', name: 'skill', arguments: {name: 'check'}}]}}, {id: 'result', parentId: 'call', type: 'message', timestamp: entry.timestamp, message: {role: 'toolResult', toolCallId: 'c', toolName: 'skill', content: [], details: {nativeResult: {value: skillValue()}}}}]
 j.snapshot.audit = [entry.data]
 const o = {...options(j), application: {tasks: {}}, channelSessions: [descriptor], sessionPersistence: {readNative: async () => j.snapshot}}
 assert.equal((await queryEvolutionUsage(o)).skills.modelUseCount, 1)
 source.channelId = 'foreign'; const denied = await queryEvolutionUsage(o); assert.equal(denied.skills.modelUseCount, null); assert.ok(denied.coverage.reasons.includes('SESSION_IDENTITY_INVALID'))
})
test('published router generations are independently verified and duplicate session descriptors deduplicate', async () => {
 const j = journal('router-old'); j.snapshot.audit = []; j.snapshot.header = {id: 'router-old', runtimeOwner: 'conversation-router', conversationId: 'conversation', generation: 1}
 j.call('skill', {name: 'check'}); j.result('skill', skillValue())
 const o = {...options(j), application: {tasks: {store: {query: async q => q.kind === 'observer.page' ? {items: [], total: 0, nextOffset: null} : q.kind === 'router.list' ? [{id: 'conversation', activeSessionId: 'router-new', generation: 2}] : [{state: 'published', conversationId: 'conversation', oldSessionId: 'router-old', oldGeneration: 1, oldCommit: 'old-commit'}, {state: 'started', conversationId: 'conversation', oldSessionId: 'ignored', oldGeneration: 1, oldCommit: 'x'}]}}}, sessionPersistence: {readNative: async id => {if (id === 'router-old') return j.snapshot; return {header: {id, runtimeOwner: 'conversation-router', conversationId: 'conversation', generation: 2}, entries: [], audit: []}}}}
 const result = await queryEvolutionUsage(o); assert.equal(result.coverage.sessionsRead, 2); assert.equal(result.skills.modelUseCount, 1)
 j.snapshot.header.conversationId = 'foreign'; assert.equal((await queryEvolutionUsage(o)).skills.modelUseCount, null)
})
test('native controlled path size preflight skips oversized files before readNative', async t => {
 const {mkdtemp, writeFile, rm} = await import('node:fs/promises'), {tmpdir} = await import('node:os'), {join} = await import('node:path')
 const dir = await mkdtemp(join(tmpdir(), 'evolution-budget-')); t.after(() => rm(dir, {recursive: true, force: true})); const file = join(dir, 'fixture'); await writeFile(file, 'too large')
 let reads = 0, guards = 0; const o = options(journal()); o.sessionPersistence = {path: () => file, checkedFile: async () => {guards++}, readNative: async () => {reads++; throw Error('must not read')}}
 const result = await queryEvolutionUsage({...o, limits: {maxSessionBytes: 1}}); assert.equal(guards, 1); assert.equal(reads, 0); assert.ok(result.coverage.reasons.includes('SESSION_BYTE_LIMIT'))
})

test('learned user invocation removes the Pi reference wrapper before comparing versions', async () => {
 const j = journal(), name = 'learned-check', location = '/ephemeral/pi-skills/learned-check/SKILL.md'
 const body = `NIGHT_LEARNED_SCOPE=${scope};revision=1\nbody`
 j.receipt('admission', 'enqueued', {id: 'packet', source: {kind: 'user'}, content: '/skill:learned-check inspect'})
 j.receipt('admission', 'command-started', {id: 'packet', name, beforeEntryIds: j.snapshot.entries.map(e => e.id)})
 const content = `<skill name="${name}" location="${location}">\nReferences are relative to /ephemeral/pi-skills/learned-check.\n\n${body}\n</skill>\n\ninspect`
 const user = j.add({type: 'message', message: {role: 'user', content}})
 j.receipt('admission', 'command-admitted', {id: 'packet', entryId: user.id, bodyDigest: hash(JSON.stringify(content))})
 const resource = {itemId: 'learned-item', name, provider: 'learned', scopeToken: scope, contentVersion: hash('body')}
 const result = await queryEvolutionUsage({...options(j), skillResources: [resource]})
 assert.equal(result.skills.userUseCount, 1); assert.equal(result.items['learned-item'].updatedSinceUse, false)
 const changed = await queryEvolutionUsage({...options(j), skillResources: [{...resource, contentVersion: hash('changed')}]})
 assert.equal(changed.items['learned-item'].updatedSinceUse, true)
})

test('relative reads require a unique matching descendant observation, never a sibling receipt', async () => {
 const j = journal(); j.call('read', {path: 'check/SKILL.md'}, 'relative'); const result = j.result('read', {text: 'body', images: []}, {id: 'relative'})
 const receipt = j.receipt('skill-observation', 'read', {callId: 'relative', resultEntryId: result.id, record: {kind: 'reference', path: skillResources[0].path}})
 assert.equal((await queryEvolutionUsage(options(j))).skills.fileReadCount, 1)
 receipt.parentId = j.snapshot.entries[0].id
 assert.equal((await queryEvolutionUsage(options(j))).skills.fileReadCount, null)
})

test('invalid event times stay unknown and mark usage coverage partial', async () => {
 const j = journal(); j.call('skill', {name: 'check'}); const result = j.result('skill', skillValue()); result.timestamp = 'invalid'
 const value = await queryEvolutionUsage(options(j))
 assert.equal(value.skills.modelUseCount, 1); assert.equal(value.items['public-skill'].lastUsedAt, null)
 assert.equal(value.coverage.status, 'partial'); assert.ok(value.coverage.reasons.includes('INVALID_EVENT_TIME'))
})

test('task discovery uses bounded revision-bound pages and never the all-task query', async () => {
 const o = options(journal()), pages = []
 o.application.tasks.store.query = async q => {
  assert.notEqual(q.kind, 'task.list')
  if (q.kind !== 'observer.page') return []
  pages.push(q)
  assert.equal(q.collection, 'tasks'); assert.equal(q.archived, 'all')
  return {items: Array.from({length: q.limit}, (_, i) => ({taskId: 'not-started-' + (q.offset + i), sessionBound: false})), total: 500, nextOffset: q.offset + q.limit, revision: 'catalog-1'}
 }
 const value = await queryEvolutionUsage(o)
 assert.deepEqual(pages.map(p => [p.offset, p.limit, p.revision]), [[0, 100, undefined], [100, 28, 'catalog-1']])
 assert.equal(value.coverage.sessionsRead, 0); assert.ok(value.coverage.reasons.includes('SESSION_LIMIT'))
})

test('catalog page failures remain partial without falling back to an unbounded task list', async () => {
 const o = options(journal()), calls = []
 o.application.tasks.store.query = async q => {calls.push(q.kind); if (q.kind === 'observer.page') throw Error('OBSERVER_PAGE_STALE'); return []}
 const value = await queryEvolutionUsage(o)
 assert.equal(value.coverage.status, 'partial'); assert.equal(value.memory.readCount, null)
 assert.deepEqual(calls, ['observer.page', 'router.list'])
})
