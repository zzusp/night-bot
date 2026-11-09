import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('截图回归：侧栏标签不竖排，复制与正文对齐，渠道卡片状态和操作不挤压', async ({page}) => {
  await page.goto('/#/chat/sample-plan')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.locator('.rail-channel .board-badge').first()).toBeVisible()
  for (const badge of await page.locator('.rail-channel .board-badge').all()) {
    const box = (await badge.boundingBox())!; expect(box.width).toBeGreaterThan(40); expect(box.height).toBeLessThanOrEqual(28)
  }
  for (const width of [1440, 1100, 768, 390]) {
    await page.setViewportSize({width, height: 960})
    await page.goto('/#/channels/room-product')
    await expect(page.locator('.message .copy-action').first()).toBeVisible()
    for (const article of await page.locator('.message').all()) {
      const text = (await article.locator('.markdown').boundingBox())!
      const copy = (await article.locator('.copy-action').boundingBox())!
      expect(Math.abs(copy.x - text.x)).toBeLessThanOrEqual(1)
      expect(copy.y).toBeGreaterThanOrEqual(text.y + text.height)
      const body = (await article.locator('.message-body').boundingBox())!
      expect(copy.y + copy.height).toBeLessThanOrEqual(body.y + body.height)
    }
    await page.goto('/#/channels')
    await expect(page.locator('.channel-card').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const card of await page.locator('.channel-card').all()) {
      const cardBox = (await card.boundingBox())!
      const badge = (await card.locator('.channel-card-select > .board-badge').boundingBox())!
      expect(badge.height).toBeLessThanOrEqual(28)
      expect(badge.x + badge.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
      for (const control of await card.locator('.channel-card-actions > button').all()) {
        const box = (await control.boundingBox())!
        expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height)
      }
    }
    await page.screenshot({path: test.info().outputPath(`channel-cards-${width}.png`)})
  }
})
