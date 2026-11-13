import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {writeFileSync} from 'node:fs'
import {acquireLock} from '../../../src/runtime/files.js'
import {readEvolutionInventory, countSkillsUpdatedToday, countMemoryUpdatedToday} from '../server/evolution-inventory.js'
import {openEvolutionCache} from '../server/evolution-cache.js'
import {entryPath} from '../../../src/memory/layered-format.js'
import {MarkdownMemoryStore} from '../../../src/memory/store.js'
import {memoryScope} from '../../../src/memory/scope.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'web-evolution-readonly-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(join(root, 'memory')), binding = {actorId: 'reader'}, scope = memoryScope(binding)
  await store.remember(scope, {topic: 'facts', key: 'one', text: 'Known fact\n\nPRIVATE_DETAIL_BODY', source: {sessionId: 'task-one', messageId: 'one'}})
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
  assert.doesNotMatch(JSON.stringify(inventory.items), /storageId|scopeToken|contentVersion|PRIVATE_DETAIL_BODY|Verified procedure/)
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
  assert.equal(inventory.items.filter(item => item.name === 'New committed fact').length, 1)
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


test('memory display uses index title and summary, with generated-key and missing-label fallbacks', async () => {
  const {memoryDisplayLabel} = await import('../server/evolution-inventory.js')
  const entry = {topic: 'experience', key: 'separate-file-verification-from-delivery'}
  const summary = '文件创建与读回验证通过，不等于已通过渠道送达。'
  assert.deepEqual(memoryDisplayLabel({...entry, title: '交付与验证', summary}), {name: '交付与验证', summary})
  assert.deepEqual(memoryDisplayLabel({...entry, title: entry.key, summary}), {name: summary})
  assert.deepEqual(memoryDisplayLabel({...entry, title: 'experience/' + entry.key, summary}), {name: summary})
  assert.deepEqual(memoryDisplayLabel({...entry, title: '  ', summary}), {name: summary})
  assert.deepEqual(memoryDisplayLabel({...entry, title: summary, summary}), {name: summary})
  assert.deepEqual(memoryDisplayLabel(entry), {name: 'experience/' + entry.key})
})

test('inventory projects index labels without changing identity or reading the leaf file', async t => {
  const f = await fixture(t)
  const old = await readEvolutionInventory(f)
  const path = join(f.directory, 'index.md')
  const source = await readFile(path, 'utf8')
  await writeFile(path, source.replace('[one]', '[可读标题]').replace('Known fact', '文件创建与读回验证通过，不等于已通过渠道送达。'))
  await writeFile(join(f.directory, entryPath('facts', 'one')), 'UNREADABLE_DETAIL_SENTINEL')
  const before = await tree(f.root)
  const result = await readEvolutionInventory(f)
  const row = result.items.find(item => item.name === '可读标题')
  assert.equal(row.summary, '文件创建与读回验证通过，不等于已通过渠道送达。')
  assert.equal(row.id, old.items.find(item => item.name === 'Known fact').id)
  assert.doesNotMatch(JSON.stringify(result.items), /UNREADABLE_DETAIL_SENTINEL|PRIVATE_DETAIL_BODY/)
  assert.deepEqual(await tree(f.root), before)
})


test('today updates count distinct skills in Bot timezone, excluding old, future and invalid timestamps', () => {
  const now = Date.parse('2026-11-13T00:30:00Z')
  const row = (id, updatedAt, extra = {}) => ({id, kind: 'skill', updatedAt, ...extra})
  const items = [row('new', '2026-11-12T16:00:00Z'), row('new', '2026-11-13T00:00:00Z'), row('edited', '2026-11-13T00:00:00Z'), row('old', '2026-11-12T15:59:59Z'), row('invalid', 'unknown'), row('future', '2026-11-14T00:00:00Z'), row('memory', '2026-11-13T00:00:00Z', {kind: 'memory'}), row('shadow', '2026-11-13T00:00:00Z', {status: 'shadowed'})]
  assert.equal(countSkillsUpdatedToday(items, {now, timeZone: 'Asia/Shanghai'}), 2)
  assert.equal(countSkillsUpdatedToday(items, {now, timeZone: 'America/Los_Angeles'}), 3)
  assert.equal(countSkillsUpdatedToday([], {now, timeZone: 'UTC'}), 0)
})

test('today updates include installed SKILL.md and learned updatedAt without writing counters', async t => {
  const f = await fixture(t), before = await tree(f.root)
  const now = Date.now()
  const inventory = await readEvolutionInventory({...f, now})
  assert.equal(inventory.skills.todayUpdatedCount, 1)
  const learnedDay = await readEvolutionInventory({...f, now: Date.parse('2026-11-10T12:00:00Z'), timeZone: 'UTC'})
  assert.equal(learnedDay.skills.todayUpdatedCount, 1)
  assert.deepEqual(await tree(f.root), before)
})

test('today updates follow calendar days across daylight-saving changes, not a 24-hour window', () => {
  const skill = (id, updatedAt) => ({id, kind: 'skill', updatedAt})
  assert.equal(countSkillsUpdatedToday([
    skill('previous-day', '2026-03-08T07:59:59Z'),
    skill('midnight', '2026-03-08T08:00:00Z'),
    skill('after-jump', '2026-03-08T10:30:00Z'),
  ], {now: Date.parse('2026-03-09T06:59:59Z'), timeZone: 'America/Los_Angeles'}), 2)
  assert.equal(countSkillsUpdatedToday([
    skill('midnight', '2026-11-01T07:00:00Z'),
    skill('first-one', '2026-11-01T08:30:00Z'),
    skill('second-one', '2026-11-01T09:30:00Z'),
  ], {now: Date.parse('2026-11-02T07:59:59Z'), timeZone: 'America/Los_Angeles'}), 3)
})

test('memory today updates derive distinct applied records, not reads or candidates', () => {
  const now = Date.parse('2026-11-13T00:30:00Z')
  const row = (id, updatedAt, extra = {}) => ({id, kind: 'memory', status: 'applied', updatedAt, ...extra})
  const items = [row('new', '2026-11-12T16:00:00Z'), row('new', '2026-11-13T00:00:00Z'), row('edited', '2026-11-13T00:00:00Z'), row('old', '2026-11-12T15:59:59Z'), row('bad', null), row('future', '2026-11-13T01:00:00Z'), row('candidate', '2026-11-13T00:00:00Z', {status: 'candidate'}), row('skill', '2026-11-13T00:00:00Z', {kind: 'skill'})]
  assert.equal(countMemoryUpdatedToday(items, {now, timeZone: 'Asia/Shanghai'}), 2)
  assert.equal(countMemoryUpdatedToday(items, {now, timeZone: 'America/Los_Angeles'}), 3)
  assert.equal(countMemoryUpdatedToday([], {now, timeZone: 'UTC'}), 0)
})

test('memory today updates come from the full read-only inventory before list pagination', async t => {
  const f = await fixture(t), before = await tree(f.root)
  const current = await readEvolutionInventory(f)
  assert.equal(current.memory.todayUpdatedCount, 2)
  const previous = await readEvolutionInventory({...f, now: Date.now() - 86400000})
  assert.equal(previous.memory.todayUpdatedCount, 0)
  assert.deepEqual(await tree(f.root), before)
})
