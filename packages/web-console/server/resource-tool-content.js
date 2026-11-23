import {dirname} from 'node:path'
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
    return {kind: value.provider, value}
  }
  if (value.kind !== 'night-memory-result' || value.revoked || typeof value.scopeToken !== 'string'
    || !Number.isSafeInteger(value.revision) || !Array.isArray(value.entries) || args.candidates !== undefined) return null
  if (args.key === undefined && args.path === undefined) {
    if (value.stage !== (args.topic === undefined ? 'root-index' : 'filtered-index') || value.topic !== args.topic
      || (args.topic !== undefined && !label(args.topic)) || value.markdown !== rendered
      || value.entries.some(row => !row || typeof row.summary !== 'string') || renderMemoryIndex(value) !== rendered) return null
    return {kind: 'memory-index', topic: args.topic, value}
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
  return {kind: 'memory-entry', value, row, path, topic: args.topic}
}

/** Current shared-resource authorization, independent of task or Router
 * membership. The reader binding comes only from the authenticated Host view.
 * No cache crosses requests, raw private fields never enter the result. */
export async function readResourceToolContents(candidates, {memory, reflection, binding}) {
  const allowed = new Map(), scopes = new Map(readableScopes(binding).map(({scope}) => [tokenFor(scope), scope]))
  if (!memory?.store?.root) return allowed
  await memory.bindingReady
  const indices = new Map(), facts = new Map(), learned = new Map(), memoryGrants = new Map()
  const index = scope => {
    if (!indices.has(scope.id)) indices.set(scope.id, memory.store.index(scope).catch(() => null))
    return indices.get(scope.id)
  }
  let installed
  if (candidates.some(({candidate}) => candidate.kind === 'filesystem') && memory.host?.runtimePaths) {
    const matches = new Map(), wanted = new Set(candidates.flatMap(({candidate}) => candidate.kind === 'filesystem' ? [candidate.value.name] : []))
    try {
      await installedSkills(memory.host.runtimePaths, memory.config?.skillDirs ?? [], {onContent: (item, file) => {
        if (wanted.has(item.name)) matches.set(item.id, {item, file})
      }})
      installed = [...matches.values()]
    } catch { /* Missing inventory proves nothing. */ }
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
        if (!contentSnapshot(file.text, item.revision) || parseSkillFrontmatter(file.text)?.content !== value.content) continue
        text = value.content
      } else if (kind === 'learned') {
        const marker = /^NIGHT_LEARNED_SCOPE=([^;\n]+);revision=\d+;key=([a-z0-9-]+);fingerprint=[a-f0-9]{64}$/m.exec(value.content)
        const scope = marker && scopes.get(marker[1]), key = marker?.[2]
        if (!scope || value.name !== 'learned-' + key || !reflection?.authorizesSkillHistory || !reflection?.renderSkill || !reflection?.state || !reflection?.skillMarker) continue
        const cacheKey = scope.id + ':' + marker[0]
        if (!learned.has(cacheKey)) learned.set(cacheKey, (async () => {
          if (!await reflection.authorizesSkillHistory(scope, marker[0])) return null
          const current = (await reflection.state(scope)).skills[key]
          if (!current?.active || reflection.skillMarker(scope, key, current) !== marker[0]) return null
          const rendered = reflection.renderSkill(scope, key, current)
          if (!contentSnapshot(rendered.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/m, ''), current.revision)) return null
          const body = current.body ?? current.guidance ?? current.steps?.map((line, i) => (i + 1) + '. ' + line).join('\n')
          return {rendered, body}
        })())
        const current = await learned.get(cacheKey)
        if (!current || current.rendered !== value.content) continue
        text = current.body
      } else {
        const scope = scopes.get(value.scopeToken)
        if (!scope) continue
        const current = await index(scope)
        // Mirror model replay's whole-scope revocation on correction/forget.
        if (!current || current.revision !== value.revision) continue
        if (kind === 'memory-index') {
          const rows = current.entries.filter(row => candidate.topic === undefined || row.topic === candidate.topic).map(noEvidence)
          if (!isDeepStrictEqual(rows, value.entries.map(noEvidence))) continue
          // Keep real Markdown and omit caller-specific applicability/context.
          text = renderIndex(rows)
          memoryGrant = {scope, revision: current.revision, topic: candidate.topic, rows}
        } else {
          const {row} = candidate
          const descriptor = current.entries.find(item => item.id === row.id && item.key === row.key && item.revision === row.revision
            && (candidate.path === undefined ? item.topic === candidate.topic : item.path === candidate.path))
          if (!descriptor) continue
          const cacheKey = JSON.stringify([scope.id, descriptor.topic, descriptor.key])
          if (!facts.has(cacheKey)) facts.set(cacheKey, memory.store.read(scope, {topic: descriptor.topic, key: descriptor.key, includeSources: false}))
          const fact = await facts.get(cacheKey), saved = fact.entries[0]
          if (fact.revision !== value.revision || fact.entries.length !== 1 || saved?.id !== row.id || saved.revision !== row.revision || saved.text !== row.text) continue
          text = saved.text
          memoryGrant = {scope, revision: current.revision, descriptor: noEvidence(descriptor)}
        }
      }
    } catch { /* Unavailable/changed/malformed resources retain the notice. */ }
    if (visibleBody(text)) {
      allowed.set(id, text)
      if (memoryGrant) memoryGrants.set(id, memoryGrant)
    }
  }
  // Fence a batch as a whole and check expiry again. One forget/correction
  // during a long read cannot leave an earlier result in that same response.
  if (memoryGrants.size) {
    const rechecked = new Map()
    for (const [id, grant] of memoryGrants) {
      if (!rechecked.has(grant.scope.id)) rechecked.set(grant.scope.id, await memory.store.index(grant.scope).catch(() => null))
      const current = rechecked.get(grant.scope.id)
      if (!current || current.revision !== grant.revision
        || (grant.descriptor ? !current.entries.some(row => isDeepStrictEqual(noEvidence(row), grant.descriptor))
          : !isDeepStrictEqual(current.entries.filter(row => grant.topic === undefined || row.topic === grant.topic).map(noEvidence), grant.rows))) allowed.delete(id)
    }
  }
  return allowed
}
