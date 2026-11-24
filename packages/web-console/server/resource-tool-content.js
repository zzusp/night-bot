import {dirname} from 'node:path'
import {digest} from './security.js'
import {isDeepStrictEqual} from 'node:util'
import {readableScopes} from '../../../src/memory/scope.js'
import {label} from '../../../src/memory/format.js'
import {renderIndex} from '../../../src/memory/layered-format.js'
import {renderMemoryIndex} from '../../../src/memory/tools.js'
import {contentSnapshot, CONTENT_LIMIT} from '../../../src/memory/previous.js'
import {installedSkills} from '../../../src/memory/skill-inventory.js'
import {parseSkillFrontmatter} from '../../../src/native-skill-filesystem.js'
import {isSkillName, renderSkillContent} from '../../../src/native-skill-protocol.js'

const names = new Set(['memory_read', 'skill'])
export const isResourceTool = name => names.has(name)
const tokenFor = scope => scope.kind + '/' + scope.id
const bounded = (text, limit = CONTENT_LIMIT) => typeof text === 'string' && text.length <= limit && Buffer.byteLength(text) <= limit
const visibleBody = text => typeof text === 'string' && !!text.trim() && contentSnapshot(text, 0) !== null
const textHash=value=>digest(JSON.stringify(value))
const noEvidence = row => ({id: row.id, revision: row.revision, topic: row.topic, key: row.key, path: row.path, title: row.title, summary: row.summary})

/** Native receipt, exact pairing and content are necessary but never sufficient
 * authority. This probe takes only committed projected messages, not live,
 * model strings, arbitrary details, or browser-supplied tool parameters. */
export function resourceReadCandidate(name, args, message, sourceEntry) {
  if (!names.has(name) || !args || typeof args !== 'object' || Array.isArray(args)
    || sourceEntry?.type !== 'message' || sourceEntry.message?.role !== 'toolResult'
    || sourceEntry.message.toolName !== name || sourceEntry.message.toolCallId !== message.toolCallId
    || sourceEntry.message.isError !== false || message.isError !== false) return null
  const receipt = sourceEntry.message.details?.nativeResult, value = receipt?.value
  if (receipt?.isError !== false || !value || typeof value !== 'object' || Array.isArray(value) || value.ok === false
    || !Array.isArray(message.content) || message.content.length !== 1 || message.content[0]?.type !== 'text'
    || !bounded(message.content[0].text, 1024 * 1024)
    || !isDeepStrictEqual(message.content, sourceEntry.message.content)
    || !isDeepStrictEqual(message.content, receipt.content)) return null
  const rendered = message.content[0].text
  if (name === 'skill') {
    if (typeof value.name !== 'string' || !isSkillName(value.name) || args.name !== value.name || !['learned', 'filesystem'].includes(value.provider)
      || !visibleBody(value.content)
      || (value.provider === 'filesystem' ? value.resourceBase?.kind !== 'directory' || typeof value.resourceBase.path !== 'string' : value.resourceBase !== undefined)
      || renderSkillContent(value) !== rendered) return null
    const marker = /^NIGHT_LEARNED_SCOPE=([^;\n]+);revision=\d+;key=([a-z0-9-]+);fingerprint=[a-f0-9]{64}$/m.exec(value.content)
    return {kind:value.provider,value:{name:value.name,resourceBase:value.resourceBase,hash:textHash(value.content),marker:marker?.slice(0,3)}}
  }
  if (value.kind !== 'night-memory-result' || value.revoked || typeof value.scopeToken !== 'string'
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.entries) || args.candidates !== undefined) return null
  if (args.key === undefined && args.path === undefined) {
    if (value.stage !== (args.topic === undefined ? 'root-index' : 'filtered-index') || value.topic !== args.topic
      || (args.topic !== undefined && !label(args.topic)) || value.markdown !== rendered
      || value.entries.some(row => !row || typeof row.summary !== 'string') || renderMemoryIndex(value) !== rendered) return null
    return {kind:'memory-index',topic:args.topic,value:{scopeToken:value.scopeToken,revision:value.revision,rowsHash:digest(JSON.stringify(value.entries.map(noEvidence)))}}
  }
  if (value.stage !== undefined || value.entries.length !== 1 || JSON.stringify(value) !== rendered) return null
  const row = value.entries[0]
  if (!row || !label(row.key) || typeof row.id !== 'string' || !Number.isSafeInteger(row.revision)
    || !visibleBody(row.text)) return null
  let path
  if (args.path !== undefined) {
    if (typeof args.path !== 'string' || args.topic !== undefined || args.key !== undefined) return null
    try {path = decodeURIComponent(args.path)} catch {return null}
  } else if (!label(args.topic) || args.key !== row.key) return null
  return {kind:'memory-entry',value:{scopeToken:value.scopeToken,revision:value.revision},row:{id:row.id,key:row.key,revision:row.revision,hash:textHash(row.text)},path,topic:args.topic}
}

/** Current shared-resource authorization, independent of task or Router
 * membership. The reader binding comes only from the authenticated Host view.
 * No cache crosses requests, raw private fields never enter the result. */
export async function readResourceToolContents(candidates, {memory, reflection, binding, measure = (_name, work) => work()}) {
  const allowed = new Map(), scopes = new Map(readableScopes(binding).map(({scope}) => [tokenFor(scope), scope]))
  if (!memory?.store?.root) return allowed
  await measure('resource_binding_wait', () => memory.bindingReady)
  const memorySelectors = new Map(), skillMarkers = new Map()
  for (const {id,candidate} of candidates) {
    const {kind,value} = candidate
    if (kind === 'memory-entry' || kind === 'memory-index') {
      const scope = scopes.get(value.scopeToken)
      if (!scope) continue
      if (!memorySelectors.has(scope.id)) memorySelectors.set(scope.id, {scope, selectors: []})
      if (kind === 'memory-entry') memorySelectors.get(scope.id).selectors.push([id,candidate])
    } else if (kind === 'learned') {
      const marker = value.marker, scope = marker && scopes.get(marker[1])
      if (!scope || value.name !== 'learned-' + marker[2]) continue
      if (!skillMarkers.has(scope.id)) skillMarkers.set(scope.id, new Set())
      skillMarkers.get(scope.id).add(marker[0])
    }
  }
  const indices = new Map(), learned = new Map(), memoryGrants = new Map()
  const skillBatch = scope => {
    if (!learned.has(scope.id)) learned.set(scope.id, measure('resource_learned_batch', () => reflection.readSkillHistoryBatch(scope, skillMarkers.get(scope.id)).catch(() => new Map())))
    return learned.get(scope.id)
  }
  let installed
  if (candidates.some(({candidate}) => candidate.kind === 'filesystem') && memory.host?.runtimePaths) {
    const matches = new Map(), wanted = new Set(candidates.flatMap(({candidate}) => candidate.kind === 'filesystem' ? [candidate.value.name] : []))
    try {
      await measure('resource_skill_scan', () => installedSkills(memory.host.runtimePaths, memory.config?.skillDirs ?? [], {onContent: (item, file) => {
        if (wanted.has(item.name)) matches.set(item.id, {item, file})
      }}))
      installed = [...matches.values()]
    } catch { /* Missing inventory proves nothing. */ }
  }
  // Finish the fact reads before taking the learned-skill authorization view.
  for (const [id, {scope, selectors}] of memorySelectors) {
    indices.set(id, await measure('resource_memory_batch', () => memory.store.readHistoryBatch(scope, selectors).catch(() => null)))
  }
  for (const {id, candidate} of candidates) {
    let text, memoryGrant
    try {
      const {kind, value} = candidate
      if (kind === 'filesystem') {
        const matching = installed?.filter(({item, file}) => item.status === 'applied' && item.modelInvocable
          && item.name === value.name && dirname(file.path) === value.resourceBase.path) ?? []
        if (matching.length !== 1) continue
        const {item, file} = matching[0]
        if (!contentSnapshot(file.text, item.revision) || textHash(parseSkillFrontmatter(file.text)?.content??'') !== value.hash) continue
        text = parseSkillFrontmatter(file.text)?.content
      } else if (kind === 'learned') {
        const marker = value.marker
        const scope = marker && scopes.get(marker[1]), key = marker?.[2]
        if (!scope || value.name !== 'learned-' + key || !reflection?.readSkillHistoryBatch) continue
        const current = (await skillBatch(scope)).get(marker[0])
        if (!current) continue
        const rendered = reflection.renderSkill(scope, key, current)
        if (!contentSnapshot(rendered.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/m, ''), current.revision) || textHash(rendered) !== value.hash) continue
        text = current.body ?? current.guidance ?? current.steps?.map((line, i) => (i + 1) + '. ' + line).join('\n')
      } else {
        const scope = scopes.get(value.scopeToken)
        if (!scope) continue
        const current = indices.get(scope.id)
        // This is a fresh Web read, not replay of private model context. A
        // scope revision may advance for unrelated records, but the exact entry
        // (or every public index descriptor) must still agree with the receipt.
        if (!Number.isSafeInteger(current?.revision) || current.revision < value.revision) continue
        if (kind === 'memory-index') {
          const rows = current.entries.filter(row => candidate.topic === undefined || row.topic === candidate.topic).map(noEvidence)
          if (digest(JSON.stringify(rows))!==value.rowsHash) continue
          // Keep real Markdown and omit caller-specific applicability/context.
          text = renderIndex(rows)
          memoryGrant = {scope, revision: current.revision, topic: candidate.topic, rows}
        } else {
          const fact = current.facts.get(id)
          if (typeof fact?.text !== 'string' || textHash(fact.text) !== candidate.row.hash) continue
          text = fact.text
          memoryGrant = {scope, revision: current.revision, descriptor: noEvidence(fact.descriptor)}
        }
      }
    } catch { /* Unavailable/changed/malformed resources retain the notice. */ }
    if (visibleBody(text)) {
      const skill = candidate.kind === 'filesystem' || candidate.kind === 'learned'
      allowed.set(id, {text, ...(skill ? {skillName: candidate.value.name} : {})})
      if (memoryGrant) memoryGrants.set(id, memoryGrant)
    }
  }
  // Fence a batch as a whole and check expiry again. One forget/correction
  // during a long read cannot leave an earlier result in that same response.
  if (memoryGrants.size) {
    const rechecked = new Map()
    for (const [id, grant] of memoryGrants) {
      if (!rechecked.has(grant.scope.id)) rechecked.set(grant.scope.id, await measure('resource_memory_recheck', () => memory.store.index(grant.scope).catch(() => null)))
      const current = rechecked.get(grant.scope.id)
      if (!current || current.revision !== grant.revision
        || (grant.descriptor ? !current.entries.some(row => isDeepStrictEqual(noEvidence(row), grant.descriptor))
          : !isDeepStrictEqual(current.entries.filter(row => grant.topic === undefined || row.topic === grant.topic).map(noEvidence), grant.rows))) allowed.delete(id)
    }
  }
  return allowed
}
