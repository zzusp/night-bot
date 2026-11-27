import {openRouter} from './open-router';
import {test,expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture:Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true,routerOperator:true})})
test.afterAll(async()=>{await fixture.close()})
for(const width of [1440,390])test(`渠道路由只读保留历史，普通 Web 仍可发送 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 let routerPosts=0
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/router/messages'))routerPosts++})
 for(const name of ['对话','路由']){
  if(name==='路由')await openRouter(page)
  await expect(page.locator('.board-composer:visible')).toHaveCount(0)
  await expect(page.locator('.router-composer')).toHaveCount(0)
  await expect(page.getByPlaceholder('向 Router 询问…')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'发送消息',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'重试发送',exact:true})).toHaveCount(0)
 }
 const panel=page.getByRole('region',{name:'路由记录'})
 await expect(panel).toContainText('产品渠道：压缩前的记录')
 await expect(panel).toContainText('资料渠道：压缩后的记录')
 await expect(panel.locator('.composer-dock')).toHaveCount(0)
 expect(routerPosts).toBe(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.goto(fixture.origin+'/#/chat')
 const input=page.getByLabel('消息内容',{exact:true}),text=`合成数据：普通 Web 发送 ${width}`
 await expect(input).toBeVisible();await input.fill(text)
 await page.getByRole('button',{name:'发送消息',exact:true}).click()
 await expect(input).toHaveValue('')
 await expect(page.locator('.message-assistant').last()).toContainText('这是本地隔离验收回复')
 await expect(page.locator('.message-user').last()).toContainText(text)
 expect(routerPosts).toBe(0)
 await page.goto(fixture.origin+'/#/channels/room-product');await openRouter(page)
 await expect(page.getByRole('region',{name:'路由记录'})).toContainText('资料渠道：压缩后的记录')
 await expect(page.locator('.board-composer:visible')).toHaveCount(0)
})
