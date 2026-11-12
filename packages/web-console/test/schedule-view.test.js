import test from 'node:test'
import assert from 'node:assert/strict'
import {schedulePage} from '../server/schedule-view.js'

const base = {id: 'schedule-one', title: '提醒', status: 'active', scheduledAt: '2030-01-01T00:00:00.000Z'}
const options = {state: 'active', offset: 0, limit: 30}
test('schedule rules have bounded safe summaries for all native kinds', () => {
  const records = [
    {kind: 'at'}, {kind: 'after', afterSeconds: 90}, {kind: 'every', everySeconds: 3600},
    {kind: 'daily', time: '09:00:00.000', timeZone: 'Asia/Shanghai'},
    {kind: 'weekly', time: '09:00:00.000', timeZone: 'UTC', weekdays: [1, 3, 7]},
    {kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC'},
  ]
  const expected = ['单次', '90秒后执行一次', '每1小时', '每天 09:00:00.000（Asia/Shanghai）', '每周一、三、日 09:00:00.000（UTC）', 'Cron：0 9 * * 1-5（UTC）']
  for (const [index, record] of records.entries()) {
    assert.equal(schedulePage([{...base, ...record}], options).items[0].scheduleSummary, expected[index])
  }
  const item = schedulePage([{...base, kind: 'at', title: 'token=private known-credential', prompt: 'PRIVATE_PROMPT', sessionId: 'PRIVATE_SESSION'}], options, ['known-credential']).items[0]
  assert.doesNotMatch(JSON.stringify(item), /private|known-credential|PRIVATE_/)
  assert.deepEqual(Object.keys(item).sort(), ['id', 'kind', 'scheduleSummary', 'scheduledAt', 'state', 'title'])
})

test('schedule presentation does not infer completion from wall clock or invent pause state', () => {
  const old = {...base, kind: 'at', scheduledAt: '2000-01-01T00:00:00.000Z', paused: true}
  assert.equal(schedulePage([old], options).items[0].state, 'active')
  assert.equal(schedulePage([{...old, status: 'inactive'}], {...options, state: 'inactive'}).total, 1)
})


test('empty or shortened catalogs clamp to a valid page offset', () => {
  assert.deepEqual(schedulePage([], {...options, offset: 999}), {items: [], total: 0, offset: 0, limit: 30, nextOffset: null})
  const records = Array.from({length: 31}, (_, index) => ({...base, id: String(index).padStart(3, '0'), kind: 'at'}))
  const page = schedulePage(records, {...options, offset: 999})
  assert.equal(page.offset, 30)
  assert.equal(page.items[0].id, '030')
  assert.equal(page.nextOffset, null)
})


test('interval and delay summaries use exact integral day, hour and minute units', () => {
  for (const [seconds, display] of [[172800, '2天'], [86400, '1天'], [7200, '2小时'], [600, '10分钟'], [120, '2分钟'], [90, '90秒'], [3661, '3661秒']]) {
    const every = schedulePage([{...base, kind: 'every', everySeconds: seconds}], options).items[0]
    assert.equal(every.scheduleSummary, `每${display}`)
    const after = schedulePage([{...base, kind: 'after', afterSeconds: seconds}], options).items[0]
    assert.equal(after.scheduleSummary, `${display}后执行一次`)
  }
})
