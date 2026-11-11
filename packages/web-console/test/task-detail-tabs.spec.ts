import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const source = {taskId: 'task-research', reviewId: 'review-1', eventId: 'event-1'};
const bodyText = '完整授权正文。\n\n' + '每个结论保留原始证据。'.repeat(40);
const deliveryText = '资料核对已完成，发现两项待确认问题。\n\n' + '长交付正文仍可完整阅读。'.repeat(80) + '\n\n[检查原始记录](https://example.com/result)';
const learning = {status: 'ready', reviews: [
  {...source, status: 'done', summary: '核对引用时应同时保留来源与版本，避免把过期记录当作当前结论。', at: '2026-11-10T09:00:00Z'},
  {...source, reviewId: 'review-2', status: 'failed', summary: '来源记录不完整，复盘未完成。', at: '2026-11-10T10:00:00Z'},
], changes: [
  {...source, id: 'memory-1', name: '资料核对时保留来源与版本', kind: 'memory', status: 'applied', action: 'upsert', scope: 'bot', version: 3, canRead: true, source},
  {...source, id: 'skill-1', name: '交叉核对步骤', kind: 'skill', status: 'candidate', action: 'current-version', scope: 'bot', version: 1, canRead: false, source},
]};
const section = (page: Page, name: string) => page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name, exact: true});
async function login(page: Page) {
  await page.goto('/#/tasks/task-research?view=execution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.locator('.task-record-facts')).toBeVisible();
}
async function reconnect(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event('online'))); }

test('三个信息栏以记录为主，移除常驻刷新，交付与授权正文按需展开，浅深窄屏可读', async ({page}) => {
  let bodyReads = 0;
  await page.route('**/api/tasks/task-research', async route => {
    const data = await (await route.fetch()).json();
    return route.fulfill({json: {...data, session: {...data.session, status: 'idle'}, controlState: 'active', notifications: [
      {id: 'delivery-1', state: 'delivered', createdAt: '2026-11-10T08:00:00Z', text: deliveryText},
      {id: 'delivery-2', state: 'unknown', text: '附件发送结果待核实。'},
    ]}});
  });
  await page.route('**/api/tasks/task-research/learning', route => route.fulfill({json: learning}));
  await page.route('**/api/tasks/task-research/learning/changes/**', route => {bodyReads++; return route.fulfill({json: {id: 'memory-1', kind: 'memory', version: 3, text: bodyText, source, redacted: true, truncated: true}});});
  await login(page);
  const rail = page.locator('.task-info-rail');
  const delivery = page.locator('.task-delivery').first();
  await expect(rail.getByRole('button')).toHaveCount(0);
  await expect(rail).not.toContainText(/当前执行上下文|获取于|刷新|获取最新/);
  await expect(page.locator('.task-execution-states')).toContainText('空闲');
  await expect(page.locator('.task-execution-states')).toContainText('进行中');
  await expect(delivery).not.toHaveAttribute('open');
  await expect(delivery.locator('.task-delivery-body')).not.toBeVisible();
  expect((await delivery.boundingBox())!.height).toBeLessThan(160);
  await delivery.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(delivery).toHaveAttribute('open');
  await expect(delivery.locator('.task-delivery-body')).toContainText('长交付正文仍可完整阅读。'.repeat(80));
  await expect(delivery.getByRole('link', {name: '检查原始记录'})).toHaveAttribute('href', 'https://example.com/result');
  await reconnect(page); await expect(delivery).toHaveAttribute('open');
  await delivery.locator('summary').press('Space');
  await expect(delivery).not.toHaveAttribute('open');
  await section(page, '复盘').click();
  await expect(page.locator('.learning-review')).toHaveCount(2);
  await expect(page.locator('.learning-review').first()).toContainText('核对引用时应同时保留来源与版本');
  await expect(rail.getByRole('button')).toHaveCount(0);
  await section(page, '学习').click();
  await expect(page.locator('.learning-change')).toHaveCount(2);
  expect(bodyReads).toBe(0);
  await expect(page.locator('.learning-change').last().getByRole('button')).toHaveCount(0);
  await expect(page.locator('.learning-change').last()).toContainText('候选，未应用');
  await expect(page.locator('.learning-change').last()).toContainText('正文未授权');
  const read = page.getByRole('button', {name: /^读取授权正文/});
  await read.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.learning-body')).toContainText(bodyText.replace(/\n\n/g, ''));
  await expect(page.locator('.learning-body')).toContainText('路径及敏感凭据已隐藏');
  await expect(page.locator('.learning-body')).toContainText('当前接口仅返回部分正文');
  expect(bodyReads).toBe(1);
  await page.getByRole('button', {name: /^收起正文/}).click();
  await expect(page.locator('.learning-body')).toHaveCount(0);
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const theme of ['light', 'dark']) for (const width of [1440, 1100, 800, 390]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({width, height: 960});
    for (const tab of ['执行', '复盘', '学习']) {
      await section(page, tab).click();
      await expect(rail).not.toContainText(/刷新复盘记录|获取最新记录/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.task-info-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (width === 1440 || width === 390) {
        expect((await new AxeBuilder({page}).include('.task-info-rail').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await rail.screenshot({path: test.info().outputPath(`${tab}-${theme}-${width}.png`)});
      }
    }
  }
});

test('学习自动更新与异常重试保留，正文撤权后不闪回，版本变化重新读取', async ({page}) => {
  let mode = 'ready', bodyMode = 'ready', version = 3;
  await page.route('**/api/tasks/task-research/learning', async route => {
    if (mode === 'failed') return route.fulfill({status: 503, json: {error: 'REQUEST_FAILED'}});
    if (mode === 'denied') return route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}});
    return route.fulfill({json: {...learning, changes: [{...learning.changes[0], version}]}});
  });
  await page.route('**/api/tasks/task-research/learning/changes/**', async route => {
    if (bodyMode === 'denied') return route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}});
    if (bodyMode === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
    return route.fulfill({json: {id: 'memory-1', kind: 'memory', text: bodyText, version, source}});
  });
  await login(page); await section(page, '学习').click();
  await page.getByRole('button', {name: /^读取授权正文/}).click();
  await expect(page.locator('.learning-body')).toContainText('完整授权正文');
  bodyMode = 'denied'; await reconnect(page);
  await expect(page.locator('.learning-body .notice')).toBeVisible();
  await expect(page.locator('.learning-body')).not.toContainText('完整授权正文');
  bodyMode = 'slow';
  await page.locator('.learning-body .notice').getByRole('button').click();
  await expect(page.locator('.learning-body')).toHaveCount(0);
  await page.getByRole('button', {name: /^读取授权正文/}).click();
  await expect(page.locator('.learning-body')).not.toContainText('完整授权正文');
  await expect(page.locator('.learning-body')).toContainText('完整授权正文');
  version = 4; await reconnect(page);
  await expect(page.locator('.learning-record-meta')).toContainText('版本 4');
  await expect(page.locator('.learning-body')).toHaveCount(0);
  mode = 'failed'; await reconnect(page);
  await expect(page.locator('.learning-page > .notice')).toContainText('上次获取的数据');
  await expect(page.locator('.learning-change')).toHaveCount(1);
  mode = 'denied'; await page.locator('.learning-page > .notice').getByRole('button').click();
  await expect(page.locator('.learning-change')).toHaveCount(0);
  mode = 'ready'; await page.locator('.learning-page > .notice').getByRole('button').click();
  await expect(page.locator('.learning-change')).toHaveCount(1);
});
