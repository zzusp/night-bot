import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readEvolutionInventory} from '../server/evolution-inventory.js'
import {MarkdownMemoryStore} from '../../../src/memory/store.js'
import {memoryScope} from '../../../src/memory/scope.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'web-evolution-readonly-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(join(root, 'memory')), binding = {actorId: 'reader'}, scope = memoryScope(binding)
  await store.remember(scope, {topic: 'facts', key: 'one', text: 'Known fact', source: {sessionId: 'task-one', messageId: 'one'}})
  await store.remember(scope, {topic: 'experience', key: 'support', text: 'Verified lesson', source: {sessionId: 'task-one', messageId: 'two'}})
  const directory = store.directory(scope)
  await mkdir(join(directory, 'evolution'), {recursive: true})
  await writeFile(join(directory, 'evolution', 'state.json'), JSON.stringify({version: 1, skills: {'check-once': {active: true, supports: [{memoryKey: 'support'}], revision: 1, updatedAt: '2026-11-10T01:00:00Z'}}}))
  const paths = {installRoot: root, mode: 'managed', skills: join(root, 'skills')}
  await mkdir(join(paths.skills, 'local-check'), {recursive: true})
  await writeFile(join(paths.skills, 'local-check', 'SKILL.md'), '---\nname: local-check\ndescription: Verify outputs.\n---\nVerify once.\n')
  const forbidden = () => {throw Error('dedicated counters or writer must not be called')}
  const memory = {store, host: {runtimePaths: paths}, config: {}, inspectEvolution: forbidden, recordUsage: forbidden, skillUsage: {inspect: forbidden, record: forbidden}, installedPrevious: {scan: forbidden}}
  const reflection = {renderSkill: () => 'NIGHT_LEARNED_SCOPE=bot/test;revision=1\nVerified procedure'}
  return {root, store, scope, directory, memory, reflection, binding}
}
async function tree(root) {
  const values = {}
  async function walk(path) {for (const name of (await readdir(path)).sort()) {
    const file = join(path, name), stat = await lstat(file)
    if (stat.isDirectory()) await walk(file)
    else values[file.slice(root.length)] = {text: await readFile(file, 'utf8'), mtime: stat.mtimeMs}
  }}
  await walk(root); return values
}

test('Web inventory is read-only, scope-bound and keeps private matching keys out of DTO', async t => {
  const f = await fixture(t), before = await tree(f.root)
  const inventory = await readEvolutionInventory(f)
  assert.equal(inventory.memory.acceptedCount, 2)
  assert.equal(inventory.skills.installedCount, 1)
  assert.equal(inventory.skills.activeCount, 1)
  assert.equal(inventory.memoryResources.length, 2)
  assert.equal(inventory.skillResources.length, 2)
  assert.ok(inventory.skillResources.find(row => row.provider === 'filesystem').path.endsWith('SKILL.md'))
  assert.doesNotMatch(JSON.stringify(inventory.items), /storageId|scopeToken|contentVersion|Known fact|Verified procedure/)
  assert.deepEqual(await tree(f.root), before)
  await assert.rejects(readEvolutionInventory({...f, binding: {actorId: ''}}))
})

test('Web inventory refuses pending writes without recovering them or opening dedicated statistics', async t => {
  const f = await fixture(t)
  await writeFile(join(f.directory, 'usage.json'), 'invalid deliberately')
  assert.equal((await readEvolutionInventory(f)).memory.acceptedCount, 2)
  await writeFile(join(f.directory, 'pending.json'), '{"version":1,"writes":[]}')
  const before = await tree(f.root)
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_UNAVAILABLE'})
  assert.deepEqual(await tree(f.root), before)
})

test('Web inventory refuses an active writer and does not create missing scope storage', async t => {
  const f = await fixture(t)
  await writeFile(join(f.directory, '.lock'), '')
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_UNAVAILABLE'})
  const absent = {...f.memory, store: new MarkdownMemoryStore(join(f.root, 'missing'))}
  assert.equal((await readEvolutionInventory({...f, memory: absent})).memory.acceptedCount, 0)
  await assert.rejects(lstat(join(f.root, 'missing')), {code: 'ENOENT'})
})
