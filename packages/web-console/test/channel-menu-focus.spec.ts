import { test, expect } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/channels');
  await page.getByLabel('访问令牌', { exact: true }).fill(FIXTURE_TOKEN);
  await page.getByRole('button', { name: '连接工作空间', exact: true }).click();
  await page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true }).waitFor();
}

for (const width of [1440, 390]) test(`编辑关闭稳定回到菜单触发器：${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await login(page);
  const trigger = page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true });
  const dialog = page.getByRole('dialog', { name: '编辑钉钉渠道', exact: true });
  for (let turn = 0; turn < 18; turn++) {
    if (turn % 2) { await trigger.focus(); await page.keyboard.press('Enter'); }
    else await trigger.click();
    await page.getByRole('menuitem', { name: '编辑配置', exact: true }).click();
    await expect(dialog).toBeVisible();
    // Visibility is not proof that the initial config read is finished. The
    // existing busy-cancel guard intentionally rejects Escape while reading.
    await expect(dialog.getByRole('button', { name: '关闭编辑钉钉渠道', exact: true })).toBeEnabled();
    if (turn % 3 === 0) await page.keyboard.press('Escape');
    else if (turn % 3 === 1) await dialog.getByRole('button', { name: '关闭编辑钉钉渠道', exact: true }).click();
    else await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
});

test('加载中 Escape 保持弹窗，实际关闭后恢复焦点', async ({ page }) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/channels/dingtalk/dingtalk-work', async route => {
    await blocked; await route.continue();
  });
  const trigger = page.getByRole('button', { name: '渠道操作：dingtalk-work', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: '编辑配置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑钉钉渠道', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭编辑钉钉渠道', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole('button', { name: '关闭编辑钉钉渠道', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
