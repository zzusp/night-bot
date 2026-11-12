import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const updatedAt = '2026-11-11T15:05:00Z';
const snapshot = (kind = 'memory') => ({
  status: 'ready', items: [{id: `${kind}-toolbar`, kind, name: '合成更新时间记录', scope: 'bot', status: 'applied', revision: 1}],
  total: 1, offset: 0, limit: 20, nextOffset: null,
  memory: {acceptedCount: 1, candidateCount: 0, readCount: null, searchCount: null},
  skills: {installedCount: 1, inventoryComplete: true, modelUseCount: null, userUseCount: null, fileReadCount: null},
  cache: {updatedAt, stale: false, refreshing: false},
  usageCoverage: {status: 'partial', sessionsDiscovered: 30, sessionsRead: 26},
});
async function open(page: Page) {
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
}
async function expectPosition(page: Page) {
  const timestamp = page.locator('.evolution-list-updated');
  const refresh = page.getByRole('button', {name: '刷新记录', exact: true});
  const [stamp, button] = await Promise.all([timestamp.boundingBox(), refresh.boundingBox()]);
  expect(stamp!.x + stamp!.width).toBeLessThanOrEqual(button!.x);
  expect(Math.abs(stamp!.y + stamp!.height / 2 - button!.y - button!.height / 2)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.evolution-list-body > .evolution-list-updated')).toHaveCount(0);
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`更新时间紧邻刷新左侧且保持次要文字色：${theme} ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 960});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.route('**/api/evolution?*', route => route.fulfill({json: snapshot(new URL(route.request().url()).searchParams.get('kind')!)}));
    await open(page);
    await page.evaluate(theme => {document.documentElement.dataset.theme = theme;}, theme);
    const timestamp = page.locator('.evolution-list-actions [role="status"]');
    await expect(timestamp).toHaveText('最近更新 11/11 23:05 · 已统计 26 个会话');
    await expectPosition(page);
    expect(await timestamp.evaluate(el => getComputedStyle(el).color)).toBe(await page.locator('.evolution-metrics dt').first().evaluate(el => getComputedStyle(el).color));
    const skillTab = page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link', {name: 'Skills', exact: true});
    await skillTab.focus(); await page.keyboard.press('Enter');
    await expect(timestamp).toHaveText('最近更新 11/11 23:05 · 已统计 26 个会话');
    await expect(skillTab).toBeFocused();
    await expectPosition(page);
    expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
    await page.locator('.evolution-library').screenshot({path: test.info().outputPath(`update-toolbar-${theme}-${width}.png`)});
  });
}

test('分类切换等待期间保留同一快照时间和窄屏工具栏高度', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/evolution?*', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind')!;
    if (kind === 'skill') await gate;
    await route.fulfill({json: snapshot(kind)}).catch(() => {});
  });
  try {
    await page.setViewportSize({width: 390, height: 960});
    await open(page);
    await expect(page.locator('.evolution-list-updated')).toHaveText('最近更新 11/11 23:05 · 已统计 26 个会话');
    const toolbar = page.locator('.evolution-list-toolbar'), bounds = await toolbar.boundingBox();
    await page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link', {name: 'Skills', exact: true}).click();
    await expect(page.getByText('正在读取自进化记录…')).toBeVisible();
    await expect(page.locator('.evolution-list-updated')).toHaveText('最近更新 11/11 23:05 · 已统计 26 个会话');
    expect(await toolbar.boundingBox()).toEqual(bounds);
    release();
    await expect(page.locator('#evolution-list-body')).toHaveAttribute('aria-busy', 'false');
    expect(await toolbar.boundingBox()).toEqual(bounds);
  } finally {release();}
});

test('旧快照保留警告语义，刷新中按钮与时间稳定，失败及撤权仍按真实状态处理', async ({page}) => {
  let stale = true, refreshing = true, status = 200, hold = false, started = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/evolution?*', async route => {
    if (hold) {started = true; await gate;}
    await route.fulfill({status, json: status === 200 ? {...snapshot(), cache: {updatedAt, stale, refreshing}} : {error: 'EVOLUTION_UNAVAILABLE'}}).catch(() => {});
  });
  try {
    await page.setViewportSize({width: 390, height: 960});
    await open(page);
    const timestamp = page.locator('.evolution-list-updated');
    const refresh = page.getByRole('button', {name: '刷新记录', exact: true});
    await expect(timestamp).toHaveText('旧快照 · 11/11 23:05 · 统计更新中 · 已统计 26 个会话');
    await expect(timestamp).toHaveAttribute('data-stale', 'true');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {document.documentElement.dataset.theme = theme;}, theme);
      await expectPosition(page);
      expect(await timestamp.evaluate(el => getComputedStyle(el).color)).not.toBe(await page.locator('.evolution-metrics dt').first().evaluate(el => getComputedStyle(el).color));
      expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
    }
    refreshing = false;
    await refresh.click();
    await expect(timestamp).toContainText('统计刷新失败');
    const bounds = await refresh.boundingBox();
    hold = true;
    await refresh.focus(); await page.keyboard.press('Enter');
    await expect.poll(() => started).toBe(true);
    await expect(refresh).toBeDisabled();
    await expect(timestamp).toContainText('统计刷新失败');
    expect(await refresh.boundingBox()).toEqual(bounds);
    hold = false; stale = false; release();
    await expect(timestamp).toHaveText('最近更新 11/11 23:05 · 已统计 26 个会话');
    await expect(timestamp).not.toHaveAttribute('data-stale');
    status = 503;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('当前显示上次获取的数据');
    await expect(timestamp).toBeVisible();
    status = 403;
    await refresh.click();
    await expect(page.getByRole('heading', {name: '无权查看自进化记录'})).toBeVisible();
    await expect(timestamp).toHaveCount(0);
  } finally {release();}
});

test('没有快照时间不伪造时间，空列表及无效时间仍可刷新', async ({page}) => {
  let withCache = false;
  await page.route('**/api/evolution?*', route => route.fulfill({json: {...snapshot(), items: [], total: 0, usageCoverage: undefined, cache: withCache ? {updatedAt: 'invalid', stale: false, refreshing: false} : undefined}}));
  await open(page);
  await expect(page.getByRole('heading', {name: '暂无自进化记录'})).toBeVisible();
  await expect(page.locator('.evolution-list-updated')).toHaveCount(0);
  withCache = true;
  await page.getByRole('button', {name: '刷新记录', exact: true}).click();
  await expect(page.locator('.evolution-list-updated')).toHaveText('最近更新 未记录 · 统计会话数未记录');
  await expectPosition(page);
});

test('统计范围只显示已读取会话数，刷新同步更新零值并保留实际盘点警告', async ({page}) => {
  let sessionsRead = 26;
  await page.route('**/api/evolution?*', route => route.fulfill({json: {
    ...snapshot(new URL(route.request().url()).searchParams.get('kind')!),
    usageCoverage: {status: 'partial', sessionsDiscovered: 30, sessionsRead},
    skills: {...snapshot().skills, inventoryComplete: false, inventoryIssues: ['部分资源不可读']},
  }}));
  await open(page);
  const status = page.locator('.evolution-list-updated');
  await expect(status).toContainText('已统计 26 个会话');
  await expect(status).not.toContainText('30');
  await expect(page.getByText('记录不完整', {exact: true})).toHaveCount(0);
  sessionsRead = 0;
  await page.getByRole('button', {name: '刷新记录', exact: true}).click();
  await expect(status).toContainText('已统计 0 个会话');
  await page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link', {name: 'Skills', exact: true}).click();
  await expect(page.locator('.evolution-list-notice')).toHaveText('技能盘点不完整：部分资源不可读');
  await expect(status).toContainText('已统计 0 个会话');
});
