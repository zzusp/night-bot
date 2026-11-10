import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { FIXTURE_TOKEN } from './preview.mjs';
import type { Channel, ChannelIngress } from '../src/api';

const version = (letter: string) => letter.repeat(64);
const base = (ingress: Partial<ChannelIngress> = {}, other: Partial<Channel> = {}): Channel => ({
  channelId: 'dingtalk-work', type: 'dingtalk-dws', name: '项目协作', enabled: true, writesAuthorized: false,
  savedVersion: version('a'), runningVersion: version('a'), liveApplied: true, connected: true, connectionState: 'listening',
  ingress: { supported: true, available: true, backfill: 'history', requestedPaused: false, state: 'receiving', errorCode: null, ...ingress }, ...other,
});
async function setup(page: Page, item = base()) {
  const data = { items: [item] }; let reads = 0;
  await page.route(/\/api\/channels$/, route => { reads++; return route.fulfill({ json: data }); });
  await page.route(/\/api\/conversations$/, route => route.fulfill({ json: { items: [] } }));
  await page.goto('/#/channels');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await page.getByRole('button', { name: `渠道操作：${item.channelId}`, exact: true }).waitFor();
  return { data, reads: () => reads };
}
async function open(page: Page, action = '暂停接收', channelId = 'dingtalk-work') {
  const trigger = page.getByRole('button', { name: `渠道操作：${channelId}`, exact: true });
  await trigger.click(); await page.getByRole('menuitem', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^(暂停接收|恢复接收)？$/ });
  await expect(dialog).toBeVisible(); return dialog;
}
const routeIngress = /\/api\/channels\/.*ingress(?:\?.*)?$/;
const receipt = (channel: Channel, changed = true, liveApplied = true) => ({ ok: true, changed, restartRequired: false, liveApplied, channel });
const shot = (name: string) => fileURLToPath(new URL(`../../../docs/tmp/channel-pause-${name}.png`, import.meta.url));

test('暂停确认默认取消、键盘关闭与焦点恢复，不发请求', async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route(routeIngress, route => { writes++; return route.abort(); });
  const trigger = page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '编辑配置', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '暂停接收？', exact: true });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await expect(dialog).toContainText('不会取消已接纳的任务');
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  const reopened = await open(page); await reopened.getByRole('button', { name: '取消', exact: true }).click();
  await expect(trigger).toBeFocused(); expect(writes).toBe(0);
});

test('暂停单次提交携带版本，轮询不卸载确认，实际暂停与外发授权分离', async ({ page }) => {
  const state = await setup(page); let writes = 0;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(routeIngress, async route => {
    writes++; expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: version('a'), paused: true, confirm: true });
    await gate; state.data.items = [base({ requestedPaused: true, state: 'paused' }, { savedVersion: version('b') })];
    await route.fulfill({ json: receipt(state.data.items[0]) });
  });
  await page.clock.install();
  const dialog = await open(page); await dialog.evaluate(node => node.setAttribute('data-retained', 'yes'));
  const reads = state.reads(); await page.clock.fastForward(11000); await expect.poll(state.reads).toBeGreaterThan(reads);
  await expect(dialog).toHaveAttribute('data-retained', 'yes');
  const confirm = dialog.getByRole('button', { name: '暂停接收', exact: true }); await confirm.click();
  await expect(confirm).toBeDisabled(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); expect(writes).toBe(1);
  release(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('.channel-card-tag')).toHaveText('已暂停接收');
  await expect(page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true })).toBeFocused();
  expect(state.data.items[0].enabled).toBe(true); expect(state.data.items[0].writesAuthorized).toBe(false);
  await page.screenshot({ path: shot('paused'), animations: 'disabled' });
});

test('恢复回执为 recovering 只报告正在补拉，深色状态截图', async ({ page }) => {
  const state = await setup(page, base({ requestedPaused: true, state: 'paused' }));
  await page.route(routeIngress, route => {
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: version('a'), paused: false, confirm: true });
    state.data.items = [base({ state: 'recovering' }, { savedVersion: version('b'), connected: false })];
    return route.fulfill({ json: receipt(state.data.items[0]) });
  });
  const dialog = await open(page, '恢复接收'); await dialog.getByRole('button', { name: '恢复接收', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.locator('.channel-card-tag')).toHaveText('正在补拉');
  await expect(page.locator('.channels-page > [role="status"]')).toContainText('正在补拉暂停期间的消息，尚未完成');
  await page.getByRole('button', { name: '切换深色外观', exact: true }).click();
  await page.screenshot({ path: shot('recovering'), animations: 'disabled' });
  expect((await new AxeBuilder({ page }).include('.channel-cards').analyze()).violations).toEqual([]);
});

test('无补拉能力明确说明不可补拉，窄屏无溢出并通过 dialog 可访问性检查', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await setup(page, base({ backfill: 'none' }, { name: '长名称渠道：仅接收后续消息的本地测试插件', type: 'fixture-custom' }));
  const dialog = await open(page);
  await expect(dialog).toContainText('暂停期间无法补拉，恢复只接收后续消息。');
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await dialog.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(390); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect((await new AxeBuilder({ page }).include('.channel-ingress-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({ path: shot('narrow'), animations: 'disabled' });
});

for (const unavailable of ['unsupported', 'unavailable', 'missing'] as const) test(`能力 ${unavailable} 仅禁用暂停操作，保留编辑与删除`, async ({ page }) => {
  await setup(page, unavailable === 'missing' ? base({}, { ingress: undefined }) : base(unavailable === 'unsupported' ? { supported: false, backfill: null } : { available: false, state: 'unavailable' }));
  await page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '暂停接收', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: '编辑配置', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: '删除渠道', exact: true })).toBeEnabled();
  await expect(page.getByRole('menu')).toContainText(unavailable === 'unavailable' ? '当前接入不可操作' : '未声明暂停接收能力');
});

for (const failure of ['network', 'incomplete', 'uncertain-409'] as const) test(`结果未知 ${failure} 关闭重开仍锁定，只读核对版本与实际状态`, async ({ page }) => {
  const state = await setup(page); let writes = 0;
  await page.route(routeIngress, route => {
    writes++;
    return failure === 'network' ? route.abort('failed') : route.fulfill(failure === 'incomplete'
      ? { json: { ok: true } } : { status: 409, json: { error: 'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN' } });
  });
  let dialog = await open(page); await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '核对接收状态', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  dialog = await open(page, '核对接收状态');
  await expect(dialog.getByRole('button', { name: '暂停接收', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '核对接收状态', exact: true }).click();
  await expect(dialog).toContainText('保存版本未变化'); expect(writes).toBe(1);
  state.data.items = [base({ requestedPaused: true, state: 'receiving' }, { savedVersion: version('b') })];
  await dialog.getByRole('button', { name: '核对接收状态', exact: true }).click();
  await expect(dialog).toContainText('本次操作结果仍未确认');
  state.data.items = [base({ requestedPaused: true, state: 'paused' }, { savedVersion: version('b') })];
  await dialog.getByRole('button', { name: '核对接收状态', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(writes).toBe(1);
  await expect(page.locator('.channels-page > [role="status"]')).toContainText('只读核对当前状态');
});

test('等待认证但 available 为 true 时仍可保存暂停意图，不宣称实际已暂停', async ({ page }) => {
  const waiting = base({ available: true, state: 'unavailable', errorCode: 'DINGTALK_AUTH_REQUIRED' }, {
    connectionState: 'waiting-auth', errorCode: 'CHANNEL_AUTH_REQUIRED', connected: false,
  });
  const state = await setup(page, waiting); let writes = 0;
  await page.route(routeIngress, route => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: version('a'), paused: true, confirm: true });
    state.data.items = [{ ...waiting, savedVersion: version('b'), ingress: { ...waiting.ingress!, requestedPaused: true } }];
    return route.fulfill({ json: receipt(state.data.items[0], true, false) });
  });
  const dialog = await open(page);
  await expect(dialog.getByRole('button', { name: '暂停接收', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog).toContainText('渠道仍在等待认证，暂停意图已保存');
  await expect(dialog).toContainText('实际接收状态尚未确认');
  await expect(page.locator('.channel-card-tag')).toHaveText('需要认证');
  await expect(page.locator('.channels-page > [role="status"]')).not.toContainText('已暂停消息接收');
  expect(writes).toBe(1);
});

for (const [status, code] of [[403, 'FORBIDDEN'], [409, 'DINGTALK_CHANNEL_VERSION_CONFLICT']] as const) test(`明确拒绝 ${status} 先只读刷新，用户重新确认才重试`, async ({ page }) => {
  const state = await setup(page); let writes = 0;
  await page.route(routeIngress, route => {
    writes++;
    if (writes === 1) return route.fulfill({ status, json: { error: code } });
    expect(route.request().postDataJSON().expectedVersion).toBe(version('b'));
    state.data.items = [base({ requestedPaused: true, state: 'paused' }, { savedVersion: version('c') })];
    return route.fulfill({ json: receipt(state.data.items[0]) });
  });
  const dialog = await open(page); await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '重新读取状态', exact: true })).toBeVisible();
  await expect(dialog).toContainText(status === 403 ? '没有访问权限' : '渠道配置已变化');
  state.data.items = [base({}, { savedVersion: version('b') })];
  await dialog.getByRole('button', { name: '重新读取状态', exact: true }).click(); expect(writes).toBe(1);
  await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(writes).toBe(2);
});

test('应用失败不报成功，保留已保存版本供显式重试同一暂停意图', async ({ page }) => {
  const state = await setup(page); let writes = 0;
  await page.route(routeIngress, route => {
    writes++;
    if (writes === 1) {
      state.data.items = [base({ requestedPaused: true, state: 'error', errorCode: 'CHANNEL_INGRESS_APPLY_FAILED' }, { savedVersion: version('b') })];
      return route.fulfill({ json: receipt(state.data.items[0], true, false) });
    }
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: version('b'), paused: true, confirm: true });
    state.data.items = [base({ requestedPaused: true, state: 'paused' }, { savedVersion: version('b') })];
    return route.fulfill({ json: receipt(state.data.items[0], false) });
  });
  const dialog = await open(page); await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog).toContainText('暂停请求已保存，但实际接收状态异常');
  await expect(page.locator('.channel-card-tag')).toHaveText('接收异常');
  await dialog.getByRole('button', { name: '重试暂停接收', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(writes).toBe(2);
});

test('暂停排空中不显示已暂停，恢复失败仍可明确重试恢复', async ({ page }) => {
  const state = await setup(page, base({ requestedPaused: true, state: 'pausing' }));
  await expect(page.locator('.channel-card-tag')).toHaveText('正在暂停');
  await page.route(routeIngress, route => {
    state.data.items = [base({ state: 'error', errorCode: 'CHANNEL_HISTORY_INCOMPLETE' }, { savedVersion: version('b') })];
    return route.fulfill({ json: receipt(state.data.items[0], true, false) });
  });
  const dialog = await open(page, '恢复接收'); await dialog.getByRole('button', { name: '恢复接收', exact: true }).click();
  await expect(dialog).toContainText('消息接收尚未恢复');
  await expect(dialog.getByRole('button', { name: '重试恢复接收', exact: true })).toBeEnabled();
});

for (const channelId of ['.', '..', '群/测试?']) test(`特殊渠道 ID ${channelId} 走安全路径`, async ({ page }) => {
  const state = await setup(page, base({}, { channelId }));
  await page.route(routeIngress, route => {
    const url = new URL(route.request().url());
    if (channelId === '.' || channelId === '..') { expect(url.pathname).toBe('/api/channels/ingress'); expect(url.searchParams.get('channelId')).toBe(channelId); }
    else expect(url.pathname).toBe(`/api/channels/${encodeURIComponent(channelId)}/ingress`);
    state.data.items = [base({ requestedPaused: true, state: 'paused' }, { channelId, savedVersion: version('b') })];
    return route.fulfill({ json: receipt(state.data.items[0]) });
  });
  const dialog = await open(page, '暂停接收', channelId); await dialog.getByRole('button', { name: '暂停接收', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
