import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
test('任务进展优先显示真实合同字段，缺失不猜测，撤权不显示旧摘要',async({page})=>{
 await page.goto('/#/channels/room-product?view=execution');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const group=page.locator('[data-task-id="task-research"]');await group.locator(':scope > summary').click()
 await expect(group.locator(':scope > summary')).toContainText('整理本周产品调研')
 await expect(group.locator('.execution-task-summary')).toContainText('任务正在执行，尚未提交处理结果。')
 let mode='waiting'
 await page.route('**/api/conversations/room-product/tasks/task-research',async route=>{
  if(mode==='denied'){await route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});return}
  const response=await route.fetch(),data=await response.json();await route.fulfill({json:{...data,state:mode,result:{action:'blocked',summary:'缺少核对输入',question:'请指定待核对文件',limitations:['只有已提交的数据可展示']},blockers:[{kind:'operation',id:'one',title:'等待用户提供文件',status:'waiting'}]}})
 })
 await expect(group.locator('.execution-task-summary')).toContainText('请指定待核对文件')
 await expect(group.locator('.execution-task-summary')).toContainText('等待用户提供文件')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])}
 mode='denied';await expect(group.locator('.execution-task-summary')).not.toContainText('缺少核对输入',{timeout:12000});await group.locator('.execution-task-summary').getByRole('button',{name:'重新获取',exact:true}).click();await expect(group.locator('.execution-task-summary')).not.toContainText('请指定待核对文件')
})
test('单条消息首答时间、确认过程与未知状态分开展示',async({page})=>{
 await page.route('**/api/conversations/room-product/response-times?*',route=>route.fulfill({json:{status:'ready',total:2,nextOffset:null,items:[{messageId:'one',preview:'核对今天的安排',status:'confirmed',receivedAt:'2026-11-09T01:00:00Z',firstReplyAt:'2026-11-09T01:00:01.250Z',durationMs:1250,reason:null,steps:[{label:'Host 接收消息',at:'2026-11-09T01:00:00Z'},{label:'分诊已提交',at:'2026-11-09T01:00:00.500Z'},{label:'首条回复已确认可见',at:'2026-11-09T01:00:01.250Z'}]},{messageId:'two',preview:'另一条独立的问题',status:'unconfirmed',receivedAt:'2026-11-09T01:00:02Z',firstReplyAt:null,durationMs:null,reason:null,steps:[]}]}}))
 await page.goto('/#/channels/room-product?view=execution');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const section=page.getByRole('region',{name:'消息首答与处理过程'});await expect(section).toContainText('1.25 秒');await expect(section).toContainText('回复尚未确认可见')
 await section.locator('details').first().locator('summary').click();await expect(section).toContainText('首条回复已确认可见')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`first-reply-${width}.png`)})}
})
