import {test, expect, type Page, type Locator} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

async function login(page: Page, route = '/#/chat') {
  await page.goto(route);
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await expect(page.locator('.main-panel')).toBeVisible();
  await expect(page.locator('.rail-footer')).toHaveCount(0);
}
async function layout(page: Page, surface: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await surface.locator('p:visible').evaluateAll(nodes => nodes.filter(node => !node.textContent?.trim()).length)).toBe(0);
}

for (const width of [1440, 390]) test(`页面精简文案后无空段落或横向溢出 ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 960});
  await page.route('**/api/evolution?*', route => route.fulfill({json: {status: 'ready', memory: {}, skills: {}, items: [{id: 'copy-memory', kind: 'memory', name: '示例记忆', scope: 'bot', status: 'applied', revision: 1}], total: 1, offset: 0, nextOffset: null}}));
  await login(page);
  for (const [name, route, ready] of [
    ['chat', '/#/chat', '.board-composer'],
    ['tasks', '/#/tasks', '.task-table'],
    ['task', '/#/tasks/task-research', '.task-info-title'],
    ['review', '/#/tasks/task-research?view=review', '.learning-page .detail-section'],
    ['learning', '/#/tasks/task-research?view=learning', '.learning-page .detail-section'],
    ['channels', '/#/channels', '.channel-cards'],
    ['channel-empty', '/#/channels/room-empty', '.board-empty'],
    ['evolution', '/#/evolution', '.evolution-table'],
  ]) {
    await page.goto(route);
    await expect(page.locator(ready).first()).toBeVisible();
    await expect(page.locator('.main-panel')).not.toContainText('复盘完成与学习变更分别记录');
    await expect(page.locator('.main-panel .board-empty > p')).toHaveCount(0);
    await layout(page, page.locator('.main-panel'));
    await page.screenshot({path: test.info().outputPath(`${name}-${width}.png`)});
  }
});

test('登录、空态与欢迎按钮以标签和动作表达，移除说明后保持间距', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');
  const card = page.locator('.login-card');
  await expect(card.locator('.field-help,.login-security')).toHaveCount(0);
  await expect(card.locator('.field-error')).toBeHidden();
  const token = await card.locator('.token-input').boundingBox();
  const submit = await card.getByRole('button', {name: '连接工作空间'}).boundingBox();
  expect(submit!.y - token!.y - token!.height).toBeGreaterThanOrEqual(12);
  expect(submit!.y - token!.y - token!.height).toBeLessThanOrEqual(20);
  await card.getByRole('button', {name: '连接工作空间'}).click();
  await expect(page.getByLabel('访问令牌', {exact: true})).toBeFocused();
  await expect(card.getByRole('alert')).toContainText('请输入');
  await login(page, '/#/missing');
  await expect(page.getByRole('heading', {name: '页面不存在', level: 1})).toBeVisible();
  await expect(page.locator('.board-empty > p')).toHaveCount(0);
  await page.getByRole('link', {name: '返回对话', exact: true}).click();
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});

for (const width of [1440, 390]) test(`表单与弹窗保留安全边界、错误关联和关闭焦点 ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await login(page, '/#/channels');
  const add = page.getByRole('button', {name: '添加渠道', exact: true});
  await add.click();
  const dialog = page.getByRole('dialog', {name: '添加渠道', exact: true});
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('dingtalk-dws');
  await expect(dialog.locator('.channel-account')).toContainText('Bot 当前登录账号');
  await expect(dialog.locator('.channel-create-boundary')).toHaveCount(0);
  await expect(dialog.locator('.field-help:visible')).toHaveCount(1);
  await expect(dialog).toContainText('关闭不会撤回已发送的消息');
  await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click();
  const id = dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true});
  await expect(id).toBeFocused();
  await expect(id).toHaveAttribute('aria-invalid', 'true');
  // The invalid field and its label must both remain below the fixed dialog header.
  await expect.poll(async () => {
    const label = await dialog.locator('label').filter({hasText: /^渠道标识$/}).filter({visible: true}).boundingBox();
    const heading = await dialog.locator('.channel-create-heading').boundingBox();
    return label!.y - heading!.y - heading!.height;
  }).toBeGreaterThanOrEqual(0);
  expect(await dialog.locator('[aria-describedby]').evaluateAll(nodes => nodes.flatMap(node => (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && !document.getElementById(id))))).toEqual([]);
  await layout(page, dialog);
  expect((await new AxeBuilder({page}).include('dialog[open]').analyze()).violations).toEqual([]);
  await page.screenshot({path: test.info().outputPath(`channel-form-${width}.png`)});
  await dialog.getByRole('button', {name: '关闭添加渠道'}).click();
  await expect(add).toBeFocused();
  await page.route('**/api/permissions', route => route.fulfill({json: {mode: 'full', options: [{value: 'full', label: '完全访问', description: '使用当前系统账号权限'}], requests: [], protection: {status: 'unconfined', backend: 'direct', description: '进程未隔离'}}}));
  await page.getByRole('button', {name: '权限与审批', exact: true}).click();
  const permissions = page.getByRole('dialog', {name: '权限与审批', exact: true});
  await expect(permissions).toContainText('不会取得管理员权限');
  await expect(permissions).toContainText('切换模式会使旧待批请求和未消费授权失效');
  await expect(permissions).not.toContainText('当前模式来自 Host');
  await layout(page, permissions);
  await page.screenshot({path: test.info().outputPath(`permissions-${width}.png`)});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: '权限与审批', exact: true})).toBeFocused();
});

test('设置卡不为已删除说明和空反馈留白，角色保存确认保持可取消', async ({page}) => {
  await login(page, '/#/settings');
  const appearance = page.locator('.settings-card').filter({has: page.getByRole('heading', {name: '助手外观', exact: true})});
  const role = page.locator('.settings-card').filter({has: page.getByRole('heading', {name: '一级分诊', exact: true})});
  const workLog = page.locator('.settings-card').filter({has: page.getByRole('heading', {name: '每日工作日志', exact: true})});
  await expect(appearance.locator('.field-help')).toHaveCount(0);
  await expect(role.locator('[id$="-help"]')).toHaveCount(0);
  await expect(workLog.locator('#work-log-help')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 844});
    for (const surface of [appearance, role, workLog]) await layout(page, surface);
  }
  await role.getByRole('button', {name: '保存一级分诊配置', exact: true}).click();
  const confirm = page.getByRole('dialog', {name: '保存一级分诊配置', exact: true});
  await expect(confirm).toContainText('正常重启后生效');
  await expect(confirm.getByRole('button', {name: '取消', exact: true})).toBeFocused();
  await layout(page, confirm);
  await page.keyboard.press('Escape');
  await expect(role.getByRole('button', {name: '保存一级分诊配置', exact: true})).toBeFocused();
});
