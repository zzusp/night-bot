import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {resultPreview} from './business-results-fixture.mjs';

async function open(page:Page,fixture:Awaited<ReturnType<typeof resultPreview>>,router=false) {
 await page.goto(fixture.origin+(router?'/#/chat/sample-plan':'/#/tasks/task-research'));
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 if(router)await page.getByRole('tab',{name:'路由',exact:true}).click();
 const history=page.locator('.execution-history');await expect(history).toBeVisible();return history;
}
for(const router of [false,true])test(`${router?'Router 回复':'任务结果'}按序独立展示，前后合组及重复刷新，窄屏浅深色`,async({page})=>{
 const fixture=await resultPreview({router});
 try {
  const history=await open(page,fixture,router);
  const messages=history.locator('.message-column > .message-assistant');
  await expect(messages).toHaveCount(3);
  await expect(messages.nth(0)).toContainText('资料核对完成，保留待确认事项。');
  await expect(messages.nth(1)).toContainText('资料核对完成，保留待确认事项。');
  if(!router)await expect(messages.nth(1)).toContainText('请确认下一步范围。');
  await expect(messages.nth(2)).toContainText('第 3 轮核对完成。');
  await expect(history.locator('.task-final-conclusion')).toHaveCount(0);
  await expect(history.locator('.execution-tool-group')).toHaveCount(4);
  expect(await history.locator('.message-column > [data-message-id]').evaluateAll(rows=>rows.map(row=>row.classList.contains('execution-tool-group')?'tools':'message'))).toEqual(['tools','message','tools','message','tools','message','tools']);
  await expect(history).not.toContainText(router?'resident_router_reply':'task_result');
  await expect(history).not.toContainText('不展示的依据');
  const firstGroup=history.locator('.execution-tool-group').first();await firstGroup.locator(':scope > summary').focus();await page.keyboard.press('Enter');await expect(firstGroup).toHaveAttribute('open');
  for(let i=0;i<2;i++){await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(messages).toHaveCount(3);}
  await expect(firstGroup).toHaveAttribute('open');
  await firstGroup.locator(':scope > summary').click();
  for(const width of [1440,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:960});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await messages.last().scrollIntoViewIfNeeded();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   await page.screenshot({path:test.info().outputPath(`${router?'router':'task'}-results-${width}-${theme}.png`)});
  }
 }finally{await fixture.close()}
});

for(const router of [false,true])test(router?'Router 回复历史分页逐条恢复且不重复':'任务结果历史分页逐条恢复，长正文续读及撤权',async({page})=>{
 const fixture=await resultPreview({router,rounds:24,long:!router});
 try{
  const history=await open(page,fixture,router);
  const messages=history.locator('.message-column > .message-assistant');
  await expect(messages.last()).toContainText(router?'第 24 轮核对完成。':'长结果正文。');
  const initial=await messages.count();expect(initial).toBeLessThan(24);
  await history.locator('.transcript').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});
  await expect(messages).toHaveCount(24);
  const ids=await messages.evaluateAll(rows=>rows.map(row=>row.getAttribute('data-message-id')));expect(new Set(ids).size).toBe(24);
  if(router){await page.screenshot({path:test.info().outputPath('router-history-results.png')});return;}
  const longMessage=messages.last();await longMessage.getByRole('button',{name:'下一段',exact:true}).click();
  await expect(longMessage).toContainText('正文终点');
  await expect(history.locator('.task-final-conclusion')).toHaveCount(0);
  await page.route('**/api/tasks/task-research/session/messages/*',route=>route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}}));
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(longMessage).not.toContainText('正文终点');
  await expect(page.getByRole('alert',{name:'读取状态汇总'})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('task-result-body-revoked.png')});
 }finally{await fixture.close()}
});
