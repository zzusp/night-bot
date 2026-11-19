// Read-only projection of existing immutable task receipts. No runtime counters.
import { receiptOwnerSql } from '../../packages/dingtalk-core/task-archive.js'
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const unknown = () => ({ milliseconds: null, activeSince: null })
function timingRounds(task, receipts, now) {
  const created = time(task.createdAt), rounds = new Map(), estimates = new Map()
  let valid = Number.isSafeInteger(task.leaseEpoch) && task.leaseEpoch >= 0 && task.leaseEpoch <= 10000 && receipts !== null
  let waitingAt = null, previousControl = null
  for (const row of receipts ?? []) {
    if (row.taskId !== task.taskId) continue
    if (row.estimates) {
      for (const estimate of row.estimates) estimates.set(estimate.leaseEpoch, estimate)
      continue
    }
    const at = time(row.updatedAt)
    if (at === null || at > now || created === null || at < created) { valid = false; continue }
    if (row.control === 'paused' && previousControl !== 'paused') waitingAt = at
    previousControl = row.control
    if (!Number.isSafeInteger(row.leaseEpoch) || row.leaseEpoch < 1) continue
    const round = rounds.get(row.leaseEpoch) ?? { start: null, end: null, interrupted: false, conflict: false }
    if (row.claim) { if (round.start !== null && round.start !== at) round.conflict = true; round.start ??= at }
    if (row.recovering || row.interruptedDrain) round.interrupted = true
    if (row.drained === true && round.end === null) { round.end = at; waitingAt = at }
    rounds.set(row.leaseEpoch, round)
  }
  return { created, rounds, estimates, waitingAt, valid }
}

export function missingInterruptedTimings(task, receipts, now = Date.now()) {
  const { rounds, estimates, valid } = timingRounds(task, receipts, now)
  if (!valid) return []
  return [...rounds].flatMap(([leaseEpoch, round]) => {
    const nextStart = rounds.get(leaseEpoch + 1)?.start
    return leaseEpoch <= task.leaseEpoch && round.interrupted && !round.conflict && !estimates.has(leaseEpoch)
      && round.start !== null && round.end !== null && round.start <= round.end && (nextStart == null || round.end <= nextStart)
      ? [{ leaseEpoch, start: round.start, end: round.end }] : []
  })
}

// Only the verified committed prefix is passed here. An admitted input binds
// the candidate records to the original task/session/lease, not to restart time.
export function interruptedTimingEvidence(task, stored, windows) {
  const identities = stored.audit.filter(row => row.domain === 'task' && row.kind === 'identity')
  if (stored.header.id !== task.sessionId || identities.length !== 1 || identities[0].version !== 1
    || identities[0].payload.taskId !== task.taskId || identities[0].payload.sessionId !== task.sessionId) return []
  const pending = new Map(windows.map(window => [window.leaseEpoch, window])), found = new Map()
  const admitted = new Map(stored.audit.filter(row => row.domain === 'admission' && row.kind === 'admitted')
    .map(row => [row.payload.entryId, row.payload.id]))
  let window
  for (const entry of stored.entries) {
    const at = time(entry.timestamp)
    if (entry.type === 'custom_message' && entry.customType === 'night.business-input') {
      const source = entry.details?.source, binding = source?.taskSession
      const next = source?.kind === 'task-input' && binding?.taskId === task.taskId && binding?.sessionId === task.sessionId
        ? pending.get(binding.leaseEpoch) : undefined
      window = next && admitted.has(entry.id) && admitted.get(entry.id) === entry.details.packetId
        && at !== null && at >= next.start && at <= next.end ? next : undefined
    }
    if (window && entry.type === 'custom' && entry.customType === 'night.audit'
      && (entry.data?.domain === 'job' && entry.data.kind === 'reconciled' || entry.data?.domain === 'task' && entry.data.kind === 'effect-reconciled')) window = undefined
    if (window && at !== null && at >= window.start && at <= window.end)
      found.set(window.leaseEpoch, { leaseEpoch: window.leaseEpoch, at: entry.timestamp, entryId: entry.id })
  }
  return [...found.values()]
}

export function projectTaskDurations(task, receipts, now = Date.now()) {
  const { created, rounds, estimates, waitingAt, valid: complete } = timingRounds(task, receipts, now)
  let valid = complete, milliseconds = 0, activeSince = null, previousEnd = created, estimated = false
  for (let lease = 1; valid && lease <= task.leaseEpoch; lease++) {
    const round = rounds.get(lease)
    if (!round || round.start === null || round.conflict || round.start < previousEnd) { valid = false; break }
    if (round.end !== null) {
      const end = round.interrupted ? time(estimates.get(lease)?.at) : round.end
      if (end === null || end < round.start || end > round.end) { valid = false; break }
      milliseconds += end - round.start; previousEnd = round.end; estimated ||= round.interrupted
    } else if (!round.interrupted && lease === task.leaseEpoch && task.drained === false && !task.recovering) activeSince = new Date(round.start).toISOString()
    else valid = false
  }
  const execution = valid ? { milliseconds, activeSince, ...(estimated ? { estimated } : {}) } : unknown()
  let total = unknown()
  if (created !== null && created <= now) {
    if (task.state === 'running') total = { milliseconds: 0, activeSince: task.createdAt }
    else {
      const endpoint = task.status === 'completed' ? time(task.completion?.at)
        : task.control === 'cancelled' ? time(task.cancelledAt)
          : task.state === 'waiting' ? Math.max(time(task.lastDecision?.at) ?? -Infinity, waitingAt ?? -Infinity) : null
      if (endpoint !== null && Number.isFinite(endpoint) && endpoint >= created && endpoint <= now) total = { milliseconds: endpoint - created, activeSince: null }
    }
  }
  return { total, execution, observedAt: new Date(now).toISOString() }
}

export function readTaskTimingRows(db, taskIds) {
  // Never scan the complete ledger on a page read or create an index in a GET.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='dynamic_receipt_owner'").get()) return null
  const ids = JSON.stringify(taskIds)
  const projection = `coalesce(json_extract(body,'$.result.task.taskId'),
      CASE WHEN json_type(body,'$.result.interruptedTimings')='array' THEN json_extract(body,'$.result.binding.taskId') END) AS taskId,
    json_extract(body,'$.result.task.leaseEpoch') AS leaseEpoch,
    json_extract(body,'$.result.task.updatedAt') AS updatedAt,
    json_extract(body,'$.result.task.drained') AS drained,
    json_extract(body,'$.result.task.recovering') AS recovering,
    json_extract(body,'$.result.task.control') AS control,
    (json_extract(body,'$.result.interruptedDrain')=1 OR (id GLOB 'task.drained:????????-????-????-????-????????????' AND json_extract(body,'$.result.task.drained')=1)) AS interruptedDrain,
    json_extract(body,'$.result.interruptedTimings') AS estimates,
    (json_extract(body,'$.dispatchEligible')=1 AND json_type(body,'$.result.wakeIds')='array') AS claim`
  const archived = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dynamic_archived_receipts'").get()
  const sql = `SELECT rowid AS sequence,${projection} FROM dynamic_receipts WHERE ${receiptOwnerSql} IN (SELECT value FROM json_each(?))`
    + (archived ? ` UNION ALL SELECT sequence,${projection} FROM dynamic_archived_receipts WHERE ${receiptOwnerSql} IN (SELECT value FROM json_each(?))` : '') + ' ORDER BY sequence LIMIT 10001'
  const rows = db.prepare(sql).all(...(archived ? [ids, ids] : [ids]))
  if (rows.length > 10000) return null
  return rows.map(row => ({ ...row, drained: row.drained === null ? null : !!row.drained, recovering: !!row.recovering,
    interruptedDrain: !!row.interruptedDrain, claim: !!row.claim, estimates: row.estimates ? JSON.parse(row.estimates) : null }))
}

export function pageTaskDurations(db, tasks, now = Date.now()) {
  if (!tasks.length) return tasks
  const rows = readTaskTimingRows(db, tasks.map(task => task.taskId))
  const grouped = new Map(tasks.map(task => [task.taskId, []]))
  for (const row of rows ?? []) grouped.get(row.taskId)?.push(row)
  return tasks.map(task => ({ ...task, durations: projectTaskDurations(task, rows === null ? null : grouped.get(task.taskId), now) }))
}
