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
  {...unanswered,messageId:'six',preview:'已绑定的附件',status:'confirmed',firstReplyAt:'2026-11-09T01:00:04.500Z',durationMs:2500,reason:'此回复通过精确来源绑定及回复前已提交的任务快照关联，为共同任务回复。',replyPreview:'四个附件均已核对。'},
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
 const shared=section.locator('.response-time-row').filter({hasText:'已绑定的附件'});await expect(shared).toContainText('共同任务回复');await expect(shared).not.toContainText('四个附件均已核对。')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`first-reply-${width}.png`)})}
})
