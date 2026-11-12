import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

const snapshot = {
  status: 'ready', coverage: 'bot-shared-current-state',
  memory: { acceptedCount: 1, candidateCount: 0, readCount: null, searchCount: null },
  skills: { activeCount: 0, candidateCount: 0, installedCount: 1, inventoryComplete: true, modelUseCount: null, userUseCount: null, fileReadCount: null },
  total: 1, offset: 0, limit: 20, nextOffset: null, revision: 'initial-load-fixture',
  cache: { updatedAt: '2026-11-11T00:00:00Z', stale: false, refreshing: false },
};
const ready = (kind = 'memory') => ({ ...snapshot, items: [{
  id: `initial-${kind}`, kind, name: kind === 'skill' ? 'fresh-skill' : '首次读取/最新记忆',
  scope: 'bot', status: 'applied', revision: 1, updatedAt: '2026-11-11T00:00:00Z',
}] });
async function login(page: Page) {
  await page.goto('/#/chat');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await expect(page.getByLabel('消息内容', { exact: true })).toBeVisible();
  // Freeze at a deterministic future instant, not a wall clock that can lag behind
  // the simulated clock between commands on a slower runner.
  await page.clock.install({time: new Date('2026-11-11T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-11T01:00:00Z'));
}
async function responseAfter(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/evolution');
  await action();
  await (await response).finished();
  // Let fetch/React process the response before advancing the next retry delay.
  await page.clock.runFor(50);
}
async function loadingWithoutError(page: Page) {
  await expect(page.getByText('正在读取自进化记录…')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('首次进入等待服务端快照，响应前持续加载且不重复查询', async ({ page }) => {
  let requests = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/evolution?*', async route => {
    requests++;
    await gate;
    await route.fulfill({ json: ready() });
  });
  try {
    await login(page);
    await page.goto('/#/evolution');
    await expect.poll(() => requests).toBe(1);
    await loadingWithoutError(page);
    await page.clock.fastForward(30000);
    await loadingWithoutError(page);
    expect(requests).toBe(1);
    await responseAfter(page, async () => { release(); });
    await expect(page.locator('.evolution-table')).toContainText('首次读取/最新记忆');
    await expect(page.locator('.evolution-list-actions [role="status"]')).toContainText('最近更新');
  } finally { release(); }
});

test('每五分钟读取缓存，手动刷新仅本次携带强制刷新参数', async ({ page }) => {
  const forced: (string | null)[] = [];
  await page.route('**/api/evolution?*', route => {
    forced.push(new URL(route.request().url()).searchParams.get('refresh'));
    return route.fulfill({ json: ready() });
  });
  await login(page);
  await responseAfter(page, () => page.goto('/#/evolution'));
  await page.clock.fastForward(299000);
  expect(forced).toEqual([null]);
  await responseAfter(page, () => page.clock.fastForward(1000));
  expect(forced).toEqual([null, null]);
  await responseAfter(page, () => page.getByRole('button', { name: '刷新记录', exact: true }).click());
  expect(forced).toEqual([null, null, '1']);
  await responseAfter(page, () => page.clock.fastForward(300000));
  expect(forced).toEqual([null, null, '1', null]);
});

test('服务端更新失败后保留上次成功快照并明确显示时间和过期状态', async ({ page }) => {
  await page.route('**/api/evolution?*', route => route.fulfill({ json: {
    ...ready(), cache: { updatedAt: '2026-11-11T00:00:00Z', stale: true, refreshing: false, error: 'EVOLUTION_BUSY' },
  } }));
  await login(page);
  await responseAfter(page, () => page.goto('/#/evolution'));
  await expect(page.locator('.evolution-table')).toContainText('首次读取/最新记忆');
  const notice = page.locator('.evolution-list-actions [role="status"]');
  await expect(notice).toContainText('旧快照');
  // Fixture is 08:00 in the configured Asia/Shanghai browser timezone.
  await expect(notice).toContainText('08:00');
  await expect(notice).toContainText('统计刷新失败');
  await expect(page.getByRole('button', { name: '刷新记录', exact: true })).toBeEnabled();
});

test('服务端重试耗尽的忙碌响应不会触发浏览器短周期重复重试', async ({ page }) => {
  let requests = 0, busy = true;
  const forced: (string | null)[] = [];
  await page.route('**/api/evolution?*', route => {
    requests++;
    forced.push(new URL(route.request().url()).searchParams.get('refresh'));
    return busy ? route.fulfill({ status: 503, json: { error: 'EVOLUTION_BUSY' } }) : route.fulfill({ json: ready() });
  });
  await login(page);
  await responseAfter(page, () => page.goto('/#/evolution'));
  await expect(page.getByRole('heading', { name: '自进化记录正在更新', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('自进化记录正在更新，请稍后重新获取。');
  await page.clock.fastForward(30000);
  expect(requests).toBe(1);
  busy = false;
  await responseAfter(page, () => page.getByRole('button', { name: '重新获取', exact: true }).click());
  await expect(page.locator('.evolution-table')).toContainText('首次读取/最新记忆');
  expect(forced).toEqual([null, '1']);
});

test('权限撤销立即隐藏缓存列表、指标和更新时间', async ({ page }) => {
  let forbidden = false;
  await page.route('**/api/evolution?*', route => forbidden
    ? route.fulfill({ status: 403, json: { error: 'FORBIDDEN' } })
    : route.fulfill({ json: ready() }));
  await login(page);
  await responseAfter(page, () => page.goto('/#/evolution'));
  await expect(page.locator('.evolution-table')).toContainText('首次读取/最新记忆');
  forbidden = true;
  await responseAfter(page, () => page.getByRole('button', { name: '刷新记录', exact: true }).click());
  await expect(page.getByRole('heading', { name: '无权查看自进化记录', exact: true })).toBeVisible();
  await expect(page.locator('.evolution-table')).toHaveCount(0);
  await expect(page.locator('.evolution-card')).toHaveCount(0);
  await expect(page.getByText(/每\s*5\s*分钟更新/)).toHaveCount(0);
});

test('切换类型取消旧轮询，离开页面取消所有自进化轮询', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/evolution?*', route => {
    const kind = new URL(route.request().url()).searchParams.get('kind')!;
    requests.push(kind);
    return route.fulfill({ json: ready(kind) });
  });
  await login(page);
  await responseAfter(page, () => page.goto('/#/evolution'));
  await responseAfter(page, () => page.getByRole('navigation', { name: '自进化记录类型' }).getByRole('link', { name: 'Skills', exact: true }).click());
  await responseAfter(page, () => page.clock.fastForward(300000));
  expect(requests).toEqual(['memory', 'skill', 'skill']);
  await expect(page.locator('.evolution-table')).toContainText('fresh-skill');
  await page.goto('/#/chat');
  await expect(page.getByLabel('消息内容', { exact: true })).toBeVisible();
  await page.clock.fastForward(900000);
  expect(requests).toEqual(['memory', 'skill', 'skill']);
});

test('切换类型后迟到的旧响应不会覆盖新列表', async ({ page }) => {
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/evolution?*', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind')!;
    requests.push(kind);
    if (kind === 'memory') {
      await gate;
      await route.fulfill({ json: ready() }).catch(() => {});
    } else await route.fulfill({ json: ready('skill') });
  });
  try {
    await login(page);
    await page.goto('/#/evolution');
    await expect.poll(() => requests).toEqual(['memory']);
    await loadingWithoutError(page);
    await responseAfter(page, () => page.getByRole('navigation', { name: '自进化记录类型' }).getByRole('link', { name: 'Skills', exact: true }).click());
    await expect(page.locator('.evolution-table')).toContainText('fresh-skill');
    release();
    await page.clock.runFor(50);
    await page.clock.fastForward(30000);
    expect(requests).toEqual(['memory', 'skill']);
    await expect(page.locator('.evolution-table')).toContainText('fresh-skill');
    await expect(page.locator('.evolution-table')).not.toContainText('首次读取/最新记忆');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});
