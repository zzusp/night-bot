import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('任务气泡展示实际Router指令与目标要求，浅深色窄屏不溢出', async ({page}) => {
  await page.goto('/#/tasks/task-research')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  const bubble = page.locator('.task-dialogue .message-user').first()
  await expect(bubble).toContainText('先核对已有资料，再逐项验证差异')
  await expect(bubble).toContainText('区分事实与假设')
  await expect(bubble).not.toContainText('原始请求：帮我看一下')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height: 960})
      await expect(bubble).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({path: test.info().outputPath(`router-instruction-${theme}-${width}.png`)})
    }
  }
})
