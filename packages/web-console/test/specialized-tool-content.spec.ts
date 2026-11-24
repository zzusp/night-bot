import {expect, test, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

// Deliberately public projection fixtures. Raw names, queries, lookup IDs and
// child session details are exercised at the server boundary in the .test.js tests.
const endpoint = '**/api/conversations/room-product/session';
const source = {sessionId: 'fixture-router', entryId: 'fixture-entry'};
const pair = (id: string, toolName: string, input: string, output: string) => [
  {id: `call-${id}`, role: 'tool', kind: 'tool-call', callId: id, toolName, text: input, status: 'result-unrecorded', source},
  {id: `result-${id}`, role: 'tool', kind: 'tool-result', callId: id, toolName, text: output, status: 'completed', source},
];
const notice = '此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。';
const items = [
  ...pair('memory', 'memory_read', '{}', notice),
  ...pair('skill', 'skill', '{"action":"加载技能"}', notice),
  ...pair('lookup', 'resident_task_lookup_async', '{"taskCount":2}', '{"status":"pending","readOnly":true}'),
  ...pair('historical-child', 'subagent', '此工具尚未声明可展示的输入字段；调用名称与状态保留。', '此工具尚未声明可展示的结果字段；调用名称与状态保留。'),
];
const response = (rows: object[]) => ({status: 'ready', scope: 'current-router-session-context', items: rows, total: rows.length, nextOffset: null, revision: 'specialized-fixture', generation: 1});
async function open(page: Page) {
  await page.goto('/#/channels/room-product');
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click();
  await page.getByRole('tab', {name: '路由', exact: true}).click();
  const history = page.getByRole('tabpanel', {name: '路由', exact: true}).locator('.execution-history');
  await expect(history.locator('[data-message-id="call-lookup"]')).toBeAttached();
  for (const summary of await history.locator('.execution-tool-group:not([open]) > summary').all()) await summary.click();
  return history;
}

test('记忆/技能只显示获权内容，后台查询接纳与业务完成分开，无伪造子会话入口', async ({page}) => {
  test.setTimeout(60000);
  let denied = false;
  await page.route(endpoint + '?*', route => denied ? route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}}) : route.fulfill({json: response(items)}));
  const history = await open(page);
  for (const id of ['memory','skill','lookup','historical-child']) {
    const card = history.locator(`[data-message-id="call-${id}"] .pi-tool-step`);
    await card.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveAttribute('open');
  }
  const lookup = history.locator('[data-message-id="call-lookup"]');
  await expect(lookup.getByText('2 项任务', {exact: true})).toBeVisible();
  await expect(lookup.locator('.specialized-tool-content').getByText('已接纳，等待结果', {exact: true})).toBeVisible();
  await expect(lookup.locator('.pi-tool-step > summary')).toContainText('等待查询结果');
  await expect(lookup.locator('.pi-tool-step > summary')).not.toContainText('已完成');
  await expect(lookup.getByText('只读', {exact: true})).toBeVisible();
  await expect(lookup).not.toContainText('查询已完成');
  await expect(history.locator('[data-message-id="call-memory"]')).toContainText(notice);
  await expect(history.locator('[data-message-id="call-skill"]')).toContainText(notice);
  await expect(history.getByRole('button', {name: /子会话|子代理|打开技能|打开记忆/})).toHaveCount(0);
  await expect(history.locator('[data-message-id="call-historical-child"] a')).toHaveCount(0);
  for (const theme of ['light','dark']) for (const width of [1440,390]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({width, height: 960});
    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.execution-history').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  }
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(history.locator('.specialized-tool-content')).toHaveCount(0);
});

test('后台查询失败/超时只描述查询，不假设业务任务失败', async ({page}) => {
  const rows = ['pending','failed','timed-out','interrupted'].flatMap((status, index) => pair(index ? status : 'lookup', 'resident_task_lookup_async', '{"taskCount":1}', JSON.stringify({status, readOnly: true})));
  await page.route(endpoint + '?*', route => route.fulfill({json: response(rows)}));
  const history = await open(page);
  for (const id of ['lookup','failed','timed-out','interrupted']) await history.locator(`[data-message-id="call-${id}"] .pi-tool-step > summary`).click();
  for (const [id, text] of [['lookup','已接纳，等待结果'],['failed','查询失败'],['timed-out','查询超时'],['interrupted','查询已中断']]) {
    const card = history.locator(`[data-message-id="call-${id}"]`);
    await expect(card.locator('.specialized-tool-content').getByText(text, {exact: true})).toBeVisible();
    await expect(card).not.toContainText('任务失败');
    await expect(card).not.toContainText('任务已完成');
  }
});

test('专用卡正文仍使用同版分页，撤权后收起重开不恢复旧正文', async ({page}) => {
  const first = '已获权的工具提示。'.repeat(2000).slice(0,16000), tail = '正文结尾 <script>window.specializedExecuted=true</script>';
  let blocked = false;
  const rows = pair('lookup', 'memory_read', '{}', first).map(row => row.kind === 'tool-result' ? {...row, textTotal: first.length + tail.length, textNextOffset: first.length, truncated: true} : row);
  await page.route(endpoint + '?*', route => route.fulfill({json: response(rows)}));
  await page.route(endpoint + '/messages/result-lookup?*', route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('revision')).toBe('specialized-fixture');
    expect(url.searchParams.get('offset')).toBe(String(first.length));
    return blocked ? route.fulfill({status: 403, json: {error: 'RESOURCE_FORBIDDEN'}})
      : route.fulfill({json: {messageId: 'result-lookup',text: tail,offset: first.length,nextOffset: null,total: first.length + tail.length,revision: 'specialized-fixture',source}});
  });
  const history = await open(page), card = history.locator('[data-message-id="call-lookup"] .pi-tool-step');
  await card.locator(':scope > summary').click();
  await card.getByRole('button', {name: '下一段', exact: true}).click();
  await expect(card.locator('.specialized-tool-text').last()).toHaveText(tail);
  expect(await page.evaluate(() => 'specializedExecuted' in window)).toBe(false);
  await card.getByRole('button', {name: '上一段', exact: true}).click();
  blocked = true;
  await card.getByRole('button', {name: '下一段', exact: true}).click();
  await expect(card.locator('.specialized-tool-text')).toHaveCount(0);
  await card.locator(':scope > summary').click();
  await card.locator(':scope > summary').click();
  await expect(card.locator('.specialized-tool-text')).toHaveCount(0);
});

test('Skill 和记忆默认收起，展开记忆后能读获权正文', async ({page}) => {
  const skillName = 'release-readiness-review';
  const skillText = '发布前检查\n\n1. 确认目标环境和版本。\n2. 部署后检查健康探针。\n3. 保留可用的回滚版本。';
  const memoryText = '部署校验与文件交付\n\n写入成功不等于已经送达。回复前以渠道回执或回读为准。';
  let revoked = false;
  const rows = () => [
    ...pair('skill-open', 'skill', '{"action":"加载技能"}', revoked ? notice : skillText),
    ...pair('memory-open', 'memory_read', '{}', memoryText),
    ...pair('no-access', 'skill', '{"action":"加载技能"}', notice),
    ...pair('lookup', 'resident_task_lookup_async', '{"taskCount":1}', '{"status":"pending","readOnly":true}'),
  ].map(row => row.id === 'result-skill-open' && !revoked ? {...row, resourceContent:true, skillName, timing:{durationMs:1250}}
    : row.id === 'result-memory-open' ? {...row, resourceContent:true, timing:{durationMs:320}}
    : row.id === 'result-no-access' ? {...row, skillName:'unapproved-fixture'} : row);
  await page.route(endpoint + '?*', route => route.fulfill({json:response(rows())}));
  const history = await open(page);
  const skill = history.locator('[data-message-id="call-skill-open"]');
  const memory = history.locator('[data-message-id="call-memory-open"]');
  const limited = history.locator('[data-message-id="call-no-access"]');
  const summary = skill.locator('.pi-web-tool-summary');
  await expect(skill.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await expect(summary.locator('.pi-web-tool-object')).toHaveText(skillName);
  await expect(summary.locator('.pi-web-tool-duration')).toHaveText('1.3s');
  await expect(summary).not.toContainText('加载技能');
  await expect(skill.locator('.specialized-tool-text')).toHaveCount(0);
  await expect(memory.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await expect(memory.locator('.specialized-tool-text')).toHaveCount(0);
  await memory.locator('.pi-web-tool-summary').click();
  await expect(memory.locator('.specialized-tool-text')).toHaveText(memoryText);
  await expect(limited.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await expect(limited.locator('.pi-web-tool-object')).toHaveText('加载技能');
  await expect(limited).not.toContainText('unapproved-fixture');
  await page.mouse.move(1,1);
  await skill.screenshot({path:test.info().outputPath('skill-collapsed-name.png')});
  for (const [width, theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:960});
    await page.evaluate(theme => {document.documentElement.dataset.theme=theme},theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('[data-message-id="call-skill-open"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  }
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(skill.locator('.specialized-tool-text')).toHaveText(skillText);
  await expect(skill.locator('.specialized-tool-fields')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(skill.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await expect(skill.locator('.specialized-tool-text')).toBeHidden();
  await expect(memory.getByText('部署校验与文件交付', {exact:false})).toBeVisible();

  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(summary.locator('.pi-web-tool-object')).toHaveText('加载技能');
  await expect(skill).not.toContainText(skillName);
  await summary.click();
  await expect(skill.locator('.specialized-tool-text')).toHaveText(notice);
  await expect(skill).not.toContainText('确认目标环境和版本');
});

test('资源续页变更后不再回显旧正文，重新取记录才恢复', async ({page}) => {
  const first = '授权时的正文。'.repeat(2400).slice(0,16000), tail = '上一次验证可读的尾页';
  const rows = [...pair('versioned-memory', 'memory_read', '{}', first), ...pair('lookup', 'resident_task_lookup_async', '{"taskCount":1}', '{"status":"completed","readOnly":true}')]
    .map(row => row.id === 'result-versioned-memory' ? {...row, resourceContent:true, textTotal:first.length+tail.length, textNextOffset:first.length, truncated:true} : row);
  await page.route(endpoint + '?*', route => route.fulfill({json:response(rows)}));
  await page.route(endpoint + '/messages/result-versioned-memory?*', route => route.fulfill({status:409,json:{error:'SESSION_PAGE_STALE'}}));
  const history = await open(page);
  const memory = history.locator('[data-message-id="call-versioned-memory"]');
  await expect(memory.locator('.pi-tool-step')).not.toHaveAttribute('open');
  await memory.locator('.pi-web-tool-summary').click();
  await expect(memory.locator('.specialized-tool-text')).toHaveText(first);
  await memory.getByRole('button',{name:'下一段',exact:true}).click();
  await expect(memory.locator('.specialized-tool-text')).toHaveCount(0);
  await memory.locator('summary').click();
  await memory.locator('summary').click();
  await expect(memory.locator('.specialized-tool-text')).toHaveCount(0);
});

test('已核验的历史子代理工具内容直接展示，不新增子会话入口', async ({page}) => {
  const requestText = '对照发布清单与部署记录。';
  const receiptText = '子代理已启动。';
  const rows = [
    ...pair('verified-child', 'subagent', requestText, receiptText),
    ...pair('lookup', 'resident_task_lookup_async', '{"taskCount":1}', '{"status":"pending","readOnly":true}'),
  ].map(row => row.id === 'result-verified-child' ? {...row, status:'accepted', resourceContent:true} : row);
  await page.route(endpoint + '?*', route => route.fulfill({json:response(rows)}));
  const history = await open(page);
  const child = history.locator('[data-message-id="call-verified-child"]');
  await expect(child.getByText(requestText,{exact:true})).toBeVisible();
  await expect(child.getByText(receiptText,{exact:true})).toBeVisible();
  await expect(child.getByRole('link')).toHaveCount(0);
  await expect(child).not.toContainText('已完成查询');
});
