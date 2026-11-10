import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page, path = '/tasks/task-research') {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
}
const section = (page: Page, name: string) => page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name, exact: true})

test('任务记录默认展开，底部标题、四类侧栏、阅读位置与前进后退独立', async ({page}) => {
  let learningReads = 0
  page.on('request', request => { if (request.url().includes('/learning')) learningReads++ })
  await login(page)
  await expect(page.locator('.task-dialogue .message-assistant').first()).toBeVisible()
  await expect(page.locator('.task-title-dock')).toContainText('整理本周产品调研')
  await expect(page.locator('.task-info-rail')).toContainText('对比三个候选方案')
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  expect(learningReads).toBe(0)
  const left = (await page.locator('.task-workspace > .conversation-page').boundingBox())!
  const right = (await page.locator('.task-info-rail').boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  const title = (await page.locator('.task-title-dock').boundingBox())!
  const records = (await page.locator('.task-dialogue').boundingBox())!
  expect(title.y).toBeGreaterThanOrEqual(records.y + records.height - 1)
  const transcript = page.locator('.task-dialogue .transcript')
  await transcript.evaluate(el => { el.scrollTop = 0; el.setAttribute('data-retained', 'yes') })
  await section(page, '执行').focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/view=execution/)
  await expect(page.getByRole('heading', {name: '执行动态', exact: true})).toBeVisible()
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
      await expect(page.locator('.task-title-dock')).toBeVisible()
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
  await expect(page.locator('.task-info-rail')).toContainText('不能据此判定没有复盘或变更')
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
  await expect(page.locator('.task-title-dock')).toContainText('整理本周产品调研')
  mode = 'offline'; await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.task-workspace > .conversation-page .notice')).toBeVisible()
  await expect(page.locator('.task-title-dock')).toContainText('整理本周产品调研')
  mode = 'denied'; await page.locator('.task-workspace > .conversation-page .notice').getByRole('button').click()
  await expect(page.locator('.task-title-dock')).toHaveCount(0)
  await expect(page.locator('.task-dialogue')).toHaveCount(0)
  mode = 'slow'; await page.locator('.task-workspace > .conversation-page .notice').getByRole('button').click()
  await expect(page.locator('.task-title-dock')).toHaveCount(0)
  await expect(page.locator('.task-title-dock')).toContainText('整理本周产品调研')
  mode = 'empty'; await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.task-info-rail')).toContainText('未记录任务目标')
  await expect(page.locator('.task-info-rail')).toContainText('尚无已记录的处理结果')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.task-title-dock h2').innerText()).toBe('很长的任务标题'.repeat(50))
})
