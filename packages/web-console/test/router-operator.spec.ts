import {test,expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture:Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true,routerOperator:{failOnce:true,delayMs:450}})})
test.afterAll(async()=>{await fixture.close()})
for(const width of [1440,390])test(`Router 网页对话与草稿隔离 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/channels/room-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.locator('.board-composer:visible')).toHaveCount(0)
 await page.getByRole('tab',{name:'分诊',exact:true}).click();await expect(page.locator('.board-composer:visible')).toHaveCount(0)
 await page.getByRole('tab',{name:'路由',exact:true}).click()
 const field=page.getByPlaceholder('向 Router 询问…'),text=`合成数据：查询当前进度 ${width}`,before=fixture.routerAttempts.length,receivedBefore=fixture.received.length,willFail=fixture.routerAttempts.length===0
 await field.fill(text);await field.dispatchEvent('compositionstart');await field.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});expect(fixture.routerAttempts.length).toBe(before);await field.dispatchEvent('compositionend')
 await page.getByRole('button',{name:'发送消息',exact:true}).click()
 if(willFail){await expect(page.getByRole('button',{name:'重试发送'})).toBeVisible();await expect(field).toHaveValue(text);await page.getByRole('button',{name:'重试发送'}).click()}
 await expect(field).toHaveValue('')
 if(willFail)expect(fixture.routerAttempts[before].requestId).toBe(fixture.routerAttempts[before+1].requestId)
 const panel=page.getByRole('tabpanel',{name:'路由',exact:true});await expect(panel).toContainText(text);await expect(panel).toContainText('合成数据回复：只在这个网页显示。');expect(fixture.received.length).toBe(receivedBefore)
 await page.screenshot({path:test.info().outputPath(`router-web-reply-${width}.png`)})
 const requests=fixture.routerAttempts.length,accepted=fixture.routerRequests.size
 await field.fill(`合成在途 ${width}`);await page.getByRole('button',{name:'发送消息',exact:true}).click()
 await page.goto(fixture.origin+'/#/channels/room-notes');await page.getByRole('tab',{name:'路由',exact:true}).click()
 const other=page.getByPlaceholder('向 Router 询问…');await other.fill(`另一渠道草稿 ${width}`)
 await expect.poll(()=>fixture.routerRequests.size).toBe(accepted+1);await expect(other).toHaveValue(`另一渠道草稿 ${width}`);expect(fixture.routerAttempts[requests].conversationId).toBe('room-product')
 await page.goto(fixture.origin+'/#/channels/room-product');await page.getByRole('tab',{name:'路由',exact:true}).click();await expect(page.getByPlaceholder('向 Router 询问…')).toHaveValue('')
 await page.goto(fixture.origin+'/#/channels/room-notes');await page.getByRole('tab',{name:'路由',exact:true}).click();await expect(other).toHaveValue(`另一渠道草稿 ${width}`)
 const rect=await page.locator('.router-composer').boundingBox();expect(rect!.y+rect!.height).toBeLessThanOrEqual(901);expect(rect!.width).toBeLessThanOrEqual(width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:test.info().outputPath(`router-web-${width}.png`)})
})
