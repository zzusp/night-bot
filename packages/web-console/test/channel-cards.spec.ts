import {test,expect,type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
async function login(page:Page){await page.goto('/#/channels');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.locator('.channel-card').first()).toBeVisible()}
for(const theme of ['light','dark'])test(`${theme}: 卡片整体悬停，3/4列与窄屏，不拉伸少量卡片`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await login(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
 const data=await page.request.get('/api/channels').then(r=>r.json()),original=data.items.find((item:{channelId:string})=>item.channelId==='dingtalk-work')
 let rows=[original,...Array.from({length:7},(_,i)=>({...original,channelId:'fixture-card-'+i,type:'fixture-custom',name:'自定义渠道 '+i,writesAuthorized:undefined}))]
 await page.route('**/api/channels',route=>route.fulfill({json:{items:rows}}));await page.reload();await expect(page.locator('.channel-card')).toHaveCount(8)
 for(const [width,columns] of [[1920,4],[1440,3],[1280,3],[1100,2],[768,2],[390,1]]){
  await page.setViewportSize({width,height:1000});const grid=page.locator('.channel-cards')
  expect(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns)
  const cards=await page.locator('.channel-card').all(),box=(await grid.boundingBox())!
  for(const card of cards){const rect=(await card.boundingBox())!;expect(rect.width).toBeLessThanOrEqual(box.width/columns+1);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:test.info().outputPath(`${theme}-${width}.png`)})
 }
 await page.setViewportSize({width:1440,height:1000});const card=page.locator('.channel-card').first(),select=card.locator('.channel-card-select'),action=card.locator('.channel-card-actions')
 await page.mouse.move(0,0);const idle=await card.evaluate(el=>getComputedStyle(el).backgroundColor);await select.hover()
 await expect.poll(()=>card.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(idle)
 const hover=await card.evaluate(el=>getComputedStyle(el).backgroundColor)
 expect(await select.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
 expect(await card.locator('.channel-card-bottom').evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('0px')
 await action.hover();expect(await card.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(hover);expect(await action.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
 await select.focus();await page.keyboard.press('Enter');await expect(select).toHaveAttribute('aria-pressed','true')
 await action.getByRole('button').click();await expect(page.getByRole('dialog',{name:'编辑钉钉渠道',exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByLabel('渠道标识',{exact:true})).toHaveValue('dingtalk-work');await expect(select).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape')
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([])
 rows=[original];await page.reload();await expect(page.locator('.channel-card')).toHaveCount(1)
 expect((await page.locator('.channel-card').boundingBox())!.width).toBeLessThan((await page.locator('.channel-cards').boundingBox())!.width/2)
})
test('阶段缺失使用中性提示，仍保留未知发送、重启和旧配置/外发限制',async({page})=>{
 await login(page)
 let rows=[{type:'web-console',channelId:'local-web',enabled:true,connectionState:'unknown',connected:true},
 {type:'dingtalk-dws',channelId:'pending-card',name:'新渠道名称',enabled:true,restartRequired:true,connectionState:'pending-restart',savedVersion:'new',runningVersion:'old',runningName:'旧渠道名称',runningConversationType:'chat',conversationType:'chat-room',runningConnectionState:'paused',runningConnected:false,writesAuthorized:false,errorCode:'DINGTALK_CHANNEL_SWITCH_BLOCKED'}]
 await page.route('**/api/channels',route=>route.fulfill({json:{items:rows}}));await page.reload()
 const web=page.locator('.channel-card').filter({hasText:'local-web'});await expect(web).toContainText('运行阶段未提供');await expect(web.getByText('运行阶段未提供',{exact:true})).toHaveClass(/board-badge--neutral/);await expect(web).toContainText('健康检查正常');await expect(web).not.toContainText('待核实')
 const pending=page.locator('.channel-card').filter({hasText:'pending-card'});await expect(pending).toContainText('已保存 · 待重启');await expect(pending).toContainText('当前仍使用此前配置：旧渠道名称');await expect(pending).toContainText('外发未授权');await expect(pending).toContainText('旧目标有未决依赖')
 await page.goto('/#/channels/room-product');await expect(page.locator('.message').getByText('待核实',{exact:true})).toBeVisible()
})
