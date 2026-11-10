import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

for (const width of [1440, 390]) test(`下方健康状态遵循实际运行值且不出现新增内容：${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 960});
  await page.goto('/#/channels');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  const card = page.locator('.channel-card').filter({has: page.getByRole('button', {name: '渠道操作：dingtalk-work', exact: true})});
  await expect(card.locator('.channel-card-health')).toHaveText('健康检查正常');
  await expect(card.locator('.channel-card-target, .channel-card-responsibility, .channel-card-id')).toHaveCount(0);
  const trigger = card.getByRole('button', {name: '渠道操作：dingtalk-work', exact: true});
  await trigger.click();
  await expect(page.getByRole('menuitem', {name: '编辑配置', exact: true})).toBeVisible();
  await expect(page.getByRole('menuitem', {name: '删除渠道', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

// State variants originate at the isolated adapter, not response interception.
for (const scenario of ['normal','abnormal','not-ready','missing','blocked']) test(`健康状态实页渲染：${scenario}`, async ({page}) => {
  const {startPreview} = await import('./preview.mjs');
  const {healthScenarios} = await import('./channel-health-scenarios.mjs');
  const sample = healthScenarios.find(item => item.id === scenario)!;
  const fixture = await startPreview({port: 0, replyDelayMs: 0, dingtalkHealth: sample.health, dingtalkBindingActive: sample.bindingActive});
  try {
    await page.goto(fixture.origin + '/#/channels');
    await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
    await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
    const card = page.locator('.channel-card').filter({has: page.getByRole('button', {name: '渠道操作：dingtalk-work', exact: true})});
    await expect(card.locator('.channel-card-health')).toHaveText(sample.label);
    await expect(card.locator('.channel-card-health')).toHaveClass(new RegExp(`channel-card-health--${sample.kind}`));
    expect(await card.locator('.board-badge').count()).toBeLessThanOrEqual(1);
    await expect(card.locator('.channel-card-error')).toHaveCount(0);
    await expect(card).not.toContainText('请先处理旧依赖');
    await expect(card).not.toContainText('适配器异常，请查看运维说明');
    await page.setViewportSize({width: 390, height: 844});
    await expect(card.locator('.channel-card-health')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  } finally { await fixture.close(); }
});
