import {test,expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture:Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true})})
test.afterAll(async()=>{await fixture.close()})
for(const width of [1440,390])test(`Router pages expose no triage history and show two active model roles ${width}`,async({page})=>{
 await page.route('**/stage-times?limit=8',route=>route.fulfill({json:{status:'ready',items:[{receivedAt:'2026-11-19T00:00:00Z',triage:{status:'missing',durationMs:null,shared:false},router:{status:'recorded',durationMs:750,shared:false}}]}}))
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.getByRole('tab',{name:'分诊',exact:true})).toHaveCount(0)
 if(width<900)await page.getByRole('button',{name:'显示活动面板',exact:true}).click()
 await expect(page.locator('.stage-timing-card-router')).toBeVisible()
 await expect(page.locator('.stage-timing-card-triage')).toHaveCount(0)
 await expect(page.getByRole('tablist',{name:'会话记录'}).getByRole('tab')).toHaveText(['对话','路由'])
 for(const path of ['/api/conversations/room-product/triage/session','/api/conversations/room-product/triage/session/messages/old','/api/chat/sample-plan/triage/session'])expect((await page.request.get(fixture.origin+path)).status()).toBe(404)
 await page.getByRole('tab',{name:'路由',exact:true}).click()
 await expect(page.getByRole('tabpanel',{name:'路由',exact:true})).toContainText('resident_task_query')
 await expect(page.locator('.board-composer:visible')).toHaveCount(0)
 await page.getByRole('button',{name:'设置',exact:true}).click()
 await page.getByRole('tab',{name:'模型分工',exact:true}).click()
 const dialog=page.getByRole('dialog')
 await expect(dialog.locator('.settings-role-card')).toHaveCount(2)
 await expect(dialog.locator('#role-router-title')).toBeVisible();await expect(dialog.locator('#role-task-title')).toBeVisible()
 await expect(dialog.locator('#role-triage-title')).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('old triage timings are hidden while Router durations remain accurate',async({page})=>{
 await page.route('**/stage-times?limit=8',route=>route.fulfill({json:{status:'ready',items:[{receivedAt:'2026-11-18T00:00:00Z',triage:{status:'recorded',durationMs:2000,shared:false},router:{status:'recorded',durationMs:3000,shared:false}}]}}))
 await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.getByRole('heading',{name:'历史分诊耗时',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'路由耗时',exact:true})).toBeVisible()
 await expect(page.locator('.stage-timing-card-triage')).toHaveCount(0)
 await expect(page.locator('.stage-timing-card-router .stage-plot-heading strong')).toContainText('3')
})

for(const width of [1440,390])test(`压缩图只显示真实成功跨度，失败取消断线且空态不填零 ${width}`,async({page})=>{
 let empty=false
 await page.route('**/stage-times?limit=8',route=>route.fulfill({json:{status:'ready',items:[{receivedAt:'2026-11-19T00:00:00Z',router:{status:'recorded',durationMs:750,shared:false}}],compactions:{status:'ready',items:empty?[]:[
  {receivedAt:'2026-11-19T00:00:04Z',compaction:{status:'failed',durationMs:4000,shared:false}},
  {receivedAt:'2026-11-19T00:00:03Z',compaction:{status:'cancelled',durationMs:3000,shared:false}},
  {receivedAt:'2026-11-19T00:00:02Z',compaction:{status:'recorded',durationMs:2000,shared:false}},
  {receivedAt:'2026-11-19T00:00:01Z',compaction:{status:'recorded',durationMs:1000,shared:false}},
 ]}}}))
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 if(width<900)await page.getByRole('button',{name:'显示活动面板',exact:true}).click()
 const card=page.getByRole('region',{name:'Router 上下文压缩耗时',exact:true})
 await expect(card.locator('[data-stage-sample=measured]')).toHaveCount(2)
 await expect(card.locator('[data-stage-sample=missing]')).toHaveCount(2)
 await expect(card.locator('.stage-line')).toHaveCount(1)
 await card.getByRole('img',{name:/压缩失败/}).focus();await expect(card.locator('.stage-plot-heading')).toContainText('压缩失败')
 await card.getByRole('img',{name:/已取消/}).focus();await expect(card.locator('.stage-plot-heading')).toContainText('已取消')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 empty=true;await page.reload()
 if(width<900&&await page.getByRole('button',{name:'显示活动面板',exact:true}).count())await page.getByRole('button',{name:'显示活动面板',exact:true}).click()
 await expect(card).toContainText('暂无压缩耗时记录');await expect(card.locator('[data-stage-sample]')).toHaveCount(0)
})
