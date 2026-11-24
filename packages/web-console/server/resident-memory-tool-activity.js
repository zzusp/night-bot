// Router activity receipts contain metadata only; memory/skill content remains
// exclusive to the authorized reader. Never serialize an arbitrary nested value.
const operations = Object.freeze({
  resident_memory_remember: 'remember',
  resident_memory_forget: 'forget',
  resident_memory_reconcile: null,
  resident_memory_review: 'review',
  resident_skill_mutate: null,
  resident_skill_query: 'query',
})
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const uint = value => Number.isSafeInteger(value) && value >= 0
const key = value => typeof value === 'string' && !!value.trim()
const router = identity => object(identity) && identity.taskId == null && key(identity.sessionId)
  && key(identity.conversationId) && uint(identity.generation) && identity.generation > 0
const projected = (toolName, value) => ({toolName, text: JSON.stringify(value, null, 2), redacted: true})

export function residentMemoryToolInput(name, args, identity) {
  if (!Object.hasOwn(operations, name) || !router(identity) || !object(args)) return null
  let operation = operations[name], scope
  switch (name) {
    case 'resident_memory_remember':
    case 'resident_memory_forget':
      if (!key(args.topic) || !key(args.key)) return null
      scope = args.topic === 'standing-instructions' ? 'standing-instructions' : 'memory'
      break
    case 'resident_memory_reconcile':
      if (!['keep', 'update', 'delete'].includes(args.decision) || !key(args.topic) || !key(args.key)) return null
      operation = args.decision
      scope = 'memory'
      break
    case 'resident_memory_review':
      if (args.key !== undefined && (!key(args.key) || !key(args.topic))) return null
      if (args.topic !== undefined && !key(args.topic)) return null
      scope = args.key !== undefined ? 'entry' : args.topic !== undefined ? 'topic' : 'index'
      break
    case 'resident_skill_mutate':
      if (!['upsert', 'delete'].includes(args.action) || !key(args.key)) return null
      operation = args.action
      break
    case 'resident_skill_query':
      if (args.key !== undefined && !key(args.key)) return null
      scope = args.key === undefined ? 'inventory' : 'entry'
      break
  }
  const row = {operation, ...(scope ? {scope} : {})}
  if (['remember', 'forget', 'keep', 'update', 'delete', 'upsert'].includes(operation) && uint(args.expectedRevision)) row.expectedRevision = args.expectedRevision
  return projected(name, row)
}

export function residentMemoryToolOutput(name, raw, identity) {
  if (!Object.hasOwn(operations, name) || !router(identity) || !object(raw)) return null
  if (name === 'resident_skill_query') {
    // The native read returns no ok field. A count is a read snapshot, not
    // permission to see the entries, their keys, or the counted content now.
    if (!Array.isArray(raw.entries) || !raw.entries.every(entry => object(entry) && typeof entry.active === 'boolean')) return null
    return projected(name, {operation: 'query', recordCount: raw.entries.length,
      activeCount: raw.entries.filter(entry => entry.active).length, ...(uint(raw.revision) ? {revision: raw.revision} : {})})
  }
  if (typeof raw.ok !== 'boolean') return null
  const row = {operation: operations[name], ok: raw.ok}
  if (!raw.ok) {
    // A reported effect can be unconfirmed. Never reuse arbitrary failure
    // flags, error text or related entries to claim a successful mutation.
    if (raw.committed === true) row.committed = true
    if (!row.operation) delete row.operation
    return projected(name, row)
  }
  if (name === 'resident_memory_review') {
    const memory = raw.memory
    if (!object(memory) || memory.kind !== 'night-memory-result' || !Array.isArray(memory.entries)) return null
    row.scope = memory.stage === 'root-index' ? 'index' : memory.stage === 'filtered-index' ? 'topic' : 'entry'
    row.recordCount = memory.entries.length
    if (uint(memory.revision)) row.revision = memory.revision
    return projected(name, row)
  }
  if (name === 'resident_memory_reconcile') {
    if (!['keep', 'update', 'delete'].includes(raw.decision)) return null
    row.operation = raw.decision
  }
  if (name === 'resident_skill_mutate') {
    if (!['upsert', 'delete'].includes(raw.action)) return null
    row.operation = raw.action
  }
  // Retained success receipts must explicitly say whether they persisted. In
  // particular 'keep' must never look like a saved revision, and duplicate
  // skill edits don't mean the current version is active.
  if (typeof raw.persisted !== 'boolean'
    || name === 'resident_memory_reconcile' && (raw.decision === 'keep') === raw.persisted) return null
  row.persisted = raw.persisted
  if (typeof raw.duplicate === 'boolean') row.duplicate = raw.duplicate
  if (uint(raw.revision)) row.revision = raw.revision
  if (name === 'resident_skill_mutate') {
    if (uint(raw.currentRevision)) row.currentRevision = raw.currentRevision
    if (typeof raw.active === 'boolean') row.active = raw.active
  }
  return projected(name, row)
}
