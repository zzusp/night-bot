import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_TOKEN } from './preview.mjs';

// UI-only synthetic values; production-source accuracy is covered by
// server.test.js, pi-evolution.test.js and the real Host reflection tests.
const snapshot = {
  status: 'ready', coverage: 'bot-shared-current-state',
  memory: { acceptedCount: 21, candidateCount: 1, readCount: 7, searchCount: 2, lastUsedAt: '2026-11-09T03:00:00Z', trackingSince: '2026-11-08T03:00:00Z' },
  skills: { activeCount: 1, candidateCount: 0, loadCount: 3, lastUsedAt: '2026-11-09T03:00:00Z', trackingSince: '2026-11-08T03:00:00Z', coverage: 'bot-installed-and-learned', installedCount:2,installedAvailableCount:2,modelUseCount:2,userUseCount:1,fileReadCount:4,callTrackingSince:'2026-11-09T00:00:00Z',inventoryComplete:true },
  items: Array.from({ length: 23 }, (_, index) => ({ id: `fixture-${index}`, name: index === 22 ? 'learned-验收技能' : `工作偏好/验收记忆-${index + 1}`, kind: index === 22 ? 'skill' : 'memory', scope: 'bot', status: index === 21 ? 'candidate' : 'applied', revision: 2, updatedAt: '2026-11-09T02:00:00Z' })),
  total: 23, offset: 0, limit: 20, nextOffset: 20, revision: 'fixture-v1',
};
async function login(page: Page) {
  await page.goto('/#/chat');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await expect(page.getByLabel('消息内容', { exact: true })).toBeVisible();
}
async function mockSnapshot(page: Page) {
  await page.route('**/api/evolution?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const kind = params.get('kind'), offset = Number(params.get('offset'));
    const items = snapshot.items.filter(item => kind === 'all' || item.kind === kind);
    await route.fulfill({ json: { ...snapshot, items: items.slice(offset, offset + 20), total: items.length, offset, nextOffset: offset + 20 < items.length ? offset + 20 : null } });
  });
}

test('自进化菜单、真实语义、筛选分页和返回保留 URL', async ({ page }) => {
  await mockSnapshot(page); await login(page);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '自进化', exact: true }).click();
  await expect(page).toHaveTitle('自进化 — Night Bot');
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(20);
  await expect(page.locator('.evolution-card')).toHaveCount(2);
  await expect(page.locator('.evolution-card h2')).toHaveText(['记忆', 'Skills']);
  await expect(page.locator('.evolution-card dt')).toHaveText(['已应用', '候选', '读取次数', '搜索次数', '目录技能', '模型 Skill 调用', '用户显式引用', '技能文件读取']);
  await expect(page.locator('.evolution-card dd')).toHaveText(['21', '1', '7', '2', '2', '2', '1', '4']);
  await expect(page.locator('.evolution-card p, .evolution-coverage')).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link')).toHaveText(['记忆', 'Skills']);
  await expect(page.locator('.evolution-table th')).toHaveText(['名称', '使用次数', '最近使用', '最近更新']);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.evolution-table')).not.toContainText('候选，未应用');
  await page.getByRole('navigation', { name: '自进化记录类型' }).getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/kind=memory&offset=20/);
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(2);
});

test('自进化首次加载、失败重试、过期快照、权限撤销与空状态', async ({ page }) => {
  let state = 'loading';
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/evolution?*', async route => {
    if (state === 'loading') await gate;
    if (state === 'failure' || state === 'forbidden') return route.fulfill({ status: state === 'forbidden' ? 403 : 503, json: { error: 'EVOLUTION_UNAVAILABLE' } });
    return route.fulfill({ json: state === 'empty' ? { ...snapshot, items: [], total: 0, nextOffset: null, memory: { ...snapshot.memory, acceptedCount: 0, candidateCount: 0, readCount: null, searchCount: null, trackingSince: null }, skills: { ...snapshot.skills, activeCount: 0, loadCount: null, trackingSince: null } } : { ...snapshot, items: snapshot.items.slice(0, 20) } });
  });
  try {
    await login(page); await page.goto('/#/evolution');
    await expect(page.getByText('正在读取自进化记录…')).toBeVisible();
    await expect(page.locator('.evolution-metrics')).toHaveCount(0);
    state = 'failure'; release();
    await expect(page.getByRole('heading', { name: '自进化记录暂不可读' })).toBeVisible();
    state = 'ready'; await page.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(page.locator('.evolution-table tbody tr')).toHaveCount(20);
    state = 'failure'; await page.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('当前显示上次获取的数据');
    await expect(page.locator('.evolution-table tbody tr')).toHaveCount(20);
    await expect(page.locator('.evolution-card')).toHaveCount(2);
    state = 'forbidden'; await page.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(page.getByRole('heading', { name: '无权查看自进化记录' })).toBeVisible();
    await expect(page.locator('.evolution-card')).toHaveCount(0);
    state = 'empty'; await page.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(page.getByRole('heading', { name: '暂无自进化记录' })).toBeVisible();
    await expect(page.locator('.evolution-card dd').first()).toHaveText('0');
    await expect(page.locator('.evolution-card dd').nth(2)).toHaveText('未记录');
    await expect(page.getByRole('navigation', {name: '自进化记录类型'})).toBeVisible();
  } finally { release(); }
});

test('自进化浅深色、键盘与窗口反复缩放无页面横向溢出', async ({ page }) => {
  await mockSnapshot(page); await login(page); await page.goto('/#/evolution');
  await expect(page.locator('.evolution-table tbody tr')).toHaveCount(20);
  for (const width of [1440, 1100, 768, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const panel = await page.locator('.main-panel').boundingBox();
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`evolution-${width}.png`), animations: 'disabled' });
  }
  const all = page.getByRole('navigation', { name: '自进化记录类型' }).getByRole('link', { name: '记忆', exact: true });
  await all.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/kind=memory/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '切换深色外观', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导航', exact: true }).getByRole('link', { name: '自进化', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeFocused();
});
