import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

for (const [label, restartRequired, liveApplied] of [['在线应用',false,true],['待重启',true,false],['尚未激活',false,false]] as const) test(`新增渠道按真实回执反馈：${label}`, async ({page}) => {
  await page.goto('/#/channels');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await page.getByRole('button', {name: '添加渠道', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '添加渠道', exact: true});
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('dingtalk-dws');
  await dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true}).fill('live-feedback');
  await dialog.getByLabel('群 ID', {exact: true}).fill('fixture-only-room');
  let writes = 0;
  await page.route('**/api/channels/dingtalk', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    await route.fulfill({json: {ok: true, changed: true, restartRequired, liveApplied, channel: {
      channelId: 'live-feedback', type: 'dingtalk-dws', enabled: true, savedVersion: 'a'.repeat(64),
      runningVersion: restartRequired ? null : 'a'.repeat(64), restartRequired, liveApplied,
    }}});
  });
  await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click();
  await expect(dialog).toContainText(restartRequired ? '保存配置待重启' : liveApplied ? '已应用到运行态' : '尚未激活');
  await expect(dialog).not.toContainText('保存结果未知');
  await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeDisabled();
  expect(writes).toBe(1);
});
