import {openRouter} from './open-router';
import {test, expect, type Page} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page) {
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.chat-panel .board-composer')).toBeVisible()
}

for (const width of [1440, 1024, 390]) test(`内容内工具栏与面板切换 ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  await login(page)
  await expect(page.locator('.main-frame > .topbar')).toBeVisible()
  await expect(page.locator('.main-frame > .topbar').getByRole('button', {name: '刷新概览'})).toBeVisible()
  await expect(page.locator('.conversation-tools').getByRole('button', {name: '刷新概览'})).toHaveCount(0)
  const panel = page.locator('.chat-panel'), header = page.locator('.main-frame > .workspace-topbar')
  const frameBox = await page.locator('.main-frame').boundingBox(), panelBox = await panel.boundingBox()
  expect(panelBox!.y - frameBox!.y).toBe(width <= 520 ? 48 : 52)
  await expect(panel.locator('.header-location')).toHaveCount(0)
  await expect(header.getByRole('heading', {level: 1})).toBeVisible()
  expect((await header.boundingBox())!.height).toBe(width <= 520 ? 48 : 52)
  const composer = page.locator('.board-composer textarea')
  await composer.fill('未发送草稿')
  await expect(page.locator('#activity-panel')).toHaveCount(0)
  await openRouter(page,'chat:sample-plan');
  const toggle = page.locator('.router-tools').getByRole('button',{name:/工作动态/})
  for (let i = 0; i < 4; i++) {
    const open = await toggle.getAttribute('aria-expanded') === 'true'
    await toggle.focus(); await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', String(!open))
    await expect(page.locator('#activity-panel')).toHaveCount(open ? 0 : 1)
    await expect(composer).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({path: test.info().outputPath(`chat-toolbar-${width}.png`)})
  await expect(page.locator('.main-frame > .topbar')).toBeVisible()
  await page.goto('/#/chat')
  await expect(composer).toHaveValue('未发送草稿')
  await page.locator('.main-frame > .topbar').getByRole('button', {name: '切换深色外观'}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toHaveCount(0)
})
