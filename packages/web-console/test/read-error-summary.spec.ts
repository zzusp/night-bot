import {selectOption} from './select-control';
import {test,expect,type Page} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
const renderErrors=new WeakMap<Page,string[]>();
test.beforeEach(({page})=>{const errors:string[]=[];renderErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.name));page.on('console',m=>{if(m.type()==='error'&&/Maximum update|while rendering a different/.test(m.text()))errors.push('render-loop')})});
test.afterEach(({page})=>{expect(renderErrors.get(page)).toEqual([])});
const fail=(route:any)=>route.fulfill({status:503,json:{error:'FIXTURE_UNAVAILABLE'}});
async function login(page:Page,path:string){await page.goto('/#'+path);await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();}
const summary=(page:Page)=>page.getByRole('alert',{name:'读取状态汇总'});
for(const width of [1440,390])test(`task shared owners first read stale recovery ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.route('**/api/tasks/task-research/session?*',fail);
 await login(page,'/tasks/task-research');
 await expect(summary(page)).toHaveCount(1);await expect(summary(page)).toContainText('执行记录加载失败');
 await expect(page.locator('.task-token-card [role=alert]')).toHaveCount(0);
 await expect(page.locator('.execution-error-state')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath(`task-first-${width}.png`)});
 await page.unroute('**/api/tasks/task-research/session?*');await summary(page).getByRole('button',{name:'重试'}).click();
 await expect(summary(page)).toHaveCount(0);await expect(page.locator('.task-dialogue .message').first()).toBeVisible();
 await page.route('**/api/tasks/task-research',fail);await page.route('**/api/tasks/task-research/session?*',fail);await page.route('**/api/tasks/task-research/learning',fail);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(summary(page)).toHaveAttribute('data-affected-count','3');await expect(page.getByRole('alert')).toHaveCount(1);
 await expect(page.locator('.task-token-card [role=alert]')).toHaveCount(0);await expect(page.locator('.task-dialogue .message').first()).toBeVisible();
 await page.locator('.workspace-topbar').getByRole('button',{name:'切换深色外观'}).click();
 await page.screenshot({path:test.info().outputPath(`task-stale-dark-${width}.png`)});
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({status:403,json:{error:'ACCESS_DENIED'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.task-dialogue .message')).toHaveCount(0);await expect(summary(page)).toContainText('没有访问权限');
 await page.route('**/api/schedules?*',r=>r.fulfill({json:{items:[],total:0,offset:0,limit:20,nextOffset:null}}));await page.goto('/#/schedules');await expect(summary(page)).toHaveCount(0);
});
for(const width of [1440,390])test(`channels concurrent reads one summary ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.route('**/api/channels',fail);await page.route('**/api/conversations',fail);await login(page,'/channels');
 await expect(summary(page)).toHaveAttribute('data-affected-count','2');await expect(page.getByRole('alert')).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'渠道配置暂不可读'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'等待第一条消息'})).toHaveCount(0);await expect(page.locator('.section-heading h2')).toContainText('—');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath(`channels-first-${width}.png`)});
 await page.unroute('**/api/channels');await page.unroute('**/api/conversations');await summary(page).getByRole('button',{name:'重试'}).click();await expect(summary(page)).toHaveCount(0);
});
test('chat and activity independent endpoints remain separate in one region',async({page})=>{
 await page.route('**/api/chat/sample-plan',fail);await page.route('**/api/overview',fail);await page.route('**/api/chat/sample-plan/stage-times?*',fail);await login(page,'/chat/sample-plan');
 await expect(summary(page)).toHaveAttribute('data-affected-count','3');await expect(page.getByRole('alert')).toHaveCount(1);await expect(page.locator('.activity-rail [role=alert]')).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('chat-concurrent.png')});
 await page.route('**/api/schedules?*',r=>r.fulfill({json:{items:[],total:0,offset:0,limit:20,nextOffset:null}}));await page.goto('/#/schedules');await expect(summary(page)).toHaveCount(0);
});
test('hidden settings read errors yield ownership; draft and operation error survive read recovery',async({page})=>{
 await login(page,'/settings');await selectOption(page.getByLabel('模型路由',{exact:true}),'fixture-model');
 await page.getByLabel('API 地址',{exact:true}).fill('https://draft.example.invalid/v1');
 await page.route('**/api/settings/model-catalog',fail);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(summary(page)).toHaveCount(1);
 await page.getByRole('tab',{name:'助手外观',exact:true}).click();await expect(summary(page)).toHaveCount(0);
 await page.route('**/api/settings/appearance',r=>r.abort());await page.getByLabel('显示名称',{exact:true}).fill('保留模拟草稿');await page.getByRole('button',{name:'保存外观',exact:true}).click();
 await expect(page.getByRole('tabpanel').getByRole('alert')).toContainText('无法确认操作结果');
 await page.getByRole('tab',{name:'模型与 API',exact:true}).click();await expect(summary(page)).toHaveCount(1);
 await page.unroute('**/api/settings/model-catalog');await summary(page).getByRole('button',{name:'重试'}).click();await expect(summary(page)).toHaveCount(0);
 await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://draft.example.invalid/v1');
 await page.getByRole('tab',{name:'助手外观',exact:true}).click();await expect(page.getByLabel('显示名称',{exact:true})).toHaveValue('保留模拟草稿');await expect(page.getByRole('tabpanel').getByRole('alert')).toContainText('无法确认操作结果');
 await page.screenshot({path:test.info().outputPath('settings-operation-preserved.png')});
});
test('permission dialog has its own read-recovery region',async({page})=>{
 await login(page,'/channels');await page.route('**/api/permissions',fail);await page.getByRole('button',{name:'权限与审批',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'权限与审批',exact:true});await expect(dialog.getByRole('alert',{name:'读取状态汇总'})).toHaveCount(1);
 await expect(page.locator('main [role=alert]')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('permission-dialog.png')});
 await dialog.getByRole('button',{name:'关闭权限与审批'}).click();await expect(summary(page)).toHaveCount(0);
});
test('evolution and feedback first-read errors do not become fake empty or start a write',async({page})=>{
 await page.route('**/api/evolution?*',fail);await login(page,'/evolution');await expect(summary(page)).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'自进化记录暂不可读'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'暂无自进化记录'})).toHaveCount(0);
 const writes:string[]=[];await page.route('**/api/feedback**',r=>{if(r.request().method()!=='GET')writes.push(r.request().method());return fail(r)});
 await page.goto('/#/feedback');await expect(summary(page)).toHaveCount(1);await expect(summary(page)).toHaveAttribute('data-affected-count','1');expect(writes).toEqual([]);
 await expect(page.getByRole('button',{name:'生成预览',exact:true})).toBeDisabled();
 await page.screenshot({path:test.info().outputPath('feedback-read-failure.png')});
});
test('revoked model snapshot stays absent through failed retry until new authorized read',async({page})=>{
 await login(page,'/settings');await selectOption(page.getByLabel('模型路由',{exact:true}),'fixture-model');
 await expect(page.getByLabel('API 地址',{exact:true})).toBeVisible();
 await page.route('**/api/settings/model-catalog',r=>r.fulfill({status:403,json:{error:'ACCESS_DENIED'}}));await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(summary(page)).toContainText('没有访问权限');await expect(page.getByLabel('API 地址',{exact:true})).toHaveCount(0);
 await page.route('**/api/settings/model-catalog',fail);await summary(page).getByRole('button',{name:'重试'}).click();
 await expect(summary(page)).toBeVisible();await expect(page.getByLabel('API 地址',{exact:true})).toHaveCount(0);
 await page.unroute('**/api/settings/model-catalog');await summary(page).getByRole('button',{name:'重试'}).click();
 await expect(summary(page)).toHaveCount(0);await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();
});

for(const width of [1440,390])test(`schedule read error, stale data and revoked snapshot recover ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});
 let mode:'unavailable'|'ready'|'forbidden'='unavailable';
 await page.route('**/api/schedules?*',route=>mode==='ready'?route.fulfill({json:{items:[{id:'read-recovery',title:'定时读取恢复样例',state:'active',kind:'every',scheduleSummary:'每10分钟',scheduledAt:'2032-11-12T08:00:00.000Z'}],total:1,offset:0,limit:20,nextOffset:null}}):route.fulfill({status:mode==='forbidden'?403:503,json:{error:mode==='forbidden'?'RESOURCE_FORBIDDEN':'SCHEDULES_UNAVAILABLE'}}));
 await login(page,'/schedules');
 await expect(summary(page)).toHaveCount(1);
 await expect(page.locator('.schedule-row')).toHaveCount(0);
 await expect(page.getByText('暂无启用的定时任务',{exact:true})).toHaveCount(0);
 mode='ready';await summary(page).getByRole('button',{name:'重试',exact:true}).click();
 await expect(summary(page)).toHaveCount(0);await expect(page.locator('.schedule-row')).toContainText('定时读取恢复样例');
 mode='unavailable';await page.getByRole('button',{name:'刷新任务',exact:true}).click();
 await expect(summary(page)).toHaveCount(1);await expect(page.locator('.schedule-row')).toHaveCount(1);
 await expect(summary(page).getByRole('heading')).toHaveText('部分内容未更新');
 mode='forbidden';await summary(page).getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.locator('.schedule-row')).toHaveCount(0);await expect(summary(page)).toContainText('没有访问权限');
 mode='unavailable';await summary(page).getByRole('button',{name:'重试',exact:true}).click();
 await expect(summary(page)).not.toContainText('没有访问权限');await expect(page.locator('.schedule-row')).toHaveCount(0);
 mode='ready';await summary(page).getByRole('button',{name:'重试',exact:true}).click();
 await expect(summary(page)).toHaveCount(0);await expect(page.locator('.schedule-row')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
