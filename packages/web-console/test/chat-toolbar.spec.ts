import {test, expect, type Page} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page) {
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.chat-panel .conversation-topbar')).toBeVisible()
}

for (const width of [1440, 1024, 390]) test(`内容内工具栏与面板切换 ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  await login(page)
  await expect(page.locator('.main-frame > .topbar')).toHaveCount(0)
  const panel = page.locator('.chat-panel'), header = panel.locator('.conversation-topbar')
  const frameBox = await page.locator('.main-frame').boundingBox(), panelBox = await panel.boundingBox()
  expect(panelBox!.y).toBe(frameBox!.y)
  await expect(header.getByRole('heading', {level: 1})).toBeVisible()
  const composer = page.locator('.board-composer textarea')
  await composer.fill('未发送草稿')
  const toggle = header.locator('.rail-toggle')
  for (let i = 0; i < 4; i++) {
    const open = await toggle.getAttribute('aria-expanded') === 'true'
    await toggle.focus(); await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', String(!open))
    await expect(page.locator('#activity-panel')).toHaveCount(open ? 0 : 1)
    await expect(composer).toHaveValue('未发送草稿')
    await expect(composer).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({path: test.info().outputPath(`chat-toolbar-${width}.png`)})
  if (width === 390) {
    await header.getByRole('button', {name: '打开导航'}).click()
    await page.getByRole('dialog', {name: '导航'}).getByRole('link', {name: '设置', exact: true}).click()
  } else await page.goto('/#/settings')
  await expect(page.locator('.main-frame > .topbar')).toBeVisible()
  await expect(page.locator('.main-panel .conversation-topbar')).toHaveCount(0)
  await page.goto('/#/chat')
  await expect(composer).toHaveValue('未发送草稿')
  await header.getByRole('button', {name: '切换深色外观'}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toBeVisible()
})
