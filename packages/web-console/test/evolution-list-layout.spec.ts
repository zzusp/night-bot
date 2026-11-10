import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

// All names, counts and text below are synthetic UI fixtures, never live user data.
const updatedAt = '2026-11-10T05:30:00Z';
const names = ['review-code', 'weekly-summary', 'meeting-notes', '资料核对偏好', '项目交付检查清单', '多语言与长标题展示 / a-very-long-resource-name-for-responsive-verification'];
const items = names.map((name, index) => ({id: `layout-${index}`, name, kind: index < 3 ? 'skill' : 'memory', origin: index < 3 ? 'installed' : undefined, scope: 'bot', status: index === 4 ? 'candidate' : 'applied', revision: 'a1b2c3d4e5f60123456789abcdef', updatedAt,
  location: `data/config/skills/${name}/SKILL.md`, modelUseCount: index + 2, userUseCount: index, fileReadCount: index + 5, lastUsedAt: updatedAt,
  memoryUse: {readCount: index * 3, searchCount: index, lastAccess: null},
  provenance: {channelId: 'fixture-channel', conversationType: 'chat-room', conversationId: 'fixture-room', conversationName: '验收示例讨论', taskId: 'fixture-task', taskTitle: '验收来源任务'},
}));
const snapshot = {status: 'ready', coverage: 'bot-shared-current-state', items, total: items.length, offset: 0, limit: 20, nextOffset: null, memory: {acceptedCount: 2, candidateCount: 1, readCount: 36, searchCount: 12, lastUsedAt: updatedAt, trackingSince: updatedAt}, skills: {installedCount: 3, installedAvailableCount: 3, modelUseCount: 9, userUseCount: 3, fileReadCount: 18, activeCount: 0, candidateCount: 0, callTrackingSince: updatedAt, inventoryComplete: true}};

async function open(page: Page) {
  await page.route('**/api/evolution?*', route => route.fulfill({json: snapshot}));
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(items.length);
}

for (const theme of ['light', 'dark']) for (const width of [1440, 2048, 390]) {
  test(`自进化列表真实渲染：${theme} ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: width === 390 ? 844 : 1080});
    await open(page);
    if (theme === 'dark') await page.getByRole('button', {name: '切换深色外观', exact: true}).click();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const first = page.locator('.evolution-table tbody tr').first();
    await expect(page.locator('.evolution-table details')).toHaveCount(0);
    await expect(page.locator('.evolution-table .board-badge')).toHaveCount(0);
    await expect(page.locator('.evolution-table').getByRole('columnheader', {name:'使用记录',exact:true})).toHaveCount(0);
    await expect(page.locator('.evolution-table')).not.toContainText('候选，未应用');
    await expect(page.locator('.evolution-usage-cell')).toHaveCount(items.length);
    await expect(page.locator('.evolution-table th')).toHaveText(['名称', '使用次数', '最近使用', '最近更新']);
    const title = await first.locator('.evolution-item-title').boundingBox();
    const action = await first.getByRole('button', {name: '查看内容：review-code'}).boundingBox();
    expect(title!.x - action!.x).toBeGreaterThan(18);
    expect(title!.x - action!.x).toBeLessThan(38);
    expect(await first.locator('.evolution-entry-open').evaluate(el => getComputedStyle(el).justifyContent)).toBe('flex-start');
    expect(action!.height).toBeGreaterThanOrEqual(34);
    if (width > 760) expect((await first.boundingBox())!.height).toBeLessThanOrEqual(58);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.evolution-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
    await page.mouse.move(0, 0);
    await page.screenshot({path: test.info().outputPath(`evolution-list-${theme}-${width}.png`), fullPage: true, animations: 'disabled'});
    await page.locator('.evolution-library').screenshot({path: test.info().outputPath(`evolution-list-detail-${theme}-${width}.png`), animations: 'disabled'});
  });
}

test('名称显式读取，详情保留来源与版本，返回恢复焦点', async ({page}) => {
  let reads = 0;
  await page.route('**/api/evolution/items/**', route => {
    reads++;
    return route.fulfill({json: {id: items[0].id, kind: 'skill', name: items[0].name, revision: items[0].revision, current: {text: '这是一条用于界面验收的合成内容。', revision: items[0].revision, updatedAt}, previous: null, comparison: {status: 'no_previous', reason: 'new_entry'}, redacted: false}});
  });
  await open(page);
  expect(reads).toBe(0);
  const action = page.getByRole('button', {name: '查看内容：review-code', exact: true});
  await action.focus(); await page.keyboard.press('Enter');
  const content = page.locator('.evolution-content');
  await expect(content.locator('.evolution-plain-text')).toContainText('合成内容');
  expect(reads).toBe(1);
  const details = content.locator('.evolution-entry-details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await expect(details.locator('.evolution-location')).toBeVisible();
  await expect(details).toContainText(items[0].revision);
  await expect(details).toContainText('Bot 公共');
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  await expect(action).toBeFocused();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: `查看内容：${items[3].name}`, exact: true}).click();
  await content.locator('.evolution-entry-details > summary').click();
  await content.locator('.evolution-entry-details .evolution-source > summary').click();
  await expect(content).toContainText('fixture-channel');
  await expect(content).toContainText('fixture-room');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.evolution-content').analyze()).violations).toEqual([]);
});


test('最近使用来自每条记忆或技能的真实观测，缺失/非法不回退到更新时间或全局值', async ({page}) => {
  const skillAt = '2026-11-08T01:23:00Z', memoryAt = '2026-11-09T02:34:00Z';
  const cases = [
    {id:'installed-used', kind:'skill', origin:'installed', lastUsedAt:skillAt, memoryUse:{lastAccess:{at:memoryAt}}, expected:skillAt},
    {id:'learned-used', kind:'skill', origin:'learned', lastUsedAt:skillAt, expected:skillAt},
    {id:'skill-missing', kind:'skill', lastUsedAt:null, expected:null},
    {id:'skill-invalid', kind:'skill', lastUsedAt:'not-a-timestamp', expected:null},
    {id:'memory-read', kind:'memory', lastUsedAt:skillAt, memoryUse:{readCount:1,searchCount:0,lastAccess:{counter:'readCount',at:memoryAt,provenance:null}}, expected:memoryAt},
    {id:'memory-search', kind:'memory', lastUsedAt:skillAt, memoryUse:{readCount:0,searchCount:1,lastAccess:{counter:'searchCount',at:memoryAt,provenance:null}}, expected:memoryAt},
    {id:'memory-untracked', kind:'memory', lastUsedAt:skillAt, memoryUse:null, expected:null},
    {id:'memory-missing', kind:'memory', memoryUse:{readCount:0,searchCount:0,lastAccess:null}, expected:null},
    {id:'memory-invalid', kind:'memory', memoryUse:{readCount:1,searchCount:0,lastAccess:{at:'invalid',provenance:null}}, expected:null},
  ];
  const rows = cases.map(({expected: _expected, ...row}) => ({...row,name:row.id,scope:'bot',status:'applied',revision:1,updatedAt}));
  await page.route('**/api/evolution?*', route => route.fulfill({json:{...snapshot,items:rows,total:rows.length,nextOffset:null}}));
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(rows.length);
  for (const [index, item] of cases.entries()) {
    const row = page.locator('.evolution-table tbody tr').nth(index), cell = row.locator('.evolution-last-used-cell');
    if (item.expected) await expect(cell.locator('time')).toHaveAttribute('datetime',item.expected);
    else { await expect(cell).toContainText('未记录'); await expect(cell.locator('time')).toHaveCount(0); }
    await expect(row.locator('.evolution-updated-cell time')).toHaveAttribute('datetime',updatedAt);
  }
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.evolution-last-used-cell .evolution-time-label').first()).toBeVisible();
  await expect(page.locator('.evolution-updated-cell .evolution-time-label').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
});
