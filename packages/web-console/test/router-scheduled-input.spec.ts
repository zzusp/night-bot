import {test, expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture: Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async () => { fixture = await startPreview({port: 0, sessionRecords: true}) })
test.afterAll(async () => { await fixture?.close() })
for (const width of [1440, 390]) test(`路由自动输入与上下文摘要 ${width}`, async ({page}) => {
 await page.setViewportSize({width, height: 1000})
 await page.route('**/api/chat/sample-plan/session?*', async route => {
  const response = await route.fetch()
  const body = await response.json()
  body.items = [
   {id:'summary', role:'assistant', kind:'context-summary', text:'明早汇报今天的工作内容。\n\n### 关联信息\n- 明早指北京时间11月15日09:00\n- 今天的工作按11月14日汇总', createdAt:'2026-11-14T12:00:00Z'},
   {id:'scheduled', role:'user', kind:'scheduled-trigger', text:'汇报今天的工作进展、遇到的阻塞和明日安排。\n\n检查发布任务的实际执行结果，并核对构建状态与服务健康情况。\n\n如仍有未完成事项，记录当前进度、具体阻塞与下一次检查时间。\n\n不要重复执行已经完成的工作。', createdAt:'2026-11-15T01:00:00Z'},
   {id:'reply', role:'assistant', kind:'message', text:'正在核对今天的任务记录和执行结果。', createdAt:'2026-11-15T01:00:02Z'},
  ]
  await route.fulfill({response, json:body})
 })
 await page.goto(fixture.origin+'/#/chat/sample-plan')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await page.getByRole('tab',{name:'路由',exact:true}).click()
 const trigger = page.locator('[data-message-id="scheduled"]')
 await expect(trigger).toHaveClass(/message-user/)
 await expect(trigger).toContainText('由已安排任务发送')
 await expect(trigger.getByLabel('定时触发')).toBeVisible()
 await expect(trigger.getByRole('button',{name:'显示更多'})).toBeVisible()
 await trigger.getByRole('button',{name:'显示更多'}).click()
 await expect(trigger.getByRole('button',{name:'收起'})).toBeVisible()
 await trigger.getByRole('button',{name:'收起'}).click()
 await expect(page.locator('[data-message-id="summary"]')).toContainText('上下文摘要')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:test.info().outputPath(`router-scheduled-${width}.png`)})
 await page.locator('.workspace-topbar').getByRole('button',{name:'切换深色外观'}).click()
 await page.screenshot({path:test.info().outputPath(`router-scheduled-dark-${width}.png`)})
})
