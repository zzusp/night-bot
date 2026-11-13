import {lstat} from 'node:fs/promises'
import {join, dirname} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {bindingSchema, readableScopes, memoryDirectory} from '../../../src/memory/scope.js'
import {decodeTopic, hash, label} from '../../../src/memory/format.js'
import {decodeRootIndex} from '../../../src/memory/layered-format.js'
import {boundedRead} from '../../../src/memory/previous.js'
import {learnedSkillSupported} from '../../../src/memory/evolution.js'
import {installedSkills, contentVersion, pathSafe} from '../../../src/memory/skill-usage.js'
import {fail} from './security.js'

const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const exists = path => lstat(path).then(() => true, error => {if (error.code === 'ENOENT') return false; throw error})
const read = async (path, root) => (await boundedRead(path, 4 * 1024 * 1024, {root}))?.text ?? null
const snapshotRetryDelays = [25, 50, 100, 200]
const busy = () => fail('EVOLUTION_BUSY', 503)
// A dashboard read must not enter store.transaction (which recovers and writes),
// inspectEvolution (dedicated counters), or installedPrevious.scan (snapshots).
// Retry a fresh fenced snapshot on contention, without acquiring or recovering a lock.
async function scopeSnapshot(memory, scope) {
  for (let attempt = 0;; attempt++) {
    try {return await readScopeSnapshot(memory, scope)}
    catch (error) {
      if (!['EVOLUTION_BUSY', 'EVOLUTION_VERSION_STALE'].includes(error.code)) throw error
      if (attempt === snapshotRetryDelays.length) busy()
      await delay(snapshotRetryDelays[attempt])
    }
  }
}
async function readScopeSnapshot(memory, scope) {
  const root = memory.store.root, directory = memoryDirectory(root, scope)
  const checkIdle = async () => {
    // The scope lease also covers ordinary read/index/search transactions.
    // It is not a write marker: store.runTransaction publishes pending.json
    // before changing any topic, writes scope.json last, then removes pending.
    // The journal + revision fences protect this read without blocking on readers.
    if (await exists(join(directory, 'pending.json')) || await exists(join(directory, 'layout-migration.pending.json')) || await exists(join(directory, 'evolution', '.lock'))) busy()
  }
  await pathSafe(directory, root, root)
  await checkIdle()
  const metaText = await read(join(directory, 'scope.json'), root)
  const stateText = await read(join(directory, 'evolution', 'state.json'), root)
  const meta = JSON.parse(metaText ?? '{"version":1,"revision":0,"forgotten":[],"seen":[]}')
  if (meta.version !== 1 || !Number.isSafeInteger(meta.revision) || !Array.isArray(meta.forgotten) || !Array.isArray(meta.seen)) fail('EVOLUTION_UNAVAILABLE', 503)
  const state = JSON.parse(stateText ?? '{"version":1,"skills":{}}')
  if (state.version !== 1 || !state.skills || typeof state.skills !== 'object' || Array.isArray(state.skills)) fail('EVOLUTION_UNAVAILABLE', 503)
  const checkCurrent = async () => {
    await checkIdle()
    if (metaText !== await read(join(directory, 'scope.json'), root) || stateText !== await read(join(directory, 'evolution', 'state.json'), root)) busy()
  }
  const entries = [], candidates = []; let bytes = 0
  const active = entry => !entry.expiresAt || Date.parse(entry.expiresAt) > (memory.store.now?.() ?? Date.now())
  const loadIndex = async (path, decode, required = false, expectedHash) => {
    const text = await read(path, root)
    if (text === null) {
      if (required) {await checkCurrent(); fail('EVOLUTION_UNAVAILABLE', 503)}
      return null
    }
    bytes += Buffer.byteLength(text)
    if (bytes > 32 * 1024 * 1024) fail('EVOLUTION_UNAVAILABLE', 503)
    if (expectedHash && hash(text) !== expectedHash) {await checkCurrent(); fail('EVOLUTION_UNAVAILABLE', 503)}
    let value
    try {value = decode(text)} catch {await checkCurrent(); fail('EVOLUTION_UNAVAILABLE', 503)}
    if (value.scope?.kind !== scope.kind || value.scope?.id !== scope.id) fail('EVOLUTION_UNAVAILABLE', 503)
    if (value.revision !== meta.revision) {await checkCurrent(); fail('EVOLUTION_UNAVAILABLE', 503)}
    return value
  }
  // Markdown owns titles/links/summaries; metadata is fenced above.
  // Never open fact/source bodies for the Web inventory.
  const index = await loadIndex(join(directory, 'index.md'), text => decodeRootIndex(text, scope, meta))
  if (!index && meta.revision > 0) {await checkCurrent(); fail('EVOLUTION_UNAVAILABLE', 503)}
  entries.push(...(index?.entries ?? []).filter(active))
  const candidateIndex = await loadIndex(join(directory, 'candidates.md'), decodeTopic)
  for (const entry of candidateIndex?.entries ?? []) {
    if (!label(entry.topic)) fail('EVOLUTION_UNAVAILABLE', 503)
    if (active(entry)) candidates.push(entry)
  }
  await checkCurrent()
  return {revision: meta.revision, entries, candidates, state}
}

/** Authenticated, read-only current inventory. Private matching keys never enter the DTO. */
export async function readEvolutionInventory({memory, reflection, binding}) {
  binding = bindingSchema.parse(binding)
  if (!memory?.store?.root) fail('EVOLUTION_UNAVAILABLE', 503)
  await memory.bindingReady
  const items = [], memoryResources = [], skillResources = [], allowedScopeTokens = []
  let acceptedCount = 0, memoryCandidates = 0, activeCount = 0, skillCandidates = 0
  for (const {scope} of readableScopes(binding)) {
    const scopeToken = scope.kind + '/' + scope.id
    allowedScopeTokens.push(scopeToken)
    const snapshot = await scopeSnapshot(memory, scope)
    acceptedCount += snapshot.entries.length; memoryCandidates += snapshot.candidates.length
    for (const [status, records] of [['applied', snapshot.entries], ['candidate', snapshot.candidates]]) for (const entry of records) {
      const id = hash(JSON.stringify([scope.kind, scope.id, 'memory', status, entry.topic, entry.key]))
      items.push({id, kind: 'memory', name: entry.topic + '/' + entry.key, scope: scope.kind, status, revision: entry.revision, updatedAt: stamp(entry.updatedAt), provenance: entry.provenance ?? null, origins: entry.origins ?? [], migration: entry.migration ?? null, memoryUse: null})
      if (status === 'applied') memoryResources.push({itemId: id, scopeToken, storageId: entry.id})
    }
    for (const [key, value] of Object.entries(snapshot.state.skills)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 60) fail('EVOLUTION_UNAVAILABLE', 503)
      const supported = learnedSkillSupported(value, snapshot.entries.filter(entry => entry.topic === 'experience'))
      if (value.active && supported) activeCount++; else if (!value.active) skillCandidates++
      const name = 'learned-' + key, id = hash(JSON.stringify([scope.kind, scope.id, 'skill', key]))
      const version = reflection?.renderSkill ? contentVersion(reflection.renderSkill(scope, key, value, snapshot.revision), 'learned') : null
      items.push({modelUseCount: null, userUseCount: null, fileReadCount: null, lastUsedAt: null, id, kind: 'skill', origin: 'learned', name, scope: scope.kind, status: value.active ? supported ? 'applied' : 'unsupported' : 'candidate', revision: value.revision, updatedAt: stamp(value.updatedAt), taskIds: value.taskIds ?? []})
      skillResources.push({itemId: id, name, provider: 'learned', scopeToken, contentVersion: version})
    }
  }
  const inventory = memory.host?.runtimePaths ? await installedSkills(memory.host.runtimePaths, memory.config?.skillDirs ?? [], {onContent: (item, loaded) => {
    skillResources.push({itemId: item.id, name: item.name, provider: 'filesystem', path: loaded.path, resourceBasePath: dirname(loaded.path), contentVersion: item.contentVersion})
  }}) : {items: [], complete: false, issues: ['安装目录技能盘点不可用']}
  const selected = new Set(inventory.items.filter(item => ['applied', 'disabled'].includes(item.status)).map(item => item.name))
  for (const item of items) if (item.origin === 'learned' && item.status === 'applied' && selected.has(item.name)) {item.status = 'shadowed'; activeCount--}
  // contentVersion/resource are private matching material, not browser fields.
  items.push(...inventory.items.map(({contentVersion, resource, ...item}) => ({...item, modelUseCount: null, userUseCount: null, fileReadCount: null, lastUsedAt: null})))
  return {items, memoryResources, skillResources, allowedScopeTokens,
    memory: {acceptedCount, candidateCount: memoryCandidates},
    skills: {activeCount, candidateCount: skillCandidates, contentTrackingStatus: memory.installedPrevious?.error ? 'degraded' : 'ready', coverage: 'bot-installed-and-learned', installedCount: inventory.items.length, installedAvailableCount: inventory.items.filter(item => item.status === 'applied').length, inventoryComplete: inventory.complete, inventoryIssues: inventory.issues}}
}
