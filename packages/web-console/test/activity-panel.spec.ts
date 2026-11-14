import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
import AxeBuilder from '@axe-core/playwright';

const tasks = [
  {taskId:'sidebar-running',title:'修复分类失败与模型响应链路',state:'running',updatedAt:'2026-11-14T05:00:00Z'},
  {taskId:'sidebar-waiting',title:'整理生产发布结果，等待下一轮执行',state:'waiting',updatedAt:'2026-11-14T04:20:00Z'},
];
const pageOf = (items: typeof tasks) => ({items,total:items.length,nextOffset:null});
const overview = {tasks:pageOf(tasks),running:pageOf(tasks.slice(0,1)),waiting:pageOf(tasks.slice(1)),channels:[],conversations:[]};

const timingMetric = (durationMs: number | null) => ({status:durationMs === null ? 'missing' : 'recorded',durationMs,shared:false});
const timingPage = {status:'ready',items:[
  [4200,14800],[5100,19200],[3600,12200],[6800,null],[4100,16400],[8400,23100],[5900,17800],[4700,13900],
].map(([triage,router],index)=>({receivedAt:`2026-11-14T05:${String(40-index*4).padStart(2,'0')}:00Z`,triage:timingMetric(triage),router:timingMetric(router)}))};
test.beforeEach(async({page})=>{await page.route('**/stage-times?limit=8',route=>route.fulfill({json:timingPage}));});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/chat'); await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await expect(page.getByLabel('消息内容',{exact:true})).toBeVisible();
}

test('activity rail prioritizes real active/waiting pages and stays a separate reading column', async ({page})=>{
  await page.route('**/api/overview', route=>route.fulfill({json:overview}));
  await login(page);
  const rail=page.getByRole('complementary',{name:'任务动态'});
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('region',{name:'正在执行'})).toContainText(tasks[0].title);
  await expect(rail.getByRole('region',{name:'等待继续'})).toContainText(tasks[1].title);
  await expect(rail).not.toContainText('已配置渠道');
  await expect(rail.getByRole('link',{name:'查看正在执行任务'})).toHaveAttribute('href','#/tasks?state=running');
  await expect(rail.locator('.rail-task').first()).toHaveAttribute('href','#/tasks/sidebar-running');
  const boxes=await page.evaluate(()=>({rail:document.querySelector('.activity-rail')!.getBoundingClientRect().toJSON(),main:document.querySelector('.chat-panel')!.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}));
  expect(boxes.rail.left).toBeGreaterThanOrEqual(boxes.main.right); expect(boxes.overflow).toBe(false);
  await page.getByLabel('消息内容',{exact:true}).fill('保留草稿');
  await page.getByRole('button',{name:'隐藏活动面板'}).click();
  await page.getByRole('button',{name:'显示活动面板'}).click();
  await expect(page.getByLabel('消息内容',{exact:true})).toHaveValue('保留草稿');
  expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'切换深色外观'}).click();
  expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
});

test('empty and unavailable states remain distinct',async({page})=>{
  await page.route('**/api/overview',route=>route.fulfill({json:{...overview,running:null,waiting:pageOf([]),sectionErrors:{running:'UNAVAILABLE'}}}));
  await login(page);const rail=page.locator('#activity-panel');
  await expect(rail.locator('.activity-counts a').first()).toContainText('—');
  await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('暂时无法读取');
  await expect(rail.getByRole('region',{name:'等待继续'})).toContainText('暂无等待中的任务');
  await expect(rail.getByRole('region',{name:'最近任务'})).toHaveCount(0);
});

test('narrow panel toggles below content without resetting the composer',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/overview',route=>route.fulfill({json:overview}));
  await login(page); await expect(page.locator('#activity-panel')).toHaveCount(0);
  await page.getByRole('button',{name:'显示活动面板'}).click();
  await expect(page.locator('#activity-panel')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'隐藏活动面板'}).click();
  await expect(page.getByLabel('消息内容',{exact:true})).toBeVisible();
});

for (const scenario of [
  {name:'confirmed idle',running:pageOf([]),waiting:pageOf([]),showRecent:true},
  {name:'waiting unavailable',running:pageOf([]),waiting:null,showRecent:false},
  {name:'nonempty total with empty page',running:{...pageOf([]),total:1},waiting:pageOf([]),showRecent:false},
  {name:'running section error',running:pageOf([]),waiting:pageOf([]),sectionErrors:{running:'UNAVAILABLE'},showRecent:false},
]) {
  test(`recent tasks require confirmed idle: ${scenario.name}`,async({page})=>{
    await page.route('**/api/overview',route=>route.fulfill({json:{...overview,...scenario}}));
    await login(page);
    const rail = page.locator('#activity-panel');
    await expect(rail.getByRole('region',{name:'最近任务'})).toHaveCount(scenario.showRecent ? 1 : 0);
    if (scenario.name === 'nonempty total with empty page') {
      await expect(rail.locator('.activity-counts a').first()).toContainText('1');
      await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('暂时无法读取');
      await expect(rail.getByRole('region',{name:'正在执行'})).not.toContainText('暂无执行中的任务');
    }
    if (scenario.name === 'running section error') {
      await expect(rail.locator('.activity-counts a').first()).toContainText('—');
      await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('暂时无法读取');
    }
    if (scenario.name === 'waiting unavailable') {
      await expect(rail.locator('.activity-counts a').last()).toContainText('—');
    }
  });
}

test('recent stage charts preserve gaps and expose equivalent point labels',async({page})=>{
  await page.route('**/api/overview',route=>route.fulfill({json:overview}));
  await login(page);
  const card=page.getByRole('region',{name:'最近处理耗时'});
  await expect(card).toContainText('本会话 · 8 条消息');
  await expect(card.locator('.stage-plot-triage .stage-point')).toHaveCount(8);
  await expect(card.locator('.stage-plot-router .stage-point')).toHaveCount(7);
  await expect(card.locator('.stage-plot-router .stage-missing')).toHaveCount(1);
  await expect(card.locator('.stage-plot-router .stage-line')).toHaveCount(2);
  await expect(card.locator('.stage-plot-triage .stage-plot-heading')).toContainText('4 秒');
  await card.locator('.stage-plot-triage svg g').first().focus();
  await expect(card.locator('.stage-plot-triage .stage-plot-foot')).not.toContainText('最新一条');
  expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
});

test('stage chart unavailable data never becomes a zero plot',async({page})=>{
  await page.route('**/stage-times?limit=8',route=>route.fulfill({json:{status:'unavailable',items:[]}}));
  await login(page);
  await expect(page.getByRole('region',{name:'最近处理耗时'})).toContainText('来源暂不可读');
  await expect(page.locator('.stage-point')).toHaveCount(0);
});
