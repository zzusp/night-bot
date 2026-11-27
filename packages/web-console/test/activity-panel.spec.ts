import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
import AxeBuilder from '@axe-core/playwright';

const tasks = [
  {taskId:'sidebar-running',title:'修复分类失败与模型响应链路',state:'running',updatedAt:'2026-11-14T05:00:00Z'},
  {taskId:'sidebar-interrupted',title:'整理发布结果时执行中断',state:'interrupted',updatedAt:'2026-11-14T04:20:00Z'},
];
const pageOf = (items: typeof tasks) => ({items,total:items.length,nextOffset:null});
const overview = {scope:{conversationId:'sample-plan-scope',chatId:'sample-plan'},tasks:pageOf(tasks),running:pageOf(tasks.slice(0,1)),interrupted:pageOf(tasks.slice(1)),channels:[],conversations:[]};

const timingMetric = (durationMs: number | null) => ({status:durationMs === null ? 'missing' : 'recorded',durationMs,shared:false});
const timingPage = {status:'ready',items:[
  [4200,14800],[5100,19200],[3600,12200],[6800,null],[4100,16400],[8400,23100],[5900,17800],[4700,13900],
].map(([triage,router],index)=>({receivedAt:`2026-11-14T05:${String(40-index*4).padStart(2,'0')}:00Z`,triage:timingMetric(triage),router:timingMetric(router)}))};
test.beforeEach(async({page})=>{await page.route('**/stage-times?limit=8*',route=>route.fulfill({json:timingPage}));});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/router?conversation=chat%3Asample-plan'); await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await expect(page.getByRole('region',{name:'路由记录'})).toBeVisible();
}

test('activity rail keeps the running list without count or interrupted cards', async ({page}, testInfo)=>{
  await page.route('**/api/overview', route=>route.fulfill({json:overview}));
  await login(page);
  const rail=page.getByRole('complementary',{name:'任务动态'});
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('region',{name:'正在执行'})).toContainText(tasks[0].title);
  await expect(rail.getByRole('region',{name:'中断的任务'})).toHaveCount(0);
  await expect(rail.locator('.activity-counts, .count-dot')).toHaveCount(0);
  await expect(rail).not.toContainText(tasks[1].title);
  await expect(rail.getByRole('link',{name:'全部任务',exact:true})).toHaveCount(0);
  await expect(rail.getByRole('region',{name:'上下文窗口',exact:true})).toBeVisible();
  await expect(rail.getByRole('region',{name:'路由耗时',exact:true})).toHaveCount(0);
  await expect(rail.locator('a[href="#/tasks?state=interrupted"]')).toHaveCount(0);
  await expect(rail).not.toContainText('已配置渠道');
  await expect(rail.getByRole('link',{name:'查看正在执行任务'})).toHaveCount(0);
  await expect(rail.locator('.rail-task').first()).toHaveAttribute('href','#/tasks/sidebar-running');
  await page.keyboard.press('Tab');
  await rail.locator('.rail-task').first().focus();
  await expect(rail.locator('.rail-task').first()).toBeFocused();
  await expect(rail.locator('.rail-task').first()).toHaveCSS('outline-style','solid');
  const boxes=await page.evaluate(()=>({rail:document.querySelector('.activity-rail')!.getBoundingClientRect().toJSON(),main:document.querySelector('.router-records')!.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}));
  expect(boxes.rail.left).toBeGreaterThanOrEqual(boxes.main.right); expect(boxes.overflow).toBe(false);
  await page.getByRole('button',{name:'隐藏工作动态'}).click();
  await page.getByRole('button',{name:'显示工作动态'}).click();
  await expect(page.getByRole('region',{name:'路由记录'})).toBeVisible();
  expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('activity-simplified-light.png'),fullPage:true});
  await page.getByRole('button',{name:'切换深色外观'}).click();
  expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('activity-simplified-dark.png'),fullPage:true});
});

test('empty and unavailable states remain distinct',async({page})=>{
  await page.route('**/api/overview',route=>route.fulfill({json:{...overview,running:null,interrupted:pageOf([]),sectionErrors:{running:'UNAVAILABLE'}}}));
  await login(page);const rail=page.locator('#activity-panel');
  await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('—');
  await expect(rail.getByRole('region',{name:'中断的任务'})).toHaveCount(0);
  await expect(page.getByRole('alert',{name:'读取状态汇总'})).toBeVisible();
  await expect(rail.getByRole('region',{name:'最近任务'})).toHaveCount(0);
});

test('narrow panel toggles below the Router transcript',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/overview',route=>route.fulfill({json:overview}));
  await login(page); await expect(page.locator('#activity-panel')).toHaveCount(0);
  await page.getByRole('button',{name:'显示工作动态'}).click();
  await expect(page.locator('#activity-panel')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#activity-panel .activity-counts')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'中断的任务'})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('activity-simplified-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'隐藏工作动态'}).click();
  await expect(page.getByRole('region',{name:'路由记录'})).toBeVisible();
});

for (const scenario of [
  {name:'confirmed idle',running:pageOf([]),interrupted:pageOf([]),showRecent:true},
  {name:'interrupted unavailable',running:pageOf([]),interrupted:null,sectionErrors:{interrupted:'UNAVAILABLE'},showRecent:false},
  {name:'interrupted tasks remain',running:pageOf([]),interrupted:pageOf(tasks.slice(1)),showRecent:false},
  {name:'nonempty total with empty page',running:{...pageOf([]),total:1},interrupted:pageOf([]),showRecent:false},
  {name:'running section error',running:pageOf([]),interrupted:pageOf([]),sectionErrors:{running:'UNAVAILABLE'},showRecent:false},
]) {
  test(`recent tasks require confirmed idle: ${scenario.name}`,async({page})=>{
    await page.route('**/api/overview',route=>route.fulfill({json:{...overview,...scenario}}));
    await login(page);
    const rail = page.locator('#activity-panel');
    await expect(rail.getByRole('region',{name:'最近任务'})).toHaveCount(scenario.showRecent ? 1 : 0);
    await expect(rail.locator('.activity-counts')).toHaveCount(0);
    await expect(rail.getByRole('region',{name:'中断的任务'})).toHaveCount(0);
    if (scenario.name === 'nonempty total with empty page') {
      await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('—');
      await expect(rail.getByRole('region',{name:'正在执行'})).not.toContainText('暂无执行中的任务');
    }
    if (scenario.name === 'running section error') {
      await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('—');
    }
    if (scenario.name === 'interrupted unavailable') {
      await expect(rail.getByRole('region',{name:'正在执行'})).toContainText('暂无执行中的任务');
      await expect(page.getByRole('alert',{name:'读取状态汇总'})).toHaveCount(0);
    }
  });
}

for (const idle of [false,true]) {
  test(`recent section errors only surface when its list is displayed: ${idle}`,async({page})=>{
    await page.route('**/api/overview',route=>route.fulfill({json:{...overview,running:pageOf(idle ? [] : tasks.slice(0,1)),interrupted:pageOf([]),tasks:null,sectionErrors:{tasks:'UNAVAILABLE'}}}));
    await login(page);
    await expect(page.getByRole('alert',{name:'读取状态汇总'})).toHaveCount(idle ? 1 : 0);
    await expect(page.getByRole('region',{name:'最近任务'})).toHaveCount(idle ? 1 : 0);
    if(idle) await expect(page.getByRole('region',{name:'最近任务'})).toContainText('—');
  });
}
