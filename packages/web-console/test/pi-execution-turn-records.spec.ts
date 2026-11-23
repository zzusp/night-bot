import {expect, test, type Page} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

const task = {path: '/tasks/task-research', endpoint: '**/api/tasks/task-research/session?*', resultKind: 'task-result'}
const router = {path: '/chat/sample-plan', endpoint: '**/api/chat/sample-plan/session?*', resultKind: 'router-reply'}
const source = (id: string) => ({sessionId: 'pi-web-fixture', entryId: id})
const call = (id: string, toolName: string) => ({id, role: 'tool', kind: 'tool-call', toolName, callId: id, text: '已脱敏参数', source: source(id)})
const output = (id: string, toolName: string, error = false) => ({
  ...call(id, toolName), id: id + '-output', kind: 'tool-result', text: error ? '连接暂不可用，请检查网络。\n错误码：TOOL_TIMEOUT' : '已脱敏结果', redacted: true,
  status: error ? 'error' : 'completed', timing: {durationMs: 1350},
  ...(error ? {isError: true, failure: {reason: '连接暂不可用，请检查网络。', code: 'TOOL_TIMEOUT'}} : {}),
})
const snapshot = (resultKind: string, phase: 'compaction' | 'text' | 'done' = 'done') => {
  const items = [
    {id: 'incoming', role: 'user', kind: 'source', text: '请核对两份发布清单，分开反馈。', createdAt: '2026-11-23T12:00:00.000Z', source: source('incoming')},
    call('read', 'read'), output('read', 'read'),
    call('skill', 'skill'), output('skill', 'skill'),
    {id: 'result-first', role: 'assistant', kind: resultKind, text: '第一份清单已核对。', createdAt: '2026-11-23T12:00:03.200Z', source: source('result-first')},
    call('memory', 'memory_read'), output('memory', 'memory_read'),
    call('script', 'bash'), output('script', 'bash', true),
    {id: 'result-second', role: 'assistant', kind: resultKind, text: '第二份清单已核对。', createdAt: '2026-11-23T12:00:09.700Z', source: source('result-second')},
    {id: 'compact', kind: 'compaction', role: 'assistant', text: '已保留两份清单的核对结论。', compaction: {mode: resultKind === 'router-reply' ? 'background' : 'foreground', tokensBefore: 22432, tokensAfter: 4320}, timing: {durationMs: 3680}},
    ...(phase !== 'done' ? [{id: 'live-input', role: 'user', text: '继续核对回退方案。'}] : []),
  ]
  return {
    status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: phase,
    live: {
      active: phase !== 'done',
      ...(phase === 'done' ? {} : {phase, phaseStartedAt: new Date(Date.now() - 2100).toISOString()}),
      items: phase === 'text' ? [{id: 'new-output', role: 'assistant', text: '正在核对回退步骤…', status: 'running', transient: true}] : [],
    },
    tokenUsage: {input: 14032, output: 756, cacheWrite: 624, cacheRead: 1920, total: 17332, basis: 'committed-native-entries'},
  }
}

async function openRecord(page: Page, view: typeof task | typeof router) {
  await page.goto('/#' + view.path)
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  if (view === router) await page.getByRole('tab', {name: '路由', exact: true}).click()
  const record = page.locator('.execution-transcript')
  await expect(record).toBeVisible()
  return record
}

for (const [name, view, width] of [['任务', task, 1440], ['路由', router, 390]] as const) {
  test(`${name}执行记录保留独立结论，已完成过程默认折叠 (${width}px)`, async ({page}) => {
    await page.setViewportSize({width, height: 940})
    await page.emulateMedia({reducedMotion: 'reduce'})
    await page.route(view.endpoint, route => route.fulfill({json: snapshot(view.resultKind)}))
    const record = await openRecord(page, view)
    await expect(page.getByRole('button', {name: '搜索执行记录', exact: true})).toHaveCount(1)
    if (view === task) {
      const resource = page.getByRole('region', {name: '消耗 Tokens', exact: true})
      await expect(resource.getByRole('img')).toHaveAccessibleName(/总量 17,332 Tokens/)
    }
    const first = record.getByText('第一份清单已核对。', {exact: true})
    const second = record.getByText('第二份清单已核对。', {exact: true})
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    for (const id of ['incoming', 'result-first']) {
      const geometry = await record.locator(`article[data-message-id="${id}"]`).evaluate(article => {
        const body = article.querySelector('.message-body')!.getBoundingClientRect()
        const time = article.querySelector('time')!
        return {gap: time.getBoundingClientRect().top - body.bottom, alignment: getComputedStyle(time).textAlign}
      })
      expect(geometry.gap).toBeGreaterThanOrEqual(2)
      expect(geometry.alignment).toBe(id === 'incoming' ? 'end' : 'start')
    }
    const history = record.locator('details.execution-turn-process').filter({hasText: '处理详情'})
    await expect(history).toHaveCount(2)
    for (const fold of await history.all()) await expect(fold).not.toHaveAttribute('open')
    await expect(first.locator('xpath=ancestor::details[contains(@class,"execution-turn-process")]')).toHaveCount(0)
    await expect(second.locator('xpath=ancestor::details[contains(@class,"execution-turn-process")]')).toHaveCount(0)
    const compacted = record.locator('details.execution-compaction')
    await expect(compacted.locator('summary')).toContainText(new RegExp('上下文压缩.*' + (view === router ? '后台' : '前台') + '.*3[.]7s'))
    await expect(compacted.getByText('已保留两份清单的核对结论。')).toBeHidden()
    await expect(record.getByText('连接暂不可用，请检查网络。', {exact: true})).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path: test.info().outputPath(name === '任务' ? 'task-record-desktop.png' : 'router-record-mobile.png')})
    const summary = history.first().locator(':scope > summary')
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(history.first()).toHaveAttribute('open')
    await expect(history.first().locator(':scope > summary')).toContainText(/2 次工具调用.*用时 3.2s/)
    await expect(history.first().getByText('skill', {exact: true})).toBeVisible()
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await expect(history.nth(1)).not.toHaveAttribute('open')
    await history.nth(1).locator(':scope > summary').click()
    const failed = history.nth(1).locator('.pi-tool-step').last()
    await expect(failed.locator('summary')).toContainText('失败')
    await expect(failed.locator('summary')).not.toContainText('TOOL_TIMEOUT')
    await failed.locator('summary').click()
    await expect(failed.getByText('连接暂不可用，请检查网络。', {exact: false})).toBeVisible()
    await expect(failed).toContainText('TOOL_TIMEOUT')
    await expect(history.nth(1).getByText('memory_read', {exact: true})).toBeVisible()
    await compacted.locator('summary').click()
    await expect(compacted.getByText('已保留两份清单的核对结论。')).toBeVisible()
    await expect(compacted.getByText('22,432 → 4,320 Tokens')).toBeVisible()
    if (view === task) await page.screenshot({path: test.info().outputPath('task-record-expanded.png')})
  })
}

test('正在压缩与生成态更新不复制结论、实时输出或移除已提交历史', async ({page}) => {
  let phase: 'compaction' | 'text' | 'done' = 'compaction'
  await page.route(task.endpoint, route => route.fulfill({json: snapshot(task.resultKind, phase)}))
  const record = await openRecord(page, task)
  await expect(record.getByText('正在压缩上下文', {exact: false})).toBeVisible()
  await page.screenshot({path: test.info().outputPath('task-record-live-compaction.png')})
  await expect(record.getByText('第一份清单已核对。', {exact: true})).toHaveCount(1)
  // No fresh server dependencies: exercise the actual client's poll/recovery path.
  phase = 'text'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(record.getByText('正在核对回退步骤…', {exact: true})).toHaveCount(1)
  await expect(record.getByText('正在核对回退步骤…', {exact: true})).toBeVisible()
  await expect(record.locator('details.execution-turn-process[open]').getByText('正在核对回退步骤…', {exact: true})).toBeVisible()
  await expect(record.getByText('正在压缩上下文', {exact: false})).toHaveCount(0)
  phase = 'done'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(record.getByText('正在核对回退步骤…', {exact: true})).toHaveCount(0)
  await expect(record.getByText('第二份清单已核对。', {exact: true})).toHaveCount(1)
})
