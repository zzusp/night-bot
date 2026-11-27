import {openRouter} from './open-router';
import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('定时回报、原对话、统一 Router 和任务协作形成可回看的链路',async({page})=>{
  await page.route('**/api/schedules?*',route=>route.fulfill({json:{
    items:[
      {id:'quiet',title:'后台自检',state:'active',kind:'every',scheduledAt:'2026-11-27T08:00:00Z',scheduleSummary:'每2小时',delivery:{mode:'silent'}},
      {id:'reply',title:'进度回报',state:'active',kind:'at',scheduledAt:'2026-11-27T09:00:00Z',scheduleSummary:'单次',delivery:{mode:'origin',origin:{kind:'channel',id:'room-product',name:'研发会话'}}},
    ],offset:0,total:2,limit:20,nextOffset:null,
  }}));
  await page.route('**/api/router/session?*',route=>route.fulfill({json:{
    items:[{id:'check',role:'user',kind:'router-trigger',text:'定时自检'}],total:1,nextOffset:null,
    status:'ready',scope:'global-router-transcript',routingMode:'shared',sessionId:'router-global-v1',revision:'fixture',
  }}));
  await page.route('**/api/tasks/chain-task',route=>route.fulfill({json:{
    taskId:'chain-task',title:'协作验收',state:'completed',origin:{kind:'channel',id:'room-product',name:'研发会话'},work:{role:'verification',reportsFinal:true},
  }}));
  await page.route('**/api/tasks/chain-task/session?*',route=>route.fulfill({json:{
    items:[{id:'work-peer',role:'user',kind:'peer-handoff',workRole:'development',text:'修订已就绪，请验证。'}],
    total:1,nextOffset:null,status:'ready',scope:'current-session-context',sessionId:'task-peer-session',revision:'fixture',
  }}));
  await page.route('**/api/tasks/standalone-task',route=>route.fulfill({json:{
    taskId:'standalone-task',title:'独立核查',state:'completed',origin:null,
  }}));
  await page.goto('/#/schedules');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  const silent=page.getByRole('row').filter({hasText:'后台自检'});
  await expect(silent.getByText('不发送消息')).toBeVisible();
  await expect(silent.getByRole('link')).toHaveCount(0);
  await page.getByRole('row').filter({hasText:'进度回报'}).getByRole('link',{name:'研发会话'}).click();
  await expect(page).toHaveURL(/channels\/room-product$/);
  await openRouter(page);
  await expect(page.locator('.router-conversation-scope')).toHaveCount(0);
  await expect(page.getByText('定时自检',{exact:true})).toBeVisible();
  await page.goto('/#/tasks/chain-task');
  await expect(page.getByText('验证 · 汇报最终结果')).toBeVisible();
  await expect(page.getByText('协作消息 · 开发')).toBeVisible();
  await expect(page.getByText('修订已就绪，请验证。')).toBeVisible();
  await expect(page.locator('.task-facts')).not.toContainText('来源对话');
  await page.goto('/#/tasks/standalone-task');
  await expect(page.getByText('未关联渠道')).toHaveCount(0);
});
