import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
test('圆端弧段：常规、极小、完整圆环、零和未知，浅暗图形验收',async({page})=>{
 let mode='regular';
 const snapshots={regular:{input:2400,output:3200,cacheWrite:1600,cacheRead:2800,total:10000},tiny:{input:1,output:3000,cacheWrite:3000,cacheRead:3999,total:10000},single:{input:0,output:0,cacheWrite:0,cacheRead:10000,total:10000},zero:{input:0,output:0,cacheWrite:0,cacheRead:0,total:0},unknown:{input:4,output:0,cacheWrite:null,cacheRead:0,total:null}};
 await page.route('**/api/tasks/task-research/learning',route=>route.fulfill({json:{status:'ready',reviews:[],changes:[],changesComplete:{memory:false,skill:false}}}));
 await page.route('**/api/tasks/task-research/session?*',async route=>{const data=await(await route.fetch()).json();await route.fulfill({json:{...data,tokenUsage:{...snapshots[mode as keyof typeof snapshots],basis:'committed-native-entries'}}});});
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const card=page.getByRole('region',{name:'消耗 Tokens',exact:true}),rail=page.locator('.task-info-rail');
 await expect(card.locator('dd')).toHaveText(['2.4K','3.2K','1.6K','2.8K']);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const state of ['regular','tiny','single','zero','unknown']){
   mode=state;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await expect(card.locator('dd')).toHaveText(state==='regular'?['2.4K','3.2K','1.6K','2.8K']:state==='tiny'?['1','3K','3K','4K']:state==='single'?['0','0','0','10K']:state==='zero'?['0','0','0','0']:['4','0','未知','0']);
   if(state==='regular'){
    await expect(card.locator('path.token-ring-segment')).toHaveCount(4);
    for(const path of await card.locator('path.token-ring-segment').all()){await expect(path).toHaveCSS('stroke-linecap','round');await expect(path).toHaveCSS('stroke-width','10px');}
    const shares=await card.locator('.token-ring-segment').evaluateAll(elements=>elements.map(element=>Number(element.getAttribute('data-share'))));for(const [index,value] of [24,32,16,28].entries())expect(shares[index]).toBeCloseTo(value,12);
   }else if(state==='tiny'){
    await expect(card.locator('.token-ring-marker')).toHaveCount(1);await expect(card.locator('.token-ring-marker')).toHaveCSS('stroke-linecap','round');
    const small=card.locator('path.token-input');await expect(small).toHaveAttribute('data-share','0.01');expect(parseFloat(await small.getAttribute('stroke-width')||'')).toBeLessThan(0.1);
    await expect(card.locator('.token-ring-marker title')).toHaveText('输入：1 Tokens；极小份额定位标记，不代表比例');await expect(card.locator('dd').first()).toHaveAttribute('title','输入：1 Tokens');
   }else if(state==='single'){
    await expect(card.locator('circle.token-ring-segment')).toHaveCount(1);await expect(card.locator('path.token-ring-segment,.token-ring-marker')).toHaveCount(0);await expect(card.locator('circle.token-ring-segment')).not.toHaveAttribute('stroke-dasharray');
   }else await expect(card.locator('.token-ring-segment,.token-ring-marker')).toHaveCount(0);
   expect((await new AxeBuilder({page}).include('.task-token-card').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   await card.screenshot({path:test.info().outputPath(`rounded-${state}-${theme}.png`)});
  }
 }
 mode='regular';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(card.locator('dd').first()).toHaveText('2.4K');
 for(const [width,theme] of [[1440,'light'],[390,'dark']] as const){await page.setViewportSize({width,height:960});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await rail.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await rail.screenshot({path:test.info().outputPath(`rounded-rail-${width}-${theme}.png`)});}
});
