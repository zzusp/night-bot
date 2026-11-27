import {openRouter} from './open-router'
import {test,expect} from '@playwright/test'
import {startPreview} from './preview.mjs'
let fixture: Awaited<ReturnType<typeof startPreview>>
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true})})
test.afterAll(async()=>{await fixture?.close()})
for(const width of [1440,390])test(`独立 Router 导航保留 Web 草稿，渠道只显示消息 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/#/chat/sample-plan')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await page.locator('.board-composer textarea').fill('切换后保留的草稿')
 if(width<900)await page.getByRole('button',{name:'打开导航',exact:true}).click()
 const nav=page.getByRole('navigation',{name:'主导航'}).filter({visible:true})
 const links=await nav.locator('a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))
 expect(links[links.indexOf('#/tasks')-1]).toBe('#/router')
 await nav.getByRole('link',{name:'Router',exact:true}).click()
 await expect(page).toHaveURL(/#\/router$/)
 await openRouter(page,'chat:sample-plan')
 await expect(page.getByRole('region',{name:'路由记录'})).toContainText('resident_task_query')
 await page.getByRole('link',{name:'原对话',exact:true}).click()
 await expect(page.locator('.board-composer textarea')).toHaveValue('切换后保留的草稿')
 await page.goto(fixture.origin+'/#/channels/room-empty')
 await expect(page.getByRole('heading',{name:'暂无消息'})).toBeVisible()
 await expect(page.getByRole('region',{name:'路由记录'})).toHaveCount(0)
 await expect(page.locator('#activity-panel')).toHaveCount(0)
 await openRouter(page,'conversations:room-empty')
 await expect(page.getByRole('heading',{name:'还没有路由记录'})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('切换终止旧记录读取，失败可重试且鉴权撤销清除正文',async({page})=>{
 await page.goto(fixture.origin+'/#/chat/sample-plan')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await page.route('**/api/chat/sample-plan/session?*',route=>route.fulfill({status:503,json:{error:{code:'SESSION_UNAVAILABLE'}}}))
 await openRouter(page)
 await expect(page.getByRole('alert')).toBeVisible()
 await page.unroute('**/api/chat/sample-plan/session?*')
 await page.getByRole('button',{name:'重试',exact:true}).click()
 await expect(page.getByRole('region',{name:'路由记录'})).toContainText('已找到已有任务')
 await page.route('**/api/chat/sample-plan/session?*',route=>route.fulfill({status:403,json:{error:{code:'ACCESS_DENIED'}}}))
 await expect(page.getByRole('region',{name:'路由记录'})).not.toContainText('已找到已有任务',{timeout:10000})
 await page.getByRole('link',{name:'原对话',exact:true}).click()
 await expect(page.locator('.board-composer textarea')).toBeVisible()
})

for (const width of [1440, 390]) test(`首次读取失败统一汇总且无重复提示，刷新失败保留记录 ${width}`, async ({page}) => {
 await page.setViewportSize({width,height:900})
 await page.goto(fixture.origin+'/#/chat/sample-plan')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const url='**/api/chat/sample-plan/session?*'
 await page.route(url,route=>route.fulfill({status:503,json:{error:{code:'SESSION_UNAVAILABLE'}}}))
 await openRouter(page)
 const panel=page.getByRole('region',{name:'路由记录'})
 const summary=page.getByRole('alert',{name:'读取状态汇总'});await expect(summary.getByRole('heading',{name:'路由记录加载失败'})).toBeVisible()
 await expect(summary).toHaveCount(1);await expect(panel.getByRole('alert')).toHaveCount(0)
 await expect(panel.locator('.notice')).toHaveCount(0)
 await expect(panel).not.toContainText('已保留')
 const geometry=await summary.evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,right:innerWidth-box.right,width:box.width}})
 expect(geometry.left).toBeGreaterThanOrEqual(16);expect(geometry.right).toBeGreaterThanOrEqual(16);expect(geometry.width).toBeLessThanOrEqual(400)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:test.info().outputPath(`error-first-${width}.png`)})
 await page.locator('.workspace-topbar').getByRole('button',{name:'切换深色外观'}).click()
 await page.screenshot({path:test.info().outputPath(`error-first-dark-${width}.png`)})
 await page.unroute(url)
 await page.getByRole('alert',{name:'读取状态汇总'}).getByRole('button',{name:'重试',exact:true}).click()
 await expect(panel).toContainText('已找到已有任务')
 await page.route(url,route=>route.fulfill({status:503,json:{error:{code:'SESSION_UNAVAILABLE'}}}))
 await expect(summary).toContainText('部分内容未更新');await expect(summary).toContainText('路由记录暂未更新')
 await expect(panel).toContainText('已找到已有任务')
 await expect(panel.locator('.execution-error-state')).toHaveCount(0)
 await page.screenshot({path:test.info().outputPath(`error-refresh-dark-${width}.png`)})
})

test('Router 的对话选择同时切换原记录和工作动态，不复用上一组的数据',async({page})=>{
 await page.route('**/api/conversations/*/session?*',route=>{
   const id=new URL(route.request().url()).pathname.split('/')[3]
   return route.fulfill({json:{status:'ready',routingMode:'shared',scope:'current-router-session-context',revision:id,total:1,items:[{id,role:'user',text:id==='room-notes'?'B 路由记录':'A 路由记录'}]}})
 })
 await page.route('**/api/conversations/*/activity',route=>{
   const id=new URL(route.request().url()).pathname.split('/')[3],items=[{taskId:id,title:id==='room-notes'?'B 工作动态':'A 工作动态',state:'running'}]
   return route.fulfill({json:{scope:{conversationId:id},tasks:{items,total:1},running:{items,total:1},interrupted:{items:[],total:0}}})
 })
 await page.goto(fixture.origin+'/#/router?conversation=conversations%3Aroom-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const record=page.getByRole('region',{name:'路由记录'}),rail=page.getByRole('complementary',{name:'任务动态'})
 await expect(record).toContainText('A 路由记录')
 await expect(rail).toContainText('A 工作动态')
 const control=page.getByRole('combobox',{name:'选择对话'})
 await control.press('Enter')
 await page.getByRole('option',{name:'资料整理 · 渠道',exact:true}).click()
 await expect(page).toHaveURL(/conversation=conversations%3Aroom-notes/)
 await expect(record).toContainText('B 路由记录')
 await expect(rail).toContainText('B 工作动态')
 await expect(record).not.toContainText('A 路由记录')
 await expect(rail).not.toContainText('A 工作动态')
})

test('explicit channel selection survives reload and Back without swapping the transcript',async({page})=>{
 await page.route('**/api/conversations/*/session?*',route=>{
   const id=new URL(route.request().url()).pathname.split('/')[3];
   return route.fulfill({json:{status:'ready',routingMode:'shared',scope:'current-router-session-context',revision:id,total:1,items:[{id,role:'user',text:id+' router data'}]}});
 });
 await page.goto(fixture.origin+'/#/router?conversation=conversations%3Aroom-product');
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const records=page.getByRole('region',{name:'路由记录'});
 await expect(records).toContainText('room-product router data');
 await page.getByRole('combobox',{name:'选择对话'}).press('Enter');
 await page.getByRole('option',{name:'资料整理 · 渠道',exact:true}).click();
 await expect(records).toContainText('room-notes router data');
 await expect(records).not.toContainText('room-product router data');
 await page.reload();
 await expect(records).toContainText('room-notes router data');
 await page.getByRole('link',{name:'原对话',exact:true}).click();
 await expect(page).toHaveURL(/channels\/room-notes$/);
 await expect(records).toHaveCount(0);
 await expect(page.locator('#activity-panel')).toHaveCount(0);
 await page.goBack();
 await expect(records).toContainText('room-notes router data');
});
test('Router opens a historical Web conversation beyond the initial listing and rejects unknown IDs',async({page})=>{
 const id='sample-plan';
 await page.route('**/api/chat?offset=0&limit=100',r=>r.fulfill({json:{
  items:Array.from({length:100},(_,i)=>({id:'historical-'+i,title:'Historical '+i,status:'ready'})),total:101,nextOffset:100,
 }}));
 const group='fixture-web-preview-sample-plan';
 await page.route('**/api/chat/sample-plan/session?*',r=>r.fulfill({json:{status:'ready',conversationId:group,items:[{id:'old-row',role:'user',text:'Historical Router record'}],total:1,revision:'old-record'}}));

 let foreignRequests=0
 page.on('request',req=>{if(req.url().includes('/api/chat/unknown-review-chat/session'))foreignRequests++})
 await page.goto(fixture.origin+'/#/router?conversation=chat%3A'+id);
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const record=page.getByRole('region',{name:'路由记录'})
 await expect(record).toContainText('Historical Router record');
 await expect(page.getByRole('link',{name:'原对话',exact:true})).toHaveAttribute('href','#/chat/'+id);
 await page.reload();
 await expect(record).toContainText('Historical Router record');
 await page.evaluate(()=>location.hash='/router?conversation=chat%3Aunknown-review-chat');
 await expect(page.getByRole('heading',{name:'所选对话暂不可用'})).toBeVisible();
 await expect(record).not.toContainText('Historical Router record');
 await expect(page.getByRole('link',{name:'原对话',exact:true})).toHaveCount(0);
 expect(foreignRequests).toBe(0)
});

test('Router offers a distinct read-only legacy record view and can return to live history',async({page})=>{
 const old=page.getByRole('region',{name:'旧路由记录（只读）',exact:true})
 await page.route('**/api/conversations/room-product/legacy-session?*',r=>r.fulfill({json:{
   status:'ready',scope:'legacy-committed-router-context',revision:'legacy',total:1,
   items:[{id:'legacy-event',role:'user',text:'仅旧 Router 会话中的记录'}],
 }}))
 await page.goto(fixture.origin+'/#/router?conversation=conversations%3Aroom-product')
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await expect(page.getByRole('region',{name:'路由记录',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'旧记录',exact:true}).click()
 await expect(old).toContainText('仅旧 Router 会话中的记录')
 await expect(page.locator('.board-composer, #activity-panel')).toHaveCount(0)
 await page.getByRole('link',{name:'当前记录',exact:true}).click()
 await expect(old).toHaveCount(0)
 await expect(page.getByRole('region',{name:'路由记录',exact:true})).not.toContainText('仅旧 Router 会话中的记录')
})
