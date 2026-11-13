import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

for (const width of [1440, 390]) test(`所有页面导航在内容区内 ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.chat-panel')).toBeVisible()
  for (const route of ['tasks', 'schedules', 'channels', 'evolution', 'settings', 'feedback', 'not-found']) {
    await page.goto(`/#/${route}`)
    const header = page.locator('.main-panel > .page-content-topbar')
    await expect(header.getByRole('heading', {level: 1})).toBeVisible()
    await expect(page.locator('.main-frame > .topbar .header-location')).toHaveCount(0)
    await expect(page.locator('.header-location')).toHaveCount(1)
    const box = await header.boundingBox(), panel = await page.locator('.main-panel').boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(panel!.y)
    const inset = width <= 760 ? 16 : 24
    expect(await header.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBe(inset)
    const body = page.locator('.page-content-slot > .page-content')
    if (await body.count()) {
      expect(await body.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBe(inset)
      expect(await body.evaluate(el => getComputedStyle(el).maxWidth)).toBe('none')
    }
    expect(box!.x).toBeGreaterThanOrEqual(panel!.x)
    expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (route === 'tasks' && width === 390) {
      const tableRegion = page.getByRole('region', {name: '任务列表，可横向滚动'})
      await tableRegion.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => tableRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
      await tableRegion.evaluate(el => { el.scrollLeft = el.scrollWidth })
      await expect(tableRegion.locator('.row-link').first()).toBeInViewport()
      await tableRegion.evaluate(el => { el.scrollLeft = 0 })
    }
    await page.locator('.main-frame > .topbar').getByRole('button', {name: '切换深色外观'}).click()
    await expect(header).toBeVisible()
    await page.screenshot({path: test.info().outputPath(`breadcrumb-${route}-${width}-dark.png`)})
    await page.locator('.main-frame > .topbar').getByRole('button', {name: '切换浅色外观'}).click()
    if (width === 390) {
      await header.getByRole('button', {name: '打开导航'}).click()
      await expect(page.getByRole('dialog', {name: '导航'})).toBeVisible()
      await page.getByRole('button', {name: '关闭导航'}).click()
      await expect(header.getByRole('button', {name: '打开导航'})).toBeFocused()
    }
  }
})
