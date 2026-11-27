import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

test('无标签概览保留，旧复盘不加载，浅深窄屏不溢出', async ({page}) => {
 let taskDenied=false, reviewFetches=0;
 await page.route('**/api/tasks/task-research',async route=>{
  if(taskDenied)return route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  const data=await(await route.fetch()).json();
  return route.fulfill({json:{...data,title:'隔离模拟：核对发布结果',objective:'核对结果、保留来源，整理可复用的经验。',durations:{observedAt:'2026-11-14T00:00:00Z',total:{milliseconds:8301000,activeSince:null},execution:{milliseconds:364000,activeSince:null}}}});
 });
 await page.route('**/api/tasks/task-research/learning',route=>{reviewFetches++;return route.abort();});
 await page.goto('/#/tasks/task-research?view=learning');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const rail=page.locator('.task-info-rail');
 await expect(rail.locator('.task-learning-summary')).toHaveCount(0);
 await expect(rail.locator('.detail-section')).toHaveCount(4);
 await expect(rail.locator('nav, [role=tab], .task-blocker-card, .learning-change, .learning-review')).toHaveCount(0);
 await expect(rail.locator('.detail-section').nth(0)).toHaveClass(/task-summary-card/);
 await expect(rail.locator('.detail-section').nth(1)).toHaveClass(/task-objective-card/);
 await expect(rail.locator('.detail-section').nth(3)).toHaveClass(/task-token-card/);
 await expect(rail).toContainText('2 小时 18 分');
 const transcript=page.locator('.transcript');await transcript.evaluate(el=>el.setAttribute('data-preserved','yes'));
 const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('online')));
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await rail.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await rail.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.task-info-rail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await rail.screenshot({path:test.info().outputPath(`summary-${theme}-${width}.png`)});
  if(width===1440&&theme==='light'){await page.locator('main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:test.info().outputPath('summary-full-light-1440.png')});}
 }
 await page.setViewportSize({width:1440,height:960});
 expect(reviewFetches).toBe(0);
 await expect(transcript).toHaveAttribute('data-preserved','yes');
 await page.getByRole('button',{name:'隐藏任务面板',exact:true}).click();await expect(rail).not.toBeVisible();
 await page.getByRole('button',{name:'显示任务面板',exact:true}).click();await expect(rail).toBeVisible();await expect(transcript).toHaveAttribute('data-preserved','yes');
 taskDenied=true;await refresh();await expect(rail.locator('.task-summary-card,.task-learning-summary')).toHaveCount(0);await expect(page.locator('.task-dialogue')).toHaveCount(0);
});


test('复盘底层资料不改动，真实登录撤销清空侧栏和执行记录',async({page,context})=>{
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.locator('.task-summary-card')).toBeVisible();
 const response=await page.request.get('/api/tasks/task-research/learning');
 expect(response.status()).toBe(200);expect((await response.json()).status).toBe('unavailable');
 await expect(page.locator('.task-learning-counts dd')).toHaveCount(0);
 await expect(page.locator('.task-token-total strong')).toHaveText('未知');
 await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.getByLabel('访问令牌',{exact:true})).toBeVisible();
 await expect(page.locator('.task-summary-card,.task-learning-summary,.task-dialogue')).toHaveCount(0);
});

test('隔离UI fixture：Tokens 环形图宽窄预览',async({page})=>{
 let tokenMode='known';
 await page.route('**/api/tasks/task-research/learning',route=>route.fulfill({json:{status:'ready',reviews:[],changes:[],changesComplete:{memory:false,skill:false}}}));
 await page.route('**/api/tasks/task-research/session?*',async route=>{const data=await(await route.fetch()).json();await route.fulfill({json:{...data,tokenUsage:tokenMode==='known'?{input:320000000,output:180000000,cacheWrite:12400,cacheRead:1100000000,total:1600012400,basis:'committed-native-entries'}:tokenMode==='zero'?{input:0,output:0,cacheWrite:0,cacheRead:0,total:0,basis:'committed-native-entries'}:{input:4,output:0,cacheWrite:null,cacheRead:0,total:null,basis:'committed-native-entries'}}});});
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const rail=page.locator('.task-info-rail');await expect(rail.locator('.task-token-total > span')).toHaveText('总量');await expect(rail.locator('.task-token-values dt')).toHaveText(['输入','输出','缓存写入','缓存命中']);await expect(rail.locator('.task-token-ring')).toHaveAttribute('aria-label',/输入 320,000,000 Tokens，输出 180,000,000 Tokens，缓存写入 12,400 Tokens，缓存命中 1,100,000,000 Tokens；总量 1,600,012,400 Tokens/);await expect(rail.locator('.task-learning-counts dd')).toHaveCount(0);await expect(rail.locator('.task-token-total strong')).toHaveText('1.6B');await expect(rail.locator('.token-ring-segment')).toHaveCount(4);
 for(const [width,theme] of [[1440,'light'],[1440,'dark'],[390,'light'],[390,'dark']] as const){
  await page.setViewportSize({width,height:960});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await rail.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(rail.locator('.task-token-unit')).toHaveCount(0);
  const ringBox=(await rail.locator('.task-token-ring').boundingBox())!;expect(ringBox.width).toBe(96);expect(ringBox.height).toBe(96);
  for(const box of await rail.locator('.task-token-values dd').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height)))expect(box).toBeLessThan(28);
  await expect(rail.locator('.task-token-values dd')).toHaveText(['320M','180M','12.4K','1.1B']);
  await expect(rail.locator('.task-token-total strong')).toHaveAttribute('title','总量：1,600,012,400 Tokens');
  expect(await rail.locator('.task-token-values dd').evaluateAll(elements=>elements.map(element=>element.getAttribute('title')))).toEqual(['输入：320,000,000 Tokens','输出：180,000,000 Tokens','缓存写入：12,400 Tokens','缓存命中：1,100,000,000 Tokens']);
  expect(await rail.locator('.task-token-card').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  const shares=await rail.locator('.token-ring-segment').evaluateAll(elements=>elements.map(element=>parseFloat(element.getAttribute('data-share')!)));
  for(const [index,value] of [320000000,180000000,12400,1100000000].entries())expect(shares[index]).toBeCloseTo(value/1600012400*100,10);
  const colors=await rail.locator('.token-ring-segment').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).stroke));const swatches=await rail.locator('.task-token-values i').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor));expect(colors).toEqual(swatches);expect(new Set(colors).size).toBe(4);
  expect((await new AxeBuilder({page}).include('.task-info-rail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await rail.screenshot({path:test.info().outputPath(`review-dash-ring-${width}-${theme}.png`)});
 }
 tokenMode='zero';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(rail.locator('.task-token-total strong')).toHaveText('0');await expect(rail.locator('.token-ring-segment')).toHaveCount(0);await expect(rail.locator('.task-token-values dd')).toHaveText(['0','0','0','0']);
 tokenMode='partial';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(rail.locator('.task-token-total strong')).toHaveText('未知');await expect(rail.locator('.token-ring-segment')).toHaveCount(0);await expect(rail.locator('.task-token-values dd')).toHaveText(['4','0','未知','0']);await expect(rail.locator('.task-learning-counts dd')).toHaveCount(0);

});
