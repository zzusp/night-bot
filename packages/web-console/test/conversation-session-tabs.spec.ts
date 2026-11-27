import {test,expect} from '@playwright/test';
import {startPreview} from './preview.mjs';
let fixture: Awaited<ReturnType<typeof startPreview>>;
test.beforeAll(async()=>{fixture=await startPreview({port:0,sessionRecords:true})});
test.afterAll(async()=>{await fixture?.close()});

for(const width of [1440,390])test(`Router uses one complete recorded timeline at ${width}px`,async({page})=>{
 const hits:string[]=[];
 page.on('request',r=>hits.push(new URL(r.url()).pathname));
 await page.setViewportSize({width,height:900});
 // Existing bookmarks open the same timeline; the former channel value never filters it.
 await page.goto(fixture.origin+'/#/router?conversation=conversations%3Aroom-notes');
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const record=page.getByRole('region',{name:'路由记录',exact:true});
 await expect(record).toContainText('产品渠道：压缩前的记录');
 await expect(record).toContainText('资料渠道：压缩后的记录');
 await expect(record).toContainText('定时自检');
 await expect(record.locator('.router-conversation-scope')).toHaveCount(0);
 await expect(page.locator('.router-toolbar')).toHaveCSS('border-bottom-width','0px');
 const historyStart=record.getByText('已到当前上下文的开始',{exact:true});
 await expect(historyStart).toBeVisible();
 await expect(record.locator('.message-column')).toHaveCSS('padding-top','4px');
 const text=await record.innerText();
 expect(text.indexOf('产品渠道：压缩前的记录')).toBeLessThan(text.indexOf('资料渠道：压缩后的记录'));
 await expect(record).not.toContainText('discarded branch');
 await expect(page.getByRole('combobox',{name:'选择对话'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'原对话',exact:true})).toHaveCount(0);
 expect(hits.filter(path=>/\/api\/(conversations|chat)\/[^/]+\/session/.test(path))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if (process.env.ROUTER_PREVIEW_DIR) {
  if (width===1440) {
   const activity = page.getByRole('button', {name:'工作动态',exact:true});
   if (await activity.count() && !(await page.locator('#activity-panel').isVisible())) await activity.click();
  }
  await page.screenshot({path:`${process.env.ROUTER_PREVIEW_DIR}/night-bot-router-${width}.png`,animations:'disabled'});
 }
 await page.goto(fixture.origin+'/#/channels/room-product');
 await expect(record).toHaveCount(0);
 await expect(page.locator('#activity-panel')).toHaveCount(0);
});

test('Router keeps one timeline on refresh and hides it when access is revoked',async({page})=>{
 await page.goto(fixture.origin+'/#/router');
 await page.getByLabel('访问令牌',{exact:true}).fill(fixture.token);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const record=page.getByRole('region',{name:'路由记录',exact:true});
 await expect(record).toContainText('产品渠道：压缩前的记录');
 await page.reload();
 await expect(record).toContainText('资料渠道：压缩后的记录');
 await page.route('**/api/router/session?*',r=>r.fulfill({status:403,json:{error:'ACCESS_DENIED'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(record).not.toContainText('资料渠道：压缩后的记录');
});
