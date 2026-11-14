import { test, expect } from '@playwright/test';
import { FIXTURE_TOKEN } from './preview.mjs';

// Synthetic committed records: no production conversation or credential data.
test('TODO lane follows canvas width, retains choice during polling and exposes task rail toggle', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/tasks/task-research/session?*', route => {
    reads++;
    return route.fulfill({json:{status:'ready',scope:'current-context',revision:'responsive',total:42,
      items:[{id:'request',role:'user',text:'请核对当前方案，逐项检查任务中的全部验收要求。'.repeat(4)}, {id:'answer',role:'assistant',text:'正在核对配置与执行结果，随后整理验证记录。'}, ...Array.from({length:40}, (_,i)=>({id:`history-${i}`,role:'assistant',text:`已完成第 ${i+1} 项资料核对，正在整理来源和执行结果。`}))],
      todos:{items:Array.from({length:15},(_,i)=>({text:`${i+1}. 核对配置与执行记录，整理这一项的结果及后续安排。`,status:i<3?'completed':i===3?'in_progress':'pending'}))}}});
  });
  await page.setViewportSize({width:2560,height:960});
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  const card=page.locator('.agent-progress');
  const expectCentered = async () => {
    const canvas = (await page.locator('.task-dialogue .execution-history').boundingBox())!;
    const column = (await page.locator('.message-column').boundingBox())!;
    expect(Math.abs(column.x + column.width / 2 - canvas.x - canvas.width / 2)).toBeLessThanOrEqual(1);
  };
  await expectCentered();
  await expect(card).toHaveAttribute('open','');
  const bounds=await page.locator('.message-column').boundingBox();
  const box=(await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(bounds!.x+bounds!.width);
  expect(box.height).toBeGreaterThan(350);
  const scroller = page.locator('.task-dialogue .execution-transcript .transcript');
  const scrollBox = (await scroller.boundingBox())!;
  const canvas = (await page.locator('.task-dialogue .execution-history').boundingBox())!;
  expect(scrollBox.x + scrollBox.width).toBeCloseTo(canvas.x + canvas.width, 0);
  expect(scrollBox.x + scrollBox.width).toBeGreaterThan(box.x + box.width);
  // The card stays fixed while the actual execution record scrolls underneath.
  const cardTop = box.y;
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect((await card.boundingBox())!.y).toBeCloseTo(cardTop, 0);
  await card.locator('summary').click();
  await expect(card).not.toHaveAttribute('open','');
  const count=reads;
  await expect.poll(()=>reads).toBeGreaterThan(count);
  await expect(card).not.toHaveAttribute('open','');
  await card.locator('summary').click();
  await page.screenshot({path:test.info().outputPath('task-wide-expanded.png')});
  const rail=page.getByRole('complementary',{name:'任务详情'});
  await page.getByRole('button',{name:'隐藏任务面板',exact:true}).click();
  await expect(rail).toBeHidden();
  await expectCentered();
  await expect(page.getByRole('button',{name:'显示任务面板',exact:true})).toHaveAttribute('aria-expanded','false');
  await page.getByRole('button',{name:'显示任务面板',exact:true}).click();
  await expect(rail).toBeVisible();
  for (const width of [1920, 1440, 1024, 390]) {
    await page.setViewportSize({width,height:960});
    await expect(card).not.toHaveAttribute('open','');
    await expectCentered();
    await scroller.evaluate(el => { el.scrollTop = 0; });
    const firstMessage = page.locator('.message-user').first();
    const firstBox = (await firstMessage.boundingBox())!;
    const closedBox = (await card.boundingBox())!;
    expect(firstBox.y).toBeGreaterThanOrEqual(closedBox.y + closedBox.height);
    const disclosure = firstMessage.locator('.message-disclosure');
    if (await disclosure.count()) {
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await disclosure.click();
    }
    await card.locator('summary').click();
    await expectCentered();
    await expect(card).toHaveAttribute('open','');
    const b=(await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x+b.width).toBeLessThanOrEqual(width);
    expect(b.height).toBeGreaterThan(350);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`task-${width}-expanded.png`)});
    // Overlay is user-requested; Escape restores access to covered message controls.
    await page.keyboard.press('Escape');
    await expect(card).not.toHaveAttribute('open','');
    await expect(card.locator('summary')).toBeFocused();
    if (await disclosure.count()) {
      await disclosure.click();
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await disclosure.click();
    }
  }
  await page.setViewportSize({width:2560,height:960});
  await expect(card).toHaveAttribute('open','');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:test.info().outputPath('task-wide-dark.png')});
});
