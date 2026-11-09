import {join} from 'node:path'
import {atomicWrite, readRegular, withLock, failure} from '../runtime/files.js'
import {bindingSchema, readableScopes} from './scope.js'
import {hash} from './format.js'

const counters = ['readCount', 'searchCount', 'loadCount']
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const latest = values => values.filter(Boolean).sort().at(-1) ?? null
const earliest = values => values.filter(Boolean).sort()[0] ?? null
export async function readUsage(store, scope) {
  const raw = await readRegular(join(store.directory(scope), 'usage.json'))
  if (!raw) return null
  const value = JSON.parse(raw)
  if (value.version !== 1 || !timestamp(value.trackingSince) || counters.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) throw failure('EVOLUTION_USAGE_INVALID')
  return value
}
// Aggregate only: never retain names, queries, memory bodies or actor identifiers.
export async function recordUsage(store, scope, counter) {
  if (!counters.includes(counter)) throw failure('EVOLUTION_USAGE_INVALID')
  const path = join(store.directory(scope), 'usage.json')
  await withLock(path + '.lock', async () => {
    const now = new Date().toISOString()
    const value = await readUsage(store, scope) ?? {version: 1, trackingSince: now, readCount: 0, searchCount: 0, loadCount: 0}
    if (value[counter] >= Number.MAX_SAFE_INTEGER) throw failure('EVOLUTION_USAGE_INVALID')
    value[counter]++
    value[counter === 'loadCount' ? 'skillLastUsedAt' : 'memoryLastUsedAt'] = now
    await atomicWrite(path, JSON.stringify(value) + '\n')
  })
}

// Keep availability aligned with the memory read window used by the real catalog.
export const learnedSkillSupported = (skill, entries) => (skill.supports ?? []).some(row => entries.slice(0, 50).some(entry => entry.key === row.memoryKey))

/** Host-only projection from authenticated reader scopes. No global scan and no
 * inference from catalogs, task completion, or the number of retained records. */
export async function inspectEvolution(memory, reflection, readerBinding, {kind = 'all', offset = 0, limit = 20} = {}) {
  const binding = bindingSchema.parse(readerBinding)
  const items = [], usage = []
  let acceptedCount = 0, memoryCandidates = 0, activeCount = 0, skillCandidates = 0
  for (const {scope} of readableScopes(binding)) {
    const snapshot = await memory.store.transaction(scope, state => {
      const active = entry => !entry.expiresAt || Date.parse(entry.expiresAt) > memory.store.now()
      return {revision: state.meta.revision, entries: [...state.topics].flatMap(([topic, value]) => value.entries.filter(active).map(entry => ({topic, key: entry.key, revision: entry.revision, updatedAt: entry.updatedAt, status: 'applied'}))),
        candidates: state.candidates.filter(active).map(entry => ({topic: entry.topic, key: entry.key, revision: entry.revision, updatedAt: entry.updatedAt, status: 'candidate'}))}
    })
    acceptedCount += snapshot.entries.length; memoryCandidates += snapshot.candidates.length
    for (const entry of [...snapshot.entries, ...snapshot.candidates]) items.push({id: hash(JSON.stringify([scope.kind, scope.id, 'memory', entry.status, entry.topic, entry.key])), kind: 'memory', name: entry.topic + '/' + entry.key, scope: scope.kind, status: entry.status, revision: entry.revision, updatedAt: timestamp(entry.updatedAt)})
    const state = await reflection.state(scope)
    for (const [key, value] of Object.entries(state.skills)) {
      // Match the learned catalog's current support requirement. Stale derived
      // files do not become active skills merely because state once said active.
      const supported = learnedSkillSupported(value, snapshot.entries.filter(entry => entry.topic === 'experience'))
      if (value.active && !supported) continue
      if (value.active) activeCount++; else skillCandidates++
      items.push({id: hash(JSON.stringify([scope.kind, scope.id, 'skill', key])), kind: 'skill', name: 'learned-' + key, scope: scope.kind, status: value.active ? 'applied' : 'candidate', revision: value.revision, updatedAt: timestamp(value.updatedAt)})
    }
    usage.push(await readUsage(memory.store, scope))
  }
  const recorded = usage.filter(Boolean)
  const sum = key => recorded.length ? recorded.reduce((count, value) => count + value[key], 0) : null
  const memoryStats = {acceptedCount, candidateCount: memoryCandidates, readCount: sum('readCount'), searchCount: sum('searchCount'), lastUsedAt: latest(recorded.map(value => timestamp(value.memoryLastUsedAt))), trackingSince: earliest(recorded.map(value => value.trackingSince))}
  const skillStats = {activeCount, candidateCount: skillCandidates, loadCount: sum('loadCount'), lastUsedAt: latest(recorded.map(value => timestamp(value.skillLastUsedAt))), trackingSince: earliest(recorded.map(value => value.trackingSince)), coverage: 'learned-skills-only'}
  items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id))
  const filtered = items.filter(item => kind === 'all' || item.kind === kind), total = filtered.length
  return {status: 'ready', coverage: 'authorized-scopes-current-state', memory: memoryStats, skills: skillStats, items: filtered.slice(offset, offset + limit), total, offset, limit, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null, revision: hash(JSON.stringify([items, memoryStats, skillStats]))}
}
