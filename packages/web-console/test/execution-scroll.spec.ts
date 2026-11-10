import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN, startPreview} from './preview.mjs'
import type {Message} from '../src/api'

const row = (n: number): Message => ({id: `row-${n}`, role: 'assistant', text: `执行记录 ${String(n).padStart(4, '0')}：核对来源与结果，保留当前执行过程。`})
async function login(page: Page) {
  await page.goto('/#/tasks/task-research')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.task-dialogue .transcript')).toBeVisible()
}
const transcript = (page: Page) => page.locator('.task-dialogue .transcript')
async function installStream(page: Page, initialRows = Array.from({length: 650}, (_, i) => row(i))) {
  const state = {rows: initialRows, requests: [] as URL[], mode: 'ready', active: 0, maxActive: 0, holdOlder: null as Promise<void> | null}
  await page.route('**/api/tasks/task-research/session?*', async route => {
    const url = new URL(route.request().url())
    state.requests.push(url); state.active++; state.maxActive = Math.max(state.maxActive, state.active)
    try {
      if (state.mode === 'denied') return await route.fulfill({status: 403, json: {error: 'SESSION_RESOURCE_UNAVAILABLE'}})
      if (state.mode === 'conflict' && url.searchParams.has('checkpoint')) return await route.fulfill({status: 409, json: {error: 'SESSION_PAGE_STALE'}})
      if (state.mode === 'offline' || state.mode === 'older-error' && url.searchParams.has('before')) return await route.fulfill({status: 503, json: {error: 'REQUEST_FAILED'}})
      if (state.mode === 'slow') await new Promise(resolve => setTimeout(resolve, 350))
      const count = Number(url.searchParams.get('limit'))
      const checkpoint = url.searchParams.get('checkpoint')
      const before = url.searchParams.get('before')
      if (before && state.holdOlder) await state.holdOlder
      const anchor = checkpoint ? Number(checkpoint.slice(3)) : -1
      const end = before ? state.rows.findIndex(item => item.id === before) : checkpoint ? Math.min(state.rows.length, anchor + 1 + count) : state.rows.length
      const start = before || !checkpoint ? Math.max(0, end - count) : anchor + 1
      await route.fulfill({json: {status: 'ready', scope: 'current-session-context', revision: `v-${state.rows.length}`,
        items: state.rows.slice(start, end), total: state.rows.length,
        checkpoint: before ? checkpoint : `cp-${end - 1}`, before: start > 0 && start < state.rows.length ? state.rows[start].id : null, hasNewer: !before && end < state.rows.length}})
    } finally { state.active-- }
  })
  return state
}
const online = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')))
const scrollTop = (page: Page, top = 0) => transcript(page).evaluate((el, value) => { el.scrollTop = value; el.dispatchEvent(new Event('scroll')) }, top)

test('200 records initially, prepend stays anchored, newer bursts have no gaps or duplicates', async ({page}) => {
  const state = await installStream(page)
  await login(page)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(200)
  expect(state.requests[0].searchParams.get('limit')).toBe('200')
  await expect(page.getByRole('button', {name: '查看更早记录', exact: true})).toHaveCount(0)
  await expect(page.locator('.execution-pagination')).toHaveCount(0)
  const first = transcript(page).locator('[data-message-id="row-450"]')
  state.mode = 'slow'
  await scrollTop(page, 80)
  const top = (await first.boundingBox())!.y
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(400)
  expect(Math.abs((await first.boundingBox())!.y - top)).toBeLessThan(2)
  const anchored = await transcript(page).evaluate(el => el.scrollTop)
  state.rows.push(...Array.from({length: 430}, (_, i) => row(650 + i)))
  await online(page)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(830)
  expect(Math.abs(await transcript(page).evaluate(el => el.scrollTop) - anchored)).toBeLessThan(2)
  expect(state.maxActive).toBe(1)
  await scrollTop(page)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(1030)
  await scrollTop(page)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(1080)
  const ids = await transcript(page).locator('.message-assistant').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.messageId))
  expect(ids).toEqual(state.rows.map(item => item.id))
  await page.getByRole('button', {name: '回到最新消息', exact: true}).click()
  state.rows.push(row(1080)); await online(page)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(1081)
  expect(await transcript(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  await page.locator('.task-info-nav').getByRole('link', {name: '执行', exact: true}).click()
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(1081)
})

test('collapsed runs fill the viewport automatically and preserve expanded input/output on polling', async ({page}) => {
  const tools = Array.from({length: 520}, (_, i): Message => ({id: `tool-${i}`, role: 'tool', kind: i % 2 ? 'tool-result' : 'tool-call', toolName: 'read', callId: `call-${Math.floor(i / 2)}`,
    text: i % 2 ? `读取结果 ${i}\n第二行` : `读取资料 ${i}`, status: i % 2 ? 'completed' : 'pending'}))
  const state = await installStream(page, [...Array.from({length: 20}, (_, i) => row(i)), ...tools])
  await login(page)
  await expect.poll(() => state.requests.filter(url => url.searchParams.has('before')).length).toBeGreaterThanOrEqual(2)
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(20)
  const group = transcript(page).locator('.execution-tool-group')
  await group.locator(':scope > summary').click()
  const input = group.locator('.execution-tool-input').first(), output = group.locator('.execution-tool-output').first()
  await input.locator('summary').click(); await output.locator('summary').click()
  await online(page)
  await expect(group).toHaveAttribute('open', '')
  await expect(input).toHaveAttribute('open', ''); await expect(output).toHaveAttribute('open', '')
  expect(await transcript(page).locator('svg,.message-avatar,.execution-tool-group-chevron').count()).toBe(0)
})

test('prepending into an expanded tool group preserves its key, nested disclosures and visible tool anchor', async ({page}) => {
  const tools = Array.from({length: 500}, (_, i): Message => ({id: `tool-${i}`, role: 'tool', kind: i % 2 ? 'tool-result' : 'tool-call', toolName: 'read', callId: `call-${Math.floor(i / 2)}`,
    text: i % 2 ? `读取结果 ${i}\n第二行` : `读取资料 ${i}`, status: i % 2 ? 'completed' : 'pending'}))
  const state = await installStream(page, [...tools, ...Array.from({length: 60}, (_, i) => row(i))])
  let release!: () => void
  state.holdOlder = new Promise<void>(resolve => { release = resolve })
  await login(page)
  const group = transcript(page).locator('.execution-tool-group')
  await group.locator(':scope > summary').click()
  const tool = transcript(page).locator('[data-message-id="tool-360"]')
  const input = tool.locator('.execution-tool-input'), output = tool.locator('.execution-tool-output')
  await input.locator('summary').click(); await output.locator('summary').click()
  await scrollTop(page, 90)
  const y = (await tool.boundingBox())!.y
  release()
  await expect(group.locator('.message-tool')).toHaveCount(170)
  await expect(group).toHaveAttribute('open', '')
  await expect(input).toHaveAttribute('open', ''); await expect(output).toHaveAttribute('open', '')
  expect(Math.abs((await tool.boundingBox())!.y - y)).toBeLessThan(2)
})

test('older-read retry retains data; changed context requires explicit recovery; revoked cache stays hidden', async ({page}) => {
  const state = await installStream(page)
  await login(page)
  state.mode = 'older-error'; await scrollTop(page)
  await expect(transcript(page).locator('.notice')).toBeVisible()
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(200)
  state.mode = 'ready'; await transcript(page).getByRole('button', {name: '重新获取'}).click()
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(400)
  state.mode = 'conflict'; await online(page)
  const notice = page.locator('.execution-history > .notice')
  await expect(notice).toContainText('执行上下文已改变')
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(400)
  state.rows = [row(9999)]; state.mode = 'ready'
  await notice.getByRole('button', {name: '重新获取'}).click()
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(1)
  await expect(transcript(page)).toContainText('9999')
  state.mode = 'denied'; await online(page)
  await expect(page.locator('.execution-history')).not.toContainText('9999')
  state.mode = 'slow'; await page.locator('.execution-history > .notice').getByRole('button', {name: '重新获取'}).click()
  await expect(page.locator('.execution-history')).not.toContainText('9999')
  await expect(transcript(page)).toContainText('9999')
})

test('narrow, dark, reduced-motion and keyboard history navigation stay readable', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.emulateMedia({reducedMotion: 'reduce'})
  await installStream(page, Array.from({length: 260}, (_, i) => row(i)))
  await login(page)
  await page.evaluate(() => {document.documentElement.dataset.theme = 'dark'})
  await transcript(page).focus(); await page.keyboard.press('Home')
  await expect(transcript(page).locator('.message-assistant')).toHaveCount(260)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const results = await new AxeBuilder({page}).include('.task-dialogue').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
  await page.screenshot({path: '../../docs/tmp/execution-scroll-narrow.png', fullPage: true})
})

test('real server projects a long execution stream and captures the default and older view', async ({page}) => {
  const fixture = await startPreview({port: 0, historyRounds: 80})
  try {
    await page.goto(fixture.origin + '/#/tasks/task-research')
    await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
    await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
    await expect(transcript(page)).toContainText('第 80 轮核对完成')
    await page.locator('.task-info-nav').getByRole('link', {name: '执行', exact: true}).click()
    await expect(page.locator('.task-record-controls')).toContainText('已载入 200 / 565 条记录')
    await page.screenshot({path: '../../docs/tmp/execution-scroll-default.png', fullPage: true})
    await scrollTop(page)
    await expect(page.locator('.task-record-controls')).toContainText('已载入 400 / 565 条记录')
    await expect(transcript(page)).toContainText('第 80 轮核对完成')
    await page.screenshot({path: '../../docs/tmp/execution-scroll-older.png', fullPage: true})
    await page.getByRole('button', {name: '回到最新消息', exact: true}).click()
    await expect.poll(() => transcript(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
    await page.setViewportSize({width: 390, height: 844})
    await page.evaluate(() => {document.documentElement.dataset.theme = 'dark'})
    await expect.poll(() => transcript(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
    await page.screenshot({path: '../../docs/tmp/execution-scroll-narrow.png', fullPage: true})
  } finally { await fixture.close() }
})

for (const theme of ['light', 'dark']) test(`${theme}: execution user bubbles reuse chat color and geometry without changing assistant prose`, async ({page}) => {
  await page.goto('/#/chat/sample-plan')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await page.evaluate(theme => {document.documentElement.dataset.theme = theme}, theme)
  const body = page.locator('.message-user > .message-body').first()
  await expect(body).toBeVisible()
  const style = () => body.evaluate(el => {
    const s = getComputedStyle(el)
    return {background: s.backgroundColor, padding: s.padding, radius: s.borderRadius, border: s.borderWidth, shadow: s.boxShadow}
  })
  const chat = await style()
  expect(chat.background).toBe(theme === 'light' ? 'rgb(204, 223, 255)' : 'rgb(38, 59, 92)')
  await installStream(page, [{id: 'user-blue', role: 'user', text: '任务执行中的用户输入，与对话页面保持同样的蓝色气泡。'}, row(1)])
  await page.goto('/#/tasks/task-research')
  await expect(transcript(page)).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 844})
    await expect(body).toBeVisible()
    expect(await style()).toEqual(chat)
    await expect(page.locator('.message-assistant > .message-body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.message-assistant > .message-body')).toHaveCSS('padding', '0px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect((await new AxeBuilder({page}).include('.task-dialogue').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
})
