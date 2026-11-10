import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page) {
  await page.goto('/#/channels')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.channel-card--add')).toBeVisible()
}

test('添加卡片位于网格末尾，替代顶部按钮并保持键盘与关闭焦点', async ({page}) => {
  await login(page)
  const card = page.getByRole('button', {name: '添加渠道', exact: true})
  await expect(page.locator('.channels-page .page-heading')).toHaveCount(0)
  await expect(card).toHaveCount(1)
  await expect(page.locator('.channel-cards > .channel-card').last()).toHaveClass(/channel-card--add/)
  await expect(card).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(card.locator('.board-badge, .channel-card-health')).toHaveCount(0)
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press('Tab')
    await card.focus()
    expect(await card.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
    await page.keyboard.press(key)
    const dialog = page.getByRole('dialog', {name: '添加渠道', exact: true})
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('渠道类型', {exact: true})).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(card).toBeFocused()
  }
})

for (const theme of ['light', 'dark']) test(`${theme}: 添加卡片复用网格尺寸、悬停和焦点，窄屏不溢出`, async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await login(page)
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
  await expect(page.locator('.channel-card:not(.channel-card--add)').first()).toBeVisible()
  const add = page.locator('.channel-card--add'), existing = page.locator('.channel-card:not(.channel-card--add)').first()
  for (const [width, columns] of [[1920, 4], [1440, 3], [1100, 2], [768, 2], [390, 1]]) {
    await page.setViewportSize({width, height: 1000})
    expect(await page.locator('.channel-cards').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns)
    const box = (await add.boundingBox())!, sibling = (await existing.boundingBox())!
    expect(Math.abs(box.width - sibling.width)).toBeLessThanOrEqual(1)
    expect(box.height).toBeGreaterThanOrEqual(128)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await add.evaluate(el => getComputedStyle(el).borderRadius)).toBe(await existing.evaluate(el => getComputedStyle(el).borderRadius))
    await page.screenshot({path: test.info().outputPath(`add-card-${theme}-${width}.png`)})
  }
  await page.mouse.move(0, 0)
  const idle = await add.evaluate(el => getComputedStyle(el).backgroundColor)
  await add.hover()
  expect(await add.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(idle)
  await page.keyboard.press('Tab')
  await add.focus()
  expect(await add.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('2px')
  expect((await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
})

test('空渠道列表保留同一张添加卡片，轮询新增卡片不丢失表单草稿', async ({page}) => {
  let items: unknown[] = []
  await page.route('**/api/channels', route => route.fulfill({json: {items}}))
  await login(page)
  await expect(page.locator('.channel-card')).toHaveCount(1)
  const add = page.getByRole('button', {name: '添加渠道', exact: true})
  await add.click()
  const dialog = page.getByRole('dialog', {name: '添加渠道', exact: true})
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('dingtalk-dws')
  const id = dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true})
  await id.fill('preserve-add-card-draft')
  items = [{channelId: 'new-list-row', type: 'web-console', enabled: true, connected: true}]
  // Visibility recovery runs the normal list refresh without replacing the page.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.channel-card')).toHaveCount(2)
  await expect(dialog).toBeVisible()
  await expect(id).toHaveValue('preserve-add-card-draft')
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await add.click()
  await expect(id).toHaveValue('preserve-add-card-draft')
})

test('列表加载和失败不伪装为空，也不阻止添加卡片打开既有流程', async ({page}) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => {release = resolve})
  await page.route('**/api/channels', async route => {await gate; await route.fulfill({status: 503, json: {error: 'UNAVAILABLE'}})})
  await login(page)
  await expect(page.locator('.channels-page > .loading').first()).toBeVisible()
  const add = page.getByRole('button', {name: '添加渠道', exact: true})
  await add.click()
  const dialog = page.getByRole('dialog', {name: '添加渠道', exact: true})
  await expect(dialog).toBeVisible()
  release()
  await expect(page.getByRole('heading', {name: '渠道配置暂不可读', exact: true})).toBeVisible()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await expect(page.getByRole('heading', {name: '还没有配置渠道', exact: true})).toHaveCount(0)
})
