import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('Pi dashboard execution and task card surfaces preserve data and responsive disclosures',async({page})=>{
 const row=(id:string,kind:string,status:string,text:string)=>({id:kind==='tool-call'?id:id+'-out',role:'tool',kind,callId:id,toolName:'bash',status,text,source:{sessionId:'fixture'}});
 const items=[...['a','b'].flatMap(id=>[row(id,'tool-call','pending',`echo ${id}`),row(id,'tool-result','completed',`result ${id}`)]),row('live','tool-call','running','echo working')];
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,revision:'pi-preview',todos:{items:[{text:'核对来源',status:'completed'},{text:'检查执行结果',status:'in_progress'},{text:'整理交付',status:'pending'}]}}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const group=page.locator('.execution-tool-group');
 await expect(group).toBeVisible();
 await group.locator(':scope > summary').click();
 const step=group.locator('.pi-tool-step').first();
 await step.locator('summary').click();
 await expect(step.locator('.tool-content')).toHaveText(['echo a','result a']);
 await expect(page.locator('.pi-tool-frame.is-running .pi-tool-shimmer')).toBeVisible();
 const card=page.locator('.agent-progress.pi-session-card');
 await expect(card).toContainText('检查执行结果');
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:960});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`pi-dashboard-${width}-${theme}.png`),fullPage:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('.pi-tool-shimmer').evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
});
