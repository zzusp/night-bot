import {test, expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

test('渠道沿用 Web 对话与执行过程、正式任务记录、深链和只读边界', async ({page}) => {
  await page.goto('/#/channels/room-product')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByRole('heading', {name: '产品协作', exact: true, level: 2})).toBeVisible()
  await expect(page.getByText('讨论参与者', {exact: true})).toBeVisible()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  await page.getByRole('link', {name: '执行过程', exact: true}).click()
  await expect(page).toHaveURL(/view=execution/)
  await expect(page.getByText('Router · 会话安排', {exact: true})).toBeVisible()
  await expect(page.getByText('执行尚未开始', {exact: true})).toBeVisible()
  const group = page.locator('.chat-execution-group').filter({has: page.locator('summary code', {hasText: /^task-research$/})})
  await expect(group).not.toHaveAttribute('open')
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/conversations/room-product/tasks/task-research/session')
  await group.locator('summary').click()
  expect((await (await response).json()).status).toBe('ready')
  await expect(group.getByText('已开始核对现有资料。先读取材料，再逐项比对来源与结论。', {exact: true})).toBeVisible()
  await expect(group.locator('.message-tool')).toHaveCount(1)
  let denied = false
  await page.route('**/api/conversations/room-product/tasks/task-research/session?*', route => denied
    ? route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}}) : route.continue())
  denied = true
  await group.getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(group.getByText('执行记录暂不可读', {exact: true})).toBeVisible()
  await expect(group.locator('.message-tool')).toHaveCount(0)
  await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
  await group.getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(group.locator('.message-tool')).toHaveCount(0)
  await page.unroute('**/api/conversations/room-product/tasks/task-research/session?*')

  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('link', {name: '执行过程', exact: true})).toHaveAttribute('aria-current', 'page')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.setViewportSize({width: 390, height: 844})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
  await page.getByRole('link', {name: '对话', exact: true}).click()
  await expect(page.getByText('讨论参与者', {exact: true})).toBeVisible()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
})
