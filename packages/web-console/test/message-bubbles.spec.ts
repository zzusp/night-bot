import {test,expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'
for(const path of ['/chat/sample-plan','/channels/room-product','/channels/custom-direct'])test(`${path}: 左右气泡与等圆角，无复制图标`,async({page})=>{
 await page.goto('/#'+path);await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.locator('.message-user').first()).toBeVisible()
 for(const width of [1440,390]){
 await page.setViewportSize({width,height:960})
 for(const role of ['user','assistant']){const row=page.locator('.message-'+role).first();if(!await row.count())continue
 expect(await row.evaluate((el,role)=>getComputedStyle(el).alignSelf===(role==='user'?'flex-end':'flex-start'),role)).toBe(true)
 const corners=await row.locator('.message-body').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius]});expect(new Set(corners).size).toBe(1)
 }
 await expect(page.getByRole('button',{name:/复制消息|复制当前段/})).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:test.info().outputPath(`bubbles-${width}.png`)})
 }
})
test('任务头部保留当前状态，目标和创建信息可键盘展开',async({page})=>{
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.locator('.detail-heading')).toBeVisible()
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});const details=page.locator('.task-description');await expect(details).not.toHaveAttribute('open','');await details.locator('summary').focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await expect(details).toContainText('创建于');await page.keyboard.press('Enter');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
})
