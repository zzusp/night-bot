import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page, path = '/tasks/task-research') {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
}
const section = (page: Page, name: string) => page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name, exact: true})

test('任务记录无顶部及底部卡片，四类侧栏保留标题、操作和阅读位置', async ({page}) => {
  let learningReads = 0
  page.on('request', request => { if (request.url().includes('/learning')) learningReads++ })
  await login(page)
  await expect(page.locator('.task-dialogue .message-assistant').first()).toBeVisible()
  await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
  await expect(page.locator('.task-info-rail')).toContainText('对比三个候选方案')
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  expect(learningReads).toBe(0)
  const left = (await page.locator('.task-workspace > .conversation-page').boundingBox())!
  const right = (await page.locator('.task-info-rail').boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  await expect(page.locator('.task-title-dock, .task-records-heading')).toHaveCount(0)
  await expect(page.locator('.task-dialogue .execution-scope')).toHaveCount(0)
  await expect(page.locator('.task-dialogue .message-avatar')).toHaveCount(0)
  await expect(page.locator('.task-dialogue .message-source')).toHaveCount(0)
  await expect(page.locator('.task-info-rail svg:visible')).toHaveCount(0)
  await expect(page.getByRole('link', {name: '全部任务', exact: true})).toHaveCount(0)
  await expect(page.locator('.task-info-rail > :first-child')).toHaveAttribute('aria-label', '任务信息分类')
  const records = (await page.locator('.task-dialogue').boundingBox())!
  expect(Math.abs(records.y - left.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(records.height - left.height)).toBeLessThanOrEqual(1)
  const transcript = page.locator('.task-dialogue .transcript')
  await transcript.evaluate(el => { el.scrollTop = 0; el.setAttribute('data-retained', 'yes') })
  await section(page, '执行').focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/view=execution/)
  await expect(page.getByRole('heading', {name: '执行动态', exact: true})).toBeVisible()
  await expect(page.locator('.task-info-rail svg:visible, .task-info-rail .timeline-dot')).toHaveCount(0)
  await expect(page.locator('.task-record-controls')).toContainText('当前执行上下文')
  await page.locator('.task-record-controls').getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(transcript).toHaveAttribute('data-retained', 'yes')
  expect(await transcript.evaluate(el => el.scrollTop)).toBe(0)
  await page.goBack(); await expect(section(page, '任务')).toHaveAttribute('aria-current', 'page')
  await page.goForward(); await expect(section(page, '执行')).toHaveAttribute('aria-current', 'page')
  await section(page, '任务').click()
  await page.emulateMedia({reducedMotion: 'reduce'})
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const width of [1440, 1100, 800, 390]) {
      await page.setViewportSize({width, height: 960})
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.locator('.task-info-title')).toBeVisible()
      const rail = (await page.locator('.task-info-rail').boundingBox())!
      const tabs = (await page.getByRole('navigation', {name: '任务信息分类'}).boundingBox())!
      expect(Math.abs(tabs.y - rail.y)).toBeLessThanOrEqual(1)
      await section(page, '执行').click()
      await expect(page.getByRole('heading', {name: '执行动态', exact: true})).toBeVisible()
      await section(page, '任务').click()
      if (width === 1440 || width === 390) {
        expect((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
        await page.locator('main').evaluate(el => el.scrollTop = 0)
        await page.screenshot({path: test.info().outputPath(`task-workspace-${theme}-${width}.png`)})
      }
    }
  }
})

for (const width of [1440, 390]) {
  test(`任务详情不显示全部任务，${width}px 全局任务导航与历史往返保留`, async ({page}) => {
    await page.setViewportSize({width, height: 960})
    await login(page)
    await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
    await expect(page.getByRole('link', {name: '全部任务', exact: true})).toHaveCount(0)
    if (width < 1024) await page.getByRole('button', {name: '打开导航', exact: true}).click()
    const navigation = page.locator(width < 1024 ? '.nav-dialog' : '.desktop-sidebar').getByRole('navigation', {name: '主导航'})
    const tasks = navigation.locator('a[href="#/tasks"]')
    await expect(tasks).toBeVisible()
    await tasks.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/tasks$/)
    await expect(page.getByRole('dialog', {name: '导航', exact: true})).not.toBeVisible()
    await expect(page.locator('.task-table')).toBeVisible()
    const taskLink = page.locator('.task-table').getByRole('link', {name: '整理本周产品调研', exact: true})
    await taskLink.click()
    await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
    await page.goBack()
    await expect(taskLink).toBeVisible()
    await page.goForward()
    await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
    await expect(page.getByRole('link', {name: '全部任务', exact: true})).toHaveCount(0)
  })
}

test('复盘与学习分别展示真实接口字段，授权正文按需读取，空与不可用不混淆', async ({page}) => {
  let mode = 'ready', bodyReads = 0
  const source = {taskId: 'task-research', reviewId: 'review-1', eventId: 'event-1'}
  await page.route('**/api/tasks/task-research/learning', async route => {
    if (mode === 'denied') return route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}})
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 500))
    return route.fulfill({json: mode === 'unavailable' ? {status: 'unavailable', reviews: null, changes: null} : {status: 'ready', reviews: mode === 'empty' ? [] : [{...source, status: 'done', summary: '从真实记录核对改进项。', at: '2026-11-10T01:00:00Z'}], changes: mode === 'empty' ? [] : [{...source, id: 'memory-1', name: '测试记忆条目', kind: 'memory', status: 'applied', action: 'upsert', scope: 'bot', version: 1, canRead: true, source}]}})
  })
  await page.route('**/api/tasks/task-research/learning/changes/**', route => { bodyReads++; return route.fulfill({json: {id: 'memory-1', kind: 'memory', text: '授权后的正文内容。', version: 1, source}}) })
  await login(page)
  await section(page, '复盘').click()
  await expect(page.locator('.task-info-rail')).toContainText('从真实记录核对改进项')
  await expect(page.locator('.learning-change')).toHaveCount(0)
  await section(page, '学习').click()
  await expect(page.locator('.learning-change')).toContainText('测试记忆条目')
  await expect(page.locator('.learning-review')).toHaveCount(0)
  expect(bodyReads).toBe(0)
  await page.getByRole('button', {name: '读取授权正文'}).click()
  await expect(page.locator('.learning-body')).toContainText('授权后的正文内容')
  expect(bodyReads).toBe(1)
  mode = 'empty'; await page.getByRole('button', {name: '刷新复盘记录'}).click()
  await expect(page.locator('.task-info-rail')).toContainText('尚无已记录的学习变更')
  mode = 'unavailable'; await page.getByRole('button', {name: '刷新复盘记录'}).click()
  await expect(page.locator('.task-info-rail')).toContainText('复盘与学习记录暂不可读')
  mode = 'ready'; await page.getByRole('button', {name: '刷新复盘记录'}).click()
  await expect(page.locator('.task-info-rail')).toContainText('测试记忆条目')
  mode = 'denied'; await page.getByRole('button', {name: '刷新复盘记录'}).click()
  await expect(page.locator('.learning-change')).toHaveCount(0)
  mode = 'slow'; await page.getByRole('button', {name: '刷新复盘记录'}).click()
  await expect(page.locator('.learning-change')).toHaveCount(0)
  await expect(page.locator('.learning-change')).toContainText('测试记忆条目')
  await expect(page.locator('.task-dialogue .message')).not.toHaveCount(0)
})

test('任务读取失败保留旧快照，撤权后左右内容清除，重试不闪回；空字段明确', async ({page}) => {
  let mode = 'ready'
  await page.route('**/api/tasks/task-research', async route => {
    if (mode === 'offline') return route.fulfill({status: 503, json: {error: 'REQUEST_FAILED'}})
    if (mode === 'denied') return route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}})
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 500))
    const response = await route.fetch(); const data = await response.json()
    return route.fulfill({json: mode === 'empty' ? {...data, title: '很长的任务标题'.repeat(50), objective: '', result: null, updatedAt: null, createdAt: null, blockers: []} : data})
  })
  await login(page)
  await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
  mode = 'offline'; await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.task-workspace > .conversation-page .notice')).toBeVisible()
  await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
  mode = 'denied'; await page.locator('.task-workspace > .conversation-page .notice').getByRole('button').click()
  await expect(page.locator('.task-info-title')).toHaveCount(0)
  await expect(page.locator('.task-dialogue')).toHaveCount(0)
  mode = 'slow'; await page.locator('.task-workspace > .conversation-page .notice').getByRole('button').click()
  await expect(page.locator('.task-info-title')).toHaveCount(0)
  await expect(page.locator('.task-info-title')).toContainText('整理本周产品调研')
  mode = 'empty'; await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.task-info-rail')).toContainText('未记录任务目标')
  await expect(page.locator('.task-info-rail')).toContainText('尚无已记录的处理结果')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.task-info-title').innerText()).toBe('很长的任务标题'.repeat(50))
  await page.locator('.task-info-rail .blockers').scrollIntoViewIfNeeded()
  await expect(page.locator('.task-info-rail .blockers')).toBeInViewport()
  await page.setViewportSize({width: 1440, height: 960})
  await page.locator('.task-info-content').evaluate(el => { el.scrollTop = el.scrollHeight })
  expect(await page.locator('.task-info-content').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await section(page, '执行').click()
  expect(await page.locator('.task-info-content').evaluate(el => el.scrollTop)).toBe(0)
  await expect(page.locator('.task-record-controls').getByRole('button', {name: '获取最新记录', exact: true})).toBeInViewport()
  await section(page, '任务').click()
  await expect(page.locator('.task-info-title')).toBeInViewport()
})
