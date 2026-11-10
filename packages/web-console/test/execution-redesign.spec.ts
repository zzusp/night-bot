import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { FIXTURE_TOKEN } from './preview.mjs'

const endpoint = '**/api/conversations/room-product/response-times?*'
const confirmed = {
  messageId: 'first', messageVersion: 1, preview: '请核对这份计划，先告诉我是否收到。', status: 'confirmed',
  receivedAt: '2026-11-09T01:00:00.000Z', firstReplyAt: '2026-11-09T01:00:01.250Z', durationMs: 1250,
  reason: null, replyPreview: '已收到，我先核对计划里的时间和依赖。',
  steps: [{ kind: 'received', label: '接收消息', at: '2026-11-09T01:00:00.000Z' },
    { kind: 'stage-turn-started', label: '开始处理（批次共享）', shared: true, at: '2026-11-09T01:00:00.200Z' },
    { kind: 'reply-prepared', label: '回复已准备', at: '2026-11-09T01:00:00.900Z' },
    { kind: 'reply-visible', label: '首条回复已确认可见', at: '2026-11-09T01:00:01.250Z' }],
}
const pageData = (items = [confirmed]) => ({ status: 'ready', items, total: items.length, nextOffset: null })
async function login(page: Page) {
  await page.goto('/#/channels/room-product?view=execution')
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN)
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click()
}

test('消息优先、真实首答和累计时间；记录按需读取、键盘与窄屏浅深色', async ({ page }) => {
  let journalReads = 0
  page.on('request', request => { if (/\/session\?/.test(request.url())) journalReads++ })
  await page.route(endpoint, route => route.fulfill({ json: pageData() }))
  await login(page)
  const section = page.getByRole('region', { name: '消息首答与处理过程' })
  await expect(section).toContainText('1.25 秒')
  await expect(page.locator('[data-task-id="task-research"] > summary')).toContainText('整理本周产品调研')
  await expect(page.locator('.execution-routing-records')).not.toHaveAttribute('open')
  expect(journalReads).toBe(0)
  const task = page.locator('[data-task-id="task-research"]')
  await task.locator(':scope > summary').click()
  await expect(task.getByRole('region', { name: '任务进展与结果' })).toContainText('任务正在执行')
  expect(journalReads).toBe(0)
  await task.getByText('工具与执行记录', { exact: true }).click()
  await expect(task.locator('.message-tool')).toHaveCount(1)
  expect(journalReads).toBeGreaterThan(0)
  await task.locator(':scope > summary').click()
  const disclosure = section.locator('.response-time-row > summary')
  await disclosure.focus(); await page.keyboard.press('Enter')
  await expect(section).toContainText(confirmed.replyPreview)
  await expect(section).toContainText('右侧为接收后的累计时间')
  await expect(section).toContainText('+200 毫秒')
  await expect(section).toContainText('批次共享，不代表本条消息单独用时')
  await expect(section).toContainText('09:00:01.250')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`execution-${theme}-${width}.png`) })
    }
  }
  await disclosure.focus(); await page.keyboard.press('Enter')
  await expect(section.locator('.response-time-row')).not.toHaveAttribute('open')
})

test('未知、失败、空记录和无能力不伪装耗时；重试撤权期间不恢复旧缓存', async ({ page }) => {
  let mode = 'states'
  await page.route(endpoint, async route => {
    if (mode === 'denied' || mode === 'slow-denied') {
      if (mode === 'slow-denied') await new Promise(resolve => setTimeout(resolve, 500))
      return route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } })
    }
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
    if (mode === 'empty') return route.fulfill({ json: pageData([]) })
    if (mode === 'unavailable') return route.fulfill({ json: { status: 'unavailable', items: [], total: 0, nextOffset: null } })
    return route.fulfill({ json: pageData(['unconfirmed', 'failed', 'pending', 'no-reply', 'unavailable', 'invalid-time'].map((status, index) => ({ ...confirmed, messageId: String(index), status, durationMs: null, firstReplyAt: null, replyPreview: '', preview: `独立消息 ${index}`, steps: [] }))) })
  })
  await login(page)
  const section = page.getByRole('region', { name: '消息首答与处理过程' })
  for (const text of ['回复尚未确认可见', '回复发送失败', '等待发送', '尚无可核实的首答', '历史记录不足', '时间记录异常']) await expect(section).toContainText(text)
  await expect(section.locator('.response-time-outcome strong')).toHaveCount(0)
  mode = 'error'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('独立消息 0')
  await expect(section.locator('.notice')).toBeVisible()
  mode = 'denied'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).not.toContainText('独立消息 0')
  mode = 'slow-denied'; await section.getByRole('button', { name: '重新获取', exact: true }).click()
  await expect(section).not.toContainText('独立消息 0')
  await expect(section.getByRole('button', { name: '刷新记录' })).toBeEnabled()
  mode = 'empty'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('尚无可核实的入站消息')
  mode = 'unavailable'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('当前 Bot 未提供首答记录')
})

test('初读等待、历史分页和返回最新，不自动跳离正在阅读的历史', async ({ page }) => {
  let release: () => void = () => {}
  const ready = new Promise<void>(resolve => { release = resolve })
  await page.route(endpoint, async route => {
    await ready
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    await route.fulfill({ json: { ...pageData([{ ...confirmed, messageId: offset ? 'old' : 'new', preview: offset ? '更早的一条消息' : '最近的一条消息' }]), total: 21, nextOffset: offset ? null : 20 } })
  })
  await login(page)
  const section = page.getByRole('region', { name: '消息首答与处理过程' })
  await expect(section).toContainText('正在读取消息处理记录')
  release()
  await expect(section).toContainText('最近的一条消息')
  await section.getByRole('button', { name: '更早消息' }).click()
  await expect(section).toContainText('更早的一条消息')
  await expect(section).not.toContainText('最近的一条消息')
  await section.getByRole('button', { name: '回到最新' }).click()
  await expect(section).toContainText('最近的一条消息')
})


test('会话访问撤销立即卸载首答与安排记录，重试期间不显示旧正文', async ({ page }) => {
  let denied = false
  await page.route(endpoint, route => route.fulfill({ json: pageData() }))
  await page.route('**/api/conversations/room-product/tasks', route => denied
    ? route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } }) : route.continue())
  await login(page)
  await expect(page.getByRole('region', { name: '消息首答与处理过程' })).toContainText(confirmed.preview)
  await page.getByText('会话安排记录', { exact: true }).click()
  await expect(page.getByText('暂无已提交的会话安排', { exact: true })).toBeVisible()
  denied = true
  await expect(page.getByRole('region', { name: '消息首答与处理过程' })).toHaveCount(0, { timeout: 12000 })
  await expect(page.locator('.execution-routing-records')).toHaveCount(0)
  await page.locator('.chat-execution').getByRole('button', { name: '重新获取', exact: true }).click()
  await expect(page.locator('.chat-execution')).not.toContainText(confirmed.preview)
})
