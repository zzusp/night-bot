import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const call = (id: string, toolName: string, args: unknown, extra = {}) => ({id, role: 'tool', kind: 'tool-call', callId: id, toolName, text: JSON.stringify(args), status: 'pending', ...extra});
const output = (id: string, toolName: string, text: string, extra = {}) => ({id: `${id}-out`, role: 'tool', kind: 'tool-result', callId: id, toolName, text, status: 'completed', ...extra});
async function open(page: Page, items: unknown[]) {
  await page.route('**/api/tasks/task-research/session?*', route => route.fulfill({json: {status: 'ready', scope: 'current-context', items, total: items.length, revision: 'pi-web-tools'}}));
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  for (const group of await page.locator('.execution-tool-group:not([open]) > summary').all()) await group.click();
}

test('pi-web single disclosure shows object status real duration and request edit, with no inner parameter fold', async ({page}) => {
  await open(page, [call('edit', 'edit', {path: '/fixture/demo.ts', edits: [{oldText: 'const n = 1;\n', newText: 'const n = 2;\n'}]}), output('edit', 'edit', '修改已完成', {timing: {durationMs: 1250}})]);
  const card = page.locator('[data-message-id="edit"]');
  await expect(card).toHaveAttribute('data-record-ids', 'edit edit-out');
  await expect(card.locator('.pi-web-tool-summary')).toContainText('edit /fixture/demo.ts');
  await expect(card.locator('.pi-web-tool-duration')).toHaveText('1.3s');
  await expect(card.locator('.pi-tool-body')).toHaveCount(0);
  await card.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.pi-tool-body')).toBeVisible();
  await expect(card.locator('details')).toHaveCount(1);
  await expect(card.locator('.pi-read-path')).toContainText('请求修改');
  const request = card.getByLabel('请求修改预览');
  await expect(request.locator('.pi-edit-row.is-removed .pi-edit-code').first()).toHaveText('const n = 1;');
  await expect(request.locator('.pi-edit-row.is-added .pi-edit-code').first()).toHaveText('const n = 2;');
  await expect(request.locator('[data-line]')).toHaveCount(0);
  await expect(card.getByLabel('已应用的文件修改')).toHaveCount(0);
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.pi-web-tool-frame').analyze()).violations).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`pi-web-tool-${width}-${theme}.png`)});
  }
});

test('empty parameters and results produce no disclosure or placeholder, and timeout is not elapsed', async ({page}) => {
  await open(page, [call('empty', 'job_list', {}), output('empty', 'job_list', ''), {id:'split', role:'assistant', text:'继续'}, call('shell', 'bash', {command:'echo hello', timeoutMs:7000})]);
  const empty = page.locator('[data-message-id="empty"]');
  await expect(empty.locator('.pi-web-tool-card')).toBeVisible();
  await expect(empty.locator('details')).toHaveCount(0);
  await expect(empty).not.toContainText('本页无输入');
  await expect(empty).not.toContainText('尚无结果');
  const shell = page.locator('[data-message-id="shell"]');
  await expect(shell.locator('.pi-web-tool-duration')).toHaveCount(0);
  await shell.locator('summary').click();
  await expect(shell.locator('.tool-part')).toHaveCount(1);
  await expect(shell.locator('.pi-shell-command small')).toHaveText('(timeout: 7s)');
});

test('truncated input stays an exact fragment and failure reason appears only inside expanded output', async ({page}) => {
  const fragment = '{"path":"/fixture/partial.ts","edits":[';
  await open(page, [{...call('partial', 'edit', {}), text: fragment, truncated: true}, output('partial', 'edit', '文件不存在（FILE_NOT_FOUND）', {status:'error', isError:true})]);
  const card = page.locator('[data-message-id="partial"]');
  await expect(card.locator('.pi-web-tool-summary')).not.toContainText('FILE_NOT_FOUND');
  await expect(card.locator('[title]')).toHaveCount(0);
  await card.locator('summary').click();
  expect(await card.locator('.tool-part').first().locator('code').textContent()).toBe(fragment);
  await expect(card.locator('.pi-web-edit')).toHaveCount(0);
  await expect(card.locator('.tool-part').last()).toContainText('文件不存在（FILE_NOT_FOUND）');
  await card.locator('summary').click();
  await expect(card.locator('.pi-tool-body')).not.toBeVisible();
});

test('read tool shows its path once, but keeps additional input such as a line range', async ({page}) => {
  await open(page, [
    call('read-brief', 'read', {path:'docs/release-checklist.md'}),
    output('read-brief', 'read', '发布检查：构建、健康检查、回退版本。', {timing:{durationMs:2400}}),
    call('read-range', 'read', {path:'docs/release-checklist.md', offset:12, limit:3}),
    output('read-range', 'read', '字段检查'),
  ]);
  const brief = page.locator('[data-message-id="read-brief"]');
  await brief.locator('summary').click();
  await expect(brief.locator('.pi-web-tool-object')).toHaveText('docs/release-checklist.md');
  await expect(brief.locator('.pi-read-path')).toHaveCount(0);
  await expect(brief.locator('.tool-part')).toHaveCount(1);
  await expect(brief.locator('.tool-part')).toContainText('发布检查');
  await brief.screenshot({path: test.info().outputPath('read-tool-expanded.png')});
  const range = page.locator('[data-message-id="read-range"]');
  await range.locator('summary').click();
  await expect(range.locator('.pi-read-path')).toContainText('从第 12 行');
  await expect(range.locator('.pi-read-path')).toContainText('3 行');
});

test('shell follows the reference: command on the disclosure, one gray output panel, status at bottom right and time fixed in the title', async ({page}) => {
  const command = 'Get-Content -LiteralPath docs/release-checklist.md | Select-Object -Skip 84';
  const stdout = [ '85: 发布前先确认部署版本。', '86: 检查健康探针和首页。', '87: 只摘录定位问题所需的最小片段。', '88: ' + '保留必要的上下文。'.repeat(18), '89: 确认回退版本。', '90: 验证后记录结果。', '', '92: 结束。'].join('\n');
  await open(page, [call('terminal', 'pwsh', {command}), output('terminal', 'pwsh', stdout, {timing:{durationMs:2100}})]);
  const card = page.locator('[data-message-id="terminal"]');
  await expect(card.locator('summary')).toContainText(command);
  await expect(card.locator('summary .pi-tool-state')).toBeVisible();
  const elapsed = card.locator('summary .pi-web-tool-duration');
  await expect(elapsed).toHaveText('2.1s');
  const closedPosition = (await elapsed.boundingBox())!;
  await card.locator('summary').click();
  await expect(card.locator('summary .pi-tool-state')).toBeHidden();
  await expect(card.locator('.pi-web-tool-body-title')).toHaveText('Shell');
  await expect(card.locator('.pi-web-tool-footer')).toHaveText('成功');
  await expect(card.locator('.pi-web-tool-duration')).toHaveCount(1);
  await expect(elapsed).toBeVisible();
  const expandedPosition = (await elapsed.boundingBox())!;
  expect(expandedPosition.x).toBeCloseTo(closedPosition.x, 0);
  expect(expandedPosition.y).toBeCloseTo(closedPosition.y, 0);
  const out = card.locator('.pi-plain-output');
  expect(await out.locator('code').textContent()).toBe(stdout);
  expect(await out.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({width, height: 960});
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.pi-web-tool-frame').analyze()).violations).toEqual([]);
    await page.mouse.move(1, 1);
    await card.screenshot({path: test.info().outputPath(`shell-reference-${theme}.png`)});
  }
});

test('consecutive tool activity uses compact row spacing without shrinking narrow touch targets', async ({page}) => {
  await open(page, [
    call('one', 'job_list', {}), output('one', 'job_list', '没有后台任务。'),
    call('two', 'job_list', {}), output('two', 'job_list', '没有后台任务。'),
  ]);
  const first = page.locator('[data-message-id="one"]');
  const second = page.locator('[data-message-id="two"]');
  await first.locator('summary').click();
  for (const [width, rowHeight] of [[1440, 26], [390, 44]]) {
    await page.setViewportSize({width,height:940});
    const a = (await first.boundingBox())!, b = (await second.boundingBox())!;
    expect(b.y - (a.y + a.height)).toBeLessThanOrEqual(4.1);
    const height = (await second.locator('summary').boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(rowHeight);
    expect(height).toBeLessThanOrEqual(rowHeight+1);
  }
});

test('task Skill remains folded by default and can be expanded by selecting a body search hit', async ({page}) => {
  const name = 'task-scope-review';
  const body = '检查前置条件并核对可用版本。';
  await open(page, [call('review-skill', 'skill', {action:'加载技能'}), output('review-skill', 'skill', body, {resourceContent:true, skillName:name})]);
  const card = page.locator('[data-message-id="review-skill"]');
  await expect(card.locator('.pi-web-tool-object')).toHaveText(name);
  await expect(card.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await expect(card.locator('.pi-tool-body')).toHaveCount(0);
  await page.getByRole('button',{name:'搜索执行记录',exact:true}).click();
  const search = page.getByRole('region',{name:'搜索执行记录'});
  await search.getByRole('searchbox').fill('核对可用版本');
  await search.getByRole('searchbox').press('Enter');
  await expect(search.getByRole('status')).toContainText('1 /');
  await expect(card.locator('.specialized-tool-text')).toHaveText(body);
  await card.locator('summary').click();
  await expect(card.locator('.specialized-tool-text')).toBeHidden();
});

test('compact Shell titles, statuses and elapsed text share a baseline, with centered arrows', async ({page}) => {
  const first = 'Get-Content -LiteralPath docs/release-checklist.md | Select-Object -First 10';
  const second = 'git status --short --branch';
  await open(page, [
    call('alignment-one', 'pwsh', {command:first}), output('alignment-one', 'pwsh', '检查完毕', {timing:{durationMs:7300}}),
    call('alignment-two', 'bash', {command:second}), output('alignment-two', 'bash', '干净', {timing:{durationMs:9200}}),
    {id:'protected-compact',kind:'compaction',role:'assistant',text:'',createdAt:'2026-11-23T15:54:00.000Z',compaction:{summaryHidden:true},timing:{durationMs:3680}},
    {id:'public-compact',kind:'compaction',role:'assistant',text:'保留关键结论。',createdAt:'2026-11-23T15:55:00.000Z',compaction:{mode:'foreground'},timing:{durationMs:1250}},
    {id:'old-compact',kind:'compaction',role:'assistant',text:'',createdAt:'2026-11-23T15:56:00.000Z',compaction:{summaryHidden:true}},
  ]);
  const record=page.locator('.execution-transcript');
  for (const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:940});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
    for (const [id,command,duration] of [['alignment-one',first,'7.3s'],['alignment-two',second,'9.2s']]) {
      const summary = record.locator('[data-message-id="'+id+'"] .pi-web-tool-summary');
      await expect(summary.locator('.pi-web-tool-object')).toHaveText(command);
      await expect(summary.locator('.pi-tool-state')).toHaveText('成功');
      await expect(summary.locator('.pi-web-tool-duration')).toHaveText(duration);
      const layout=await summary.evaluate(el=>{
        const selector=['.pi-web-tool-object','.pi-tool-state','.pi-web-tool-duration'];
        const baselines=selector.map(name=>{
          const target=el.querySelector(name)!;
          const marker=document.createElement('span');
          marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0';
          target.prepend(marker);
          const y=marker.getBoundingClientRect().y;
          marker.remove();
          return y;
        });
        const middle=(node:Element)=>{const box=node.getBoundingClientRect();return box.y+box.height/2};
        return {spread:Math.max(...baselines)-Math.min(...baselines),arrowOffset:middle(el.querySelector('.pi-tool-chevron')!)-middle(el),width:el.getBoundingClientRect().width};
      });
      expect(layout.spread).toBeLessThanOrEqual(.5);
      expect(Math.abs(layout.arrowOffset)).toBeLessThanOrEqual(.5);
      expect(layout.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const cards=record.locator('.execution-compaction');
    await expect(cards.locator('.execution-timing-meta')).toHaveText(['用时 3.7s','用时 1.3s','耗时未记录']);
    await expect(cards.locator('time')).toHaveCount(0);
    await expect(cards.filter({hasText:'摘要未公开'})).toHaveCount(0);
    for (const card of await cards.all()) {
      expect((await card.boundingBox())!.height).toBe(width === 1440 ? 26 : 44);
    }
    const adjacent=record.locator('[data-message-id="alignment-two"] .pi-web-tool-summary');
    const tool=(await adjacent.boundingBox())!;
    expect(tool.height).toBe((await cards.first().boundingBox())!.height);
    const positions=await cards.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}));
    const stackGaps=positions.slice(1).map((row,i)=>row.top - positions[i].bottom);
    for (const gap of [positions[0].top - (tool.y + tool.height), ...stackGaps]) {
      expect(gap).toBeGreaterThanOrEqual(4);
      expect(gap).toBeLessThanOrEqual(8);
    }
    await cards.last().scrollIntoViewIfNeeded();
    await page.mouse.move(1,1);
    const clipFirst=(await adjacent.boundingBox())!, last=(await cards.last().boundingBox())!;
    await page.screenshot({path:test.info().outputPath(`compact-execution-rows-${width}.png`),clip:{
      x:Math.max(0,Math.floor(clipFirst.x)-4),y:Math.max(0,Math.floor(clipFirst.y)-4),
      width:Math.min(width,Math.ceil(clipFirst.width)+8),height:Math.ceil(last.y+last.height-clipFirst.y)+8,
    }});
  }
});

test('verified edit uses one inline patch, genuine line gutters and syntax on desktop and mobile', async ({page}) => {
  const path='src/example.ts';
  const diff=[' 23 export const release = {', ' 24   name: "night-bot",', '-25   version: 1,',
    '+25   version: 2,', '+26   ready: true,', ' 26   active: false,', ' 27 };', '    ...',
    ' 62 // Retain later context', '-63 const previous = 1;', '+64 const previous = 2;'].join('\n');
  const changes={path,edits:[{oldText:'version: 1,',newText:'version: 2,\n  ready: true,'}]};
  await open(page, [
    call('public-edit','edit',changes), output('public-edit','edit',diff,{editDiff:true}),
    {id:'split-edit',role:'assistant',text:'另一个文件没有匹配的修改。'},
    call('failed-edit','edit',changes),output('failed-edit','edit','原文未找到',{isError:true,status:'error'}),
    {id:'split-unproved',role:'assistant',text:'没有已应用的差异。'},
    call('unproved-edit','edit',changes),output('unproved-edit','edit',diff),
  ]);
  const [success,failed,unproved]=['public-edit','failed-edit','unproved-edit'].map(id=>page.locator('[data-message-id="'+id+'"]'));
  await success.locator('summary').focus();
  await page.keyboard.press('Enter');
  const patch=success.getByLabel('已应用的文件修改');
  await expect(patch).toBeVisible();
  await expect(success.getByLabel('请求修改预览')).toHaveCount(0);
  await expect(patch.locator('.pi-edit-row').nth(1).locator('.pi-edit-code')).toHaveText('name: "night-bot",');
  await expect(patch.locator('.pi-edit-row.is-removed [data-line]')).toHaveText(['25','63']);
  await expect(patch.locator('.pi-edit-row.is-added [data-line]')).toHaveText(['25','26','64']);
  await expect(patch.locator('.pi-edit-row.is-removed .pi-edit-marker')).toHaveText(['-','-']);
  await expect(patch.locator('.pi-edit-row.is-added .pi-edit-marker')).toHaveText(['+','+','+']);
  await expect(patch.locator('.pi-edit-row.is-omitted [data-line]')).toHaveCount(0);
  await expect(patch.locator('.pi-token-keyword').first()).toBeVisible();
  await expect(patch.locator('.pi-token-string').first()).toBeVisible();
  for (const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const grid=await patch.evaluate(box=>{
      const one=box.querySelector('.pi-edit-row.is-removed')!,two=box.querySelector('.pi-edit-row.is-added')!;
      const a=one.getBoundingClientRect(),b=two.getBoundingClientRect();
      return {left:a.left-b.left,height:b.top-a.top, removed:getComputedStyle(one).backgroundColor,added:getComputedStyle(two).backgroundColor};
    });
    expect(grid.left).toBe(0); expect(grid.height).toBeGreaterThan(0); expect(grid.removed).not.toBe(grid.added);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.pi-web-edit-diff').analyze()).violations).toEqual([]);
    await success.screenshot({path:test.info().outputPath(`inline-pi-edit-${width}.png`)});
  }
  await failed.locator('summary').click();
  await expect(failed.getByLabel('请求修改预览')).toBeVisible();
  await expect(failed.getByLabel('已应用的文件修改')).toHaveCount(0);
  await expect(failed).toContainText('原文未找到');
  await unproved.locator('summary').click();
  await expect(unproved.getByLabel('请求修改预览')).toBeVisible();
  await expect(unproved.getByLabel('已应用的文件修改')).toHaveCount(0);
});
