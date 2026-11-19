import {test,expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture:Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true})})
test.afterAll(async()=>{await fixture.close()})
for(const width of [1440,390])test(`direct Router labels preserve historical triage and show two active model roles ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.getByRole('tab',{name:'分诊',exact:true})).toHaveCount(0)
 await page.getByRole('tab',{name:'历史分诊',exact:true}).click()
 await expect(page.getByRole('tabpanel',{name:'历史分诊',exact:true})).toContainText('channel_triage_submit')
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
