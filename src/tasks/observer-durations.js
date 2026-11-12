// Read-only projection of existing immutable task receipts. No runtime counters.
import { receiptOwnerSql } from '../../packages/dingtalk-core/task-archive.js'
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const unknown = () => ({ milliseconds: null, activeSince: null })
export function projectTaskDurations(task, receipts, now = Date.now()) {
  const created = time(task.createdAt), rounds = new Map()
  let valid = Number.isSafeInteger(task.leaseEpoch) && task.leaseEpoch >= 0 && task.leaseEpoch <= 10000 && receipts !== null
  let waitingAt = null, previousControl = null
  for (const row of receipts ?? []) {
    if (row.taskId !== task.taskId) continue
    const at = time(row.updatedAt)
    if (at === null || at > now || created === null || at < created) { valid = false; continue }
    if (row.control === 'paused' && previousControl !== 'paused') waitingAt = at
    previousControl = row.control
    if (!Number.isSafeInteger(row.leaseEpoch) || row.leaseEpoch < 1) continue
    const round = rounds.get(row.leaseEpoch) ?? { start: null, end: null, uncertain: false }
    if (row.claim) { if (round.start !== null && round.start !== at) round.uncertain = true; round.start ??= at }
    if (row.recovering) round.uncertain = true
    if (row.drained === true && round.end === null) { round.end = at; waitingAt = at }
    rounds.set(row.leaseEpoch, round)
  }
  let milliseconds = 0, activeSince = null, previousEnd = created
  for (let lease = 1; valid && lease <= task.leaseEpoch; lease++) {
    const round = rounds.get(lease)
    if (!round || round.start === null || round.uncertain || round.start < previousEnd) { valid = false; break }
    if (round.end !== null) {
      if (round.end < round.start) { valid = false; break }
      milliseconds += round.end - round.start; previousEnd = round.end
    } else if (lease === task.leaseEpoch && task.drained === false && !task.recovering) activeSince = new Date(round.start).toISOString()
    else valid = false
  }
  const execution = valid ? { milliseconds, activeSince } : unknown()
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

export function pageTaskDurations(db, tasks, now = Date.now()) {
  if (!tasks.length) return tasks
  // Never scan the complete ledger on a page read or create an index in a GET.
  const indexed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='dynamic_receipt_owner'").get()
  if (!indexed) return tasks.map(task => ({ ...task, durations: projectTaskDurations(task, null, now) }))
  const ids = JSON.stringify(tasks.map(task => task.taskId))
  const projection = `json_extract(body,'$.result.task.taskId') AS taskId,
    json_extract(body,'$.result.task.leaseEpoch') AS leaseEpoch,
    json_extract(body,'$.result.task.updatedAt') AS updatedAt,
    json_extract(body,'$.result.task.drained') AS drained,
    json_extract(body,'$.result.task.recovering') AS recovering,
    json_extract(body,'$.result.task.control') AS control,
    json_extract(body,'$.result.task.status') AS status,
    (json_extract(body,'$.dispatchEligible')=1 AND json_type(body,'$.result.wakeIds')='array') AS claim`
  const archived = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dynamic_archived_receipts'").get()
  const sql = `SELECT rowid AS sequence,${projection} FROM dynamic_receipts WHERE ${receiptOwnerSql} IN (SELECT value FROM json_each(?))`
    + (archived ? ` UNION ALL SELECT sequence,${projection} FROM dynamic_archived_receipts WHERE ${receiptOwnerSql} IN (SELECT value FROM json_each(?))` : '') + ' ORDER BY sequence LIMIT 10001'
  const rows = db.prepare(sql).all(...(archived ? [ids, ids] : [ids]))
  const grouped = new Map(tasks.map(task => [task.taskId, []]))
  for (const row of rows) grouped.get(row.taskId)?.push({ ...row, drained: row.drained === null ? null : !!row.drained, recovering: !!row.recovering, claim: !!row.claim })
  return tasks.map(task => ({ ...task, durations: projectTaskDurations(task, rows.length > 10000 ? null : grouped.get(task.taskId), now) }))
}
