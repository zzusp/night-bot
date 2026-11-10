import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_TOKEN } from './preview.mjs';
import { openConversationRecords } from './message-process-helpers';

const call = (id: string, status = 'pending') => ({ id, role: 'tool', kind: 'tool-call', callId: id, toolName: 'bash', text: `输入 ${id}`, status, source: { sessionId: 'fixture-execution', entryId: id } });
const result = (id: string, status = 'completed') => ({ ...call(id, status), id: `${id}-result`, kind: 'tool-result', text: `输出 ${id}`, redacted: true });
const done = (id: string) => [call(id), result(id)];

test('连续工具默认折叠，进行中单列；实时完成合并保留展开状态，键盘可达，撤权隐藏记录', async ({ page }) => {
  let mode = 'initial';
  await page.route('**/api/conversations/room-product/tasks/task-research/session?*', route => {
    if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } });
    const items = [...done('a').map(row => ({ ...row, toolName: 'read' })), ...done('b'), call('current', 'running'),
      ...(mode === 'updated' ? [result('current'), call('next', 'running')] : [])];
    return route.fulfill({ json: { status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: mode } });
  });
  await page.goto('/#/channels/room-product');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await openConversationRecords(page);
  const task = page.locator('[data-task-id="task-research"]');
  await task.locator(':scope > summary').click();
  await task.getByText('工具与执行记录', { exact: true }).click();
  const history = task.locator('.execution-history');
  const group = history.locator('.execution-tool-group');
  await expect(group).toHaveCount(1);
  await expect(group).not.toHaveAttribute('open');
  await expect(group.locator(':scope > summary')).toContainText('2 项工具调用与脚本执行');
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('读取 1 次 · 脚本 1 次');
  await expect(history.locator('.message-column > .message-tool')).toHaveCount(1);
  await expect(history.locator('.message-column > .message-tool')).toContainText('执行中');
  await history.locator('.message-column > .message-tool .tool-message > summary').click();
  await expect(history.locator('.message-column > .message-tool')).toContainText('尚无结果。');
  await expect(history.locator('.message-column > .message-tool .message-source')).toHaveCount(0);
  await expect(group.locator('.tool-content')).toHaveCount(0);
  await group.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open');
  await group.locator('.tool-message > summary').first().click();
  await expect(group).toContainText('输入 a');
  await expect(group).toContainText('输出 a');
  await expect(group).not.toContainText('仅展示获准公开的工具字段');
  await expect(group.locator('.message-source')).toHaveCount(0);
  await expect(group).not.toContainText('fixture-execution');
  mode = 'updated';
  await history.getByRole('button', { name: '获取最新记录', exact: true }).click();
  await expect(group.locator(':scope > summary')).toContainText('3 项工具调用与脚本执行');
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('读取 1 次 · 脚本 2 次');
  await expect(group).toHaveAttribute('open');
  await expect(group.locator('.tool-message').first()).toHaveAttribute('open');
  await expect(history.locator('.message-column > .message-tool')).toHaveCount(1);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  }
  await group.locator(':scope > summary').focus();
  await page.keyboard.press('Space');
  await expect(group).not.toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(group.locator('.tool-message').first()).toHaveAttribute('open');
  mode = 'denied';
  await history.getByRole('button', { name: '获取最新记录', exact: true }).click();
  await expect(group).toHaveCount(0);
  await expect(history.locator('.message-tool')).toHaveCount(0);
  await expect(history).toContainText('执行记录暂不可读');
});

test('job_output 按普通工具合组并按需展开，保留安全正文与刷新去重', async ({ page }) => {
  const job = [call('job'), { ...result('job'), text: '用户可见的作业结果 <script>window.jobOutputExecuted=true</script>' }].map(row => ({ ...row, toolName: 'job_output' }));
  const items = [job[0], ...done('a').map(row => ({ ...row, toolName: 'custom_check' })), ...[call('b'), result('b', 'error')], job[1], ...done('c'), ...done('d')];
  await page.route('**/api/conversations/room-product/tasks/task-research/session?*', route => route.fulfill({ json: { status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: 'job-output-revision' } }));
  await page.goto('/#/channels/room-product');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await openConversationRecords(page);
  const task = page.locator('[data-task-id="task-research"]');
  await task.locator(':scope > summary').click();
  await task.getByText('工具与执行记录', { exact: true }).click();
  const history = task.locator('.execution-history');
  const group = history.locator('.execution-tool-group');
  await expect(group).toHaveCount(1);
  await expect(group).not.toHaveAttribute('open');
  await expect(group.locator('.execution-tool-group-summary')).toHaveText('job_output 1 次 · custom_check 1 次 · 脚本 3 次');
  await expect(group.locator(':scope > summary')).toContainText('1 项失败');
  await expect(history.locator('.execution-job-output')).toHaveCount(0);
  await expect(history.getByText('用户可见的作业结果', { exact: false })).toHaveCount(0);
  await group.locator(':scope > summary').click();
  const jobActivity = group.locator('.message-tool').filter({ has: page.locator('.message-meta strong', { hasText: /^job_output$/ }) });
  await expect(jobActivity).toHaveCount(1);
  await expect(jobActivity.locator('.tool-message')).not.toHaveAttribute('open');
  await expect(jobActivity.locator('.tool-content')).toHaveCount(0);
  await jobActivity.getByText('查看工具输入与结果', { exact: true }).click();
  await expect(jobActivity.locator('.tool-content')).toHaveCount(2);
  await expect(jobActivity).toContainText('输入 job');
  await expect(jobActivity).toContainText('用户可见的作业结果 <script>window.jobOutputExecuted=true</script>');
  await expect(jobActivity).not.toContainText('仅展示获准公开的工具字段');
  await expect(jobActivity.locator('.message-source')).toHaveCount(0);
  await expect(jobActivity).not.toContainText('fixture-execution');
  await expect(history.locator('.message-assistant')).toHaveCount(0);
  await history.getByRole('button', { name: '获取最新记录', exact: true }).click();
  await expect(jobActivity).toHaveCount(1);
  await expect(jobActivity.locator('.tool-message')).toHaveAttribute('open');
  await expect(jobActivity.locator('.tool-content')).toHaveCount(2);
  expect(await page.evaluate(() => 'jobOutputExecuted' in window)).toBe(false);
});


for (const toolName of ['read', 'job_output']) {
  test(`${toolName} 输入输出保留正文分页与失败恢复，不显示工具来源或内部标识`, async ({ page }) => {
    let mode = 'ready';
    let revision = 'body-revision';
    const first = '长输出。'.repeat(4000);
    const tail = '分页终点 <script>window.toolPageExecuted=true</script>';
    const items = [{ ...call('paged'), toolName }, { ...result('paged', 'error'), toolName, text: first, textTotal: first.length + tail.length, textNextOffset: first.length, truncated: true }];
    const endpoint = '**/api/conversations/room-product/tasks/task-research/session';
    await page.route(endpoint + '?*', route => route.fulfill({ json: { status: 'ready', scope: 'current-context', items: revision === 'body-revision' ? items : items.map(row => row.kind === 'tool-result' ? { ...row, text: '重新授权后的最新正文', textNextOffset: null, truncated: false } : row), total: 2, nextOffset: null, revision } }));
    await page.route(endpoint + '/messages/paged-result?*', async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('revision')).toBe('body-revision');
      expect(url.searchParams.get('offset')).toBe(String(first.length));
      if (mode.startsWith('denied-')) {
        const status = Number(mode.slice(7));
        await new Promise(resolve => setTimeout(resolve, 300));
        return route.fulfill({ status, json: { error: 'RESOURCE_FORBIDDEN' } });
      }
      if (mode === 'stale') return route.fulfill({ status: 409, json: { error: 'SESSION_PAGE_STALE' } });
      return route.fulfill({ json: { messageId: 'paged-result', text: tail, offset: first.length, nextOffset: null, total: first.length + tail.length, revision: 'body-revision', redacted: true, source: { sessionId: 'HIDDEN_SESSION_ID', entryId: 'HIDDEN_ENTRY_ID', callId: 'HIDDEN_CALL_ID' } } });
    });
    await page.goto('/#/channels/room-product');
    await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
    await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
    await openConversationRecords(page);
    const task = page.locator('[data-task-id="task-research"]');
    await task.locator(':scope > summary').click();
    await task.getByText('工具与执行记录', { exact: true }).click();
    const activity = task.locator('.execution-history .message-tool');
    await activity.getByText('查看工具输入与结果', { exact: true }).click();
    await expect(activity).toContainText('输入 paged');
    await expect(activity.getByRole('heading', { name: '输出 · 失败' })).toBeVisible();
    await expect(activity.locator('.tool-content').last()).toContainText('长输出。');
    await activity.getByRole('button', { name: '下一段', exact: true }).click();
    await expect(activity.locator('.tool-content').last()).toHaveText(tail);
    await expect(activity.locator('.message-source')).toHaveCount(0);
    await expect(activity).not.toContainText('HIDDEN_');
    await expect(activity).not.toContainText('信息已隐藏');
    expect(await page.evaluate(() => 'toolPageExecuted' in window)).toBe(false);
    await activity.getByRole('button', { name: '上一段', exact: true }).click();
    mode = 'stale';
    await activity.getByRole('button', { name: '下一段', exact: true }).click();
    await expect(activity.getByRole('alert')).toBeVisible();
    await activity.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(activity.locator('.tool-content').last()).toContainText('长输出。');
    await expect(activity.locator('.message-source')).toHaveCount(0);
    mode = 'ready';
    await activity.getByRole('button', { name: '下一段', exact: true }).click();
    await expect(activity.locator('.tool-content').last()).toHaveText(tail);
    for (const status of [403, 404, 401]) {
      mode = `denied-${status}`;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(activity.getByRole('alert')).toBeVisible();
      const output = activity.locator('.tool-part').last();
      await expect(output.locator('.tool-content')).toHaveCount(0);
      await expect(output.locator('.body-pagination')).toHaveCount(0);
      await activity.getByText('查看工具输入与结果', { exact: true }).click();
      await activity.getByText('查看工具输入与结果', { exact: true }).click();
      await expect(output.locator('.tool-content')).toHaveCount(0);
      const deniedResponse = page.waitForResponse(response => response.url().includes('/messages/paged-result?') && response.status() === status);
      await activity.getByRole('button', { name: '重新获取', exact: true }).click();
      await expect(output.locator('.tool-content')).toHaveCount(0);
      await expect(output).not.toContainText('长输出。');
      await expect(output).not.toContainText('分页终点');
      await deniedResponse;
      await expect(activity.getByRole('alert')).toBeVisible();
      mode = 'ready';
      await activity.getByRole('button', { name: '重新获取', exact: true }).click();
      await expect(output.locator('.tool-content')).toHaveText(tail);
    }
    mode = 'denied-403';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(activity.getByRole('alert')).toBeVisible();
    mode = 'stale';
    await activity.getByRole('button', { name: '重新获取', exact: true }).click();
    await expect(activity.getByRole('button', { name: '获取最新记录', exact: true })).toBeVisible();
    await expect(activity.getByRole('button', { name: '重新获取', exact: true })).toHaveCount(0);
    await expect(activity.locator('.tool-part').last().locator('.tool-content')).toHaveCount(0);
    revision = 'restored-revision';
    mode = 'ready';
    await activity.getByRole('button', { name: '获取最新记录', exact: true }).click();
    // Recovery remounts only after a successful latest-reader authorization.
    await expect(activity.locator('.tool-message')).not.toHaveAttribute('open');
    await activity.getByText('查看工具输入与结果', { exact: true }).click();
    await expect(activity).toContainText('重新授权后的最新正文');
    await expect(activity).not.toContainText('分页终点');
    await expect(activity.locator('.message-source')).toHaveCount(0);
  });
}
