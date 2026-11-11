import {createHash} from 'node:crypto'
import {isAbsolute, normalize, dirname} from 'node:path'
import {lstat} from 'node:fs/promises'
import {parseSkillBlock, parseFrontmatter} from '@earendil-works/pi-coding-agent'

const hash = value => createHash('sha256').update(value).digest('hex')
const text = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text).join('\n') : ''
const stamp = entry => {const value = entry.message?.timestamp ?? entry.timestamp; const time = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null; return time && Number.isFinite(time.getTime()) ? time.toISOString() : null}
const latest = (a, b) => !a || b && b > a ? b : a
const earliest = (a, b) => !a || b && b < a ? b : a
const pathKey = path => typeof path === 'string' && isAbsolute(path) ? normalize(path) : null
const version = (content, provider) => {let body = provider === 'learned' ? content.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm, '') : content; try {body = parseFrontmatter(body).body} catch {} return hash(body.replaceAll('\r\n', '\n').trim())}
const memoryKey = (scope, id) => JSON.stringify([scope, id])
const defaults = Object.freeze({maxSessions: 128, maxEntriesPerSession: 20000, maxEntries: 100000, maxSessionBytes: 8 * 1024 * 1024, maxPendingCalls: 128})
const emptyMemory = () => ({readCount: null, searchCount: null, lastUsedAt: null, lastAccess: null, trackingSince: null, entryTrackingSince: null})
const emptySkills = () => ({modelUseCount: null, userUseCount: null, fileReadCount: null, lastUsedAt: null, lastInvocationAt: null, loadCount: null, trackingSince: null, callTrackingSince: null})
function mergeStats(target, source) {
  for (const [field, value] of Object.entries(source)) {
    if (field.endsWith('Count') && value !== null) target[field] = (target[field] ?? 0) + value
    else if (field.endsWith('Since')) target[field] = earliest(target[field], value)
    else if (['lastUsedAt', 'lastInvocationAt'].includes(field)) target[field] = latest(target[field], value)
  }
  if (source.lastAccess?.at && (!target.lastAccess || source.lastAccess.at >= target.lastAccess.at)) target.lastAccess = source.lastAccess
}

/** Request-local, read-only query. Inputs contain only inventory resources the
 * authenticated evolution reader is allowed to inspect. No journal bodies or
 * private resource paths are returned, and no derived state is persisted. */
export async function queryEvolutionUsage({application, sessionPersistence, allowedScopeTokens = [], memoryResources = [], skillResources = [], channelSessions = [], limits = {}}) {
  const budget = {...defaults, ...limits}
  for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(budget[key]) || budget[key] < 1 || budget[key] > defaults[key]) throw new TypeError('Invalid evolution query budget')
  const allowed = new Set(allowedScopeTokens), memoryMap = new Map(memoryResources.filter(r => allowed.has(r.scopeToken)).map(r => [memoryKey(r.scopeToken, r.storageId), r.itemId]))
  const resources = skillResources.filter(r => typeof r.itemId === 'string' && (!r.scopeToken || allowed.has(r.scopeToken)))
  const skillsByName = new Map(), skillsByPath = new Map()
  for (const resource of resources) {
    const key = JSON.stringify([resource.provider, resource.name]), path = pathKey(resource.path)
    if (!skillsByName.has(key)) skillsByName.set(key, [])
    skillsByName.get(key).push(resource)
    if (path) {if (!skillsByPath.has(path)) skillsByPath.set(path, []); skillsByPath.get(path).push(resource)}
  }
  const items = Object.create(null), reasons = new Set(), seenEvents = new Set()
  const memory = emptyMemory(), skills = emptySkills()
  const coverage = {status: 'unrecorded', source: 'retained-committed-pi-journals', sessionsDiscovered: 0, sessionsRead: 0, entriesRead: 0, oldestObservedAt: null, newestObservedAt: null, limits: budget, reasons: []}
  const problem = code => reasons.add(code)
  const count = (object, field) => {object[field] = (object[field] ?? 0) + 1}
  function skillMatch(value) {
    if (!value || typeof value.content !== 'string' || typeof value.name !== 'string' || !['filesystem', 'learned'].includes(value.provider)) return
    let candidates = skillsByName.get(JSON.stringify([value.provider, value.name])) ?? []
    if (value.provider === 'learned') {
      const scope = typeof value.content === 'string' && /^NIGHT_LEARNED_SCOPE=([^;\n]+);/m.exec(value.content)?.[1]
      if (!scope || !allowed.has(scope)) return
      candidates = candidates.filter(r => !r.scopeToken || r.scopeToken === scope)
    } else {
      const base = pathKey(value.resourceBase?.kind === 'directory' && value.resourceBase.path)
      if (!base) return
      candidates = candidates.filter(r => pathKey(r.resourceBasePath ?? (r.path && dirname(r.path))) === base)
    }
    if (candidates.length !== 1 && typeof value.content === 'string') candidates = candidates.filter(r => r.contentVersion === version(value.content, value.provider))
    return candidates.length === 1 ? candidates[0] : undefined
  }
  function scan(snapshot, target) {
    // Publish one session's observations only after its whole scan succeeds.
    // Failure reasons and read budgets remain global, even when these values are discarded.
    const items = Object.create(null), memory = emptyMemory(), skills = emptySkills(), seenEvents = new Set()
    let oldestObservedAt = null, newestObservedAt = null
    function observed(at) {if (!at) {problem('INVALID_EVENT_TIME'); return} oldestObservedAt = earliest(oldestObservedAt, at); newestObservedAt = latest(newestObservedAt, at)}
    function useSkill(resource, mode, entry, eventId, content) {
      if (!resource) {problem('UNRESOLVED_SKILL_RESOURCE'); return}
      if (seenEvents.has(eventId)) return
      seenEvents.add(eventId)
      const field = {model: 'modelUseCount', user: 'userUseCount', file: 'fileReadCount'}[mode], at = stamp(entry)
      const row = items[resource.itemId] ??= {modelUseCount: 0, userUseCount: 0, fileReadCount: 0, lastUsedAt: null, updatedSinceUse: false}
      count(row, field); count(skills, field); skills.trackingSince = earliest(skills.trackingSince, at); skills.callTrackingSince = earliest(skills.callTrackingSince, at); row.lastUsedAt = latest(row.lastUsedAt, at); skills.lastUsedAt = latest(skills.lastUsedAt, at)
      if (mode !== 'file') {skills.lastInvocationAt = latest(skills.lastInvocationAt, at); if (at && (!row.lastInvocationAt || at >= row.lastInvocationAt)) {row.lastInvocationAt = at; row.updatedSinceUse = typeof content === 'string' && !!resource.contentVersion && version(content, resource.provider) !== resource.contentVersion}}
      observed(at)
    }
    const entries = snapshot.entries, byId = new Map(), states = new Map(), successes = new Map(), observations = new Map()
    for (const e of entries) if (e.type === 'custom' && e.customType === 'night.audit' && e.data?.domain === 'skill-observation' && e.data.kind === 'read') {const id = e.data.payload?.resultEntryId; if (!observations.has(id)) observations.set(id, []); observations.get(id).push(e)}
    // Each entry inherits its actual parent state, not the preceding physical
    // line. This also prevents pairing results across sibling branches.
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || byId.has(entry.id) || entry.parentId !== null && !byId.has(entry.parentId)) throw new Error('ENTRY_TREE_INVALID')
      byId.set(entry.id, entry)
      let pending = states.get(entry.parentId) ?? new Map()
      const message = entry.type === 'message' ? entry.message : undefined
      if (message?.role === 'assistant') {
        pending = new Map(pending)
        for (const call of Array.isArray(message.content) ? message.content : []) if (call.type === 'toolCall' && typeof call.id === 'string') pending.set(call.id, pending.has(call.id) ? null : {call, entryId: entry.id})
      } else if (message?.role === 'toolResult') {
        const paired = pending.get(message.toolCallId); pending = new Map(pending); pending.delete(message.toolCallId)
        if (paired?.call.name === message.toolName && !message.isError) successes.set(entry.id, {entry, call: paired.call})
        else if (['memory_read', 'memory_search', 'skill', 'read', 'read_window'].includes(message.toolName) && !message.isError) problem('UNPAIRED_TOOL_RESULT')
      }
      if (pending.size > budget.maxPendingCalls) throw new Error('PENDING_CALL_LIMIT')
      states.set(entry.id, pending)
    }
    // Tree intervals make receipt ancestry checks O(1), including deep sessions.
    const children = new Map(), intervals = new Map(); let tick = 0
    for (const e of entries) {if (!children.has(e.parentId)) children.set(e.parentId, []); children.get(e.parentId).push(e.id)}
    const stack = (children.get(null) ?? []).map(id => [id, false])
    while (stack.length) {const [id, exit] = stack.pop(); if (exit) {intervals.get(id).end = tick++; continue} intervals.set(id, {start: tick++}); stack.push([id, true]); for (const child of children.get(id) ?? []) stack.push([child, false])}
    const ancestor = (child, parent) => {const c = intervals.get(child), p = intervals.get(parent); return !!c && !!p && p.start <= c.start && p.end >= c.end}
    for (const {entry, call} of successes.values()) {
      const message = entry.message, eventId = target.sessionId + ':' + entry.id
      let value = message.details?.nativeResult?.value ?? message.structuredContent
      if (value === undefined) try {value = JSON.parse(text(message.content))} catch {}
      if (value?.ok === false || message.details?.nativeResult?.isError === true) continue
      if (['memory_read', 'memory_search'].includes(call.name)) {
        if (call.arguments?.candidates === true) continue
        if (value?.kind !== 'night-memory-result' || !allowed.has(value.scopeToken) || !Number.isSafeInteger(value.revision) || !Array.isArray(value.entries) || value.revoked) continue
        if (seenEvents.has(eventId)) continue
        seenEvents.add(eventId)
        const field = call.name === 'memory_read' ? 'readCount' : 'searchCount', at = stamp(entry)
        count(memory, field); memory.trackingSince = earliest(memory.trackingSince, at); if (value.entries.length) memory.entryTrackingSince = earliest(memory.entryTrackingSince, at); memory.lastUsedAt = latest(memory.lastUsedAt, at)
        if (at && (!memory.lastAccess || at >= memory.lastAccess.at)) memory.lastAccess = {counter: field, at, provenance: null}
        for (const id of new Set(value.entries.map(r => r?.id).filter(id => typeof id === 'string'))) {
          const itemId = memoryMap.get(memoryKey(value.scopeToken, id)); if (!itemId) continue
          const row = (items[itemId] ??= {memoryUse: {readCount: 0, searchCount: 0, lastAccess: null}}).memoryUse
          count(row, field); if (at && (!row.lastAccess || at >= row.lastAccess.at)) row.lastAccess = {counter: field, at, provenance: null}
        }
        observed(at)
      } else if (call.name === 'skill' && value?.name === call.arguments?.name) {
        useSkill(skillMatch(value), 'model', entry, eventId, value?.content)
      } else if (['read', 'read_window'].includes(call.name)) {
        // Native file registration returns this explicit success DTO. Do not
        // infer success from arbitrary JSON that merely lacks isError.
        if (!value || typeof value.text !== 'string' || !Array.isArray(value.images) || value.error !== undefined) continue
        if (call.name === 'read_window') {const window = value.structuredContent; if (!window || window.path !== call.arguments?.path || !Number.isSafeInteger(window.offset) || typeof window.hasMore !== 'boolean' || !Array.isArray(window.lines)) continue}
        // Absolute call arguments are unambiguous without replaying cwd changes.
        // Relative paths require an existing host observation tied to this result.
        let path = pathKey(call.arguments?.path)
        const receipts = (observations.get(entry.id) ?? []).filter(e => e.data.payload.callId === message.toolCallId && ancestor(e.id, entry.id))
        const paths = new Set(receipts.filter(e => e.data.payload.record?.kind === 'reference').map(e => pathKey(e.data.payload.record.path)).filter(Boolean))
        if (!path && paths.size === 1) path = [...paths][0]
        const candidates = path && skillsByPath.get(path)?.filter(r => r.provider === 'filesystem')
        if (candidates?.length === 1) useSkill(candidates[0], 'file', entry, eventId)
      }
    }
    const audit = entries.filter(e => e.type === 'custom' && e.customType === 'night.audit' && e.data?.domain === 'admission')
    const indexed = new Map()
    for (const e of audit) {const key = JSON.stringify([e.data.kind, e.data.payload?.id]); if (!indexed.has(key)) indexed.set(key, []); indexed.get(key).push(e)}
    const lookup = (kind, id) => indexed.get(JSON.stringify([kind, id])) ?? []
    const usedPackets = new Set(), usedUsers = new Set()
    for (const ack of audit.filter(e => e.data.kind === 'command-admitted')) {
      const data = ack.data.payload, user = byId.get(data?.entryId)
      const starts = lookup('command-started', data?.id).filter(e => ancestor(ack.id, e.id))
      const packets = lookup('enqueued', data?.id).filter(e => ancestor(ack.id, e.id))
      const internal = lookup('enqueued-internal', data?.id).length > 0
      if (starts.length !== 1 || packets.length !== 1 || internal || user?.type !== 'message' || user.message?.role !== 'user' || !ancestor(ack.id, user.id) || !ancestor(user.id, starts[0]?.id) || starts[0].data.payload.beforeEntryIds?.includes(user.id) || hash(JSON.stringify(user.message.content)) !== data.bodyDigest || usedPackets.has(data.id) || usedUsers.has(user.id)) {problem('INVALID_SKILL_COMMAND'); continue}
      const name = starts[0].data.payload.name, command = /^\/skill:([^\s]+)(?:\s|$)/.exec(text(packets[0].data.payload.content))
      let parsed; try {parsed = parseSkillBlock(text(user.message.content))} catch {}
      if (!parsed || command?.[1] !== name || parsed.name !== name) {problem('INVALID_SKILL_COMMAND'); continue}
      usedPackets.add(data.id); usedUsers.add(user.id)
      let candidates = (skillsByPath.get(pathKey(parsed.location)) ?? []).filter(r => r.name === name)
      // Learned Pi resources use ephemeral paths; require the embedded scope and
      // provider identity instead of interpreting that path as installed data.
      if (!candidates.length && /NIGHT_LEARNED_SCOPE=/.test(parsed.content)) {const found = skillMatch({name, provider: 'learned', content: parsed.content}); candidates = found ? [found] : []}
      const resource = candidates.length === 1 ? candidates[0] : undefined
      const prefix = pathKey(parsed.location) ? 'References are relative to ' + dirname(parsed.location) + '.\n\n' : ''
      const content = prefix && parsed.content.startsWith(prefix) ? parsed.content.slice(prefix.length) : parsed.content
      useSkill(resource, 'user', user, target.sessionId + ':' + user.id, content)
    }
    return {items, memory, skills, seenEvents, oldestObservedAt, newestObservedAt}
  }
  function commitUsage(usage) {
    mergeStats(memory, usage.memory); mergeStats(skills, usage.skills)
    for (const [id, row] of Object.entries(usage.items)) {
      const current = items[id]
      if (!current) {items[id] = row; continue}
      if (row.memoryUse) mergeStats(current.memoryUse, row.memoryUse)
      else {
        if (row.lastInvocationAt && (!current.lastInvocationAt || row.lastInvocationAt >= current.lastInvocationAt)) current.updatedSinceUse = row.updatedSinceUse
        mergeStats(current, row)
      }
    }
    for (const event of usage.seenEvents) seenEvents.add(event)
    coverage.oldestObservedAt = earliest(coverage.oldestObservedAt, usage.oldestObservedAt)
    coverage.newestObservedAt = latest(coverage.newestObservedAt, usage.newestObservedAt)
  }
  const targets = new Map()
  const add = value => {const old = targets.get(value.sessionId); if (old && JSON.stringify(old) !== JSON.stringify(value)) {problem('CONFLICTING_SESSION_IDENTITY'); targets.set(value.sessionId, {...old, invalid: true})} else if (!old) targets.set(value.sessionId, value)}
  for (const row of channelSessions) {
    if (!['chat', 'chat-room'].includes(row.type) || !row.channelId || !row.conversationId || row.type === 'chat' && !row.senderId) {problem('CHANNEL_IDENTITY_INVALID'); continue}
    const expected = 'conversation-' + hash(JSON.stringify([row.type, row.channelId, row.conversationId, ...row.type === 'chat' ? [row.senderId] : []]))
    if (row.sessionId !== expected) {problem('CHANNEL_IDENTITY_INVALID'); continue}
    add({sessionId: row.sessionId, channel: {type: row.type, channelId: row.channelId, conversationId: row.conversationId, ...(row.type === 'chat' ? {senderId: row.senderId} : {})}})
  }
  const query = application?.tasks?.store?.query?.bind(application.tasks.store)
  if (!sessionPersistence?.readNative || !query && !channelSessions.length) problem('SESSION_DISCOVERY_FAILED')
  if (query) {
    // Reuse the existing observer page, never deserialize the full task ledger.
    // Revision fences prevent mixing pages from different catalog versions.
    try {
      let offset = 0, revision
      do {
        const limit = Math.min(100, budget.maxSessions - offset)
        const page = await query({kind: 'observer.page', collection: 'tasks', archived: 'all', offset, limit, ...(revision ? {revision} : {})})
        if (!page || !Array.isArray(page.items) || page.items.length > limit || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('invalid')
        revision = page.revision
        for (const task of page.items) if (task.sessionId && task.sessionBound !== false) add({sessionId: task.sessionId, taskId: task.taskId})
        if (page.nextOffset == null) break
        if (page.nextOffset !== offset + page.items.length || page.nextOffset <= offset) throw new Error('invalid')
        offset = page.nextOffset
        if (offset >= budget.maxSessions) {problem('SESSION_LIMIT'); break}
      } while (true)
    } catch {problem('SESSION_DISCOVERY_FAILED')}
    try {
      const routers = await query({kind: 'router.list'})
      if (!Array.isArray(routers)) throw new Error('invalid')
      // This existing metadata API is not paginated. Fetch rotation metadata
      // once, rather than re-reading all rotations for every conversation.
      const rotations = routers.length ? await query({kind: 'router.rotations'}) : []
      if (!Array.isArray(rotations)) throw new Error('invalid')
      const byConversation = new Map()
      for (const row of rotations) if (row.state === 'published') {if (!byConversation.has(row.conversationId)) byConversation.set(row.conversationId, []); byConversation.get(row.conversationId).push(row)}
      for (const router of routers.slice(0, budget.maxSessions)) {
        if (router.activeSessionId) add({sessionId: router.activeSessionId, conversationId: router.id, generation: router.generation})
        const prior = byConversation.get(router.id) ?? []
        for (const row of prior.slice(0, budget.maxSessions)) if (row.oldCommit && Number.isSafeInteger(row.oldGeneration) && row.oldGeneration > 0 && row.oldGeneration < router.generation && row.oldSessionId) add({sessionId: row.oldSessionId, conversationId: router.id, generation: row.oldGeneration})
        if (prior.length > budget.maxSessions) problem('SESSION_LIMIT')
      }
      if (routers.length > budget.maxSessions) problem('SESSION_LIMIT')
    } catch {problem('SESSION_DISCOVERY_FAILED')}
  }
  const all = [...targets.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)); coverage.sessionsDiscovered = all.length
  if (all.length > budget.maxSessions) problem('SESSION_LIMIT')
  // Read at most two snapshots concurrently, then fold in stable catalog order.
  for (let offset = 0; offset < Math.min(all.length, budget.maxSessions); offset += 2) {
    if (coverage.entriesRead >= budget.maxEntries) {problem('ENTRY_LIMIT'); break}
    const batch = all.slice(offset, Math.min(offset + 2, budget.maxSessions))
    const results = await Promise.all(batch.map(async target => {try {if (target.invalid) throw new Error();
      // Native stat() itself decodes the entire file. Use its controlled file
      // guard plus filesystem metadata instead. This is a size preflight, not
      // an atomic bound against concurrent append by the legitimate writer.
      if (typeof sessionPersistence.checkedFile === 'function' && typeof sessionPersistence.path === 'function') {await sessionPersistence.checkedFile(target.sessionId); const info = await lstat(sessionPersistence.path(target.sessionId)); if (info.size > budget.maxSessionBytes) {problem('SESSION_BYTE_LIMIT'); return null}}
      return await sessionPersistence.readNative(target.sessionId, {requireComplete: true})} catch {return null}}))
    for (let index = 0; index < batch.length; index++) {
      const target = batch[index], snapshot = results[index]
      if (!snapshot) {problem('SESSION_UNAVAILABLE'); continue}
      const identities = snapshot.audit?.filter(r => r.domain === 'task' && r.kind === 'identity') ?? []
      const channelValid = target.channel && !snapshot.header?.runtimeOwner && snapshot.audit?.some(r => {const source = r.payload?.source; return r.domain === 'admission' && r.kind === 'enqueued' && source?.kind === 'user' && source.channelType === target.channel.type && source.channelId === target.channel.channelId && source.conversationId === target.channel.conversationId && (target.channel.type !== 'chat' || source.senderId === target.channel.senderId) && source.principal === 'channel-actor-' + hash(JSON.stringify([source.channelId, source.senderId]))})
      const valid = snapshot.header?.id === target.sessionId && (target.channel ? channelValid : target.taskId ? identities.length === 1 && identities[0].version === 1 && identities[0].payload?.taskId === target.taskId && identities[0].payload?.sessionId === target.sessionId : snapshot.header.runtimeOwner === 'conversation-router' && snapshot.header.conversationId === target.conversationId && Number.isSafeInteger(target.generation) && target.generation > 0 && snapshot.header.generation === target.generation)
      if (!valid || !Array.isArray(snapshot.entries)) {problem('SESSION_IDENTITY_INVALID'); continue}
      if (snapshot.entries.length > budget.maxEntriesPerSession || snapshot.entries.length + coverage.entriesRead > budget.maxEntries) {problem('ENTRY_LIMIT'); continue}
      coverage.entriesRead += snapshot.entries.length
      let usage
      try {usage = scan(snapshot, target)} catch {problem('SESSION_EVIDENCE_INVALID'); continue}
      commitUsage(usage); coverage.sessionsRead++
    }
  }
  coverage.status = reasons.size ? 'partial' : seenEvents.size ? 'ready' : 'unrecorded'; coverage.reasons = [...reasons].sort()
  return {items, memory, skills, coverage}
}
