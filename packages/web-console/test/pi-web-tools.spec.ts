import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const call = (id: string, toolName: string, args: unknown, extra = {}) => ({id, role: 'tool', kind: 'tool-call', callId: id, toolName, text: JSON.stringify(args), status: 'pending', ...extra});
const output = (id: string, toolName: string, text: string, extra = {}) => ({id: `${id}-out`, role: 'tool', kind: 'tool-result', callId: id, toolName, text, status: 'completed', ...extra});
async function open(page: Page, items: unknown[]) {
  await page.route('**/api/tasks/task-research/session?*', route => route.fulfill({json: {status: 'ready', scope: 'current-context', items, total: items.length, revision: 'pi-web-tools'}}));
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  for (const group of await page.locator('.execution-tool-group:not([open]) > summary').all()) await group.click();
}

test('pi-web single disclosure shows object status real duration and request edit, with no inner parameter fold', async ({page}) => {
  await open(page, [call('edit', 'edit', {path: '/fixture/demo.ts', edits: [{oldText: 'const n = 1;\n', newText: 'const n = 2;\n'}]}), output('edit', 'edit', '修改已完成', {timing: {durationMs: 1250}})]);
  const card = page.locator('[data-message-id="edit"]');
  await expect(card).toHaveAttribute('data-record-ids', 'edit edit-out');
  await expect(card.locator('.pi-web-tool-summary')).toContainText('edit /fixture/demo.ts');
  await expect(card.locator('.pi-web-tool-duration')).toHaveText('1.3s');
  await expect(card.locator('.pi-tool-body')).toHaveCount(0);
  await card.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.pi-tool-body')).toBeVisible();
  await expect(card.locator('details')).toHaveCount(1);
  await expect(card.locator('.pi-read-path')).toContainText('请求修改');
  expect(await card.locator('.pi-web-edit-before code').textContent()).toBe('const n = 1;\n');
  expect(await card.locator('.pi-web-edit-after code').textContent()).toBe('const n = 2;\n');
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.pi-web-tool-frame').analyze()).violations).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`pi-web-tool-${width}-${theme}.png`)});
  }
});

test('empty parameters and results produce no disclosure or placeholder, and timeout is not elapsed', async ({page}) => {
  await open(page, [call('empty', 'job_list', {}), output('empty', 'job_list', ''), {id:'split', role:'assistant', text:'继续'}, call('shell', 'bash', {command:'echo hello', timeoutMs:7000})]);
  const empty = page.locator('[data-message-id="empty"]');
  await expect(empty.locator('.pi-web-tool-card')).toBeVisible();
  await expect(empty.locator('details')).toHaveCount(0);
  await expect(empty).not.toContainText('本页无输入');
  await expect(empty).not.toContainText('尚无结果');
  const shell = page.locator('[data-message-id="shell"]');
  await expect(shell.locator('.pi-web-tool-duration')).toHaveCount(0);
  await shell.locator('summary').click();
  await expect(shell.locator('.tool-part')).toHaveCount(1);
  await expect(shell.locator('.pi-shell-command small')).toHaveText('(timeout: 7s)');
});

test('truncated input stays an exact fragment and failure reason appears only inside expanded output', async ({page}) => {
  const fragment = '{"path":"/fixture/partial.ts","edits":[';
  await open(page, [{...call('partial', 'edit', {}), text: fragment, truncated: true}, output('partial', 'edit', '文件不存在（FILE_NOT_FOUND）', {status:'error', isError:true})]);
  const card = page.locator('[data-message-id="partial"]');
  await expect(card.locator('.pi-web-tool-summary')).not.toContainText('FILE_NOT_FOUND');
  await expect(card.locator('[title]')).toHaveCount(0);
  await card.locator('summary').click();
  expect(await card.locator('.tool-part').first().locator('code').textContent()).toBe(fragment);
  await expect(card.locator('.pi-web-edit')).toHaveCount(0);
  await expect(card.locator('.tool-part').last()).toContainText('文件不存在（FILE_NOT_FOUND）');
  await card.locator('summary').click();
  await expect(card.locator('.pi-tool-body')).not.toBeVisible();
});

test('read tool shows its path once, but keeps additional input such as a line range', async ({page}) => {
  await open(page, [
    call('read-brief', 'read', {path:'docs/release-checklist.md'}),
    output('read-brief', 'read', '发布检查：构建、健康检查、回退版本。', {timing:{durationMs:2400}}),
    call('read-range', 'read', {path:'docs/release-checklist.md', offset:12, limit:3}),
    output('read-range', 'read', '字段检查'),
  ]);
  const brief = page.locator('[data-message-id="read-brief"]');
  await brief.locator('summary').click();
  await expect(brief.locator('.pi-web-tool-object')).toHaveText('docs/release-checklist.md');
  await expect(brief.locator('.pi-read-path')).toHaveCount(0);
  await expect(brief.locator('.tool-part')).toHaveCount(1);
  await expect(brief.locator('.tool-part')).toContainText('发布检查');
  await brief.screenshot({path: test.info().outputPath('read-tool-expanded.png')});
  const range = page.locator('[data-message-id="read-range"]');
  await range.locator('summary').click();
  await expect(range.locator('.pi-read-path')).toContainText('从第 12 行');
  await expect(range.locator('.pi-read-path')).toContainText('3 行');
});

test('shell follows the reference: command on the disclosure, one gray output panel, status at bottom right and time fixed in the title', async ({page}) => {
  const command = 'Get-Content -LiteralPath docs/release-checklist.md | Select-Object -Skip 84';
  const stdout = [ '85: 发布前先确认部署版本。', '86: 检查健康探针和首页。', '87: 只摘录定位问题所需的最小片段。', '88: ' + '保留必要的上下文。'.repeat(18), '89: 确认回退版本。', '90: 验证后记录结果。', '', '92: 结束。'].join('\n');
  await open(page, [call('terminal', 'pwsh', {command}), output('terminal', 'pwsh', stdout, {timing:{durationMs:2100}})]);
  const card = page.locator('[data-message-id="terminal"]');
  await expect(card.locator('summary')).toContainText(command);
  await expect(card.locator('summary .pi-tool-state')).toBeVisible();
  const elapsed = card.locator('summary .pi-web-tool-duration');
  await expect(elapsed).toHaveText('2.1s');
  const closedPosition = (await elapsed.boundingBox())!;
  await card.locator('summary').click();
  await expect(card.locator('summary .pi-tool-state')).toBeHidden();
  await expect(card.locator('.pi-web-tool-body-title')).toHaveText('Shell');
  await expect(card.locator('.pi-web-tool-footer')).toHaveText('成功');
  await expect(card.locator('.pi-web-tool-duration')).toHaveCount(1);
  await expect(elapsed).toBeVisible();
  const expandedPosition = (await elapsed.boundingBox())!;
  expect(expandedPosition.x).toBeCloseTo(closedPosition.x, 0);
  expect(expandedPosition.y).toBeCloseTo(closedPosition.y, 0);
  const out = card.locator('.pi-plain-output');
  expect(await out.locator('code').textContent()).toBe(stdout);
  expect(await out.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.pi-web-tool-frame').analyze()).violations).toEqual([]);
    await page.mouse.move(1, 1);
    await card.screenshot({path: test.info().outputPath(`shell-reference-${theme}.png`)});
  }
});

test('consecutive tool activity uses compact row spacing without shrinking narrow touch targets', async ({page}) => {
  await open(page, [
    call('one', 'job_list', {}), output('one', 'job_list', '没有后台任务。'),
    call('two', 'job_list', {}), output('two', 'job_list', '没有后台任务。'),
  ]);
  const first = page.locator('[data-message-id="one"]');
  const second = page.locator('[data-message-id="two"]');
  await first.locator('summary').click();
  for (const [width, rowHeight] of [[1440, 26], [390, 44]]) {
    await page.setViewportSize({width,height:940});
    const a = (await first.boundingBox())!, b = (await second.boundingBox())!;
    expect(b.y - (a.y + a.height)).toBeLessThanOrEqual(4.1);
    const height = (await second.locator('summary').boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(rowHeight);
    expect(height).toBeLessThanOrEqual(rowHeight+1);
  }
});
