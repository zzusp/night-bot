import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('截图回归：侧栏标签不竖排，消息无复制图标，渠道卡片状态和操作不挤压', async ({page}) => {
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
    await expect(page.locator('.message .copy-action')).toHaveCount(0)
    await page.goto('/#/channels')
    await expect(page.locator('.channel-card').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const card of await page.locator('.channel-card:not(.channel-card--add)').all()) {
      const cardBox = (await card.boundingBox())!
      const tag = card.locator('.channel-card-tag')
      const badge = await tag.count() ? await tag.boundingBox() : null
      if (badge) {
        expect(badge.height).toBeLessThanOrEqual(28)
        expect(badge.x + badge.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
      }
      for (const control of await card.locator('.channel-card-actions > button').all()) {
        const box = (await control.boundingBox())!
        expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height)
      }
    }
    await page.screenshot({path: test.info().outputPath(`channel-cards-${width}.png`)})
  }
})
