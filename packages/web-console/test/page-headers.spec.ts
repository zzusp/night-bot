import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

const evolution = {
  status: 'ready', coverage: 'bot-shared-current-state',
  memory: {acceptedCount: 0, candidateCount: 0, readCount: 0, searchCount: 0},
  skills: {installedCount: 0, installedAvailableCount: 0, activeCount: 0, candidateCount: 0, modelUseCount: 0, userUseCount: 0, fileReadCount: 0, loadCount: 0},
  items: [], total: 0, offset: 0, limit: 20, nextOffset: null, revision: 'page-header-fixture',
}

async function login(page: Page) {
  await page.route('**/api/evolution?*', route => route.fulfill({json: evolution}))
  await page.goto('/#/tasks')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByRole('navigation', {name: '任务状态'})).toBeVisible()
}

test('页面直接进入内容，导航标题和必要操作保留', async ({page}) => {
  await login(page)
  for (const [path, title, content] of [
    ['/tasks', '任务', '.tasks-page > .list-toolbar'],
    ['/evolution', '自进化', '.evolution-page > .evolution-library'],
    ['/settings', '设置', '.settings-page > .settings-card'],
  ]) {
    await page.goto('/#' + path)
    await expect(page.getByRole('heading', {name: title, level: 1, exact: true})).toBeVisible()
    await expect(page.getByRole('heading', {name: title, level: 2, exact: true})).toHaveCount(0)
    await expect(page.locator('.page-heading')).toHaveCount(0)
    await expect(page.locator(content).first()).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 960})
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
      await page.screenshot({path: test.info().outputPath(`${path.slice(1)}-${width}.png`), animations: 'disabled'})
    }
  }
})

test('移位后的刷新按钮可键盘操作，读取失败仍可重试', async ({page}) => {
  await login(page)
  await page.goto('/#/evolution')
  const refresh = page.getByRole('button', {name: '刷新记录', exact: true})
  await expect(refresh).toBeVisible()
  await refresh.focus()
  const evolutionRead = page.waitForResponse(response => response.url().includes('/api/evolution?'))
  await page.keyboard.press('Enter')
  await evolutionRead
  await expect(page.getByRole('heading', {name: '暂无自进化记录', exact: true})).toBeVisible()

  await page.goto('/#/settings')
  const reload = page.getByRole('button', {name: '重新读取设置', exact: true})
  await expect(reload).toBeVisible()
  await page.getByLabel('显示名称', {exact: true}).fill('未保存的名称')
  await reload.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('显示名称', {exact: true})).not.toHaveValue('未保存的名称')
  await page.route('**/api/settings', route => route.fulfill({status: 503, json: {error: 'SETTINGS_UNAVAILABLE'}}))
  await page.getByRole('button', {name: '重新读取设置', exact: true}).click()
  await expect(page.locator('.settings-page > .notice[role="alert"]')).toBeVisible()
  await page.unroute('**/api/settings')
  await page.locator('.settings-page').getByRole('button', {name: '重新获取', exact: true}).click()
  await expect(page.getByRole('button', {name: '重新读取设置', exact: true})).toBeVisible()
})
