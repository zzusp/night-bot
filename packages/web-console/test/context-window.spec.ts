import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
import {mkdir} from 'node:fs/promises';
const synthetic={status:'ready',basis:'pi-context-estimate',tokens:387040,contextWindow:472000,categories:[{key:'unclassified',tokens:387040}]};
const timings={status:'ready',items:[13900,17800,23100,16400,19200,12200,14800,16100].map((durationMs,i)=>({receivedAt:`2026-11-20T01:${String(40-i*4).padStart(2,'0')}:00Z`,router:{status:'recorded',durationMs,shared:false}}))};
async function login(page:import('@playwright/test').Page){await page.goto('/#/channels/room-product');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByRole('tab',{name:'路由',exact:true})).toBeVisible();await page.evaluate(()=>{const marker=document.createElement('div');marker.textContent='合成测试数据 · 非真实运行记录';marker.style.cssText='position:fixed;bottom:8px;left:300px;z-index:9999;font-size:10px;color:#555;background:#fff;padding:4px;pointer-events:none';document.body.append(marker);});}
for(const width of [1440,390])test(`context composition card, theme and layout ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});await page.route('**/stage-times?limit=8*',r=>r.fulfill({json:{...timings,contextWindow:synthetic}}));await login(page);
 if(width<900)await page.getByRole('button',{name:'显示活动面板',exact:true}).click();
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});
 await expect(card).toContainText('387k / 472k (82%)');await expect(card).not.toContainText('演示');await expect(card.locator('.context-color-messages')).toHaveCount(0);await expect(card.locator('.context-window-legend')).toBeVisible();await expect(card.locator('.context-window-bar')).toBeVisible();
 await expect(card.getByRole('button')).toHaveCount(0);await expect(card.locator('[aria-expanded]')).toHaveCount(0);
 await expect(card.locator('.context-window-row')).toHaveCount(2);await expect(card).toContainText('85k');
 await expect(page.getByRole('region',{name:'路由耗时',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const geometry=await card.evaluate(el=>{const next=document.querySelector('.stage-timing-card-router')!;return {left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,nextLeft:next.getBoundingClientRect().left,nextRight:next.getBoundingClientRect().right,bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopWidth}});
 expect(geometry.left).toBe(geometry.nextLeft);expect(geometry.right).toBe(geometry.nextRight);expect(geometry.border).toBe('1px');expect(geometry.bg).not.toBe('rgba(0, 0, 0, 0)');
 expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
 if(width<900){await card.locator('.context-window-row').last().scrollIntoViewIfNeeded();await expect(card.locator('.context-window-row').last()).toBeVisible();await card.locator('.context-window-heading').scrollIntoViewIfNeeded();}
 await mkdir('/workspace/context-window-deliverables',{recursive:true});
 await page.screenshot({path:`/workspace/context-window-deliverables/context-window-test-${width}.png`,fullPage:true});
 if(width===1440)await card.screenshot({path:'/workspace/context-window-deliverables/context-window-demo-detail.png'});
 await page.getByRole('button',{name:'切换深色外观'}).click();
 expect((await new AxeBuilder({page}).include('#activity-panel').analyze()).violations).toEqual([]);
 if(width===1440)await page.screenshot({path:'/workspace/context-window-deliverables/context-window-demo-dark.png',fullPage:true});
});
for(const [name,contextWindow] of [
 ['unknown',{status:'unavailable'}],['missing window',{...synthetic,contextWindow:null}],['overlapping buckets',{...synthetic,categories:[{key:'unclassified',tokens:900000}]}],
] as const)test(`context ${name} has no fabricated zero or chart`,async({page})=>{
 await page.route('**/stage-times?limit=8*',r=>r.fulfill({json:{...timings,contextWindow}}));await login(page);
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});await expect(card).toContainText('暂无可靠的上下文计数');await expect(card.locator('.context-window-bar')).toHaveCount(0);await expect(card).not.toContainText('0%');
 if(name==='unknown')await page.screenshot({path:'/workspace/context-window-deliverables/context-window-empty.png',fullPage:true});
});
test('actual aggregate uses unclassified, overflow stays bounded, failed refresh clears estimate',async({page})=>{
 let fail=false;await page.route('**/stage-times?limit=8*',r=>fail?r.fulfill({status:503,json:{error:'UNAVAILABLE'}}):r.fulfill({json:{...timings,contextWindow:{status:'ready',basis:'pi-context-estimate',tokens:1200,contextWindow:1000,categories:[{key:'unclassified',tokens:1200}]}}}));await login(page);
 const card=page.getByRole('region',{name:'上下文窗口',exact:true});await expect(card).toContainText('1.2k / 1k (120%)');await expect(card).toContainText('未分类');await expect(card).toContainText('Pi 估算');
 expect(await card.locator('.context-window-bar').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 fail=true;await page.reload();await expect(card).toContainText('暂无可靠的上下文计数');await expect(card).not.toContainText('1.2k');
});
