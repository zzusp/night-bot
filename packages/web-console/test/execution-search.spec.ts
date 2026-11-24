import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
test('execution search locates loaded records, handles keyboard, clears and hides after revoked reads', async({page})=>{
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.getByRole('button',{name:'搜索执行记录',exact:true}).click();
 const search=page.getByRole('region',{name:'搜索执行记录'}), input=search.getByRole('searchbox');
 await expect(search).toContainText('仅已载入正文');
 await input.fill('已读取 3 份资料'); await input.press('Enter');
 await expect(search.getByRole('status')).toContainText('1 /');
 await expect(page.locator('.pi-tool-frame').filter({hasText:'已读取 3 份资料'}).first()).toBeInViewport();
 await search.getByRole('button',{name:'清除记录搜索'}).click();
 await expect(input).toHaveValue(''); await expect(input).toBeFocused();
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
 await page.route('**/api/chat/sample-plan/session?*',route=>route.fulfill({json:{status:'ready',revision:'toolbar-r1',scope:'current-router-session-context',total:1,items:[{id:'toolbar-row',role:'assistant',kind:'message',text:'可搜索的路由记录'}]}}));
 await page.goto('/#/chat/sample-plan');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByRole('button',{name:'搜索执行记录',exact:true})).toHaveCount(0);
 const tab=page.getByRole('tab',{name:'路由',exact:true});
 await tab.click();
 const toolbar=page.locator('.conversation-tools');
 const trigger=toolbar.getByRole('button',{name:'搜索执行记录',exact:true});
 const rail=toolbar.getByRole('button',{name:/活动面板/});
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
   await expect(trigger).toHaveAttribute('aria-expanded','true');
   const input=page.getByRole('region',{name:'搜索执行记录'}).getByRole('searchbox');
   await expect(input).toBeFocused();
   await input.press('Escape');
   await expect(trigger).toBeFocused();
   await expect(trigger).toHaveAttribute('aria-expanded','false');
 }
 await page.getByRole('tab',{name:'对话',exact:true}).click();
 await expect(trigger).toHaveCount(0);
 await expect(rail).toBeVisible();
});
