import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {memoryScope} from '../src/memory/scope.js'
import {inspectEvolution, recordUsage, readUsage} from '../src/memory/evolution.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'night-evolution-'))
  const store = new MarkdownMemoryStore(root)
  t.after(async () => {await store.close(); await rm(root, {recursive: true, force: true})})
  const binding = {actorId: 'reader'}, scope = memoryScope(binding)
  const reflection = {state: async () => ({skills: {}})}
  const remember = (key, options = {}) => store.remember(scope, {topic: 'experience', key, text: 'PRIVATE BODY', source: {sessionId: 'private-session', messageId: key}, ...options})
  return {root, store, binding, scope, reflection, remember}
}

test('evolution reports retained current state, unknown historical usage, filters and pagination without bodies', async t => {
  const f = await fixture(t)
  await f.remember('first'); await f.remember('second', {candidate: true})
  f.reflection.state = async () => ({skills: {learn: {active: true, revision: 2, updatedAt: '2026-11-09T01:00:00Z', supports: [{memoryKey: 'first', taskId: 'task-one'}], steps: ['PRIVATE SKILL']}, stale: {active: true, supports: [{memoryKey: 'gone'}]}}})
  const result = await inspectEvolution({store: f.store}, f.reflection, f.binding, {limit: 1})
  assert.equal(result.memory.acceptedCount, 1); assert.equal(result.memory.candidateCount, 1)
  assert.equal(result.memory.readCount, null); assert.equal(result.skills.loadCount, null)
  assert.equal(result.skills.activeCount, 1); assert.equal(result.total, 4); assert.equal(result.nextOffset, 1)
  assert.equal(result.items.length, 1)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private-session|task-one|memoryKey|steps|source/)
  const skills = await inspectEvolution({store: f.store}, f.reflection, f.binding, {kind: 'skill'})
  assert.equal(skills.total, 2); assert.ok(skills.items.some(row=>row.name==='learned-learn'&&row.status==='applied'));assert.ok(skills.items.some(row=>row.name==='learned-stale'&&row.status==='unsupported'))
  await f.store.forget(f.scope, {topic: 'experience', key: 'first'})
  const forgotten = await inspectEvolution({store: f.store}, f.reflection, f.binding)
  assert.equal(forgotten.memory.acceptedCount, 0); assert.equal(forgotten.skills.activeCount, 0)
})

test('usage is concurrent-safe, durable and Bot-wide; dashboard reads do not increment usage', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({length: 8}, () => recordUsage(f.store, f.scope, 'readCount')))
  await recordUsage(f.store, f.scope, 'searchCount'); await recordUsage(f.store, f.scope, 'loadCount')
  const value = await inspectEvolution({store: f.store}, f.reflection, f.binding)
  assert.equal(value.memory.readCount, 8); assert.equal(value.memory.searchCount, 1); assert.equal(value.skills.loadCount, 1)
  assert.ok(value.memory.trackingSince); assert.ok(value.skills.lastUsedAt)
  assert.equal((await readUsage(new MarkdownMemoryStore(f.root), f.scope)).readCount, 8)
  assert.equal((await inspectEvolution({store: f.store}, f.reflection, {actorId: 'other'})).memory.readCount, 8)
  assert.equal((await inspectEvolution({store: f.store}, f.reflection, {actorId: 'reader', groupId: 'room'})).memory.readCount, 8)
  assert.equal((await readUsage(f.store, f.scope)).readCount, 8)
  assert.doesNotMatch(await readFile(join(f.store.directory(f.scope), 'usage.json'), 'utf8'), /reader|name|query|body/)
  await assert.rejects(recordUsage(f.store, f.scope, 'invented'), {code: 'EVOLUTION_USAGE_INVALID'})
})

test('learned availability uses the same first 50 unexpired experience records as the live catalog', async t => {
  const f = await fixture(t)
  let now = Date.now(); f.store.now = () => now
  await f.remember('expired', {expiresAt: new Date(now + 1000).toISOString()})
  for (let index = 0; index < 51; index++) await f.remember('record-' + index)
  now += 2000
  const values = {first: {active: true, supports: [{memoryKey: 'record-0'}]}, last: {active: true, supports: [{memoryKey: 'record-50'}]}, expired: {active: true, supports: [{memoryKey: 'expired'}]}}
  f.reflection.state = async () => ({skills: values})
  const current = await f.store.read(f.scope, {topic: 'experience'})
  assert.equal(current.entries.length, 50)
  assert.equal(current.entries[0].key, 'record-0')
  const result = await inspectEvolution({store: f.store}, f.reflection, f.binding, {kind: 'skill'})
  assert.equal(result.memory.acceptedCount, 51)
  assert.equal(result.skills.activeCount, 1)
  assert.deepEqual(result.items.filter(row=>row.status==='applied').map(item => item.name), ['learned-first']);assert.equal(result.items.length,3)
})

test('legacy selectors address one Bot namespace without double-counting the shared snapshot', async t => {
  const f = await fixture(t)
  const binding = {...f.binding, projects: [{id: 'permitted'}]}
  const project = memoryScope(binding, {scope: 'project', projectId: 'permitted'})
  const foreign = memoryScope({...f.binding, projects: [{id: 'foreign'}]}, {scope: 'project', projectId: 'foreign'})
  await f.remember('personal')
  for (const scope of [project, foreign]) await f.store.remember(scope, {topic: 'facts', key: 'record', text: 'PRIVATE BODY', source: {sessionId: 'session', messageId: 'message'}})
  await recordUsage(f.store, f.scope, 'readCount')
  await recordUsage(f.store, project, 'readCount')
  await recordUsage(f.store, foreign, 'readCount')
  const result = await inspectEvolution({store: f.store}, f.reflection, binding)
  assert.equal(result.memory.acceptedCount, 2); assert.equal(result.memory.readCount, 3)
  assert.deepEqual(result.items.map(item => item.scope).sort(), ['bot', 'bot'])
})
