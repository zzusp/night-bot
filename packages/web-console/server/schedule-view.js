import {visibleText} from './session-view.js'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
function duration(seconds) {
  for (const [unit, size] of [['天', 86400], ['小时', 3600], ['分钟', 60]]) {
    if (seconds % size === 0) return `${seconds / size}${unit}`
  }
  return `${seconds}秒`
}
function summary(record) {
  switch (record.kind) {
    case 'at': return '单次'
    case 'after': return `${duration(record.afterSeconds)}后执行一次`
    case 'every': return `每${duration(record.everySeconds)}`
    case 'daily': return `每天 ${record.time}（${record.timeZone}）`
    case 'weekly': return `每周${record.weekdays.map(day => weekdays[day - 1]).join('、')} ${record.time}（${record.timeZone}）`
    case 'cron': return `Cron：${record.expression}（${record.timeZone}）`
    default: throw new Error('Unsupported native schedule kind')
  }
}

// Native inactive means no future occurrence, not successful business completion.
// There is currently no native paused state. Deleted schedules have no catalog row.
// Explicit projection only: prompt, Session binding and delivery packets stay private.
export function schedulePage(catalog, {state, offset, limit}, secrets = []) {
  const rows = catalog.filter(record => record.status === state)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id))
  if (offset >= rows.length) offset = rows.length ? Math.floor((rows.length - 1) / limit) * limit : 0
  const items = rows.slice(offset, offset + limit).map(record => ({
    id: record.id,
    title: visibleText(record.title, secrets, {maxLength: 256}).text,
    state,
    kind: record.kind,
    scheduledAt: record.scheduledAt,
    scheduleSummary: visibleText(summary(record), secrets, {maxLength: 512}).text,
  }))
  return {items, total: rows.length, offset, limit, nextOffset: offset + items.length < rows.length ? offset + items.length : null}
}
