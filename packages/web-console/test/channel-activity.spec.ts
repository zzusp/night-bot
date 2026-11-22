import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {startPreview} from './preview.mjs';
let fixture:Awaited<ReturnType<typeof startPreview>>;
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true,configureTasks:(tasks:any[])=>{
 const sample=tasks[0],row=(id:string,title:string,groupId:string|undefined,state:string)=>({...sample,taskId:id,title,groupId,state,controlState:state==='completed'?'completed':'active',session:{...sample.session,sessionId:'fixture-pi-'+id,status:state}});
 tasks.splice(0,tasks.length,row('global-only','合成 · 独立全局任务',undefined,'running'),...Array.from({length:12},(_,i)=>row('b-'+i,'合成 · B 渠道任务 '+i,'room-notes',i%2?'interrupted':'running')),row('a-running','合成 · A 渠道执行中','room-product','running'),row('a-interrupted','合成 · A 渠道执行中断','room-product','interrupted'),row('a-completed','合成 · A 渠道已完成','room-product','completed'));
}})});
test.afterAll(async()=>{await fixture.close()});
async function login(page:Page){await page.goto(fixture.origin+'/#/channels/room-product');await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();}
async function channel(page:Page,id:string){await page.evaluate(id=>{location.hash='/channels/'+id},id)}
for(const width of [1440,390])test(`channel task rail uses its own scope on both tabs and hides global collection links ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1044});await login(page);if(width<900)await page.getByRole('button',{name:'显示活动面板',exact:true}).click();
 const rail=page.getByRole('complementary',{name:'任务动态'});
 await expect(rail).toContainText('合成 · A 渠道执行中');await expect(rail).toContainText('合成 · A 渠道执行中断');await expect(rail).not.toContainText('B 渠道');await expect(rail).not.toContainText('独立全局');
 await expect(rail.locator('.activity-counts strong')).toHaveText(['1','1']);await expect(rail.getByRole('link',{name:'全部任务',exact:true})).toHaveCount(0);await expect(rail.locator('.rail-section-title > a, .activity-counts > a')).toHaveCount(0);
 await page.getByRole('tab',{name:'路由',exact:true}).click();await expect(rail).toContainText('合成 · A 渠道执行中');await expect(rail.locator('.activity-counts strong')).toHaveText(['1','1']);
 await expect(rail.getByRole('region',{name:'上下文窗口',exact:true})).toBeVisible();await expect(rail.getByRole('region',{name:'路由耗时',exact:true})).toBeVisible();
 expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===1440)await page.screenshot({path:testInfo.outputPath('channel-activity-synthetic.png'),fullPage:true});
 await channel(page,'room-notes');await expect(rail.locator('.activity-counts strong')).toHaveText(['6','6']);await expect(rail).not.toContainText('A 渠道');await expect(rail).not.toContainText('独立全局');
 await channel(page,'room-empty');await expect(rail.locator('.activity-counts strong')).toHaveText(['0','0']);await expect(rail).toContainText('暂无执行中的任务');await expect(rail).toContainText('暂无中断的任务');
 await page.evaluate(()=>{location.hash='/tasks'});await expect(page.getByText('合成 · 独立全局任务',{exact:true})).toBeVisible();await expect(page.getByText('合成 · B 渠道任务 0',{exact:true})).toBeVisible();
});
test('late channel A response cannot overwrite B; failure and wrong-scope data never fall back globally',async({page})=>{
 let release!:()=>void,entered!:()=>void,finished!:()=>void;const completed=new Promise<void>(r=>finished=r);const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 await page.route('**/api/conversations/room-product/activity',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response}).catch(()=>{});finished()});
 await login(page);await started;await expect(page.getByRole('region',{name:'上下文窗口',exact:true})).toBeVisible();await channel(page,'room-notes');const rail=page.locator('#activity-panel');await expect(rail.locator('.activity-counts strong')).toHaveText(['6','6']);release();await completed;
 await expect(rail).not.toContainText('A 渠道');await expect(rail.locator('.activity-counts strong')).toHaveText(['6','6']);
 await page.route('**/api/conversations/room-empty/activity',route=>route.fulfill({status:503,json:{error:'UNAVAILABLE'}}));await channel(page,'room-empty');await expect(rail.locator('.activity-counts strong')).toHaveText(['—','—']);await expect(rail).not.toContainText('B 渠道');await expect(rail).not.toContainText('独立全局');
 await page.route('**/api/conversations/custom-direct/activity',route=>route.fulfill({json:{scope:{conversationId:'room-notes'},running:{items:[],total:99},interrupted:{items:[],total:99}}}));await channel(page,'custom-direct');await expect(rail.locator('.activity-counts strong')).toHaveText(['—','—']);await expect(rail).not.toContainText('99');
});
