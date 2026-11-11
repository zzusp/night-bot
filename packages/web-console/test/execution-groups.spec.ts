import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_TOKEN } from './preview.mjs';

const call = (id: string, status = 'pending') => ({ id, role: 'tool', kind: 'tool-call', callId: id, toolName: 'bash', text: `输入 ${id}`, status, source: { sessionId: 'fixture-execution', entryId: id } });
const result = (id: string, status = 'completed') => ({ ...call(id, status), id: `${id}-result`, kind: 'tool-result', text: `输出 ${id}`, redacted: true });
const done = (id: string) => [call(id), result(id)];
const endpoint = '**/api/tasks/task-research/session';
async function openHistory(page: Page) {
  await page.goto('/#/tasks/task-research?view=execution');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await expect(page.locator('.task-dialogue .execution-history')).toBeVisible();
  return page.locator('.task-dialogue .execution-history');
}

test('执行正文流无图标信息条，组默认折叠，输入输出独立展开，刷新保留状态', async ({ page }) => {
  let mode = 'initial';
  await page.route(endpoint + '?*', route => {
    if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } });
    const items = [{ id: 'note', role: 'assistant', text: '先核对已有材料，再执行脚本。', status: 'stop' }, ...done('a').map(row => ({ ...row, toolName: 'read' })), ...done('b'), call('current', 'running'), ...(mode === 'updated' ? [result('current'), call('next', 'running')] : [])];
    return route.fulfill({ json: { status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: mode } });
  });
  const history = await openHistory(page), group = history.locator('.execution-tool-group');
  await expect(history.locator('.execution-transcript')).toHaveCount(1);
  await expect(history.locator('.message-avatar, .message-meta, .board-badge, .execution-tool-group-chevron')).toHaveCount(0);
  await expect(group).not.toHaveAttribute('open');
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('读取 1 次 · 脚本 1 次');
  await expect(history.locator('.message-column > .message-tool')).toContainText('执行中');
  await expect(history.locator('.message-column > .message-tool')).toContainText('尚无结果。');
  await expect(group.locator('.tool-content')).toHaveCount(0);
  await group.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  const input = group.locator('.execution-tool-input').first(), output = group.locator('.execution-tool-output').first();
  await expect(input).not.toHaveAttribute('open');
  await expect(output).not.toHaveAttribute('open');
  await expect(input.locator('summary')).toContainText('输入 a');
  await expect(output.locator('summary')).toContainText('输出 a');
  await input.locator('summary').click();
  await expect(input.locator('.tool-content')).toHaveText('输入 a');
  await expect(output).not.toHaveAttribute('open');
  await output.locator('summary').click();
  await expect(output.locator('.tool-content')).toHaveText('输出 a');
  await expect(group.locator('.message-source')).toHaveCount(0);
  await expect(group).not.toContainText('fixture-execution');
  mode = 'updated';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('读取 1 次 · 脚本 2 次');
  await expect(input).toHaveAttribute('open');
  await expect(output).toHaveAttribute('open');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  mode = 'denied';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(history.locator('.message-tool')).toHaveCount(0);
});

test('job_output 普通合组，安全首行摘要与独立正文，无内部来源信息', async ({ page }) => {
  const text = '用户可见的作业结果 <script>window.jobOutputExecuted=true</script>\n第二行';
  const job = [{ ...call('job'), text: '输入 job ' + '安全参数'.repeat(40) }, { ...result('job'), text }].map(row => ({ ...row, toolName: 'job_output' }));
  const items = [...job, ...done('a').map(row => ({ ...row, toolName: 'custom_check' })), call('b'), result('b', 'error')];
  await page.route(endpoint + '?*', route => route.fulfill({ json: { status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: 'jobs' } }));
  const history = await openHistory(page), group = history.locator('.execution-tool-group');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('job_output 1 次 · custom_check 1 次 · 脚本 1 次');
  await expect(group.locator(':scope > summary')).toContainText('1 项失败');
  await group.locator(':scope > summary').click();
  const activity = group.locator('.message-tool').first(), output = activity.locator('.execution-tool-output');
  await expect(output.locator('summary')).toContainText('用户可见的作业结果');
  await expect(output.locator('summary')).toContainText('本段另 1 行');
  await expect(activity.locator('.tool-content')).toHaveCount(0);
  expect((await activity.locator('.execution-tool-input .execution-tool-preview').textContent())!.length).toBeLessThanOrEqual(93);
  await activity.locator('.execution-tool-input > summary').click();
  await output.locator('summary').click();
  await expect(activity.locator('.tool-content')).toHaveCount(2);
  await expect(output.locator('.tool-content')).toHaveText(text);
  await expect(activity.locator('.message-source')).toHaveCount(0);
  await expect(activity).not.toContainText('信息已隐藏');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(output).toHaveAttribute('open');
  expect(await page.evaluate(() => 'jobOutputExecuted' in window)).toBe(false);
});

for (const toolName of ['read', 'job_output']) {
  test(`${toolName} 正文分页撤权连摘要隐藏，精确重试及新版本恢复安全`, async ({ page }) => {
    let mode = 'ready', revision = 'body-revision';
    const first = '长输出。'.repeat(4000), tail = '分页终点 <script>window.toolPageExecuted=true</script>';
    const items = [{ ...call('paged'), toolName }, { ...result('paged', 'error'), toolName, text: first, textTotal: first.length + tail.length, textNextOffset: first.length, truncated: true }];
    await page.route(endpoint + '?*', route => route.fulfill({ json: { status: 'ready', scope: 'current-context', items: revision === 'body-revision' ? items : items.map(row => row.kind === 'tool-result' ? { ...row, text: '重新授权后的最新正文', textNextOffset: null, truncated: false } : row), total: 2, nextOffset: null, revision } }));
    await page.route(endpoint + '/messages/paged-result?*', async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('revision')).toBe('body-revision');
      expect(url.searchParams.get('offset')).toBe(String(first.length));
      if (mode.startsWith('denied-')) { const status = Number(mode.slice(7)); await new Promise(resolve => setTimeout(resolve, 300)); return route.fulfill({ status, json: { error: 'RESOURCE_FORBIDDEN' } }); }
      if (mode === 'stale') return route.fulfill({ status: 409, json: { error: 'SESSION_PAGE_STALE' } });
      return route.fulfill({ json: { messageId: 'paged-result', text: tail, offset: first.length, nextOffset: null, total: first.length + tail.length, revision, redacted: true, source: { sessionId: 'HIDDEN_SESSION_ID', entryId: 'HIDDEN_ENTRY_ID', callId: 'HIDDEN_CALL_ID' } } });
    });
    const history = await openHistory(page), activity = history.locator('.message-tool'), row = activity.locator('.execution-tool-output-row');
    await expect(row.locator('summary')).toContainText('失败');
    await expect(row.locator('summary')).toContainText('可继续读取');
    expect((await row.locator('.execution-tool-preview').textContent())!.length).toBeLessThanOrEqual(111);
    await row.locator('summary').click();
    await row.getByRole('button', { name: '下一段', exact: true }).click();
    await expect(row.locator('.tool-content')).toHaveText(tail);
    await expect(row.locator('summary')).toContainText('分页终点');
    await expect(activity.locator('.message-source')).toHaveCount(0);
    await expect(activity).not.toContainText('HIDDEN_');
    expect(await page.evaluate(() => 'toolPageExecuted' in window)).toBe(false);
    for (const status of [403, 404, 401]) {
      mode = `denied-${status}`;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(row.getByRole('alert')).toBeVisible();
      await expect(row.locator('summary, .tool-content, .body-pagination')).toHaveCount(0);
      await expect(row).not.toContainText('分页终点');
      const deniedResponse = page.waitForResponse(response => response.url().includes('/messages/paged-result?') && response.status() === status);
      await row.getByRole('button', { name: '重新获取', exact: true }).click();
      await expect(row).not.toContainText('长输出。');
      await expect(row).not.toContainText('分页终点');
      await deniedResponse;
      await expect(row.getByRole('alert')).toBeVisible();
      mode = 'ready';
      await row.getByRole('button', { name: '重新获取', exact: true }).click();
      await expect(row.locator('.tool-content')).toHaveText(tail);
    }
    mode = 'denied-403';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(row.getByRole('alert')).toBeVisible();
    mode = 'stale';
    await row.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(row.getByRole('button', { name: '获取最新记录', exact: true })).toBeVisible();
    await expect(row.locator('summary, .tool-content')).toHaveCount(0);
    revision = 'restored-revision'; mode = 'ready';
    await row.getByRole('button', { name: '获取最新记录', exact: true }).click();
    await expect(row.locator('summary')).toContainText('重新授权后的最新正文');
    await expect(row.locator('details')).not.toHaveAttribute('open');
    await row.locator('summary').click();
    await expect(row.locator('.tool-content')).toHaveText('重新授权后的最新正文');
    await expect(row).not.toContainText('分页终点');
  });
}
