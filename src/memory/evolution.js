import {installedSkills,contentVersion,skillIdentity} from './skill-usage.js'
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
  if(value.entries!==undefined){if(!timestamp(value.entryTrackingSince)||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))throw failure('EVOLUTION_USAGE_INVALID');for(const [key,row]of Object.entries(value.entries))if(!/^[a-f0-9]{64}$/.test(key)||!row||['readCount','searchCount'].some(counter=>!Number.isSafeInteger(row[counter])||row[counter]<0)||row.lastAccess&&!timestamp(row.lastAccess.at))throw failure('EVOLUTION_USAGE_INVALID')}
  return value
}
// Aggregate only: never retain names, queries, memory bodies or actor identifiers.
export async function recordUsage(store, scope, counter, {provenance,entries} = {}) {
  if (!counters.includes(counter)) throw failure('EVOLUTION_USAGE_INVALID')
  const path = join(store.directory(scope), 'usage.json')
  await withLock(path + '.lock', async () => {
    const now = new Date().toISOString()
    const value = await readUsage(store, scope) ?? {version: 1, trackingSince: now, readCount: 0, searchCount: 0, loadCount: 0}
    if (value[counter] >= Number.MAX_SAFE_INTEGER) throw failure('EVOLUTION_USAGE_INVALID')
    value[counter]++
    if (counter!=='loadCount') value.lastMemoryAccess={counter,at:now,provenance:provenance??null}
    if(Array.isArray(entries)){value.entryTrackingSince??=now;value.entries??={};for(const entry of entries){if(typeof entry.id!=='string')continue;const key=hash(entry.id),current=value.entries[key]??{readCount:0,searchCount:0};if(current[counter]>=Number.MAX_SAFE_INTEGER)throw failure('EVOLUTION_USAGE_INVALID');current[counter]=(current[counter]??0)+1;current.lastAccess={counter,at:now,provenance:provenance??null};value.entries[key]=current}}
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
    const scopedUsage=await readUsage(memory.store,scope)
    const snapshot = await memory.store.transaction(scope, state => {
      const active = entry => !entry.expiresAt || Date.parse(entry.expiresAt) > memory.store.now()
      return {revision: state.meta.revision, entries: [...state.topics].flatMap(([topic, value]) => value.entries.filter(active).map(entry => ({storageId:entry.id,topic, key: entry.key, revision: entry.revision, updatedAt: entry.updatedAt, provenance:entry.provenance??null, origins:entry.origins??[], migration:entry.migration??null, status: 'applied'}))),
        candidates: state.candidates.filter(active).map(entry => ({storageId:entry.id,topic: entry.topic, key: entry.key, revision: entry.revision, updatedAt: entry.updatedAt, provenance:entry.provenance??null, origins:entry.origins??[], migration:entry.migration??null, status: 'candidate'}))}
    })
    acceptedCount += snapshot.entries.length; memoryCandidates += snapshot.candidates.length
    for (const entry of [...snapshot.entries, ...snapshot.candidates]) items.push({id: hash(JSON.stringify([scope.kind, scope.id, 'memory', entry.status, entry.topic, entry.key])), kind: 'memory', name: entry.topic + '/' + entry.key, scope: scope.kind, status: entry.status, revision: entry.revision, updatedAt: timestamp(entry.updatedAt), provenance:entry.provenance,origins:entry.origins,migration:entry.migration,memoryUse:scopedUsage?.entryTrackingSince?{readCount:scopedUsage.entries?.[hash(entry.storageId)]?.readCount??0,searchCount:scopedUsage.entries?.[hash(entry.storageId)]?.searchCount??0,lastAccess:scopedUsage.entries?.[hash(entry.storageId)]?.lastAccess??null}:null})
    const state = await reflection.state(scope)
    for (const [key, value] of Object.entries(state.skills)) {
      // Match the learned catalog's current support requirement. Stale derived
      // files do not become active skills merely because state once said active.
      const supported = learnedSkillSupported(value, snapshot.entries.filter(entry => entry.topic === 'experience'))
      if (value.active&&supported) activeCount++; else if(!value.active) skillCandidates++
      items.push({id: hash(JSON.stringify([scope.kind, scope.id, 'skill', key])), kind: 'skill', origin:'learned', name: 'learned-' + key, scope: scope.kind, status: value.active ? supported ? 'applied' : 'unsupported' : 'candidate', revision: value.revision, updatedAt: timestamp(value.updatedAt),resource:skillIdentity({name:'learned-'+key,provider:'learned'}),contentVersion:contentVersion(reflection.renderSkill?reflection.renderSkill(scope,key,value,snapshot.revision):JSON.stringify(value),'learned'),taskIds:value.taskIds??[]})
    }
    usage.push(scopedUsage)
  }
  let captured
  if(memory.installedPrevious)try{captured=(await memory.installedPrevious.scan()).inventory}catch{memory.installedPrevious.error='EVOLUTION_SNAPSHOT_UNAVAILABLE'}
  const inventory=captured??(memory.host?.runtimePaths?await installedSkills(memory.host.runtimePaths,memory.config?.skillDirs??[]):{items:[],issues:['安装目录技能盘点不可用'],complete:false})
  const selectedFiles=new Set(inventory.items.filter(row=>['applied','disabled'].includes(row.status)).map(row=>row.name));for(const item of items)if(item.origin==='learned'&&item.status==='applied'&&selectedFiles.has(item.name)){item.status='shadowed';activeCount--}
  items.push(...inventory.items)
  const observed=memory.skillUsage?.inspect?.()??{trackingSince:null,items:[]},byResource=new Map(observed.items.map(row=>[row.resource,row]))
  for(const item of items)if(item.kind==='skill'){
    const used=byResource.get(item.resource??item.id)
    Object.assign(item,{modelUseCount:used?.modelCount??0,userUseCount:used?.userCount??0,fileReadCount:used?.fileReadCount??0,lastUsedAt:used?.lastUsedAt??null,updatedSinceUse:!!used?.lastVersion&&!!item.contentVersion&&used.lastVersion!==item.contentVersion})
  }
  const recorded = usage.filter(Boolean)
  const sum = key => recorded.length ? recorded.reduce((count, value) => count + value[key], 0) : null
  const memoryStats = {trackingStatus:memory.memoryTrackingError?'degraded':'ready',acceptedCount, candidateCount: memoryCandidates, readCount: sum('readCount'), searchCount: sum('searchCount'), lastUsedAt: latest(recorded.map(value => timestamp(value.memoryLastUsedAt))), trackingSince: earliest(recorded.map(value => value.trackingSince)),entryTrackingSince:earliest(recorded.map(value=>value.entryTrackingSince)),lastAccess:recorded.map(value=>value.lastMemoryAccess).filter(Boolean).sort((a,b)=>b.at.localeCompare(a.at))[0]??null}
  const skillStats = {activeCount, candidateCount: skillCandidates, loadCount: sum('loadCount'), lastUsedAt: latest(recorded.map(value => timestamp(value.skillLastUsedAt))), trackingSince: earliest(recorded.map(value => value.trackingSince)), contentTrackingStatus:memory.installedPrevious?.error?'degraded':'ready',coverage: 'bot-installed-and-learned',installedCount:inventory.items.length,installedAvailableCount:inventory.items.filter(row=>row.status==='applied').length,inventoryComplete:inventory.complete,inventoryIssues:inventory.issues,modelUseCount:observed.items.reduce((sum,row)=>sum+row.modelCount,0),userUseCount:observed.items.reduce((sum,row)=>sum+row.userCount,0),fileReadCount:observed.items.reduce((sum,row)=>sum+row.fileReadCount,0),callTrackingSince:observed.trackingSince,trackingStatus:memory.skillTrackingError?'degraded':'ready',lastInvocationAt:latest(observed.items.map(row=>row.lastInvocationAt))}
  items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id))
  const filtered = items.filter(item => kind === 'all' || item.kind === kind), total = filtered.length
  return {status: 'ready', coverage: 'bot-shared-current-state', memory: memoryStats, skills: skillStats, items: filtered.slice(offset, offset + limit), total, offset, limit, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null, revision: hash(JSON.stringify([items, memoryStats, skillStats]))}
}
