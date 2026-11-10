import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: shared controls and repeated viewport resize`, async ({page}) => {
    await login(page)
    await page.evaluate(value => { localStorage.setItem('night-theme', value); document.documentElement.dataset.theme = value }, theme)
    for (const route of ['#/chat', '#/tasks', '#/tasks/task-research', '#/channels']) {
      await page.goto('/' + route)
      await expect(page.locator('.main-panel')).toBeVisible()
      for (const width of [1440, 1100, 768, 390, 1440]) {
        await page.setViewportSize({width, height: 960})
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const panel = await page.locator('.main-panel').boundingBox()
        expect(panel!.x + panel!.width).toBeLessThanOrEqual(width)
        expect(panel!.width).toBeGreaterThan(width < 1024 ? width - 40 : width - 600)
        await page.screenshot({path: test.info().outputPath(`${theme}-${route.replaceAll('/', '-')}-${width}.png`)})
      }
    }
    const nav = page.locator('.primary-nav a').first()
    await nav.hover()
    await expect(nav).toHaveCSS('text-decoration-line', 'none')
    await page.getByRole('button', {name: '添加渠道', exact: true}).click()
    const dialog = page.getByRole('dialog', {name: '添加渠道'})
    await dialog.getByLabel('渠道类型', {exact: true}).selectOption('dingtalk-dws')
    const type = dialog.getByLabel('会话类型', {exact: true})
    await type.focus()
    await type.press('ArrowDown')
    await type.press('Enter')
    await expect(type).toHaveValue('chat')
    await type.press('Alt+ArrowDown')
    await page.screenshot({path: test.info().outputPath(`${theme}-native-select-open.png`)})
    await type.press('Escape')
    // Chromium/headless may deliver Escape to the dialog when the native popup
    // is not held open. Verify its focus restoration before reopening the form.
    if (!await dialog.count()) {
      await expect(page.getByRole('button', {name: '添加渠道', exact: true})).toBeFocused()
      await page.getByRole('button', {name: '添加渠道', exact: true}).click()
      await type.focus()
    }
    await expect(type).toBeFocused()
    await page.setViewportSize({width: 390, height: 844})
    const prompt = dialog.getByLabel('渠道职责（可选）')
    await prompt.fill('用途说明\n'.repeat(30))
    await expect(prompt).toHaveCSS('resize', 'none')
    expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(240)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
    await expect(dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true})).toBeFocused()
    await expect(dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true})).toHaveAttribute('aria-invalid', 'true')
    expect((await new AxeBuilder({page}).include('.channel-create-dialog[open]').analyze()).violations).toEqual([])
    await page.screenshot({path: test.info().outputPath(`${theme}-mobile-form.png`)})
    await dialog.getByRole('button', {name: '关闭添加渠道'}).click()
    await expect(page.getByRole('button', {name: '添加渠道', exact: true})).toBeFocused()
  })
}
