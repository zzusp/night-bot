import {openRouter} from './open-router';
import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
test('execution search locates loaded records, handles keyboard, closes and hides after revoked reads', async({page})=>{
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.getByRole('button',{name:'搜索执行记录',exact:true}).click();
 const search=page.getByRole('region',{name:'搜索执行记录'}), input=search.getByRole('searchbox');
 await expect(search).not.toContainText('仅已载入正文');
 await input.fill('已读取 3 份资料');
 await expect(search.getByRole('status')).toContainText('1 /');
 await expect(page.locator('[data-execution-search-match]')).toHaveCount(1);
 await expect(page.locator('.pi-tool-frame').filter({hasText:'已读取 3 份资料'}).first()).toBeInViewport();
 const trigger = page.getByRole('button',{name:'搜索执行记录',exact:true});
 const close = search.getByRole('button',{name:'关闭记录搜索',exact:true});
 await expect(close).toHaveCount(1);
 await search.locator('.search-field').getByRole('button',{name:'关闭记录搜索',exact:true}).click();
 await expect(search).toHaveCount(0); await expect(trigger).toBeFocused();
 await trigger.click();
 await expect(input).toHaveValue(''); await expect(input).toBeFocused();
 await close.click();
 await expect(search).toHaveCount(0); await expect(trigger).toBeFocused();
 await trigger.click();
 await expect(page.locator('[data-execution-search-match]')).toHaveCount(0);
 await input.fill('not-a-real-fixture-result'); await expect(search).toContainText('无匹配');
 await expect(search.getByRole('button',{name:'下一个搜索结果'})).toBeDisabled();
 await input.press('Escape'); await expect(search).toHaveCount(0);
 await page.getByRole('button',{name:'搜索执行记录',exact:true}).click();
 await expect(input).toHaveValue(''); await input.fill('资料');
 await page.route('**/api/tasks/task-research/session?*',route=>route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(search).toHaveCount(0);
});

test('Router search sits immediately before the activity button at wide and narrow widths',async({page})=>{
 await page.route('**/api/router/session?*',route=>route.fulfill({json:{status:'ready',revision:'toolbar-r1',scope:'global-router-transcript',total:3,items:[{id:'m-1',role:'user',kind:'message',text:'看看有哪些任务可以继续做。'},{id:'toolbar-row',role:'assistant',kind:'message',text:'已同步任务进度：导出功能在验证，文档已更新。'},{id:'m-2',role:'assistant',kind:'message',text:'已更新任务进度：两项检查都通过了。'}]}}));
 await page.goto('/#/chat/sample-plan');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByRole('button',{name:'搜索执行记录',exact:true})).toHaveCount(0);
 await openRouter(page);
 const toolbar=page.locator('.router-tools');
 const trigger=toolbar.getByRole('button',{name:'搜索执行记录',exact:true});
 const rail=toolbar.getByRole('button',{name:/工作动态/});
 for (const width of [1440,390]) {
   await page.setViewportSize({width,height:880});
   await expect(trigger).toBeVisible();
   const [a,b]=await Promise.all([trigger.boundingBox(),rail.boundingBox()]);
   expect(a).not.toBeNull();expect(b).not.toBeNull();
   expect(a!.x+a!.width).toBeLessThanOrEqual(b!.x);
   expect(Math.abs((a!.y+a!.height/2)-(b!.y+b!.height/2))).toBeLessThan(1);
   const toolbarBox=(await toolbar.boundingBox())!;
   const x=Math.max(0,Math.floor(toolbarBox.x)-120);
   await page.screenshot({path:test.info().outputPath(`router-search-toolbar-${width}.png`),clip:{
     x,y:Math.max(0,Math.floor(toolbarBox.y)-5),width:Math.min(width-x,Math.ceil(toolbarBox.x+toolbarBox.width-x)+8),height:Math.ceil(toolbarBox.height)+10,
   }});
   await trigger.focus();await page.keyboard.press('Enter');
   const search=toolbar.getByRole('region',{name:'搜索执行记录'});
   const input=search.getByRole('searchbox');
   await expect(input).toBeFocused();
   await expect(trigger).toHaveCount(0);
   const opened=(await input.boundingBox())!, unchanged=(await rail.boundingBox())!;
   expect(Math.abs(opened.y+opened.height/2-(unchanged.y+unchanged.height/2))).toBeLessThan(2);
   expect(unchanged.x).toBe(b!.x);
   if (width===1440) await page.screenshot({path:test.info().outputPath('router-search-open.png'),animations:'disabled'});
   await input.fill('任务进度');
   const field=search.locator('.search-field');
   await expect(field.getByRole('status')).toHaveText('1 / 2');
   await expect(field.getByRole('button')).toHaveCount(3);
   await expect(field.getByRole('button').nth(0)).toHaveAccessibleName('上一个搜索结果');
   await expect(field.getByRole('button').nth(1)).toHaveAccessibleName('下一个搜索结果');
   await expect(field.getByRole('button').nth(2)).toHaveAccessibleName('关闭记录搜索');
   await expect(page.locator('[data-execution-search-match]')).toContainText('已同步任务进度');
   await search.getByRole('button',{name:'下一个搜索结果'}).click();
   await expect(search.getByRole('status')).toHaveText('2 / 2');
   await expect(page.locator('[data-execution-search-match]')).toContainText('已更新任务进度');
   await page.screenshot({path:test.info().outputPath(`router-search-match-${width}.png`),animations:'disabled'});
   await page.keyboard.press('Escape');
   await expect(trigger).toBeFocused();
   await expect(trigger).toHaveAttribute('aria-expanded','false');
 }
 await page.goto('/#/chat/sample-plan');
 await expect(trigger).toHaveCount(0);
 await expect(rail).toHaveCount(0);
});

test('Task search shares the right toolbar before panel, without overlapping progress or duplicating the control',async({page},info)=>{
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const toolbar=page.locator('.task-panel-tools');
 const trigger=toolbar.getByRole('button',{name:'搜索执行记录',exact:true});
 const rail=toolbar.getByRole('button',{name:/任务面板/});
 const progress=page.getByRole('region',{name:'任务待办'}).locator('summary');
 for (const width of [1440,390]) {
   await page.setViewportSize({width,height:880});
   await expect(trigger).toBeVisible();
   await expect(progress).toBeVisible();
   await expect(page.getByRole('button',{name:'搜索执行记录',exact:true})).toHaveCount(1);
   await expect(page.locator('.execution-search-owner').getByRole('button',{name:'搜索执行记录',exact:true})).toHaveCount(0);
   const [search,toggle,todo]=await Promise.all([trigger.boundingBox(),rail.boundingBox(),progress.boundingBox()]);
   expect(search!.x+search!.width).toBeLessThanOrEqual(toggle!.x);
   expect(Math.abs((search!.y+search!.height/2)-(toggle!.y+toggle!.height/2))).toBeLessThan(1);
   expect(todo!.x+todo!.width).toBeLessThanOrEqual(search!.x);
   const canvas=(await page.getByRole('region',{name:'任务执行记录',exact:true}).boundingBox())!;
   expect(canvas.x+canvas.width-toggle!.x-toggle!.width).toBeLessThanOrEqual(16.5);
   const x=Math.max(0,Math.floor(todo!.x)-6);
   await trigger.evaluate(el=>(el as HTMLElement).blur()); await page.mouse.move(0,0);
   await page.screenshot({path:info.outputPath(`task-search-toolbar-${width}.png`),clip:{
     x,y:Math.max(0,Math.floor(search!.y)-5),width:Math.min(width-x,Math.ceil(canvas.x+canvas.width-x)),height:44,
   }});
   await trigger.focus();await page.keyboard.press('Enter');
   const panel=toolbar.getByRole('region',{name:'搜索执行记录'});
   const input=panel.getByRole('searchbox');
   await expect(input).toBeFocused();
   const field=(await input.boundingBox())!;
   expect(Math.abs(field.y+field.height/2-(toggle!.y+toggle!.height/2))).toBeLessThan(1);
   expect((await rail.boundingBox())!.x).toBe(toggle!.x);
   await input.fill('已读取 3 份资料');
   await expect(panel.locator('.search-field').getByRole('status')).toContainText('1 /');
   await expect(page.locator('[data-execution-search-match]')).toHaveCount(1);
   await page.screenshot({path:info.outputPath(`task-search-match-${width}.png`),animations:'disabled'});
   await input.press('Escape');
   await expect(trigger).toBeFocused();
   await expect(trigger).toHaveAttribute('aria-expanded','false');
 }
 await rail.click();
 await expect(rail).toHaveAttribute('aria-expanded','false');
 await expect(trigger).toBeVisible();
});
