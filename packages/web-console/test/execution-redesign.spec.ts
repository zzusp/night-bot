import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { FIXTURE_TOKEN } from './preview.mjs'
import { openMessageProcess } from './message-process-helpers'

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
async function login(page: Page, path = '/channels/room-product') {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN)
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click()
}

test('移除 tab 和执行页：点击消息读精确来源，弹窗直接显示真实时间线，键盘及浅深窄屏', async ({ page }) => {
  let timingReads = 0, journalReads = 0
  page.on('request', request => { if (/\/session\?/.test(request.url())) journalReads++ })
  await page.route(endpoint, route => {
    expect(new URL(route.request().url()).searchParams.get('selectedMessageId')).toBeTruthy()
    timingReads++
    return route.fulfill({ json: pageData() })
  })
  await login(page, '/channels/room-product?view=execution')
  await expect(page.locator('.conversation-page .message-user').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: '会话视图' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '执行过程', exact: true })).toHaveCount(0)
  expect(timingReads).toBe(0)
  await page.screenshot({ path: test.info().outputPath('conversation-without-tabs.png') })
  const trigger = page.locator('.conversation-page .message-process-trigger').first()
  await page.locator('.conversation-page .message-body').first().click()
  const dialog = page.getByRole('dialog', { name: '消息处理过程', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('1.25 秒')
  await expect(dialog).toContainText(confirmed.replyPreview)
  await expect(dialog).toContainText('右侧为接收后的累计时间')
  await expect(dialog).toContainText('+200 毫秒')
  await expect(dialog).toContainText('批次共享，不代表本条消息单独用时')
  await expect(dialog).toContainText('09:00:01.250')
  expect(journalReads).toBe(0)
  await expect(dialog.getByRole('button', { name: '关闭消息处理过程' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`message-process-${theme}-${width}.png`) })
    }
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: '关闭消息处理过程' }).click()
  await expect(trigger).toBeFocused()
})

test('未知、失败、多来源与空记录不伪装耗时；失败保留旧快照，撤权与重试隐藏旧内容', async ({ page }) => {
  let mode = 'states'
  await page.route(endpoint, async route => {
    if (mode === 'denied' || mode === 'slow-denied') {
      if (mode === 'slow-denied') await new Promise(resolve => setTimeout(resolve, 500))
      return route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } })
    }
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'REQUEST_FAILED' } })
    if (mode === 'empty') return route.fulfill({ json: pageData([]) })
    if (mode === 'unavailable') return route.fulfill({ json: { status: 'unavailable', items: [], total: 0, nextOffset: null } })
    return route.fulfill({ json: pageData(['unconfirmed', 'failed', 'pending', 'no-reply', 'unavailable', 'invalid-time'].map((status, index) => ({ ...confirmed, messageId: String(index), status, durationMs: null, firstReplyAt: null, replyPreview: '', preview: `独立来源 ${index}`, steps: [] }))) })
  })
  await login(page)
  await openMessageProcess(page)
  const section = page.getByRole('region', { name: '消息首答与处理过程' })
  for (const text of ['回复尚未确认可见', '回复发送失败', '等待发送', '无需处理及回复', '历史记录不足', '时间记录异常', '各条分别从自己的接收时间计时']) await expect(section).toContainText(text)
  await expect(section.locator('.response-time-outcome strong')).toHaveCount(0)
  mode = 'error'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('独立来源 0')
  await expect(section.locator('.notice')).toBeVisible()
  mode = 'empty'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('这条消息暂无可核实的入站来源')
  mode = 'unavailable'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(section).toContainText('这条消息暂无可核验的来源记录')
  mode = 'denied'; await section.getByRole('button', { name: '刷新记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.conversation-page .message')).toHaveCount(0)
})

test('初读等待、关闭取消及更换消息不串记录；长内容可滚动，关闭入口始终可达', async ({ page }) => {
  let release: () => void = () => {}, first = true
  const ready = new Promise<void>(resolve => { release = resolve })
  const requested: string[] = []
  await page.route(endpoint, async route => {
    const id = new URL(route.request().url()).searchParams.get('selectedMessageId')!
    requested.push(id)
    if (first) { first = false; await ready }
    await route.fulfill({ json: pageData([{ ...confirmed, preview: `来源 ${id}`, replyPreview: '经过核实的回复。'.repeat(300) }]) })
  })
  await login(page)
  let dialog = await openMessageProcess(page)
  await expect(dialog).toContainText('正在读取消息处理记录')
  await page.keyboard.press('Escape')
  await page.locator('.conversation-page .message-process-trigger').nth(1).click()
  dialog = page.getByRole('dialog', { name: '消息处理过程', exact: true })
  await expect.poll(() => requested.length).toBeGreaterThanOrEqual(2)
  expect(requested[0]).not.toBe(requested[1])
  await expect(dialog).toContainText(`来源 ${requested[1]}`)
  release()
  await expect(dialog).not.toContainText(`来源 ${requested[0]}`)
  await page.setViewportSize({ width: 390, height: 560 })
  await dialog.locator('.message-process-body').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(dialog.getByRole('button', { name: '关闭消息处理过程' })).toBeInViewport()
  await dialog.getByRole('button', { name: '关闭消息处理过程' }).click()
  await expect(dialog).toHaveCount(0)
})

test('Web 回复来源、Markdown 链接和文字选择保留，后退切页关闭弹窗与消息权限撤销', async ({ page }) => {
  await page.route('**/api/chat/sample-plan', async route => {
    const response = await route.fetch(), data = await response.json()
    data.messages = [{ id: 'user-exact', role: 'user', text: '问题正文，可选择复制', status: 'accepted' },
      { id: 'reply-exact', role: 'assistant', text: '回复正文 [查看任务](#/tasks/task-research)' }]
    await route.fulfill({ json: data })
  })
  let selected = ''
  await page.route('**/api/chat/sample-plan/response-times?*', route => {
    selected = new URL(route.request().url()).searchParams.get('selectedMessageId')!
    return route.fulfill({ json: pageData() })
  })
  await login(page, '/chat/sample-plan')
  await page.locator('.message-user .markdown').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  })
  await page.locator('.message-user .message-body').dispatchEvent('click')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.locator('.message-assistant .message-body').click({ position: { x: 20, y: 15 } })
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(selected).toBe('reply-exact')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '查看任务', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks\/task-research/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.conversation-page')).toBeVisible()
  await openMessageProcess(page)
  let denyMode = 'denied'
  await page.route('**/api/chat/sample-plan', async route => {
    if (denyMode === 'retry') await new Promise(resolve => setTimeout(resolve, 700))
    await route.fulfill({ status: denyMode === 'retry' ? 503 : 403, json: { error: denyMode === 'retry' ? 'REQUEST_FAILED' : 'RESOURCE_FORBIDDEN' } })
  })
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 12000 })
  await expect(page.locator('.message')).toHaveCount(0)
  denyMode = 'retry'
  await page.locator('.conversation-page').getByRole('button', { name: '重新获取', exact: true }).click()
  await expect(page.locator('.message')).toHaveCount(0)
  await expect(page.locator('.conversation-page .notice')).toBeVisible()
  await expect(page.locator('.message')).toHaveCount(0)
})


test('会话任务接口撤权立即关闭整个消息弹窗，不等下一次计时轮询', async ({page}) => {
  await page.route(endpoint, route => route.fulfill({json: pageData()}))
  await page.route('**/api/conversations/room-product/tasks', route => route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}}))
  await login(page)
  const dialog=await openMessageProcess(page)
  await expect(dialog).toContainText(confirmed.replyPreview)
  await dialog.getByText('本会话的任务与安排',{exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.conversation-page .message')).toHaveCount(0)
})
