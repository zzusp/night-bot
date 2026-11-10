import {readdir, lstat} from 'node:fs/promises'
import {join, dirname} from 'node:path'
import {bindingSchema, readableScopes, memoryDirectory} from '../../../src/memory/scope.js'
import {decodeTopic, hash, label} from '../../../src/memory/format.js'
import {boundedRead} from '../../../src/memory/previous.js'
import {installedSkills, contentVersion, pathSafe} from '../../../src/memory/skill-usage.js'
import {fail} from './security.js'

const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const exists = path => lstat(path).then(() => true, error => {if (error.code === 'ENOENT') return false; throw error})
const read = async (path, root) => (await boundedRead(path, 4 * 1024 * 1024, {root}))?.text ?? null
// A dashboard read must not enter store.transaction (which recovers and writes),
// inspectEvolution (dedicated counters), or installedPrevious.scan (snapshots).
// Use revision fences and refuse an in-progress write instead of acquiring a lock.
async function scopeSnapshot(memory, scope) {
  const root = memory.store.root, directory = memoryDirectory(root, scope)
  const checkIdle = async () => {
    if (await exists(join(directory, 'pending.json')) || await exists(join(directory, '.lock')) || await exists(join(directory, 'evolution', '.lock'))) fail('EVOLUTION_UNAVAILABLE', 503)
  }
  await pathSafe(directory, root, root)
  await checkIdle()
  const metaText = await read(join(directory, 'scope.json'), root)
  const stateText = await read(join(directory, 'evolution', 'state.json'), root)
  const meta = JSON.parse(metaText ?? '{"version":1,"revision":0,"forgotten":[],"seen":[]}')
  if (meta.version !== 1 || !Number.isSafeInteger(meta.revision) || !Array.isArray(meta.forgotten) || !Array.isArray(meta.seen)) fail('EVOLUTION_UNAVAILABLE', 503)
  const state = JSON.parse(stateText ?? '{"version":1,"skills":{}}')
  if (state.version !== 1 || !state.skills || typeof state.skills !== 'object' || Array.isArray(state.skills)) fail('EVOLUTION_UNAVAILABLE', 503)
  const topicsPath = join(directory, 'topics')
  await pathSafe(topicsPath, root, root)
  const names = await readdir(topicsPath).catch(error => {if (error.code === 'ENOENT') return []; throw error})
  if (names.length > 10000) fail('EVOLUTION_UNAVAILABLE', 503)
  const entries = [], candidates = []; let bytes = 0
  const active = entry => !entry.expiresAt || Date.parse(entry.expiresAt) > (memory.store.now?.() ?? Date.now())
  const load = async (path, candidate = false) => {
    const text = await read(path, root)
    if (text === null) {if (!candidate) fail('EVOLUTION_UNAVAILABLE', 503); return}
    bytes += Buffer.byteLength(text)
    if (bytes > 32 * 1024 * 1024) fail('EVOLUTION_UNAVAILABLE', 503)
    const value = decodeTopic(text)
    if (value.scope?.kind !== scope.kind || value.scope?.id !== scope.id || value.revision > meta.revision) fail('EVOLUTION_UNAVAILABLE', 503)
    if (!candidate && path !== join(topicsPath, hash(value.topic) + '.md')) fail('EVOLUTION_UNAVAILABLE', 503)
    for (const entry of value.entries.filter(active)) {
      if (candidate && !label(entry.topic)) fail('EVOLUTION_UNAVAILABLE', 503)
      const records = candidate ? candidates : entries
      records.push({...entry, topic: candidate ? entry.topic : value.topic})
    }
  }
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.md$/.test(name)) fail('EVOLUTION_UNAVAILABLE', 503)
    await load(join(topicsPath, name))
  }
  await load(join(directory, 'candidates.md'), true)
  await checkIdle()
  if (metaText !== await read(join(directory, 'scope.json'), root) || stateText !== await read(join(directory, 'evolution', 'state.json'), root)) fail('EVOLUTION_UNAVAILABLE', 503)
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
      const supported = (value.supports ?? []).some(row => snapshot.entries.filter(entry => entry.topic === 'experience').slice(0, 50).some(entry => entry.key === row.memoryKey))
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
