import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('停止结论在记录底部消息框展示，恢复运行及撤权时隐藏', async ({page}) => {
 let mode = 'waiting';
 await page.route('**/api/tasks/task-research', async route => {
  if (mode === 'denied') return route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  const data = await (await route.fetch()).json();
  return route.fulfill({json:{...data,state:mode,session:{...data.session,status:mode==='running'?'running':'idle'},result:mode==='empty'?null:{summary:'资料核对已完成。\n\n当前等待发布时间，尚未部署。',limitations:['外部投递仍待核验']}}});
 });
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const bubble=page.getByRole('article',{name:'最后结论'});
 await expect(bubble).toBeVisible();
 await expect(bubble).toContainText('尚未部署');
 await expect(bubble).toContainText('外部投递仍待核验');
 expect(await bubble.evaluate(el=>el.parentElement?.lastElementChild===el)).toBe(true);
 for(const width of [1440,390]) for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:960});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await bubble.scrollIntoViewIfNeeded();
  await expect(bubble).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`conclusion-${width}-${theme}.png`)});
 }
 mode='running'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(bubble).toHaveCount(0);
 mode='waiting'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(bubble).toBeVisible();
 mode='empty'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(bubble).toHaveCount(0);
 mode='denied'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.getByText('资料核对已完成。',{exact:false})).toHaveCount(0);
});

test('仅有最终结论且历史为空时不显示默认空态并保持顶部排版',async({page})=>{
 await page.route('**/api/tasks/task-research',async route=>{const data=await(await route.fetch()).json();await route.fulfill({json:{...data,state:'completed',session:{...data.session,status:'idle'},result:{summary:'隔离模拟数据：本轮核验已完成。'}}})});
 await page.route('**/api/tasks/task-research/session?*',async route=>{const data=await(await route.fetch()).json();await route.fulfill({json:{...data,status:'ready',items:[],total:0,before:null,live:{active:false,items:[]}}})});
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const bubble=page.getByRole('article',{name:'最后结论'});await expect(bubble).toBeVisible();
 await expect(page.locator('.message-column')).not.toHaveClass(/is-empty/);
 await expect(page.getByText('暂无消息',{exact:true})).toHaveCount(0);
 await expect(page.getByText('暂无可展示的执行记录',{exact:true})).toHaveCount(0);
 await expect(page.locator('.message-column .message')).toHaveCount(1);
 for(const width of[1440,390])for(const theme of['light','dark']){
  await page.setViewportSize({width,height:960});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const geometry=await bubble.evaluate(el=>{const p=el.parentElement!,s=getComputedStyle(p),r=el.getBoundingClientRect(),pr=p.getBoundingClientRect();return {offset:r.top-pr.top,padding:parseFloat(s.paddingTop),margin:parseFloat(getComputedStyle(el).marginTop),justify:s.justifyContent,children:[...p.children].map(x=>({tag:x.tagName,cls:x.className,h:x.getBoundingClientRect().height}))}});console.log(JSON.stringify({width,theme,...geometry}));expect(geometry.justify).not.toBe('center');expect(Math.abs(geometry.offset-geometry.padding-geometry.margin)).toBeLessThan(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`result-only-${width}-${theme}.png`)});
 }
});
