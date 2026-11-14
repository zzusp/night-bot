import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FIXTURE_TOKEN} from './preview.mjs';

// Cross-feature acceptance fixture, never a production conversation/model run.
for(const width of [1440,1920,390]) for(const theme of ['light','dark']) {
 test(`whole-canvas center and default TODO clearance ${width}px ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:960});
  await page.route('**/api/tasks/task-research',async route=>{const data=await(await route.fetch()).json();await route.fulfill({json:{...data,title:'隔离模拟：任务工作区联合验收',objective:'核对布局、执行记录与只读统计，保留原始来源。'}});});
  await page.route('**/api/tasks/task-research/learning',route=>route.fulfill({json:{status:'ready',reviews:[],changes:[],changesComplete:{memory:false,skill:false}}}));
  await page.route('**/api/tasks/task-research/session?*',route=>route.fulfill({json:{status:'ready',scope:'current-context',revision:'integrated-ui-fixture',total:41,
   items:[{id:'matrix-request',role:'user',text:'隔离模拟资料：请逐项核对方案、来源与待确认问题。'.repeat(20)},...Array.from({length:40},(_,i)=>({id:`matrix-answer-${i}`,role:'assistant',text:`隔离模拟记录 ${i+1}：正在核对配置与执行结果，保留来源、限制和后续安排。`}))],
   tokenUsage:{input:2400,output:3200,cacheWrite:1600,cacheRead:2800,total:10000,basis:'committed-native-entries'},
   todos:{items:Array.from({length:15},(_,i)=>({text:`隔离待办 ${i+1}：核对配置与执行记录，整理结果及后续安排。`,status:i<3?'completed':i===3?'in_progress':'pending'}))}}}));
  await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const card=page.locator('.agent-progress'),summary=card.locator('summary'),scroller=page.locator('.task-dialogue .transcript');
  const disclosure=page.locator('[data-message-id="matrix-request"] .message-disclosure');
  await expect(card).toBeVisible();const evidence=[];
  for(const rail of [true,false]){
   const toggle=page.getByRole('button',{name:rail?'显示任务面板':'隐藏任务面板',exact:true});if(await toggle.count())await toggle.click();
   await page.locator('main').evaluate(el=>el.scrollTop=0);await scroller.evaluate(el=>el.scrollTop=0);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const geometry=await page.evaluate(()=>{
    const rect=(selector:string)=>{const b=document.querySelector(selector)!.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
    const canvas=rect('.task-dialogue .execution-history'),column=rect('.task-dialogue .message-column'),todo=rect('.agent-progress'),first=rect('[data-message-id="matrix-request"]');
    return {canvas,column,todo,first,centerError:Math.abs(column.x+column.width/2-canvas.x-canvas.width/2),bodyOverflow:document.documentElement.scrollWidth-innerWidth};
   });
   expect(geometry.centerError).toBeLessThanOrEqual(1);expect(geometry.bodyOverflow).toBe(0);
   expect(geometry.first.x<geometry.todo.right&&geometry.first.right>geometry.todo.x&&geometry.first.y<geometry.todo.bottom&&geometry.first.bottom>geometry.todo.y).toBe(false);
   const narrow=geometry.canvas.width<1496;
   if(narrow)await expect(card).not.toHaveAttribute('open');else await expect(card).toHaveAttribute('open');
   await disclosure.click();await expect(disclosure).toHaveAttribute('aria-expanded','true');await disclosure.click();
   await scroller.hover();await page.mouse.wheel(0,400);await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
   if(narrow)expect((await scroller.boundingBox())!.y).toBeGreaterThanOrEqual((await card.boundingBox())!.y+(await card.boundingBox())!.height);
   await scroller.evaluate(el=>el.scrollTop=0);
   if(narrow){
    await summary.click();await expect(card).toHaveAttribute('open');await page.getByRole('list',{name:'任务步骤',exact:true}).focus();await page.keyboard.press('Escape');await expect(card).not.toHaveAttribute('open');await expect(summary).toBeFocused();
    await disclosure.click();await expect(disclosure).toHaveAttribute('aria-expanded','true');await disclosure.click();
    await summary.click();await expect(card).toHaveAttribute('open');await scroller.click({position:{x:5,y:100}});await expect(card).not.toHaveAttribute('open');
    await disclosure.click();await expect(disclosure).toHaveAttribute('aria-expanded','true');await disclosure.click();
    await summary.click();await summary.click();await expect(card).not.toHaveAttribute('open');
   }
   if(rail){
    await expect(page.locator('.task-info-rail nav')).toHaveCount(0);
    await expect(page.locator('.task-info-rail .detail-section')).toHaveClass([/task-summary-card/,/task-objective-card/,/task-token-card/,/task-learning-summary/]);
    await expect(page.locator('.task-learning-counts dd')).toHaveText(['—','—']);
   }
   await summary.evaluate(el=>(el as HTMLElement).blur());await page.mouse.move(0,0);await page.locator('main').evaluate(el=>el.scrollTop=0);
   await page.screenshot({path:test.info().outputPath(`integrated-${width}-${theme}-rail-${rail}.png`)});
   evidence.push({width,theme,rail,...geometry,defaultIntersectsTODO:false,disclosureClickable:true,scrollClear:true,escapeAndOutsideClose:narrow?'passed':'wide-card'});
  }
  await writeFile(test.info().outputPath('geometry.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence.map(({width,theme,rail,centerError,bodyOverflow})=>({width,theme,rail,centerError,bodyOverflow}))));
 });
}
