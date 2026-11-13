import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
import {openMessageProcess} from './message-process-helpers'
test('单条消息首答时间、共同任务结果与无需回复、等待和未知状态分开展示',async({page})=>{
 const unanswered={receivedAt:'2026-11-09T01:00:02Z',firstReplyAt:null,durationMs:null,reason:null,steps:[]}
 const items=[
  {messageId:'one',preview:'核对今天的安排',status:'confirmed',receivedAt:'2026-11-09T01:00:00Z',firstReplyAt:'2026-11-09T01:00:01.250Z',durationMs:1250,reason:null,steps:[{label:'Host 接收消息',at:'2026-11-09T01:00:00Z'},{label:'首条回复已确认可见',at:'2026-11-09T01:00:01.250Z'}]},
  {...unanswered,messageId:'two',preview:'另一条独立的问题',status:'unconfirmed'},
  {...unanswered,messageId:'three',preview:'无需操作的旁白',status:'no-reply',reason:'一级分诊明确无需处理且无需回复。'},
  {...unanswered,messageId:'four',preview:'等待分诊的请求',status:'awaiting-handling'},
  {...unanswered,messageId:'five',preview:'已安排但还没回复的请求',status:'awaiting-reply'},
  {...unanswered,messageId:'six',preview:'已绑定的附件',status:'confirmed',replyAssociation:'task',firstReplyAt:'2026-11-09T01:00:04.500Z',durationMs:2500,reason:'此回复通过精确来源绑定及回复前已提交的任务快照关联，为共同任务回复。',replyPreview:'四个附件均已核对。'},
  {...unanswered,messageId:'seven',preview:'发送失败的请求',status:'failed'},
  {...unanswered,messageId:'eight',preview:'等待发送的请求',status:'pending'},
 ]
 await page.route('**/api/conversations/room-product/response-times?*',route=>route.fulfill({json:{status:'ready',total:items.length,nextOffset:null,items}}))
 await page.goto('/#/channels/room-product?view=execution');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 await openMessageProcess(page)
 const section=page.getByRole('region',{name:'消息首答与处理过程'})
 for(const text of ['1 秒','3 秒','回复尚未确认可见','无需处理及回复','等待处理','等待回复','回复发送失败','等待发送'])await expect(section).toContainText(text)
 await expect(section).not.toContainText('尚无可核实的首答');await expect(section).not.toContainText('未记录本条消息的回复')
 await expect(section).toContainText('首条回复已确认可见')
 const shared=section.locator('.response-time-row').filter({hasText:'已绑定的附件'});await expect(shared).toContainText('共同回复');await expect(shared).not.toContainText('此回复通过精确来源绑定');await expect(shared).not.toContainText('四个附件均已核对。')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`first-reply-${width}.png`)})}
})

test('任务待办清单与模型思考展示真实记录，更新和撤权不沿用旧内容', async ({page}) => {
 await page.goto('/#/tasks/task-research?view=execution'); await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN); await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const todos=page.getByRole('region',{name:'任务待办'}), cards=todos.locator('.agent-progress-step')
 await expect(cards).toHaveCount(3)
 await expect(todos.locator('.agent-progress-label')).toHaveText('还剩 2 步')
 await expect(todos).not.toContainText('模型最近提交')
 await todos.locator('summary').click()
 await expect(cards.first()).not.toBeVisible()
 await expect(todos.locator('.agent-progress-current')).toHaveText('核对来源与结论')
 await todos.locator('summary').click()
 await expect(cards.first()).toBeVisible()
 for(const [index,status] of ['已完成','进行中','待处理'].entries()) await expect(cards.nth(index)).toContainText(status)
 await expect(cards.nth(1)).toContainText('核对来源与结论')
 const thought=page.locator('.thinking-message'); await expect(thought).not.toHaveAttribute('open')
 await thought.locator(':scope > summary').click(); await expect(thought).toContainText('先比较任务材料中的来源，再检查结论是否有证据支持。')
 const tool=page.locator('.message-tool'); await tool.locator('.execution-tool-input > summary').click(); await tool.locator('.execution-tool-output > summary').click()
 await expect(tool).toContainText('/fixture/materials/research.md'); await expect(tool).toContainText('已读取 3 份资料')
 const snapshot=await (await page.request.get('/api/tasks/task-research/session')).json()
 expect(snapshot.items.some((row:{kind:string})=>row.kind==='thinking')).toBe(true)
 expect(JSON.stringify(snapshot)).not.toMatch(/SECRET_ARGUMENT_FIXTURE|SECRET_SIGNATURE_FIXTURE/)
 for(const [width,theme] of [[1440,'light'],[390,'light'],[1440,'dark'],[390,'dark']] as const){
  await page.setViewportSize({width,height:960}); await page.evaluate(value=>document.documentElement.dataset.theme=value,theme)
  const geometry=await todos.locator('.agent-progress').evaluate(el=>({width:el.getBoundingClientRect().width,border:getComputedStyle(el).borderRadius,background:getComputedStyle(el).backgroundColor}))
  expect(geometry.width).toBeLessThanOrEqual(300)
  expect(geometry.border).toBe('16px')
  await todos.locator('summary').focus(); await page.keyboard.press('Enter')
  await expect(cards.first()).not.toBeVisible()
  expect(await todos.locator('.agent-progress').evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(340)
  await page.screenshot({path:test.info().outputPath(`agent-progress-collapsed-${width}-${theme}.png`),fullPage:true})
  await page.keyboard.press('Enter'); await expect(cards.first()).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
  await page.screenshot({path:test.info().outputPath(`execution-records-${width}-${theme}.png`),fullPage:true})
 }
 await todos.locator('summary').click()
 let denied=false
 await page.route('**/api/tasks/task-research/session?*',async route=>{
  if(denied){await route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});return}
  const response=await route.fetch(),data=await response.json()
  await route.fulfill({json:{...data,todos:{...data.todos,items:data.todos.items.map((row:object)=>({...row,status:'completed'}))}}})
 })
 await page.evaluate(() => window.dispatchEvent(new Event('online')))
 await expect(todos.locator('.todo-completed')).toHaveCount(3)
 await expect(todos.locator('.agent-progress-label')).toHaveText('步骤已完成')
 await expect(cards.first()).not.toBeVisible()
 await todos.locator('summary').click()
 await expect(cards.first()).toBeVisible()
 denied=true; await page.evaluate(() => window.dispatchEvent(new Event('online')))
 await expect(page.getByText('执行记录暂不可读',{exact:true})).toBeVisible()
 await expect(todos).toHaveCount(0); await expect(page.locator('.thinking-message')).toHaveCount(0); await expect(page.locator('.message-tool')).toHaveCount(0)
})
