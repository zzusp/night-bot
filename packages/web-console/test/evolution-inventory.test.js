import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {writeFileSync} from 'node:fs'
import {acquireLock} from '../../../src/runtime/files.js'
import {readEvolutionInventory} from '../server/evolution-inventory.js'
import {openEvolutionCache} from '../server/evolution-cache.js'
import {entryPath} from '../../../src/memory/layered-format.js'
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
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_BUSY'})
  assert.deepEqual(await tree(f.root), before)
})

test('Web inventory does not create missing scope storage', async t => {
  const f = await fixture(t)
  const absent = {...f.memory, store: new MarkdownMemoryStore(join(f.root, 'missing'))}
  assert.equal((await readEvolutionInventory({...f, memory: absent})).memory.acceptedCount, 0)
  await assert.rejects(lstat(join(f.root, 'missing')), {code: 'ENOENT'})
})

test('first inventory reads concurrently with a real read-only memory transaction without joining its write path', async t => {
  const f = await fixture(t), before = await tree(f.root)
  const entered = Promise.withResolvers(), finish = Promise.withResolvers()
  const transaction = f.store.transaction(f.scope, async () => {entered.resolve(); await finish.promise})
  await entered.promise
  try {
    const locked = await tree(f.root)
    const inventory = await readEvolutionInventory(f)
    assert.equal(inventory.memory.acceptedCount, 2, 'an ordinary read lease must not delay or reject inventory')
    assert.deepEqual(await tree(f.root), locked)
  } finally {finish.resolve(); await transaction}
  assert.deepEqual(await tree(f.root), before)
})

test('inventory waits for the actual writer to finish its pending journal and reads only the committed result', async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), finish = Promise.withResolvers()
  f.store.beforeApply = async () => {entered.resolve(); await finish.promise}
  const write = f.store.remember(f.scope, {topic: 'facts', key: 'two', text: 'New committed fact', source: {sessionId: 'task-two', messageId: 'three'}})
  await entered.promise
  const pending = await readFile(join(f.directory, 'pending.json'), 'utf8')
  let settled = false
  const read = readEvolutionInventory(f).finally(() => {settled = true})
  try {
    await delay(50)
    assert.equal(settled, false)
    assert.equal(await readFile(join(f.directory, 'pending.json'), 'utf8'), pending, 'reader must not recover the writer journal')
  } finally {finish.resolve(); await write}
  const inventory = await read
  assert.equal(inventory.memory.acceptedCount, 3)
  assert.equal(inventory.items.filter(item => item.name === 'facts/two').length, 1)
  await assert.rejects(lstat(join(f.directory, 'pending.json')), {code: 'ENOENT'})
})

test('short reflection leases recover; persistent leases stay bounded and untouched', async t => {
  const f = await fixture(t), before = await tree(f.root)
  const release = await acquireLock(join(f.directory, 'evolution', '.lock'))
  const read = readEvolutionInventory(f)
  try {await delay(50)} finally {await release()}
  assert.equal((await read).skills.activeCount, 1)
  assert.deepEqual(await tree(f.root), before)
  const releasePersistent = await acquireLock(join(f.directory, 'evolution', '.lock'))
  try {
    const locked = await tree(f.root)
    await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_BUSY', status: 503})
    assert.deepEqual(await tree(f.root), locked)
  } finally {await releasePersistent()}
})

test('revision changes discard the whole snapshot rather than append mixed or duplicate rows', async t => {
  const f = await fixture(t), path = join(f.directory, 'scope.json')
  await f.store.remember(f.scope, {topic: 'facts', key: 'one', text: 'Known fact', expiresAt: new Date(Date.now() + 60_000).toISOString(), source: {sessionId: 'expiry', messageId: 'expiry'}})
  const meta = JSON.parse(await readFile(path, 'utf8'))
  const {buildLayeredWrites}=await import('../../../src/memory/layered-format.js')
  const snapshot=await f.store.transaction(f.scope,state=>({meta:{...meta,revision:meta.revision+1},topics:state.topics,candidates:state.candidates}))
  const next=buildLayeredWrites(f.scope,snapshot)
  let changed = false
  f.store.now = () => {
    // A completed concurrent commit advances indices and metadata together.
    if (!changed) {changed = true;for(const [name,text]of next)writeFileSync(join(f.directory,name),text)}
    return Date.now()
  }
  const inventory = await readEvolutionInventory(f)
  assert.equal(changed, true)
  assert.equal(inventory.memory.acceptedCount, 2)
  assert.equal(new Set(inventory.items.map(item => item.id)).size, inventory.items.length)
})

test('stable stale indices and interrupted layout migrations never publish an inventory',async t=>{
  const f=await fixture(t),path=join(f.directory,'scope.json'),original=await readFile(path,'utf8'),meta=JSON.parse(original)
  await writeFile(path,JSON.stringify({...meta,revision:meta.revision+1,entryDescriptors:[]}))
  await assert.rejects(readEvolutionInventory(f),{code:'EVOLUTION_UNAVAILABLE'})
  await writeFile(path,original)
  await writeFile(join(f.directory,'layout-migration.pending.json'),'{}')
  await assert.rejects(readEvolutionInventory(f),{code:'EVOLUTION_BUSY'})
})

test('malformed records and unsafe paths remain fatal instead of transient busy responses', async t => {
  const f = await fixture(t)
  await writeFile(join(f.directory, 'scope.json'), 'invalid JSON')
  await assert.rejects(readEvolutionInventory(f), SyntaxError)
  await writeFile(join(f.directory, 'scope.json'), JSON.stringify({version: 9, revision: 0, forgotten: [], seen: []}))
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_UNAVAILABLE'})
  // A future topic revision with no active writer or changed fence is corruption.
  await writeFile(join(f.directory, 'scope.json'), JSON.stringify({version: 1, revision: 0, forgotten: [], seen: []}))
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_UNAVAILABLE'})
  const external = join(f.root, 'external.json')
  await writeFile(external, JSON.stringify({version: 1, revision: 2, forgotten: [], seen: []}))
  await rm(join(f.directory, 'scope.json'))
  await link(external, join(f.directory, 'scope.json'))
  await assert.rejects(readEvolutionInventory(f), {code: 'EVOLUTION_BODY_FORBIDDEN'})
})

test('Router来源收据支持的Skill无须experience，坏来源和失去经验的复盘Skill仍不可用',async t=>{
 const f=await fixture(t),path=join(f.directory,'evolution','state.json'),state=JSON.parse(await readFile(path,'utf8'))
 const source={messageId:'authenticated-message',sessionId:'router-session',actor:'a'.repeat(64),quoteSha256:'b'.repeat(64)}
 state.skills['router-valid']={active:true,origin:'router',source,supports:[],revision:1}
 state.skills['router-invalid']={active:true,origin:'router',source:{...source,actor:'unbound'},supports:[{memoryKey:'support'}],revision:1}
 state.skills['unsupported-task']={active:true,supports:[{memoryKey:'missing'}],revision:1}
 await writeFile(path,JSON.stringify(state))
 const before=await tree(f.root),inventory=await readEvolutionInventory(f)
 assert.equal(inventory.items.find(r=>r.name==='learned-router-valid').status,'applied')
 assert.equal(inventory.items.find(r=>r.name==='learned-router-invalid').status,'unsupported')
 assert.equal(inventory.items.find(r=>r.name==='learned-unsupported-task').status,'unsupported')
 assert.equal(inventory.items.find(r=>r.name==='learned-check-once').status,'applied')
 assert.equal(inventory.skills.activeCount,2)
 assert.deepEqual(await tree(f.root),before,'清单保持只读，不创建经验或修复收据')
})


test('layered inventory reads descriptors, never accepted detail or source bodies', async t => {
  const f = await fixture(t)
  // A broken detail must not poison an unrelated metadata-only listing. Detail
  // validation belongs to the explicit body read, not the optional dashboard.
  await writeFile(join(f.directory, entryPath('facts', 'one')), 'DETAIL MUST NOT BE OPENED')
  await writeFile(join(f.directory, entryPath('experience', 'support')), 'DETAIL MUST NOT BE OPENED')
  f.store.transaction = () => {throw Error('full inventory must not load')}
  f.store.read = () => {throw Error('body read must not run')}
  const before = await tree(f.root), inventory = await readEvolutionInventory(f)
  assert.equal(inventory.memory.acceptedCount, 2)
  assert.equal(inventory.skills.activeCount, 1)
  assert.deepEqual(await tree(f.root), before)
})

test('layered inventory includes every category descriptor beyond the Bot read window', async t => {
  const f = await fixture(t)
  const {randomUUID} = await import('node:crypto')
  await f.store.transaction(f.scope, state => {
    const value = state.topics.get('facts'), template = value.entries[0]
    for (let index = 0; index < 61; index++) value.entries.push({...template, id: randomUUID(), key: 'extra-' + index})
    state.mark()
  })
  f.store.read = () => {throw Error('inventory must not use capped body reads')}
  const inventory = await readEvolutionInventory(f)
  assert.equal(inventory.memory.acceptedCount, 63)
  assert.equal(inventory.memoryResources.length, 63)
  assert.equal(inventory.items.filter(row => row.kind === 'memory').length, 63)
  assert.equal(new Set(inventory.items.map(row => row.id)).size, inventory.items.length)
  const directory = join(f.root, 'web-cache'); await mkdir(directory, {mode: 0o700})
  const cache = await openEvolutionCache({directory, identity: 'reader', collect: async () => ({status: 'ready', items: inventory.items, memory: inventory.memory, skills: inventory.skills, usageCoverage: {status: 'unrecorded'}})})
  t.after(() => cache.close())
  const first = await cache.read({kind: 'memory', offset: 0, limit: 50})
  const second = await cache.read({kind: 'memory', offset: 50, limit: 50})
  assert.equal(first.snapshot.total, 63)
  assert.equal(first.snapshot.items.length, 50)
  assert.equal(second.snapshot.items.length, 13)
  assert.equal(new Set([...first.snapshot.items, ...second.snapshot.items].map(row => row.id)).size, 63)
})
