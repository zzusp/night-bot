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
    { kind: 'stage-turn-completed', label: '消息处理完成', shared: true, durationMs: 700, at: '2026-11-09T01:00:00.900Z' },
    { kind: 'reply-prepared', label: '回复已准备', at: '2026-11-09T01:00:00.900Z' },
    { kind: 'reply-visible', label: '首条回复已确认可见', at: '2026-11-09T01:00:01.250Z' }],
}
const pageData = (items = [confirmed]) => ({ status: 'ready', items, total: items.length, nextOffset: null })
async function login(page: Page, path = '/channels/room-product') {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN)
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click()
}

test('移除 tab 和执行页：点击消息读精确来源，气泡侧边浮层只显示过程和节点耗时，键盘及浅深窄屏', async ({ page }) => {
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
  await expect(dialog).toContainText('1 秒')
  await expect(dialog).not.toContainText(confirmed.replyPreview)
  await expect(dialog).not.toContainText(confirmed.preview)
  await expect(dialog).toContainText('700 毫秒')
  await expect(dialog).toContainText('+0 毫秒')
  await expect(dialog).toContainText('700 毫秒')
  await expect(dialog).toContainText('+200 毫秒')
  await expect(dialog).not.toContainText(/接收后|耗时 700|此节点未单独计时/)
  await expect(dialog.getByRole('img', {name:'接收后 200 毫秒',exact:true})).toBeVisible()
  await expect(dialog).not.toContainText(/自动更新|自动刷新|立即刷新|共享节点不分摊/)
  await expect(dialog.locator('.execution-section-heading, .response-time-footnote')).toHaveCount(0)
  await expect(dialog.getByRole('button')).toHaveCount(1)
  await expect(dialog.getByText('本会话的任务与安排')).toHaveCount(0)
  await expect(dialog).toHaveAttribute('aria-modal', 'false')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(trigger).toHaveCSS('clip-path', 'inset(50%)')
  const bubble = (await page.locator('.conversation-page .message-body').first().boundingBox())!
  const floating = (await dialog.boundingBox())!
  expect(floating.width).toBeLessThanOrEqual(306)
  expect(floating.x + floating.width <= bubble.x || floating.x >= bubble.x + bubble.width || floating.y + floating.height <= bubble.y || floating.y >= bubble.y + bubble.height).toBe(true)
  await expect(dialog).toHaveAttribute('data-side', /left|right|top|bottom/)
  expect(journalReads).toBe(0)
  await expect(dialog.getByRole('button', { name: '关闭消息处理过程' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect.poll(async () => {
        const box = await dialog.boundingBox()
        return !!box && box.x >= 0 && box.x + box.width <= width
      }).toBe(true)
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
  for (const text of ['回复尚未确认可见', '回复发送失败', '等待发送', '无需处理及回复', '历史记录不足', '时间记录异常', '6 个来源']) await expect(section).toContainText(text)
  await expect(section.locator('.response-time-summary strong')).toHaveCount(0)
  mode = 'error'
  await expect(section).toContainText('独立来源 0')
  await expect(section.locator('.notice')).toBeVisible({ timeout: 8000 })
  mode = 'empty'; await section.getByRole('button', { name: '重新获取', exact: true }).click()
  await expect(section).toContainText('无来源记录')
  mode = 'unavailable'
  await expect(section).toContainText('来源不可核验')
  mode = 'denied'
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
    await route.fulfill({ json: pageData([{ ...confirmed, preview: `来源 ${id}`, steps: Array.from({length: 40}, (_, i) => ({label: `来源 ${id} · 节点 ${i}`, at: confirmed.receivedAt, durationMs: 20})) }]) })
  })
  await login(page)
  let dialog = await openMessageProcess(page)
  await expect(dialog).toContainText('读取中')
  await page.keyboard.press('Escape')
  await page.locator('.conversation-page .message-process-trigger').nth(1).focus()
  await page.keyboard.press('Enter')
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
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: '查看任务', exact: true }).click()
  const linkedPage = await popupPromise
  await expect(linkedPage).toHaveURL(/\/tasks\/task-research/)
  await linkedPage.close()
  await openMessageProcess(page)
  await page.evaluate(() => { location.hash = '/tasks/task-research' })
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


test('外部点击与重复点击关闭，滚动跟随，窗口调整重新定位且 Tab 不困在浮层', async ({page}) => {
  await page.route(endpoint, route => route.fulfill({json: pageData()}))
  await login(page)
  const trigger = page.locator('.conversation-page .message-process-trigger').first()
  let dialog = await openMessageProcess(page)
  await page.locator('.conversation-page .message-body').first().click()
  await expect(dialog).toHaveCount(0)
  dialog = await openMessageProcess(page)
  await expect(dialog.getByRole('button', {name: '关闭消息处理过程'})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog).toHaveCount(0)
  dialog = await openMessageProcess(page)
  await page.locator('.transcript').dispatchEvent('scroll')
  await expect(dialog).toBeVisible()
  await page.getByRole('heading', {name: '产品协作', exact: true}).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})


test('滚动实时跟随所点消息，消息完全离屏才关闭并停止读取', async ({page}) => {
  await page.route(endpoint, route => route.fulfill({json: pageData()}))
  await login(page)
  await page.setViewportSize({width:1440,height:560})
  const dialog = await openMessageProcess(page)
  await expect(dialog).toContainText('700 毫秒')
  await expect(dialog).toContainText('+0 毫秒')
  await expect(dialog).toContainText('700 毫秒')
  const before=(await dialog.boundingBox())!
  const bubble=page.locator('.conversation-page .message-body').first()
  const sourceBefore=(await bubble.boundingBox())!
  await page.locator('.transcript').evaluate(el=>{el.scrollTop+=12})
  await expect(dialog).toBeVisible()
  await expect.poll(async()=>Math.round((await dialog.boundingBox())!.y)).not.toBe(Math.round(before.y))
  const after=(await dialog.boundingBox())!,sourceAfter=(await bubble.boundingBox())!
  expect(Math.abs((after.y-before.y)-(sourceAfter.y-sourceBefore.y))).toBeLessThanOrEqual(2)
  await page.locator('.transcript').evaluate(el=>{el.scrollTop=el.scrollHeight})
  await expect(dialog).toHaveCount(0)
})

test('不显示刷新工具栏或底部说明，仍自动读取新阶段，后台暂停恢复，关闭后不再轮询', async ({page}) => {
  let reads=0, mode='waiting'
  await page.route(endpoint, route => {
    reads++
    return route.fulfill({json:pageData([{...confirmed,status:mode==='waiting'?'awaiting-reply':'confirmed',durationMs:mode==='waiting'?null:1250,steps:mode==='waiting'?confirmed.steps.slice(0,2):confirmed.steps}])})
  })
  await login(page)
  const dialog=await openMessageProcess(page)
  await expect(dialog).toContainText('等待回复')
  await expect(dialog).not.toContainText(/自动更新|自动刷新|立即刷新|共享节点不分摊/)
  await expect(dialog.locator('.execution-section-heading, .response-time-footnote')).toHaveCount(0)
  const waitingHeight=(await dialog.boundingBox())!.height
  mode='confirmed'
  await expect(dialog).toContainText('700 毫秒',{timeout:8000})
  await expect.poll(async()=>(await dialog.boundingBox())!.height).toBeGreaterThan(waitingHeight+50)
  expect(reads).toBeGreaterThanOrEqual(2)
  await expect(dialog).not.toContainText(/自动更新|自动刷新|立即刷新|共享节点不分摊/)
  await expect(dialog.getByRole('button')).toHaveCount(1)
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  const hiddenReads=reads
  await page.waitForTimeout(3200)
  expect(reads).toBe(hiddenReads)
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))})
  await expect.poll(()=>reads).toBeGreaterThan(hiddenReads)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  const closedReads=reads
  await page.waitForTimeout(3200)
  expect(reads).toBe(closedReads)
})


test('异步首读增高时浮层自行重新测量，不需要滚动或调整窗口', async ({page}) => {
  let release:()=>void=()=>{}
  const ready=new Promise<void>(resolve=>{release=resolve})
  await page.route(endpoint,async route=>{await ready;await route.fulfill({json:pageData()})})
  await login(page)
  const dialog=await openMessageProcess(page)
  await expect(dialog).toContainText('读取中')
  const loadingHeight=(await dialog.boundingBox())!.height
  release()
  await expect(dialog).toContainText('700 毫秒')
  await expect(dialog).toContainText('+0 毫秒')
  await expect(dialog).toContainText('700 毫秒')
  await expect.poll(async()=>(await dialog.boundingBox())!.height).toBeGreaterThan(loadingHeight+80)
})


test('首答和节点共用时长格式，小于一秒显示毫秒，达到一秒显示四舍五入整数秒', async ({page}) => {
  const values = [0, 999, 1000, 1499, 1500, 2500]
  await page.route(endpoint, route => route.fulfill({json: pageData([{...confirmed, durationMs: 1500,
    steps: values.map(ms => ({kind: 'stage-turn-completed', label: `节点 ${ms}`, at: confirmed.receivedAt, durationMs: ms}))
  }])}))
  await login(page)
  const dialog = await openMessageProcess(page)
  await expect(dialog.locator('.response-time-summary strong')).toHaveText('2 秒')
  const elapsed = dialog.locator('.response-time-elapsed')
  await expect(elapsed).toHaveText(['0 毫秒', '999 毫秒', '1 秒', '1 秒', '2 秒', '3 秒'])
  await expect(dialog).not.toContainText(/1\.499|1\.5|2\.5/)
})


test('Router 开始准备使用真实起点；时间点显示接收后经过时间，不冒充阶段耗时', async ({ page }) => {
  const at = (ms: number) => new Date(Date.parse(confirmed.receivedAt) + ms).toISOString()
  const row = { ...confirmed, durationMs: 29000, firstReplyAt: at(29000), steps: [
    { kind: 'received', timingType: 'milestone', label: '接收消息', at: at(0) },
    { kind: 'reply-prepared', timingType: 'milestone', label: '回复已准备', at: at(25900) },
    { kind: 'stage-router-started', timingType: 'milestone', label: 'Router 开始准备', at: at(26000) },
    { kind: 'send-started', timingType: 'milestone', label: '开始发送', at: at(26100) },
    { kind: 'stage-triage-completed', timingType: 'span', label: '消息分流（截至回复可见）', at: at(29000), durationMs: 28900 },
    { kind: 'stage-router-completed', timingType: 'span', label: 'Router 处理（截至回复可见）', clipped: true, shared: true, at: at(29000), durationMs: 3000 },
    { kind: 'reply-visible', timingType: 'milestone', label: '首条回复已确认可见', at: at(29000) },
  ] }
  await page.route(endpoint, route => route.fulfill({ json: pageData([row]) }))
  await login(page)
  const dialog = await openMessageProcess(page)
  const start = dialog.locator('li').filter({ hasText: 'Router 开始准备' })
  await expect(start).toContainText('+26 秒')
  await expect(dialog.locator('li').filter({ hasText: 'Router 处理' })).toContainText('3 秒')
  await expect(dialog.locator('li').filter({ hasText: '首条回复已确认可见' })).toContainText('+29 秒')
  await expect(dialog).not.toContainText('未记录')
  await expect(dialog).not.toContainText(/截至回复可见|批次共享|接收后/)
  await expect(dialog.locator('.response-time-explanation')).toHaveCount(0)
  await expect(dialog.locator('.response-time-legend')).toHaveText('+距接收阶段耗时')
  const router = dialog.locator('li').filter({hasText:'Router 处理'})
  await expect(router).toHaveAttribute('data-timing-type', 'span')
  await expect(router).toContainText('至首答')
  await expect(router).toContainText('共享')
  await expect(router.getByRole('img', {name:'耗时 3 秒',exact:true})).toBeVisible()
  await expect(start).toHaveAttribute('data-timing-type', 'milestone')
  const labels = await dialog.locator('.response-time-event').allTextContents()
  expect(labels.indexOf('Router 开始准备')).toBeLessThan(labels.indexOf('开始发送'))
  await page.screenshot({ path: test.info().outputPath('router-timeline-metrics.png') })
  await page.setViewportSize({ width: 390, height: 560 })
  await expect(start).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('router-timeline-metrics-mobile.png') })
})


test('紧凑过程保留缺失和异常状态，不显示解释段落或将未知伪装为零', async ({page}) => {
  const reason = '此回复通过精确来源绑定及回复前已提交的任务快照关联，为共同任务回复。'
  const row = {...confirmed, reason, replyAssociation:'task', steps:[
    {kind:'stage-router-started',timingType:'milestone',label:'Router 开始准备',at:confirmed.receivedAt},
    {kind:'stage-router-completed',timingType:'span',label:'Router 处理',at:confirmed.receivedAt},
    {kind:'stage-host-completed',timingType:'span',label:'安排已提交',at:confirmed.receivedAt,durationMs:-1},
  ]}
  await page.route(endpoint, route => route.fulfill({json:pageData([row])}))
  await login(page)
  const dialog = await openMessageProcess(page)
  await expect(dialog).not.toContainText(reason)
  await expect(dialog.locator('.response-time-explanation')).toHaveCount(0)
  await expect(dialog).toContainText('共同回复')
  await expect(dialog.getByRole('img', {name:'耗时未记录',exact:true})).toHaveText('未记录')
  await expect(dialog.getByRole('img', {name:'耗时异常',exact:true})).toHaveText('异常')
  await expect(dialog.locator('.response-time-elapsed--span')).toHaveText(['未记录', '异常'])
  await page.setViewportSize({width:390,height:560})
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([])
  for (const row of await dialog.locator('.response-time-timeline li').all()) {
    const label = (await row.locator('.response-time-event').boundingBox())!
    const value = (await row.locator('.response-time-elapsed').boundingBox())!
    expect(label.x + label.width).toBeLessThanOrEqual(value.x)
  }
})
