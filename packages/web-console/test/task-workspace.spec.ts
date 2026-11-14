import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page, path = '/tasks/task-research') {
  await page.goto('/#' + path)
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
}
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
