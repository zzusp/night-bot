import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const item = {id: 'memory:fixture', kind: 'memory', name: '示例记忆', scope: 'bot', status: 'applied', revision: 2, updatedAt: '2026-11-10T10:00:00Z'};
const current = {text: '<script>safe plain text</script>\n新的中文内容\n' + '长内容'.repeat(200), revision: 2, updatedAt: item.updatedAt};
const body = {id: item.id, kind: item.kind, name: item.name, revision: 2, current, previous: {text: '旧内容', revision: 1, updatedAt: item.updatedAt}, comparison: {status: 'available', added: 1, removed: 1, lines: [{type: 'removed', text: '旧内容'}, {type: 'added', text: '新的中文内容'}]}, redacted: false};
async function open(page: Page) {
  await page.route('**/api/evolution?**', route => route.fulfill({json: {status: 'ready', coverage: 'bot-shared-current-state', items: [item], total: 1, offset: 0, nextOffset: null, memory: {}, skills: {}}}));
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.getByRole('button', {name: '查看内容：示例记忆', exact: true})).toBeVisible();
}

test('正文显式读取、纯文本、最新差异、键盘返回与浅深色窄屏', async ({page}) => {
  let reads = 0;
  await page.route('**/api/evolution/items/**', route => { reads++; expect(new URL(route.request().url()).searchParams.get('revision')).toBe('2'); return route.fulfill({json: body}); });
  await open(page);
  expect(reads).toBe(0);
  const action = page.getByRole('button', {name: '查看内容：示例记忆', exact: true});
  await action.focus(); await action.press('Enter');
  await expect(page.locator('.evolution-plain-text')).toContainText('<script>safe plain text</script>');
  await expect(page.locator('#evolution-content-title')).toBeFocused();
  await expect(page.locator('.evolution-content script')).toHaveCount(0);
  await page.getByRole('button', {name: '最近差异', exact: true}).click();
  await expect(page.locator('.evolution-diff')).toContainText('−旧内容');
  await expect(page.locator('.evolution-diff')).toContainText('+新的中文内容');
  await expect(page.getByText('新增 1 行', {exact: true})).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.getByRole('button', {name: '当前内容', exact: true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const violations = (await new AxeBuilder({page}).include('.evolution-content').analyze()).violations;
    expect(violations).toEqual([]);
    await page.locator('.evolution-content').screenshot({path: test.info().outputPath(`content-${theme}-390.png`)});
  }
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  await expect(action).toBeFocused();
  await expect(page.locator('.evolution-content')).toHaveCount(0);
});

test('加载、无上次、无变化、失败重试、撤权及版本冲突隐藏旧内容', async ({page}) => {
  let response: object = body, status = 200, delayed = false;
  await page.route('**/api/evolution/items/**', async route => {
    if (delayed) await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({status, json: response});
  });
  await open(page);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect(page.locator('.evolution-plain-text')).toBeVisible();
  status = 403; response = {error: 'EVOLUTION_BODY_FORBIDDEN'}; delayed = true;
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('正在读取内容…')).toBeVisible();
  await expect(page.locator('.evolution-plain-text')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  status = 503; response = {error: 'EVOLUTION_UNAVAILABLE'};
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.evolution-plain-text')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('内容暂不可读');
  status = 200; response = {...body, previous: null, comparison: {...body.comparison, status: 'no_previous', reason: 'not_recorded'}};
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await page.getByRole('button', {name: '最近差异'}).click();
  await expect(page.getByText('暂无可比较的上次内容', {exact: true})).toBeVisible();
  response = {...body, comparison: {...body.comparison, added: 0, removed: 0, lines: []}};
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('可展示的内容没有变化。')).toBeVisible();
  status = 409; response = {error: 'EVOLUTION_VERSION_STALE'};
  await page.getByRole('button', {name: '刷新内容'}).click();
  await expect(page.getByText('条目已经更新，请重新获取列表后查看最新内容。')).toBeVisible();
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.locator('.evolution-content')).toHaveCount(0);
});

test('关闭未完成读取不重新展示正文，目录技能标明采集边界', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let started = false;
  await page.route('**/api/evolution/items/**', async route => {
    started = true;
    await gate;
    await route.fulfill({json: {...body, kind: 'skill', comparison: {...body.comparison, basis: 'observed'}}}).catch(() => {});
  });
  await open(page);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.getByText('正在读取内容…')).toBeVisible();
  await page.getByRole('button', {name: '返回列表', exact: true}).click();
  release();
  await expect(page.locator('.evolution-content')).toHaveCount(0);
  await page.getByRole('button', {name: '查看内容：示例记忆'}).click();
  await expect(page.getByText('目录文件比较上次采集与当前内容；未采集的中间修改无法还原。')).toBeVisible();
});
