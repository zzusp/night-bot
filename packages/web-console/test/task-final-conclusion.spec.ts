import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('停止结论在记录底部消息框展示，恢复运行及撤权时隐藏', async ({page}) => {
 let mode = 'waiting';
 await page.route('**/api/tasks/task-research', async route => {
  if (mode === 'error') return route.fulfill({status:503,json:{error:'REQUEST_FAILED'}});
  if (mode === 'denied') return route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  const data = await (await route.fetch()).json();
  return route.fulfill({json:{...data,title:'隔离模拟：资料核对任务',state:mode,durations:{execution:{milliseconds:8301000,activeSince:null}},session:{...data.session,status:mode==='running'?'running':'idle'},result:mode==='empty'?null:{summary:'资料核对已完成。\n\n当前等待发布时间，尚未部署。',question:'是否安排下一轮核验？',evidence:['隔离样例已完成资料核对','保留原始来源记录'],limitations:['外部投递仍待核验','尚未验证线上状态']}}});
 });
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN);
 const taskResponse=page.waitForResponse(response=>response.url().endsWith('/api/tasks/task-research')&&response.status()===200);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const bubble=page.getByRole('article',{name:'最后结论'});
 await expect(bubble).toBeVisible();
 await expect(bubble).toContainText('尚未部署');
 await expect(bubble).toContainText('用时 2h 18m 21s');
 const geometry = async () => {
  const gap = await bubble.evaluate(el => el.getBoundingClientRect().top - el.previousElementSibling!.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(7.5); expect(gap).toBeLessThanOrEqual(8.5);
  const label = await page.locator('.task-conclusion-label').boundingBox();
  const thinking = await page.locator('.thinking-message > summary').first().boundingBox();
  expect(Math.abs(label!.x + 17 - thinking!.x)).toBeLessThanOrEqual(1);
  const textX=await page.evaluate(()=>{
    const x=(selector:string)=>{const el=document.querySelector(selector)!;const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.textContent?.trim()){const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().x;}}return NaN;};
    return [x('.task-conclusion-label'),x('.thinking-message > summary')];
  });
  expect(Math.abs(textX[0]-textX[1])).toBeLessThanOrEqual(1);
  console.log(JSON.stringify({conclusionGeometry:{width:page.viewportSize()!.width,theme:await page.evaluate(()=>document.documentElement.dataset.theme),gap,textX}}));
 };
 await geometry();
 await expect(bubble).toContainText('是否安排下一轮核验？');
 await expect(bubble.locator('details,summary,button,a,[tabindex]')).toHaveCount(0);
 await expect(page.getByText('依据与限制',{exact:true})).toHaveCount(0);
 for(const text of ['隔离样例已完成资料核对','保留原始来源记录','外部投递仍待核验','尚未验证线上状态']) await expect(bubble).not.toContainText(text);
 expect(await bubble.ariaSnapshot()).not.toMatch(/依据|限制|外部投递仍待核验|尚未验证线上状态/);
 const responseData=await taskResponse.then(response=>response.json());
 expect(responseData.result).toEqual({summary:'资料核对已完成。\n\n当前等待发布时间，尚未部署。',question:'是否安排下一轮核验？',evidence:['隔离样例已完成资料核对','保留原始来源记录'],limitations:['外部投递仍待核验','尚未验证线上状态']});
 expect(await bubble.evaluate(el=>el.parentElement?.lastElementChild===el)).toBe(true);
 for(const width of [1440,390]) for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:960});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await bubble.scrollIntoViewIfNeeded();
  await geometry();
  await expect(bubble).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=> (document.activeElement as HTMLElement)?.blur());await page.mouse.move(0,0);
  await page.screenshot({path:test.info().outputPath(`conclusion-${width}-${theme}.png`)});

 }
 mode='running'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(bubble).toHaveCount(0);
 mode='waiting'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(bubble).toBeVisible();
 mode='error'; await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(bubble).toHaveCount(0);
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
 await expect(page.locator('.task-conclusion-details')).toHaveCount(0);
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
