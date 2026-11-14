import {test, expect, type Page} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';
const login = async (page: Page) => {await page.goto('/#/channels/room-product'); await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN); await page.getByRole('button',{name:'连接工作空间',exact:true}).click();};
const items = (from:number,to:number) => Array.from({length:to-from},(_,i)=>({id:`m${from+i}`,role:'user',text:`历史消息 ${from+i} `+'正文内容。'.repeat(20),createdAt:new Date(Date.UTC(2026,0,1,0,from+i)).toISOString()}));
const snapshot = (offset:number) => ({items:offset===0?items(50,100):items(0,50),pages:{messages:{total:100,nextOffset:offset===0?50:null,revision:'r1'},outbox:{total:0,nextOffset:null,revision:'o1'}}});

test('渠道对话移除底部分页，向上自动补读、保持锚点和唯一消息',async({page})=>{
  const reads:URL[]=[];
  await page.route('**/api/conversations/room-product/messages?**',async route=>{const url=new URL(route.request().url()); reads.push(url);await route.fulfill({json:snapshot(Number(url.searchParams.get('messageOffset')))});});
  await login(page);
  const list=page.locator('.transcript');
  await expect(page.locator('[data-message-id]')).toHaveCount(50);
  await expect(page.locator('.conversation-pagination')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'查看更早消息',exact:true})).toHaveCount(0);
  await list.evaluate(el=>{el.scrollTop=80;el.dispatchEvent(new Event('scroll'));});
  await expect(page.locator('[data-message-id]')).toHaveCount(100);
  expect(reads[1].searchParams.get('messageRevision')).toBe('r1');
  expect(reads[1].searchParams.get('outboxRevision')).toBe('o1');
  expect(await list.evaluate(el=>el.scrollTop)).toBeGreaterThan(1000);
  await list.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await expect(page.getByText('已到当前上下文的开始',{exact:true})).toBeVisible();
  expect(reads).toHaveLength(2);
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`channel-history-${width}.png`)});}
});

test('更早页暂时失败可重试；权限撤销清除已累积消息',async({page})=>{
  let attempts=0;
  await page.route('**/api/conversations/room-product/messages?**',async route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('messageOffset'));
    if(!offset)return route.fulfill({json:snapshot(0)});
    attempts++;
    return route.fulfill({status:attempts===1?503:403,json:{error:{code:attempts===1?'SERVICE_UNAVAILABLE':'FORBIDDEN'}}});
  });
  await login(page);await expect(page.locator('[data-message-id]')).toHaveCount(50);
  await page.locator('.transcript').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await expect(page.locator('.execution-history-start button')).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(50);
  await page.locator('.execution-history-start button').click();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});
