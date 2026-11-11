import {test, expect, type Page} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

const snapshot = (kind = 'memory') => ({
  status: 'ready', coverage: 'bot-shared-current-state',
  memory: {acceptedCount: 1, candidateCount: 0, readCount: null, searchCount: null},
  skills: {activeCount: 0, candidateCount: 0, installedCount: 1, inventoryComplete: true},
  items: [{id: `timeout-${kind}`, kind, name: `${kind}-deadline-result`, scope: 'bot', status: 'applied', revision: 1}],
  total: 1, offset: 0, limit: 20, nextOffset: null, revision: 'timeout-fixture',
  cache: {updatedAt: '2026-11-11T00:00:00Z', stale: false, refreshing: false},
});
async function login(page: Page) {
  await page.goto('/#/chat');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible();
}
async function pauseClock(page: Page) {
  await page.clock.install({time: new Date('2026-11-11T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-11T01:00:00Z'));
}

for (const mode of ['initial', 'manual'] as const) {
  test(`${mode} snapshot survives the native 20-second browser deadline without duplicate reads`, async ({page}) => {
    test.setTimeout(45000);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const requests: (string | null)[] = [];
    await page.route('**/api/evolution?*', async route => {
      const refresh = new URL(route.request().url()).searchParams.get('refresh');
      requests.push(refresh);
      if (mode === 'initial' || refresh) await gate;
      await route.fulfill({json: snapshot()}).catch(() => {});
    });
    try {
      await login(page);
      await page.goto('/#/evolution');
      if (mode === 'manual') {
        await expect(page.locator('.evolution-table')).toContainText('memory-deadline-result');
        await page.getByRole('button', {name: '刷新记录', exact: true}).click();
      }
      await expect.poll(() => requests.length).toBe(mode === 'initial' ? 1 : 2);
      // No page.clock shim: this regression must cross the real native deadline.
      await new Promise(resolve => setTimeout(resolve, 21000));
      await expect(page.locator('#evolution-list-body')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(requests).toEqual(mode === 'initial' ? [null] : [null, '1']);
      release();
      await expect(page.locator('.evolution-table')).toContainText('memory-deadline-result');
      await expect(page.locator('#evolution-list-body')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('alert')).toHaveCount(0);
    } finally {release();}
  });
}

test('a stalled snapshot ends at 120 seconds and an explicit retry can recover', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const requests: (string | null)[] = [];
  await page.route('**/api/evolution?*', async route => {
    requests.push(new URL(route.request().url()).searchParams.get('refresh'));
    if (requests.length === 1) await gate;
    await route.fulfill({json: snapshot()}).catch(() => {});
  });
  try {
    await login(page);
    await pauseClock(page);
    await page.goto('/#/evolution');
    await expect.poll(() => requests).toEqual([null]);
    await page.clock.fastForward(119999);
    await expect(page.getByText('正在读取自进化记录…')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.clock.fastForward(1);
    await expect(page.getByRole('alert')).toContainText('连接超时');
    await expect(page.locator('#evolution-list-body')).toHaveAttribute('aria-busy', 'false');
    await page.clock.fastForward(30000);
    expect(requests).toEqual([null]);
    await page.getByRole('button', {name: '重新获取', exact: true}).click();
    await expect(page.locator('.evolution-table')).toContainText('memory-deadline-result');
    expect(requests).toEqual([null, '1']);
    release();
    await page.clock.runFor(50);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {release();}
});

test('changing category and leaving still abort slow snapshot reads before their longer deadline', async ({page}) => {
  await page.addInitScript(() => {
    const tracked = window as typeof window & {snapshotSignals: AbortSignal[]};
    tracked.snapshotSignals = [];
    const fetch = window.fetch;
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/evolution?') && init?.signal) tracked.snapshotSignals.push(init.signal);
      return fetch(input, init);
    };
  });
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/evolution?*', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind')!;
    requests.push(kind);
    await gate;
    await route.fulfill({json: snapshot(kind)}).catch(() => {});
  });
  const aborted = () => page.evaluate(() => (window as typeof window & {snapshotSignals: AbortSignal[]}).snapshotSignals.map(signal => signal.aborted));
  try {
    await login(page);
    await pauseClock(page);
    await page.goto('/#/evolution');
    await expect.poll(() => requests).toEqual(['memory']);
    await page.clock.fastForward(30000);
    expect(await aborted()).toEqual([false]);
    await page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link', {name: 'Skills', exact: true}).click();
    await expect.poll(() => requests).toEqual(['memory', 'skill']);
    expect(await aborted()).toEqual([true, false]);
    await page.goto('/#/chat');
    await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible();
    expect(await aborted()).toEqual([true, true]);
    release();
    await page.clock.runFor(50);
    await page.clock.fastForward(900000);
    expect(requests).toEqual(['memory', 'skill']);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.evolution-table')).toHaveCount(0);
  } finally {release();}
});
