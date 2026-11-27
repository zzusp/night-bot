import {openRouter} from './open-router';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

test('Router dispatch and settlement have a concise default with optional supporting details', async ({page},info) => {
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
 await page.route('**/api/router/session?*',route=>route.fulfill({json:{status:'ready',scope:'global-router-transcript',items,total:items.length,revision:'activity-polish',generation:1,live:{active:false,items:[]}}}));
 await page.goto('/#/chat/sample-plan');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await openRouter(page);
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
 await expect(tool.getByText(request.handoff,{exact:true})).toBeVisible();
 await expect(tool.getByText(task.objective,{exact:true})).toBeVisible();
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

test('task query and reopen show the current outcome before historical details', async ({page},info) => {
 const id='fixture-task-access';
 const title='核对版本详情的访问权限';
 const current='已修复并核对结果';
 const old='之前查验没有完成';
 const objective='部署本轮修复后核对版本';
 const requirement='只核对本轮改动，不扩大范围。';
 const lastDecision={action:'blocked',summary:old,contextRevision:3};
 const task={taskId:id,title,status:'completed',control:'active',objective,requirements:[requirement],lastDecision,completion:{summary:current},contextRevision:4};
 const query='resident_task_query', action='resident_task_action';
 const pair=(callId:string,toolName:string,input:object,output:object)=>['call','result'].map(kind=>({
  id:callId+'-'+kind,toolName,callId,role:'tool',kind:'tool-'+kind,status:kind==='result'?'completed':'result-unrecorded',
  source:{sessionId:'fixture-summary',entryId:callId+'-'+kind},text:JSON.stringify(kind==='call'?input:output),
 }));
 const items=[
  ...pair('query',query,{taskId:id,detail:'full'},{task}),
  ...pair('reopen',action,{kind:'reopen',taskId:id,handoff:'补充发布信息',objective},{result:{task:{...task,status:'active'}}}),
  ...pair('blocked',query,{detail:'summary'},{tasks:[{title:'核查定时事项',status:'blocked',lastDecision}],hasMore:true}),
  ...pair('empty',query,{detail:'index'},{tasks:[],total:0}),
  {id:'answer',role:'assistant',kind:'router-reply',text:'任务状态已核对。'},
 ];
 await page.route('**/api/router/session?*',route=>route.fulfill({json:{status:'ready',scope:'global-router-transcript',items,total:items.length,revision:'task-summary',generation:1,live:{active:false,items:[]}}}));
 await page.goto('/#/chat/sample-plan');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await openRouter(page);
 const record=page.locator('.execution-transcript');
 const fold=record.locator('.execution-turn-process').first();
 await fold.locator('summary').first().click();
 const row=(id:string)=>record.locator(`[data-message-id="${id}-call"]`);
 for (const id of ['query','reopen','blocked','empty']) await row(id).locator('.pi-web-tool-summary').click();
 const queried=row('query'), reopened=row('reopen');
 await expect(queried.getByText(title,{exact:true})).toBeVisible();
 await expect(queried.getByText('已完成',{exact:true})).toBeVisible();
 await expect(queried.getByText(current,{exact:true}).first()).toBeVisible();
 await expect(queried.getByText(old,{exact:true})).toBeHidden();
 await expect(queried.getByText(requirement,{exact:true})).toBeVisible();
 await expect(queried.getByText(objective,{exact:true})).toBeVisible();
 await expect(queried.getByText(id,{exact:true}).first()).toBeHidden();
 await expect(reopened.getByText('已安排',{exact:true})).toBeVisible();
 await expect(reopened.getByText(objective,{exact:true})).toBeVisible();
 await expect(reopened.getByText('补充发布信息',{exact:true})).toBeVisible();
 await expect(reopened.getByText(requirement,{exact:true})).toBeVisible();
 await expect(reopened.getByText(old,{exact:true})).toBeHidden();
 await expect(reopened.getByText(current,{exact:true})).toBeHidden();
 await expect(row('blocked').getByText(old,{exact:true}).first()).toBeVisible();
 await expect(row('blocked').getByText('还有更多任务',{exact:true})).toBeVisible();
 await expect(row('empty').getByText('未查到任务',{exact:true})).toBeVisible();
 for (const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
  await page.setViewportSize({width,height:900});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.pi-tool-body').analyze()).violations).toEqual([]);
  await queried.screenshot({path:info.outputPath(`task-query-${width}.png`)});
  await reopened.screenshot({path:info.outputPath(`task-action-${width}.png`)});
 }
 await queried.getByText('更多详情',{exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(queried.getByText(old,{exact:true})).toBeVisible();
 await expect(queried.getByText(requirement,{exact:true})).toBeVisible();
 await queried.getByText('查询参数',{exact:true}).click();
 await expect(queried.getByText(id,{exact:true}).first()).toBeVisible();
 await expect(queried.locator('.pi-web-tool-card')).toHaveAttribute('open','');
});
