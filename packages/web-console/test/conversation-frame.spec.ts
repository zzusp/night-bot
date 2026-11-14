import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'
import {openMessageProcess} from './message-process-helpers'

for (const source of [
  {path: '/chat/sample-plan', writable: true},
  {path: '/channels/room-product', writable: false},
  {path: '/channels/custom-room', writable: false, task: 'task-history-16'},
  {path: '/channels/custom-direct', writable: false, task: 'task-history-17'},
]) {
  test(`${source.path}: 统一截图布局、执行视图与宽度，保留来源读写边界`, async ({page}) => {
    await page.goto('/#' + source.path)
    await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
    await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
    const frame = page.locator('.conversation-page')
    await expect(frame).toBeVisible()
    await expect(frame.locator('.chat-history-tabs')).toHaveCount(0)
    await expect(page.locator('.channel-chat-header')).toHaveCount(0)
    await expect(page.locator('.channel-chat-footer')).toHaveCount(0)
    for (const width of [1440, 1100, 768, 390]) {
      await page.setViewportSize({width, height: 960})
      await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(source.writable ? 1 : 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (source.writable) {
        const geometry = await frame.evaluate(el => {
          const column = el.querySelector('.message-column')!, composer = el.querySelector('.composer-dock > div')!;
          const box = column.getBoundingClientRect(), input = composer.getBoundingClientRect();
          return {contentLeft: box.left + 16, contentRight: box.right - 16, inputLeft: input.left, inputRight: input.right};
        });
        expect(Math.abs(geometry.contentLeft - geometry.inputLeft)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.contentRight - geometry.inputRight)).toBeLessThanOrEqual(2);
      }
      const rect = (await frame.boundingBox())!
      expect(rect.x + rect.width).toBeLessThanOrEqual(width)
      if (width > 1250) await expect(page.getByRole('complementary', {name: '任务动态'})).toBeVisible()
      await openMessageProcess(page)
      const popover = page.getByRole('dialog', {name: '消息处理过程', exact: true})
      await expect(popover.getByText('本会话的任务与安排', {exact: true})).toHaveCount(0)
      await expect(popover.locator('.message-tool')).toHaveCount(0)
      await expect(popover).toHaveAttribute('aria-modal', 'false')
      await page.getByRole('button', {name: '关闭消息处理过程', exact: true}).click()
      await expect(page.getByLabel('消息内容', {exact: true})).toHaveCount(source.writable ? 1 : 0)
      await page.screenshot({path: test.info().outputPath(`${source.path.replaceAll('/', '-')}-${width}.png`)})
    }
  })
}
