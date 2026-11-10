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
test('任务标题固定在记录底部，任务信息在侧栏且窄屏可达',async({page})=>{
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960})
  await expect(page.locator('.task-title-dock')).toContainText('整理本周产品调研')
  await expect(page.locator('.task-info-rail')).toContainText('创建时间')
  await page.getByRole('navigation',{name:'任务信息分类'}).getByRole('link',{name:'执行',exact:true}).focus()
  await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'执行动态',exact:true})).toBeVisible()
  await page.getByRole('navigation',{name:'任务信息分类'}).getByRole('link',{name:'任务',exact:true}).click()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
})
test('截图红框的输入框底部说明不再可见，保留发送入口',async({page})=>{
 await page.goto('/#/chat/sample-plan');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.getByLabel('消息内容',{exact:true})).toBeVisible();await expect(page.getByText('关闭页面后，任务仍会继续',{exact:true})).toHaveCount(0)
 await expect(page.getByText('Enter 发送 · Shift + Enter 换行',{exact:true})).toHaveClass(/sr-only/)
 await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeVisible()
})
