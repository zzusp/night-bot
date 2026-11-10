import {test, expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
import {openMessageProcess} from './message-process-helpers'

test('渠道保留只读对话和任务深链，消息浮层不读取全会话任务或工具', async ({page}) => {
  let recordsReads = 0
  page.on('request', request => { if (/\/api\/conversations\/room-product\/(tasks|session)(?:[/?]|$)/.test(request.url())) recordsReads++ })
  await page.goto('/#/channels/room-product')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByRole('heading', {name: '产品协作', exact: true, level: 1})).toBeVisible()
  await expect(page.getByText('讨论参与者', {exact: true})).toBeVisible()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  const dialog = await openMessageProcess(page)
  await expect(dialog.getByText('本会话的任务与安排', {exact: true})).toHaveCount(0)
  await expect(dialog.locator('.message-tool')).toHaveCount(0)
  expect(recordsReads).toBe(0)
  await page.setViewportSize({width: 390, height: 844})
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
  await page.getByRole('button', {name: '关闭消息处理过程', exact: true}).click()
  await expect(page.getByText('讨论参与者', {exact: true})).toBeVisible()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
