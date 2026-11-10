import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE_TOKEN } from './preview.mjs';
import { openConversationRecords } from './message-process-helpers';

const call = (id: string, status = 'pending') => ({ id, role: 'tool', kind: 'tool-call', callId: id, toolName: 'shell', text: `输入 ${id}`, status, source: { sessionId: 'fixture-execution', entryId: id } });
const result = (id: string, status = 'completed') => ({ ...call(id, status), id: `${id}-result`, kind: 'tool-result', text: `输出 ${id}`, redacted: true });
const done = (id: string) => [call(id), result(id)];

test('连续工具默认折叠，进行中单列；实时完成合并保留展开状态，键盘可达，撤权隐藏记录', async ({ page }) => {
  let mode = 'initial';
  await page.route('**/api/conversations/room-product/tasks/task-research/session?*', route => {
    if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'RESOURCE_FORBIDDEN' } });
    const items = [...done('a'), ...done('b'), call('current', 'running'),
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
  await expect(history.locator('.message-column > .message-tool')).toHaveCount(1);
  await expect(history.locator('.message-column > .message-tool')).toContainText('执行中');
  await expect(group.locator('.tool-content')).toHaveCount(0);
  await group.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open');
  await group.locator('.tool-message > summary').first().click();
  await expect(group).toContainText('输入 a');
  await expect(group).toContainText('输出 a');
  await expect(group).toContainText('仅展示获准公开的工具字段');
  mode = 'updated';
  await history.getByRole('button', { name: '获取最新记录', exact: true }).click();
  await expect(group.locator(':scope > summary')).toContainText('3 项工具调用与脚本执行');
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

test('job_output 正文始终可见，不入组，不被输入折叠隐藏；刷新不重复输出', async ({ page }) => {
  const job = [call('job'), { ...result('job'), text: '用户可见的作业结果 <script>window.jobOutputExecuted=true</script>' }].map(row => ({ ...row, toolName: 'job_output' }));
  const items = [...done('a'), ...done('b'), ...job, ...done('c'), ...done('d')];
  await page.route('**/api/conversations/room-product/tasks/task-research/session?*', route => route.fulfill({ json: { status: 'ready', scope: 'current-context', items, total: items.length, nextOffset: null, revision: 'job-output-revision' } }));
  await page.goto('/#/channels/room-product');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await openConversationRecords(page);
  const task = page.locator('[data-task-id="task-research"]');
  await task.locator(':scope > summary').click();
  await task.getByText('工具与执行记录', { exact: true }).click();
  const history = task.locator('.execution-history');
  await expect(history.locator('.execution-tool-group')).toHaveCount(2);
  const output = history.getByRole('region', { name: 'job_output 输出' });
  await expect(output).toBeVisible();
  await expect(output).toContainText('用户可见的作业结果');
  await expect(history.locator('.execution-tool-group .execution-job-output')).toHaveCount(0);
  await expect(history.locator('.message-column > .message-tool .tool-message')).not.toHaveAttribute('open');
  await history.getByText('查看工具输入', { exact: true }).click();
  await expect(output).toBeVisible();
  await history.getByText('查看工具输入', { exact: true }).click();
  await history.getByRole('button', { name: '获取最新记录', exact: true }).click();
  await expect(output).toHaveCount(1);
  await expect(output).toBeVisible();
  expect(await page.evaluate(() => 'jobOutputExecuted' in window)).toBe(false);
});
