import {test, expect, type Page} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

const first = 'task-research';
const second = 'task-documents';
const inputPath = `**/api/tasks/${first}/input`;
const targetSession = `fixture-pi-${first}`;
const title = '整理本周产品调研';
const otherTitle = '检查接口文档与实现的一致性';
const file = {name:'补充资料.txt', mimeType:'text/plain', buffer:Buffer.from('夜间调研资料')};
const fileInput = (page: Page) => page.locator('.task-input-dock input[type=file]');
const textbox = (page: Page) => page.getByRole('textbox',{name:'消息内容',exact:true});
const send = (page: Page) => page.getByRole('button',{name:'发送消息',exact:true});
const storedReceipt = (requestId: string) => ({requestId, taskId:first, sessionId:targetSession, status:'accepted'});

async function login(page: Page, id = first) {
  await page.goto(`/#/tasks/${id}`);
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
}
async function visitTask(page: Page,id: string,name: string) {
  await page.evaluate(id => {location.hash=`/tasks/${id}`;}, id);
  await expect(page.locator('.task-info-title')).toHaveText(name);
}

for (const width of [1440, 390]) {
  test(`task input is aligned to history and sends only to its exact task session at ${width}px`, async({page}, testInfo) => {
    await page.setViewportSize({width,height:960});
    const text = width === 390 ? '' : '  补充一条调研要求\n需保留原始换行  ';
    const writes: {url: string; method: string}[] = [];
    let committed = false;
    page.on('request', request => {
      if (request.method() !== 'GET' && request.url().includes('/api/') && !request.url().endsWith('/api/login')) {
        writes.push({url:new URL(request.url()).pathname,method:request.method()});
      }
    });
    // Runtime taskDetail exposes the canonical session id, even when the projection omits role.
    await page.route(`**/api/tasks/${first}`, async route => {
      const response = await route.fetch();
      const value = await response.json();
      delete value.session.role;
      await route.fulfill({response, json:value});
    });
    await page.route(`**/api/tasks/${first}/session?*`, route => route.fulfill({json:{
      status:'ready', total:committed ? 2 : 1, items:[{id:'history-start', role:'assistant', text:'已提交的执行记录'},
        ...(committed ? [{id:'task-new-input', role:'user', text:'补充消息已写入本任务记录'}] : [])],
    }}));
    await page.route(inputPath, async route => {
      const value = route.request().postDataJSON();
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      expect(value).toEqual({sessionId:targetSession, requestId:expect.stringMatching(/^[a-f0-9-]{36}$/), text,
        attachments:[{name:file.name,mediaType:file.mimeType,data:file.buffer.toString('base64')}]});
      committed = true;
      await route.fulfill({status:202,json:storedReceipt(value.requestId)});
    });
    await login(page);
    await expect(page.getByText('已提交的执行记录',{exact:true})).toBeVisible();
    await expect(page.locator('.task-info-title')).toHaveText(title);
    const geometry = await page.evaluate(() => {
      const column = document.querySelector('.task-dialogue .message-column')!;
      const box = column.getBoundingClientRect();
      const composer = document.querySelector('.task-input-dock form')!.getBoundingClientRect();
      const style = getComputedStyle(column);
      const transcript = document.querySelector('.task-dialogue .transcript')!.getBoundingClientRect();
      return {left:Math.abs(composer.left-(box.left+parseFloat(style.paddingLeft))), right:Math.abs(composer.right-(box.right-parseFloat(style.paddingRight))),
        below:composer.top >= transcript.bottom, overflow:document.documentElement.scrollWidth > innerWidth};
    });
    expect(geometry).toMatchObject({below:true,overflow:false});
    expect(geometry.left).toBeLessThanOrEqual(1);
    expect(geometry.right).toBeLessThanOrEqual(1);
    await textbox(page).fill(text);
    await fileInput(page).setInputFiles(file);
    await expect(page.getByRole('list',{name:'待发送附件'})).toContainText(file.name);
    await page.screenshot({path:testInfo.outputPath(`task-composer-${width}.png`),fullPage:true});
    if (width === 390) await send(page).click(); else await textbox(page).press('Enter');
    await expect(page.getByText('消息已提交给当前任务。',{exact:true})).toBeVisible();
    await expect(textbox(page)).toHaveValue('');
    await expect(page.getByRole('list',{name:'待发送附件'})).toHaveCount(0);
    await expect(page.getByText('补充消息已写入本任务记录',{exact:true})).toBeVisible();
    expect(writes).toEqual([{url:`/api/tasks/${first}/input`,method:'POST'}]);
  });
}

test('an uncertain response preserves text and attachments; only an explicit same-request retry writes again', async({page}) => {
  const payloads: unknown[] = [];
  let checks = 0;
  await page.route(inputPath, async route => {
    const value = route.request().postDataJSON();
    payloads.push(value);
    if (payloads.length === 1) await route.fulfill({status:202,json:{...storedReceipt(value.requestId),sessionId:'wrong-session'}});
    else await route.fulfill({status:202,json:storedReceipt(value.requestId)});
  });
  await page.route(`${inputPath}/*`, async route => {
    checks += 1;
    expect(new URL(route.request().url()).pathname.split('/').at(-1)).toBe((payloads[0] as {requestId:string}).requestId);
    await route.fulfill({status:404,json:{error:'TASK_INPUT_NOT_FOUND'}});
  });
  await login(page);
  await textbox(page).fill('保留本任务草稿和附件');
  await fileInput(page).setInputFiles(file);
  await send(page).click();
  await expect(page.locator('.task-input-dock').getByRole('alert')).toContainText('待核实');
  await expect(textbox(page)).toBeDisabled();
  expect(checks).toBe(0);
  await visitTask(page, second, otherTitle);
  await expect(textbox(page)).toHaveValue('');
  await textbox(page).fill('另一项任务的独立草稿');
  await visitTask(page, first, title);
  await expect(textbox(page)).toHaveValue('保留本任务草稿和附件');
  await expect(page.getByRole('list',{name:'待发送附件'})).toContainText(file.name);
  await page.getByRole('button',{name:'核对发送状态',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试这条消息',exact:true})).toBeEnabled();
  expect(checks).toBe(1);
  expect(payloads).toHaveLength(1);
  await page.getByRole('button',{name:'重试这条消息',exact:true}).click();
  await expect(page.getByText('消息已提交给当前任务。',{exact:true})).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  await visitTask(page, second, otherTitle);
  await expect(textbox(page)).toHaveValue('另一项任务的独立草稿');
});

test('a delayed receipt does not clear or route away from another task draft', async({page}) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release=resolve;});
  await page.route(inputPath, async route => {
    const value = route.request().postDataJSON();
    await pending;
    await route.fulfill({status:202,json:storedReceipt(value.requestId)});
  });
  await login(page);
  try {
    await textbox(page).fill('等待确认');
    const request = page.waitForRequest(request=>request.method()==='POST' && request.url().endsWith(`/tasks/${first}/input`));
    await send(page).click();
    await request;
    await expect(page.getByRole('button',{name:'正在发送消息'})).toBeDisabled();
    await visitTask(page,second,otherTitle);
    await textbox(page).fill('不要清除这项任务的草稿');
    const response = page.waitForResponse(response=>response.url().endsWith(`/tasks/${first}/input`));
    release();
    await response;
    await expect(page).toHaveURL(new RegExp(`#\/tasks\/${second}$`));
    await expect(textbox(page)).toHaveValue('不要清除这项任务的草稿');
    await visitTask(page,first,title);
    await expect(textbox(page)).toHaveValue('');
    await expect(page.getByText('消息已提交给当前任务。',{exact:true})).toBeVisible();
  } finally {release();}
});

test('a stale-session refusal keeps the draft editable and never switches its target automatically', async({page}) => {
  let writes = 0;
  await page.route(inputPath, async route => {
    writes += 1;
    await route.fulfill({status:409,json:{error:'TASK_INPUT_SESSION_STALE'}});
  });
  await login(page);
  await textbox(page).fill('不转交给其他会话');
  await fileInput(page).setInputFiles(file);
  await send(page).click();
  await expect(page.locator('.task-input-dock').getByRole('alert')).toContainText('任务会话已变化');
  await expect(textbox(page)).toBeEditable();
  await expect(textbox(page)).toHaveValue('不转交给其他会话');
  await expect(page.getByRole('list',{name:'待发送附件'})).toContainText(file.name);
  expect(writes).toBe(1);
});
