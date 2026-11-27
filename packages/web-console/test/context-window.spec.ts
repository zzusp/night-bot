import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
const synthetic={status:'ready',basis:'pi-context-estimate',tokens:387040,contextWindow:472000,categories:[{key:'messages',tokens:250000},{key:'skills',tokens:10000},{key:'memory',tokens:20000},{key:'systemTools',tokens:30000},{key:'system',tokens:30000},{key:'tools',tokens:40000},{key:'unclassified',tokens:7040}]};
const timings={status:'ready',items:[13900,17800,23100,16400,19200,12200,14800,16100].map((durationMs,i)=>({receivedAt:`2026-11-20T01:${String(40-i*4).padStart(2,'0')}:00Z`,router:{status:'recorded',durationMs,shared:false}}))};
async function login(page:import('@playwright/test').Page){await page.goto('/#/router?conversation=conversations%3Aroom-product');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByRole('region',{name:'路由记录'})).toBeVisible();await page.evaluate(()=>{const marker=document.createElement('div');marker.textContent='合成测试数据 · 非真实运行记录';marker.style.cssText='position:fixed;bottom:8px;left:300px;z-index:9999;font-size:10px;color:#555;background:#fff;padding:4px;pointer-events:none';document.body.append(marker);});}
for(const width of [1440,390])test(`context composition card, theme and layout ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.route('**/stage-times?limit=8*',r=>r.fulfill({json:{...timings,contextWindow:synthetic}}));await login(page);
 if(width<900)await page.getByRole('button',{name:'显示工作动态',exact:true}).click();
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});
 await expect(card).toContainText('387k / 472k (82%)');await expect(card).not.toContainText('演示');await expect(card.locator('.context-window-bar>i')).toHaveCount(7);await expect(card.locator('.context-window-legend')).toBeVisible();await expect(card.locator('.context-window-bar')).toBeVisible();
 await expect(card.getByRole('button')).toHaveCount(0);await expect(card.locator('[aria-expanded]')).toHaveCount(0);
 await expect(card.locator('.context-window-row > span:first-of-type')).toHaveText(['消息与摘要','Skills','记忆','系统工具定义','系统提示','其他工具返回','未分类','可用空间']);
 await expect(card.locator('.context-window-tokens')).toHaveText(['250k','10k','20k','30k','30k','40k','7k','85k']);
 await expect(page.getByRole('region',{name:'路由耗时',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const geometry=await card.evaluate(el=>{const next=document.querySelector('.stage-timing-card-router')!;return {left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,nextLeft:next.getBoundingClientRect().left,nextRight:next.getBoundingClientRect().right,bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopWidth}});
 expect(geometry.left).toBe(geometry.nextLeft);expect(geometry.right).toBe(geometry.nextRight);expect(geometry.border).toBe('1px');expect(geometry.bg).not.toBe('rgba(0, 0, 0, 0)');
 expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
 if(width<900){await card.locator('.context-window-row').last().scrollIntoViewIfNeeded();await expect(card.locator('.context-window-row').last()).toBeVisible();await card.locator('.context-window-heading').scrollIntoViewIfNeeded();}
 await card.screenshot({path:test.info().outputPath('context-window-light.png')});
 await page.getByRole('button',{name:'切换深色外观'}).click();
 expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
 if(width===1440)await card.screenshot({path:test.info().outputPath('context-window-dark.png')});
});
for(const [name,contextWindow,detail] of [
 ['unknown',{status:'unavailable'},null],
 ['cold',{status:'unavailable',reason:'not-loaded'},'当前进程尚未加载此 Router'],
 ['post-compaction',{status:'unavailable',reason:'awaiting-model-usage'},'等待下一次有效的模型响应'],
 ['missing window',{...synthetic,contextWindow:null},null],
 ['overlapping buckets',{...synthetic,categories:[{key:'unclassified',tokens:900000}]},null],
] as const)test(`context ${name} has no fabricated zero or chart`,async({page})=>{
 await page.route('**/stage-times?limit=8*',r=>r.fulfill({json:{...timings,contextWindow}}));await login(page);
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});await expect(card).toContainText('暂无可靠的上下文计数');await expect(card.locator('.context-window-bar')).toHaveCount(0);await expect(card).not.toContainText('0%');
 if(detail)await expect(card).toContainText(detail);
});
test('actual aggregate uses unclassified, overflow stays bounded, failed refresh clears estimate',async({page})=>{
 let fail=false;await page.route('**/stage-times?limit=8*',r=>fail?r.fulfill({status:503,json:{error:'UNAVAILABLE'}}):r.fulfill({json:{...timings,contextWindow:{status:'ready',basis:'pi-context-estimate',tokens:1200,contextWindow:1000,categories:[{key:'unclassified',tokens:1200}]}}}));await login(page);
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});await expect(card).toContainText('1.2k / 1k (120%)');await expect(card).toContainText('未分类');await expect(card).not.toContainText('Pi 估算');await expect(card).not.toContainText('未分类部分暂无可靠明细');
 expect(await card.locator('.context-window-bar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 fail=true;await page.reload();await expect(card).toContainText('暂无可靠的上下文计数');await expect(card).not.toContainText('1.2k');
});


test('task context window follows objective and precedes consumption; no Router footer',async({page})=>{
 const path='**/api/tasks/task-research/context-window';
 let available=true;
 await page.route(path,route=>route.fulfill({json:available?synthetic:{status:'unavailable',reason:'task-not-loaded'}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const rail=page.getByRole('complementary',{name:'任务详情'});
 const card=rail.getByRole('region',{name:'上下文窗口',exact:true});
 await expect(rail.locator('.detail-section')).toHaveClass([/task-summary-card/,/task-objective-card/,/task-context-window/,/task-token-card/,/task-learning-summary/]);
 await expect(card).toContainText('387k / 472k (82%)');
 await expect(card).toContainText('未分类');
 await expect(card).not.toContainText('Pi 估算');
 await expect(card.locator('.context-window-bar > i')).toHaveCount(7);
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:960});
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await card.screenshot({path:test.info().outputPath(`task-context-window-${width}.png`)});
 }
 available=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(card).toContainText('暂无已保存的上下文记录');
 await expect(card.locator('.context-window-bar')).toHaveCount(0);
 await expect(card).not.toContainText('387k');
});

test('completed task displays saved context with or without a known window',async({page})=>{
 let contextWindow:number|undefined=472000
 await page.route('**/api/tasks/task-summary/context-window',route=>route.fulfill({json:{...synthetic,basis:'pi-committed-context-estimate',contextWindow,...contextWindow?{windowBasis:'current-model-config'}:{}}}))
 await page.goto('/#/tasks/task-summary')
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN)
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
 const card=page.getByRole('region',{name:'上下文窗口',exact:true})
 await expect(card).toContainText('387k / 472k (82%)')
 await expect(card).toContainText('已保存上下文估算 · 上限按当前模型配置')
 contextWindow=undefined
 await page.evaluate(()=>window.dispatchEvent(new Event('online')))
 await expect(card).toContainText('387k tokens')
 await expect(card).toContainText('未知窗口上限')
 await expect(card).toContainText('消息与摘要')
 await expect(card.locator('.context-window-bar')).toHaveCount(0)
 await expect(card).not.toContainText('可用空间')
})
