import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

async function setup(page: Page) {
  await page.goto('/#/channels');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await page.locator('.channel-card').first().waitFor();
  return page.request.get('/api/channels').then(response => response.json());
}
async function openRemoval(page: Page) {
  await page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除渠道', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除渠道？', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
test('二次确认默认取消，关闭不请求删除且返回菜单触发器', async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route(/\/api\/channels\/dingtalk-work$/, route => { writes++; return route.abort(); });
  for (const method of ['escape', 'cancel']) {
    const dialog = await openRemoval(page);
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await expect(dialog).toContainText('会话、任务和历史记录不会随配置删除');
    if (method === 'escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true })).toBeFocused();
  }
  expect(writes).toBe(0);
});
test('单次确认仅发一次，发送版本和确认字段，成功后刷新并聚焦页标题', async ({ page }) => {
  const data = await setup(page); let rows = data.items, writes = 0;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/channels$/, route => route.fulfill({ json: { items: rows } }));
  await page.route(/\/api\/channels\/dingtalk-work$/, async route => {
    writes++; expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: rows.find((item: {channelId: string}) => item.channelId === 'dingtalk-work').savedVersion, confirm: true });
    await gate; rows = rows.filter((item: {channelId: string}) => item.channelId !== 'dingtalk-work');
    await route.fulfill({ json: { ok: true, channelId: 'dingtalk-work', changed: true, restartRequired: false, liveApplied: false } });
  });
  const dialog = await openRemoval(page), confirm = dialog.getByRole('button', { name: '删除渠道', exact: true });
  await confirm.click(); await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release(); await expect(dialog).not.toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '渠道', exact: true })).toBeFocused();
});
test('未知结果锁定，关闭再开仍仅核对，不自动重发', async ({ page }) => {
  const data = await setup(page); let rows = data.items, writes = 0;
  await page.route(/\/api\/channels$/, route => route.fulfill({ json: { items: rows } }));
  await page.route(/\/api\/channels\/dingtalk-work$/, route => { writes++; return route.abort('failed'); });
  let dialog = await openRemoval(page);
  await dialog.getByRole('button', { name: '删除渠道', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '核对删除结果', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  dialog = await openRemoval(page);
  await expect(dialog.getByRole('button', { name: '删除渠道', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '核对删除结果', exact: true }).click();
  await expect(dialog).toContainText('列表中仍有此渠道');
  expect(writes).toBe(1);
  rows = rows.filter((item: {channelId: string}) => item.channelId !== 'dingtalk-work');
  await dialog.getByRole('button', { name: '核对删除结果', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(writes).toBe(1);
  await expect(page.getByText(/无法确认是否由本次删除完成/)).toBeVisible();
});
