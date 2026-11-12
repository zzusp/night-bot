import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const active = {id: 'schedule-active', title: '监督云端全栈开发', state: 'active', kind: 'every', scheduledAt: '2026-11-12T08:00:00.000Z', scheduleSummary: '每 10 分钟'};
const inactive = {...active, id: 'schedule-inactive', title: '汇报 Night Bot 进度', state: 'inactive'};
const snapshot = (items: object[], offset = 0, total = items.length, nextOffset: number | null = null) => ({items, offset, total, limit: 20, nextOffset});
async function open(page: Page, path = '/schedules') {
  await page.goto('/#' + path);
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
}

test('定时任务导航与两行真实列表，只显示启用和停用分类，不提供写操作', async ({page}) => {
  const writes: string[] = [];
  page.on('request', request => {if (request.url().includes('/api/schedules') && request.method() !== 'GET') writes.push(request.method());});
  await page.route('**/api/schedules?*', route => {
    const state = new URL(route.request().url()).searchParams.get('state');
    expect(['active', 'inactive']).toContain(state);
    return route.fulfill({json: snapshot([state === 'inactive' ? inactive : active])});
  });
  await open(page);
  await expect(page.getByRole('navigation', {name: '主导航'}).getByRole('link', {name: '定时任务', exact: true})).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/定时任务 — /);
  const tabs = page.getByRole('navigation', {name: '定时任务状态'});
  await expect(tabs.getByRole('link')).toHaveText(['启用', '停用']);
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  await expect(page.locator('.schedule-meta')).toContainText('启用 ·');
  await expect(page.locator('.schedule-meta')).toContainText('每 10 分钟');
  await expect(page.locator('.schedule-row :is(button, a)')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /暂停|恢复|删除|编辑|创建/})).toHaveCount(0);
  const tab = tabs.getByRole('link', {name: '停用', exact: true});
  await tab.focus(); await page.keyboard.press('Enter');
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.schedule-title')).toHaveText(inactive.title);
  await expect(page.locator('.schedule-meta')).toContainText('停用 ·');
  await page.goBack(); await expect(page.locator('.schedule-title')).toHaveText(active.title);
  await page.goForward(); await expect(page.locator('.schedule-title')).toHaveText(inactive.title);
  await page.reload(); await expect(page.locator('.schedule-title')).toHaveText(inactive.title);
  expect(writes).toEqual([]);
});

test('列表分页保持 URL，分类切换回第一页，数据缩小时回到有效页', async ({page}) => {
  let shrink = false;
  await page.route('**/api/schedules?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const requested = Number(params.get('offset'));
    if (params.get('state') === 'inactive') return route.fulfill({json: snapshot([])});
    const offset = shrink ? 0 : requested;
    return route.fulfill({json: snapshot([{...active, title: offset ? '第二页定时任务' : active.title}], offset, shrink ? 1 : 21, offset || shrink ? null : 20)});
  });
  await open(page);
  await page.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page).toHaveURL(/state=active&offset=20/);
  await expect(page.locator('.schedule-title')).toHaveText('第二页定时任务');
  await page.reload(); await expect(page.locator('.schedule-title')).toHaveText('第二页定时任务');
  shrink = true;
  await page.getByRole('button', {name: '刷新任务', exact: true}).click();
  await expect(page).toHaveURL(/state=active&offset=0/);
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  await page.getByRole('navigation', {name: '定时任务状态'}).getByRole('link', {name: '停用', exact: true}).click();
  await expect(page).toHaveURL(/state=inactive$/);
  await expect(page.getByRole('heading', {name: '暂无停用的定时任务'})).toBeVisible();
});

test('首次读取失败不显示空结果，刷新失败保留旧快照，撤权及重试隐藏旧记录', async ({page}) => {
  let status = 503, hold = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/schedules?*', async route => {
    if (hold) await gate;
    await route.fulfill({status, json: status === 200 ? snapshot([active]) : {error: 'SCHEDULES_UNAVAILABLE'}}).catch(() => {});
  });
  await open(page);
  await expect(page.getByRole('heading', {name: '定时任务暂不可读'})).toBeVisible();
  await expect(page.getByText('暂无启用的定时任务')).toHaveCount(0);
  status = 200;
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  status = 503;
  await page.getByRole('button', {name: '刷新任务', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('当前显示上次获取的数据');
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  status = 403;
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.schedule-title')).toHaveCount(0);
  status = 200; hold = true;
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.getByText('正在读取定时任务…')).toBeVisible();
  await expect(page.locator('.schedule-title')).toHaveCount(0);
  release();
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
});

test('切换分类取消迟到读取，不在新分类闪回上一分类', async ({page}) => {
  let release!: () => void, requested = false;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/schedules?*', async route => {
    const state = new URL(route.request().url()).searchParams.get('state');
    if (state === 'inactive') {requested = true; await gate;}
    await route.fulfill({json: snapshot([state === 'inactive' ? inactive : active])}).catch(() => {});
  });
  await open(page);
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  const tabs = page.getByRole('navigation', {name: '定时任务状态'});
  await tabs.getByRole('link', {name: '停用', exact: true}).click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText('正在读取定时任务…')).toBeVisible();
  await expect(page.locator('.schedule-title')).toHaveCount(0);
  await tabs.getByRole('link', {name: '启用', exact: true}).click();
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
  release();
  await expect(page.locator('.schedule-title')).toHaveText(active.title);
});

test('长标题与规则在桌面和390px浅深色可读，无横向溢出且通过 axe', async ({page}) => {
  await page.route('**/api/schedules?*', route => route.fulfill({json: snapshot([
    active,
    {...active, id: 'long', title: '核对长任务标题与中文内容的完整展示'.repeat(6), scheduleSummary: '每周一、三、五 09:00（Asia/Shanghai）'},
    {...active, id: 'once', kind: 'at', title: '一次性提醒', scheduledAt: '2032-11-12T08:00:00.000Z', scheduleSummary: '单次'},
    {...active, id: 'cron', title: 'Cron 定时任务', scheduleSummary: 'Cron 0 9 * * 1-5（Asia/Shanghai）'},
  ])}));
  await open(page);
  await expect(page.locator('.schedule-row')).toHaveCount(4);
  await expect(page.locator('.schedule-meta time')).toContainText('2032');
  await expect(page.locator('.schedule-meta time')).toContainText('GMT+8');
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 900});
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.schedule-title').nth(1).evaluate(el => el.scrollHeight === el.clientHeight)).toBe(true);
    expect((await new AxeBuilder({page}).include('.schedules-page').analyze()).violations).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`schedules-${theme}-${width}.png`), fullPage: true});
  }
  await page.getByRole('button', {name: '打开导航', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '导航'}).getByRole('link', {name: '定时任务', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: '打开导航', exact: true})).toBeFocused();
});

for (const state of ['populated', 'empty', 'loading', 'unavailable'] as const) {
  test(`定时任务 ${state} 保留与任务列表一致的外框`, async ({page}) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    await page.route('**/api/schedules?*', async route => {
      if (state === 'loading') await gate;
      await route.fulfill({status: state === 'unavailable' ? 503 : 200,
        json: state === 'unavailable' ? {error: 'SCHEDULES_UNAVAILABLE'} : snapshot(state === 'populated' ? [active] : []),
      }).catch(() => {});
    });
    try {
      await open(page, '/tasks');
      const sibling = page.locator('.task-table-wrap');
      await expect(sibling).toBeVisible();
      const surfaces: Record<string, {border: string; radius: string; background: string}> = {};
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        surfaces[theme] = await sibling.evaluate(element => {
          const style = getComputedStyle(element);
          return {border: style.borderTopColor, radius: style.borderTopLeftRadius, background: style.backgroundColor};
        });
      }
      await page.getByRole('navigation', {name: '主导航'}).getByRole('link', {name: '定时任务', exact: true}).click();
      const frame = page.getByRole('region', {name: '启用的定时任务', exact: true});
      if (state === 'populated') await expect(frame.locator('.schedule-title')).toHaveText(active.title);
      if (state === 'empty') await expect(frame.getByRole('heading', {name: '暂无启用的定时任务'})).toBeVisible();
      if (state === 'loading') await expect(frame.getByText('正在读取定时任务…')).toBeVisible();
      if (state === 'unavailable') await expect(frame.getByRole('heading', {name: '定时任务暂不可读'})).toBeVisible();
      for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({width, height: 900});
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await expect(frame).toHaveCSS('border-top-style', 'solid');
        await expect(frame).toHaveCSS('border-top-width', '1px');
        await expect(frame).toHaveCSS('border-top-color', surfaces[theme].border);
        await expect(frame).toHaveCSS('border-top-left-radius', surfaces[theme].radius);
        await expect(frame).toHaveCSS('background-color', surfaces[theme].background);
        await expect(frame).toHaveCSS('min-height', '168px');
        if (state === 'loading') await expect(frame.getByText('正在读取定时任务…')).toBeVisible();
        const box = await frame.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(frame.locator('.list-toolbar, .pagination')).toHaveCount(0);
        await page.screenshot({path: test.info().outputPath(`schedule-frame-${state}-${theme}-${width}.png`), fullPage: true});
      }
    } finally {release();}
  });
}
