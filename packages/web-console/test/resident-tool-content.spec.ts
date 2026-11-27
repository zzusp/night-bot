import {openRouter} from './open-router';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

test('Router plan reads once with real dependencies, and failures or changed receipt stay distinct', async ({page},info) => {
  const message=(id:string,toolName:string,phase:'call'|'result',text:unknown,extra={})=>({
    id:id+'-'+phase, toolName, callId:id, role:'tool', kind:'tool-'+phase, text:typeof text==='string'?text:JSON.stringify(text),
    status:phase==='result'?'completed':'result-unrecorded', source:{sessionId:'resident-fixture',entryId:id+'-'+phase}, ...extra,
  });
  const first={taskId:'fixture-first',title:'核对发布清单',objective:'确认实际部署版本和校验项。',requirements:['保留现有探针','核对回滚条件'],handoff:'核对通过后才发出下一步通知。'};
  const second={taskId:'fixture-second',title:'整理发布记录',objective:'登记经确认的发布结论。',requirements:['只写核实过的结果']};
  const dependency={condition:'清单全部核验通过',taskId:'fixture-second',prerequisiteTaskId:'fixture-first',taskTitle:second.title,prerequisiteTitle:first.title};
  const input={tasks:[first,second],dependencies:[dependency]};
  const {handoff:_,...receiptFirst}=first;
  const planReceipt={result:{tasks:[{...receiptFirst,status:'active',control:'active'},{...second,status:'blocked',control:'active'}],dependencies:[{...dependency,state:'pending'}]}};
  const single={tasks:[second],dependencies:[]};
  const rows=[
    {id:'thought',role:'assistant',kind:'thinking',text:'已公开的核对过程。',timing:{modelWaitMs:12100,durationMs:1200}},
    message('plan','resident_task_plan','call',input,{timing:{modelWaitMs:4700}}),
    message('plan','resident_task_plan','result',planReceipt,{timing:{durationMs:2100}}),
    message('failed','resident_task_plan','call',single),
    message('failed','resident_task_plan','result','条件无效，请核对依赖。',{status:'error',isError:true}),
    message('different','resident_task_plan','call',single),
    message('different','resident_task_plan','result',{result:{tasks:[{...second,objective:'仅登记通过的步骤。',status:'active'}],dependencies:[]}}),
    message('settle','resident_router_settle','call',{requestedEventCount:2}),
    message('settle','resident_router_settle','result',{settled:true,requestedEventCount:2,dispositions:{'handled-inline':1,'context-only':1}}),
    message('memory','resident_memory_review','call',{operation:'review',scope:'topic'}),
    message('memory','resident_memory_review','result',{operation:'review',scope:'topic',ok:true,recordCount:3}),
    message('mutation','resident_skill_mutate','call',{operation:'upsert',expectedRevision:4}),
    message('mutation','resident_skill_mutate','result',{operation:'upsert',ok:true,persisted:true,revision:5}),
    message('bounded','resident_memory_review','call',{operation:'review',scope:'topic'}),
    message('bounded','resident_memory_review','result',{operation:'review',scope:'topic',ok:true}, {truncated:true,textNextOffset:25}),
  ];
  await page.route('**/api/chat/sample-plan/session?*',route=>route.fulfill({json:{status:'ready',scope:'current-router-session-context',items:rows,total:rows.length,revision:'resident-fixture',generation:1,live:{active:false,items:[]}}}));
  await page.goto('/#/chat/sample-plan');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await openRouter(page);
  const record=page.locator('.execution-transcript');
  await expect(record).toBeVisible();
  const find=(id:string)=>record.locator('[data-message-id="'+id+'-call"]');
  const plan=find('plan');
  await expect(plan.locator('summary')).toContainText('安排任务');
  await expect(plan.locator('summary .pi-web-tool-duration')).toHaveText('2.1s');
  await expect(plan.locator('details')).not.toHaveAttribute('open');
  await expect(record.locator('.execution-thought summary .execution-timing-meta')).toHaveText('用时 1.2s');
  await expect(record).not.toContainText(/首段|12[.]1s|4[.]7s/);
  await plan.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(plan.locator('.resident-plan')).toHaveCount(1);
  await expect(plan.locator('.resident-plan-heading')).toContainText('安排结果');
  await expect(plan.locator('.resident-plan-task-heading')).toHaveText(['核对发布清单已安排','整理发布记录受阻']);
  await expect(plan.locator('.resident-plan-dependencies')).toContainText('核对发布清单 → 整理发布记录');
  await expect(plan).toContainText('清单全部核验通过');
  await expect(plan).toContainText(first.handoff);
  await expect(plan.locator('pre')).toHaveCount(0);
  await expect(plan).not.toContainText('fixture-first');
  for (const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:940});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const violations=(await new AxeBuilder({page}).include('.resident-plan').analyze()).violations;
    expect(violations).toEqual([]);
    await plan.locator('summary').evaluate(el=>(el as HTMLElement).blur());
    await plan.screenshot({path:info.outputPath(`resident-plan-open-${width}.png`)});
    await plan.locator('summary').click();
    await expect(plan.locator('details')).not.toHaveAttribute('open');
    await plan.screenshot({path:info.outputPath(`resident-plan-folded-${width}.png`)});
    await plan.locator('summary').click();
  }
  const failed=find('failed'), changed=find('different');
  await failed.locator('summary').click();
  await expect(failed).toContainText('条件无效，请核对依赖。');
  await expect(failed.locator('.resident-plan-heading')).toContainText('提交的安排');
  await expect(failed.locator('.resident-plan-dependencies')).toHaveCount(0);
  await changed.locator('summary').click();
  await expect(changed.locator('.resident-plan-heading')).toHaveText(['提交的安排1 项任务','安排结果1 项任务']);
  for(const [id,fields] of [['settle',['已结清','已直接处理','仅作背景']],['memory',['核对','主题','记录数']]] as const){
    const card=find(id);
    await card.locator('summary').click();
    for(const field of fields) await expect(card).toContainText(field);
    await expect(card.locator('pre')).toHaveCount(0);
    await expect(card.getByText(id === 'settle' ? '提交 2 项事件' : '操作',{exact:true})).toHaveCount(1);
    await card.screenshot({path:info.outputPath(`resident-${id}-mobile.png`)});
  }
  const mutation=find('mutation'), bounded=find('bounded');
  await mutation.locator('summary').click();
  await expect(mutation.getByText('操作',{exact:true})).toHaveCount(1);
  await expect(mutation.getByText('预期版本',{exact:true})).toHaveCount(1);
  await expect(mutation.getByText('版本',{exact:true})).toHaveCount(1);
  await bounded.locator('summary').click();
  await expect(bounded.getByText('操作',{exact:true})).toHaveCount(1);
  await expect(bounded.locator('pre').first()).toContainText('"operation":"review"');
});
