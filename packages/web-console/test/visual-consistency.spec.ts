import {selectOption} from './select-control';
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
        const expected = await page.locator('.workspace-body').evaluate(body => {
          const style = getComputedStyle(body), rect = body.getBoundingClientRect();
          if (style.flexDirection === 'column') return rect.width;
          const siblings = [...body.children].filter(node => !node.matches('.main-panel') && node.getBoundingClientRect().width > 0);
          return rect.width - siblings.reduce((sum, node) => sum + node.getBoundingClientRect().width, 0) - siblings.length * parseFloat(style.columnGap);
        })
        expect(Math.abs(panel!.width - expected)).toBeLessThanOrEqual(1)
        expect(panel!.width).toBeGreaterThan(width < 1024 ? width - 40 : 600)
        await page.screenshot({path: test.info().outputPath(`${theme}-${route.replaceAll('/', '-')}-${width}.png`)})
      }
    }
    const nav = page.locator('.primary-nav a').first()
    await nav.hover()
    await expect(nav).toHaveCSS('text-decoration-line', 'none')
    await page.getByRole('button', {name: '添加渠道', exact: true}).click()
    const dialog = page.getByRole('dialog', {name: '添加渠道'})
    await selectOption(dialog.getByLabel('渠道类型', {exact: true}),'dingtalk-dws')
    const type = dialog.getByLabel('会话类型', {exact: true})
    await type.focus()
    await type.press('Space')
    const popup = page.getByRole('listbox')
    await expect(popup).toBeVisible()
    await page.keyboard.press('End')
    await expect(page.getByRole('option').last()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(type).toHaveAttribute('data-value', 'chat')
    await expect(type).toBeFocused()
    await type.press('Space')
    await expect(popup).toBeVisible()
    const triggerBounds = await type.boundingBox(), popupBounds = await popup.boundingBox()
    expect(Math.abs(triggerBounds!.width - popupBounds!.width)).toBeLessThanOrEqual(1)
    await page.screenshot({path: test.info().outputPath(`${theme}-select-open.png`)})
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(dialog).toBeVisible()
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
