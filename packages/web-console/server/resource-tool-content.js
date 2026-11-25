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
  const batches = new Map()
  for (const {id,candidate} of candidates) {
    const {kind,value} = candidate
    if (kind === 'filesystem') continue
    const scope = scopes.get(kind === 'learned' ? value.marker?.[1] : value.scopeToken)
    if (!scope || kind === 'learned' && (!reflection || value.name !== 'learned-' + value.marker[2])) continue
    if (!batches.has(scope.id)) batches.set(scope.id, {scope, selectors: [], includeSkillState: false})
    const batch = batches.get(scope.id)
    if (kind === 'memory-entry') batch.selectors.push([id,candidate])
    if (kind === 'learned') batch.includeSkillState = true
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
  // Directory IO finishes before the scope lease. Facts and learned skill
  // evidence then share one current index instead of reopening it per phase.
  const snapshots = new Map()
  for (const [id, {scope, selectors, includeSkillState}] of batches) {
    const current = await measure('resource_memory_batch', () => memory.store.readHistoryBatch(scope, selectors, {includeSkillState}).catch(() => null))
    if (current) snapshots.set(id, {current, support: includeSkillState ? current.entries.filter(row => row.topic === 'experience') : []})
  }
  for (const {id, candidate} of candidates) {
    let text
    try {
      const {kind, value} = candidate
      if (kind === 'filesystem') {
        const matching = installed?.filter(({item, file}) => item.status === 'applied' && item.modelInvocable
          && item.name === value.name && dirname(file.path) === value.resourceBase.path) ?? []
        if (matching.length !== 1) continue
        const {item, file} = matching[0]
        const parsed = parseSkillFrontmatter(file.text)
        if (!contentSnapshot(file.text, item.revision) || textHash(parsed?.content??'') !== value.hash) continue
        text = parsed?.content
      } else if (kind === 'learned') {
        const marker = value.marker
        const scope = marker && scopes.get(marker[1]), key = marker?.[2]
        if (!scope || value.name !== 'learned-' + key) continue
        const snapshot = snapshots.get(scope.id)
        if (!snapshot) continue
        const current = reflection.skillFromHistorySnapshot(scope, marker[0], key, snapshot.current.skillState, snapshot.support)
        if (!current) continue
        const rendered = reflection.renderSkill(scope, key, current)
        if (!contentSnapshot(rendered.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/m, ''), current.revision) || textHash(rendered) !== value.hash) continue
        text = current.body ?? current.guidance ?? current.steps?.map((line, i) => (i + 1) + '. ' + line).join('\n')
      } else {
        const scope = scopes.get(value.scopeToken)
        if (!scope) continue
        const current = snapshots.get(scope.id)?.current
        if (!Number.isSafeInteger(current?.revision) || current.revision < value.revision) continue
        if (kind === 'memory-index') {
          const rows = current.entries.filter(row => candidate.topic === undefined || row.topic === candidate.topic).map(noEvidence)
          if (digest(JSON.stringify(rows))!==value.rowsHash) continue
          // Keep real Markdown and omit caller-specific applicability/context.
          text = renderIndex(rows)
        } else {
          const fact = current.facts.get(id)
          if (typeof fact?.text !== 'string' || textHash(fact.text) !== candidate.row.hash) continue
          text = fact.text
        }
      }
    } catch { /* Unavailable/changed/malformed resources retain the notice. */ }
    if (visibleBody(text)) {
      const skill = candidate.kind === 'filesystem' || candidate.kind === 'learned'
      allowed.set(id, {text, ...(skill ? {skillName: candidate.value.name} : {})})
    }
  }
  return allowed
}
