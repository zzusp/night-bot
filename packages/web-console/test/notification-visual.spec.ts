import {test,expect} from '@playwright/test';import {FIXTURE_TOKEN} from './preview.mjs';
test('notification first look light dark and phone',async({page})=>{
 let failed=false;const requests:string[]=[];
 await page.route('**/api/tasks/task-research**',r=>{if(failed&&r.request().method()==='GET'){requests.push(new URL(r.request().url()).pathname);return r.fulfill({status:503,json:{error:'FIXTURE_UNAVAILABLE'}})}return r.continue()});
 await page.setViewportSize({width:1440,height:960});await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.locator('.task-dialogue .message').first()).toBeVisible();
 const before=await page.locator('.task-dialogue .message').first().boundingBox();failed=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 const card=page.getByRole('alert',{name:'读取状态汇总'});await expect(card).toHaveAttribute('data-affected-count','3');await expect(card).toContainText('任务、执行记录和复盘暂未更新。');
 const after=await page.locator('.task-dialogue .message').first().boundingBox();expect(Math.abs(after!.y-before!.y)).toBeLessThan(1);
 for(const [width,theme]of [[1440,'light'],[1440,'dark'],[390,'light'],[390,'dark']]as const){await page.setViewportSize({width,height:960});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await expect(card).toBeVisible();const box=await card.boundingBox();expect(box!.width).toBeLessThanOrEqual(400);expect(box!.height).toBeLessThan(170);expect(box!.x).toBeGreaterThanOrEqual(16);expect(box!.x+box!.width).toBeLessThanOrEqual(width-16);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);console.log('NOTIFICATION_GEOMETRY',width,theme,box);await page.screenshot({path:test.info().outputPath(`notification-task-${width}-${theme}.png`)});}
 const identity=await card.elementHandle();const initialReads=requests.length;await page.waitForTimeout(5200);await expect(card).toHaveCount(1);expect(await identity!.evaluate(el=>el.isConnected)).toBe(true);expect(requests.length).toBeGreaterThan(initialReads);
});
