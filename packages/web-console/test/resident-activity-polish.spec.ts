import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

test('Router dispatch and settlement have one readable layer with no extra technical disclosure', async ({page},info) => {
 const action='resident_task_action', settle='resident_router_settle';
 const pair=(id:string,toolName:string,request:object,response:unknown,extra={})=>['call','result'].map(kind=>({
  id:id+'-'+kind, toolName, callId:id, role:'tool', kind:'tool-'+kind,
  status:kind==='result'?'completed':'result-unrecorded', source:{sessionId:'fixture-activity',entryId:id+'-'+kind},
  text:kind==='call'?JSON.stringify(request):typeof response==='string'?response:JSON.stringify(response),
  ...kind==='result'?extra:{},
 }));
 const request={taskId:'fixture-deploy-check',kind:'supplement',handoff:'补充一份验收截图供发布前核对；目标与上线时间均不变。'};
 const task={taskId:request.taskId,title:'校验发布列表中的部署版本',objective:'确认实际部署版本与核验记录一致。',
  requirements:['先核对实例状态，再核对回滚入口。','仅记录已确认的事项。'],status:'active',control:'active',
  drained:false,requirementRevision:3,contextRevision:4,arrangementRevision:1,runSequence:2};
 const plan={replayed:false,dispatchEligible:false,result:{task}};
 const groups={requestedEventCount:2,dispositions:{'context-only':1,'handled-inline':1},inspectionReviews:{wait:1}};
 const items=[
  ...pair('action',action,request,plan,{timing:{durationMs:905}}),
  ...pair('settle',settle,groups,{...groups,settled:true},{timing:{durationMs:120}}),
  {id:'answer',role:'assistant',kind:'router-reply',text:'内容已补入现有任务。'},
  ...pair('failed',action,request,'当前任务不可修改。',{isError:true,status:'error'}),
  ...pair('partial',action,request,plan,{truncated:true,textNextOffset:200}),
 ];
 await page.route('**/api/chat/sample-plan/session?*',route=>route.fulfill({json:{status:'ready',scope:'current-router-session-context',items,total:items.length,revision:'activity-polish',generation:1,live:{active:false,items:[]}}}));
 await page.goto('/#/chat/sample-plan');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.getByRole('tab',{name:'路由',exact:true}).click();
 const record=page.locator('.execution-transcript');
 const fold=record.locator('.execution-turn-process').first();
 await fold.locator('summary').first().click();
 const row=(id:string)=>record.locator(`[data-message-id="${id}-call"]`);
 const tool=row('action'), event=row('settle');
 await expect(tool.locator('.pi-web-tool-summary')).toContainText('补充任务');
 await tool.locator('.pi-web-tool-summary').focus();
 await page.keyboard.press('Enter');
 await event.locator('.pi-web-tool-summary').click();
 await expect(tool.getByText(task.title,{exact:true})).toHaveCount(1);
 await expect(tool.getByText(task.objective,{exact:true})).toBeVisible();
 await expect(tool.getByText(request.handoff,{exact:true})).toBeVisible();
 await expect(tool.getByText(task.requirements[0],{exact:true})).toBeVisible();
 await expect(tool.getByText('已安排',{exact:true})).toBeVisible();
 await expect(tool.getByText('回执',{exact:true})).toHaveCount(0);
 await expect(tool.getByText('记录信息',{exact:true})).toHaveCount(0);
 await expect(tool.getByText('上下文版本',{exact:true})).toHaveCount(0);
 await expect(tool.getByText(request.taskId,{exact:true})).toHaveCount(0);
 await expect(tool.locator('details')).toHaveCount(1);
 await expect(event.getByText('提交 2 项事件',{exact:true})).toHaveCount(1);
 await expect(event.getByText('已结清',{exact:true}).filter({visible:true})).toHaveCount(1);
 await expect(event.getByText('仅作背景 1',{exact:true})).toBeVisible();
 await expect(event.getByText('等待 1',{exact:true})).toBeVisible();
 await expect(event.getByText('提交事件数',{exact:true})).toHaveCount(0);
 for(const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
  await page.setViewportSize({width,height:900});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const violations=(await new AxeBuilder({page}).include('.resident-action').include('.resident-settlement').analyze()).violations;
  expect(violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await tool.locator('.pi-web-tool-summary').evaluate(el=>(el as HTMLElement).blur());
  await event.locator('.pi-web-tool-summary').evaluate(el=>(el as HTMLElement).blur());
  await page.mouse.move(0,0);
  await fold.screenshot({path:info.outputPath(`router-tool-polish-${width}.png`)});
 }
 const failed=row('failed'), partial=row('partial');
 await failed.locator('.pi-web-tool-summary').click();
 await expect(failed.getByText(request.handoff,{exact:true})).toBeVisible();
 await expect(failed.getByText('当前任务不可修改。',{exact:true})).toBeVisible();
 await expect(failed.getByText(task.title,{exact:true})).toHaveCount(0);
 await partial.locator('.pi-web-tool-summary').click();
 await expect(partial.getByText(request.handoff,{exact:true})).toBeVisible();
 await expect(partial.locator('pre')).toContainText('requirementRevision');
 await expect(partial.locator('.resident-action')).toHaveCount(1);
});
