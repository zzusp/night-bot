import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const memory = {id: 'memory-1', kind: 'memory', name: '合成记忆', scope: 'bot', status: 'applied', revision: 1, updatedAt: null, memoryUse: {readCount: 3, searchCount: 2}};
const skill = {id: 'skill-1', kind: 'skill', name: '合成技能', scope: 'bot', status: 'applied', revision: 1, updatedAt: null, modelUseCount: 2, userUseCount: 1, fileReadCount: 4};
const snapshot = (items: object[], partial = false) => ({status: 'ready', items, total: items.length, offset: 0, limit: 20, nextOffset: null, memory: {acceptedCount: 6, candidateCount: 0, readCount: null, searchCount: null}, skills: {installedCount: 11, modelUseCount: 1, userUseCount: null, fileReadCount: 5}, usageCoverage: {status: partial ? 'partial' : 'ready'}});
async function open(page: Page) {
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
}

test('分类读取仅更新列表，工具栏与焦点稳定，迟到结果不能覆盖新分类', async ({page}) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  let delayed = true, skillRequests = 0;
  await page.route('**/api/evolution?*', async route => {
    const kind = new URL(route.request().url()).searchParams.get('kind');
    expect(['memory', 'skill']).toContain(kind);
    if (kind === 'skill') {skillRequests++; if (delayed) await gate;}
    await route.fulfill({json: snapshot([kind === 'skill' ? skill : memory])}).catch(() => {});
  });
  await open(page);
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toBeVisible();
  const toolbar = page.locator('.evolution-list-toolbar'), library = page.locator('.evolution-library');
  const toolbarNode = await toolbar.elementHandle(), libraryNode = await library.elementHandle();
  const summary = page.locator('.evolution-summary'), summaryNode = await summary.elementHandle();
  const summaryBounds = await summary.boundingBox();
  const bounds = await toolbar.boundingBox(), height = await page.locator('.evolution-list-body').evaluate(el => el.getBoundingClientRect().height);
  const tabs = page.getByRole('navigation', {name: '自进化记录类型'});
  const skillTab = tabs.getByRole('link', {name: 'Skills', exact: true});
  await skillTab.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('正在读取自进化记录…')).toBeVisible();
  await expect(skillTab).toBeFocused();
  await expect(skillTab).toHaveAttribute('aria-current', 'page');
  expect(await toolbarNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await libraryNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await summaryNode!.evaluate(el => el.isConnected)).toBe(true);
  expect(await summary.boundingBox()).toEqual(summaryBounds);
  await expect(summary.locator('dd')).toHaveText(['6', '0', '未记录', '未记录', '11', '1', '未记录', '5']);
  expect(await toolbar.boundingBox()).toEqual(bounds);
  expect(await page.locator('.evolution-list-body').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(height);
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toHaveCount(0);
  await expect.poll(() => skillRequests).toBe(1);
  await tabs.getByRole('link', {name: '记忆', exact: true}).click();
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toBeVisible();
  delayed = false; release();
  await expect(page.getByRole('button', {name: '查看内容：合成技能'})).toHaveCount(0);
  await skillTab.click();
  await expect(page.locator('.evolution-usage-cell')).toHaveText('使用次数7');
  await page.goBack();
  await expect(page.locator('.evolution-usage-cell')).toHaveText('使用次数5');
  await page.goForward();
  await expect(page.getByRole('button', {name: '查看内容：合成技能'})).toBeVisible();
});

test('使用次数只加真实事件，保留缺失与零且不显示不完整标签，浅深色窄屏可读', async ({page}) => {
  let partial = false;
  const rows = [memory, skill, {...memory, id: 'missing', name: '未记录', memoryUse: null}, {...skill, id: 'zero', name: '零次', modelUseCount: 0, userUseCount: 0, fileReadCount: 0}, {...skill, id: 'partial', name: '部分', modelUseCount: 2, userUseCount: null, fileReadCount: 3}, {...skill, id: 'invalid', name: '非法', modelUseCount: -1, userUseCount: '2', fileReadCount: null}, {...skill, id: 'unobserved', name: '无技能记录', modelUseCount: null, userUseCount: null, fileReadCount: null}];
  await page.route('**/api/evolution?*', route => route.fulfill({json: snapshot(rows, partial)}));
  await open(page);
  const cells = page.locator('.evolution-usage-cell');
  await expect(cells).toHaveText(['使用次数5', '使用次数7', '使用次数未记录', '使用次数0', '使用次数5', '使用次数未记录', '使用次数未记录']);
  partial = true;
  await page.getByRole('button', {name: '刷新记录'}).click();
  await expect(cells.nth(0)).toHaveText('使用次数5');
  await expect(cells.nth(2)).toHaveText('使用次数未记录');
  await expect(page.getByText('记录不完整', {exact: true})).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.evolution-library').analyze()).violations).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`evolution-counts-${theme}-390.png`), fullPage: true});
  }
});

test('分类失败和空态保留操作入口，撤权重试不恢复旧数据', async ({page}) => {
  let status = 200, empty = false, hold = false, started = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/evolution?*', async route => {
    if (hold) {started = true; await gate;}
    await route.fulfill({status, json: status === 200 ? snapshot(empty ? [] : [memory]) : {error: 'EVOLUTION_UNAVAILABLE'}});
  });
  await open(page);
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toBeVisible();
  status = 503;
  await page.getByRole('button', {name: '刷新记录'}).click();
  await expect(page.getByRole('alert')).toContainText('当前显示上次获取的数据');
  status = 403;
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect(page.getByRole('heading', {name: '无权查看自进化记录'})).toBeVisible();
  await expect(page.locator('.evolution-card')).toHaveCount(0);
  status = 200; hold = true;
  await page.getByRole('button', {name: '重新获取', exact: true}).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator('.evolution-card')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: '自进化记录类型'})).toBeVisible();
  release();
  await expect(page.getByRole('button', {name: '查看内容：合成记忆'})).toBeVisible();
  empty = true;
  await page.getByRole('button', {name: '刷新记录'}).click();
  await expect(page.getByRole('heading', {name: '暂无自进化记录'})).toBeVisible();
  await expect(page.getByRole('navigation', {name: '自进化记录类型'})).toBeVisible();
});

test('明确不可读后切换分类不会恢复缓存摘要，直到新的读取成功', async ({page}) => {
  let unavailable = false, hold = false, started = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/evolution?*', async route => {
    if (hold) {started = true; await gate;}
    await route.fulfill({json: unavailable ? {status: 'unavailable'} : snapshot([memory])});
  });
  await open(page);
  await expect(page.locator('.evolution-card')).toHaveCount(2);
  unavailable = true;
  await page.getByRole('button', {name: '刷新记录'}).click();
  await expect(page.getByRole('heading', {name: '自进化记录暂不可读'})).toBeVisible();
  await expect(page.locator('.evolution-card')).toHaveCount(0);
  unavailable = false; hold = true;
  await page.getByRole('navigation', {name: '自进化记录类型'}).getByRole('link', {name: 'Skills', exact: true}).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator('.evolution-card')).toHaveCount(0);
  release();
  await expect(page.locator('.evolution-card')).toHaveCount(2);
  await expect(page.locator('.evolution-card dd').first()).toHaveText('6');
});
