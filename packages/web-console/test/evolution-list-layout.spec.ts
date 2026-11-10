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
    await expect(first.locator('.evolution-entry-details')).not.toHaveAttribute('open', '');
    const title = await first.locator('.evolution-item-title').boundingBox();
    const action = await first.getByRole('button', {name: '查看内容：review-code'}).boundingBox();
    expect(action!.x).toBeGreaterThan(title!.x);
    if (width > 760) expect((await first.boundingBox())!.height).toBeLessThanOrEqual(104);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.evolution-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`evolution-list-${theme}-${width}.png`), fullPage: true, animations: 'disabled'});
    await page.locator('.evolution-library').screenshot({path: test.info().outputPath(`evolution-list-detail-${theme}-${width}.png`), animations: 'disabled'});
  });
}

test('来源版本可键盘展开，内容不预读，返回保留焦点', async ({page}) => {
  let reads = 0;
  await page.route('**/api/evolution/items/**', route => {
    reads++;
    return route.fulfill({json: {id: items[0].id, kind: 'skill', name: items[0].name, revision: items[0].revision, current: {text: '这是一条用于界面验收的合成内容。', revision: items[0].revision, updatedAt}, previous: null, comparison: {status: 'no_previous', reason: 'new_entry'}, redacted: false}});
  });
  await open(page);
  expect(reads).toBe(0);
  const row = page.locator('.evolution-table tbody tr').first();
  await row.locator('.evolution-entry-details > summary').focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('.evolution-location')).toBeVisible();
  await expect(row).toContainText(items[0].revision);
  await page.keyboard.press('Enter');
  await expect(row.locator('.evolution-location')).not.toBeVisible();
  expect(reads).toBe(0);
  const action = row.getByRole('button', {name: '查看内容：review-code', exact: true});
  await action.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.evolution-plain-text')).toContainText('合成内容');
  expect(reads).toBe(1);
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  await expect(action).toBeFocused();
  await page.setViewportSize({width: 390, height: 844});
  const memory = page.locator('.evolution-table tbody tr').nth(3);
  await memory.locator('.evolution-entry-details > summary').click();
  await memory.locator('.evolution-entry-details .evolution-source > summary').click();
  await expect(memory).toContainText('fixture-channel');
  await expect(memory).toContainText('fixture-room');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
