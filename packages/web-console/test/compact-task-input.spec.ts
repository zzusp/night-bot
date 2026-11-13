import { test, expect } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

// Sanitized fixtures, never a recording of the user's production conversation.
const long = '请核对项目当前状态，整理已有记录并给出下一步安排。'.repeat(12) + '\n\n**验收要求**\n\n- 保留完整原文，不生成替代摘要。\n- [参考资料](https://example.com/reference)\n\n```text\n原样保留代码\n最后一行\n```';
const rows = [
  {id:'old-input',role:'user',text:long},
  {id:'result',role:'assistant',text:'已核对记录，接下来整理执行结果。'},
  {id:'new-input',role:'user',text:'仅核对最新结果。'},
];
test('three rendered lines, accessible disclosure, resize, polling, canvas gutters and floating TODO', async ({ page }) => {
  await page.route('**/api/tasks/task-research/session?*', route => route.fulfill({json:{status:'ready',scope:'current-context',items:rows,total:rows.length,revision:'compact-fixture',todos:{items:[{text:'核对已有记录',status:'completed'},{text:'整理执行结果',status:'in_progress'},{text:'返回处理结论',status:'pending'}]}}}));
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  const message=page.locator('[data-message-id="old-input"]');
  const toggle=message.getByRole('button',{name:'展开',exact:true});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('[data-message-id="new-input"] .message-disclosure')).toHaveCount(0);
  await expect(message.locator('.markdown')).toContainText('最后一行');
  await expect(message.getByRole('link',{name:'参考资料'})).toHaveAttribute('tabindex','-1');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(message.getByRole('button',{name:'收起',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(message.getByRole('link',{name:'参考资料'})).not.toHaveAttribute('tabindex','-1');
  await page.waitForTimeout(2800);
  await expect(message.getByRole('button',{name:'收起',exact:true})).toHaveAttribute('aria-expanded','true');
  await message.getByRole('button',{name:'收起',exact:true}).click();
  for (const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:960});
    await expect(toggle).toBeVisible();
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
      const pane=page.locator('.task-workspace > .conversation-page');
      const paneBox=(await pane.boundingBox())!;
      if(width>760) expect(paneBox.y).toBeLessThan(16);
      const body=(await message.locator('.message-body').boundingBox())!;
      expect(paneBox.x+paneBox.width-body.x-body.width).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const before=(await message.boundingBox())!;
      await page.locator('.agent-progress-heading').click();
      const after=(await message.boundingBox())!;
      expect(Math.abs(after.y-before.y)).toBeLessThan(2);
      await page.locator('.agent-progress-heading').click();
      await page.screenshot({path:test.info().outputPath(`task-compact-${width}-${theme}.png`)});
    }
  }
});
