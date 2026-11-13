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
    expect(await message.locator('.three-line-content').evaluate(el => {
      const first = el.querySelector('p')!;
      const range = document.createRange(); range.selectNodeContents(first);
      const visible = [...range.getClientRects()].filter(rect => rect.bottom <= el.getBoundingClientRect().bottom + 1);
      return visible.length;
    })).toBe(3);
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
      const pane=page.locator('.task-workspace > .conversation-page');
      const paneBox=(await pane.boundingBox())!;
      const headerBox=(await page.locator('.main-frame > .workspace-topbar').boundingBox())!;
      expect(headerBox.height).toBe(width <= 520 ? 48 : 52);
      const main=page.locator('.main-panel.task-workspace-panel');
      const mainBox=(await main.boundingBox())!;
      expect(mainBox.y).toBe(headerBox.y + headerBox.height);
      const scroll=await main.evaluate(el=>({top:el.scrollTop,overflowY:getComputedStyle(el).overflowY}));
      expect(paneBox.y + scroll.top).toBe(mainBox.y);
      expect(['auto','hidden','scroll']).toContain(scroll.overflowY);
      expect(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.workspace-topbar')),
        {x:paneBox.x + Math.min(paneBox.width / 2,200),y:headerBox.y + headerBox.height - 1})).toBe(true);
      await expect(pane.locator('.header-location')).toHaveCount(0);
      const body=(await message.locator('.message-body').boundingBox())!;
      expect(paneBox.x+paneBox.width-body.x-body.width).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('.agent-progress-heading').scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before=(await message.boundingBox())!;
      await page.locator('.agent-progress-heading').click();
      const after=(await message.boundingBox())!;
      expect(Math.abs(after.y-before.y)).toBeLessThan(2);
      const todo=(await page.locator('.execution-todos').boundingBox())!;
      const start=(await page.locator('.execution-history-start').boundingBox())!;
      expect(todo.y+todo.height).toBeLessThanOrEqual(start.y);
      const steps=page.locator('.agent-progress-steps');
      expect(await steps.evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
      await page.locator('.agent-progress-heading').click();
      // This screenshot represents the first screen, not retained outer scroll after resizing.
      await main.evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:test.info().outputPath(`task-compact-${width}-${theme}.png`)});
    }
  }
});

test('task and chat share responsive message reading width and side insets', async ({page}) => {
  await page.goto('/#/chat');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  for (const width of [1920,1440,390]) {
    await page.setViewportSize({width,height:960});
    await page.goto('/#/chat');
    const chatColumn=page.locator('.chat-panel .message-column').first();
    await expect(chatColumn).toBeVisible();
    const chat=await chatColumn.evaluate(el=>{
      const css=getComputedStyle(el);
      return {maxWidth:css.maxWidth,left:css.paddingLeft,right:css.paddingRight};
    });
    await page.goto('/#/tasks/task-research');
    const taskColumn=page.locator('.task-dialogue .message-column').first();
    await expect(taskColumn).toBeVisible();
    const task=await taskColumn.evaluate(el=>{
      const css=getComputedStyle(el);
      const parent=el.parentElement!;
      const box=el.getBoundingClientRect(), viewport=parent.getBoundingClientRect();
      return {maxWidth:css.maxWidth,left:css.paddingLeft,right:css.paddingRight,
        width:box.width, parentWidth:parent.clientWidth, x:box.left-viewport.left};
    });
    expect(task.maxWidth).toBe(chat.maxWidth);
    expect(task.left).toBe(chat.left);
    expect(task.right).toBe(chat.right);
    expect(task.width).toBeLessThanOrEqual(800);
    expect(task.width).toBeLessThanOrEqual(task.parentWidth+1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
