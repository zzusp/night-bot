import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

for (const width of [1440, 390]) test(`evolution sorting requests and pagination ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const requests: URL[] = [];
  await page.route('**/api/evolution?*', route => {
    const url = new URL(route.request().url()); requests.push(url);
    const kind = url.searchParams.get('kind') || 'memory';
    const offset = Number(url.searchParams.get('offset'));
    const items = Array.from({length:10}, (_, i) => ({id:`${kind}-${offset+i}`, kind, name:`${kind === 'memory' ? '记忆' : '技能'} ${offset+i+1}`, status:'applied', scope:'bot', revision:'1', updatedAt:'2026-11-15T01:00:00Z', lastUsedAt:'2026-11-15T00:00:00Z', modelUseCount:25-i, fileReadCount:0, userUseCount:0, memoryUse:{readCount:25-i,searchCount:0,lastAccess:{counter:'readCount',at:'2026-11-15T00:00:00Z'}}}));
    return route.fulfill({json:{status:'ready',items,total:25,offset,limit:10,nextOffset:offset+10<25?offset+10:null,memory:{acceptedCount:25,candidateCount:0,readCount:42,todayUpdatedCount:3,searchCount:12},skills:{installedCount:25,activeCount:0,candidateCount:0,modelUseCount:42,todayUpdatedCount:2,fileReadCount:8},usageCoverage:{status:'ready',sessionsRead:12}}});
  });
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(10);
  await expect(page.locator('th[aria-sort="descending"]')).toContainText('最近更新');
  for (const [field,label] of [['usage','使用次数'],['lastUsed','最近使用'],['updated','最近更新']]) {
    await page.getByRole('button',{name:`${label}，降序排列`,exact:true}).click();
    await expect.poll(()=>requests.at(-1)?.searchParams.get('sort')).toBe(field);
    await expect(page.locator('th[aria-sort="descending"]')).toContainText(label);
    await page.getByRole('button',{name:`${label}，升序排列`,exact:true}).click();
    await expect.poll(()=>requests.at(-1)?.searchParams.get('direction')).toBe('asc');
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText(label);
  }
  await page.getByRole('link',{name:'Skills',exact:true}).click();
  await expect.poll(()=>requests.at(-1)?.searchParams.get('kind')).toBe('skill');
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('最近更新');
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0');
  await expect(page.locator('.evolution-summary')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`evolution-sort-${width}.png`),fullPage:true});
});
