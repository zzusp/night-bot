import { expect, test } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

test('任务详情只在有按需通知时显示送达状态', async ({page}) => {
  await page.route('**/api/tasks/task-research',async route => {
    const data=await(await route.fetch()).json();
    await route.fulfill({json:{...data,controlState:'active',milestone:{trigger:'UAT2 部署',text:'新版已部署到 UAT2，尚未做业务验证。',state:'unknown',waitForDelivery:true}}});
  });
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  const details=page.getByRole('complementary',{name:'任务详情'});
  await expect(details.getByText('等待通知送达',{exact:true})).toBeVisible();
  await expect(details.getByText('新版已部署到 UAT2，尚未做业务验证。',{exact:true})).toBeVisible();
  await expect(details.getByText('通知送达后继续',{exact:true})).toBeVisible();
});
