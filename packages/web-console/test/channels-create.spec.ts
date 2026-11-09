import {test, expect, type Page, type Locator} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
import type {DingtalkChannelDetail} from '../src/api'

const endpoint = '/api/channels/dingtalk', savedChannels = '/api/channels'
const dialogFor = (page: Page) => page.getByRole('dialog', {name: '添加钉钉渠道', exact: true})
const cardFor = (page: Page, id: string) => page.locator('.channel-card').filter({hasText: id})
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done}); return {promise, resolve}}
const rendered = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
async function login(page: Page, initial = true) {
  if (initial) await page.goto('/#/channels')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByRole('heading', {name: '所有对话，在这里汇合', exact: true})).toBeVisible()
}
async function openForm(page: Page) {
  await page.getByRole('button', {name: '添加钉钉渠道', exact: true}).click()
  const dialog = dialogFor(page); await expect(dialog).toBeVisible(); return dialog
}
async function fillRoom(dialog: Locator, id: string) {
  await dialog.getByLabel('渠道标识', {exact: true}).fill(id)
  await dialog.getByLabel('会话类型', {exact: true}).selectOption('chat-room')
  await dialog.getByLabel('目标填写方式', {exact: true}).selectOption('id')
  await dialog.getByLabel('群 ID', {exact: true}).fill('fixture-room-id')
}
const waitSave = (page: Page) => page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint)
const editEndpoint = (id: string) => endpoint + '/' + encodeURIComponent(id)
const editDialogFor = (page: Page) => page.getByRole('dialog', {name: '编辑钉钉渠道', exact: true})
const editButton = (page: Page, id: string) => page.getByRole('button', {name: '编辑钉钉渠道：' + id, exact: true})
const waitPatch = (page: Page, id: string) => page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === editEndpoint(id))
async function readDetail(page: Page, id: string): Promise<DingtalkChannelDetail> {
  const response = await page.request.get(editEndpoint(id)); expect(response.status()).toBe(200)
  const detail = await response.json()
  expect(Object.keys(detail).sort()).toEqual(['channelId', 'conversationType', 'name', 'prompt', 'target', 'targetKind', 'version', 'writesAuthorized'])
  expect(detail.version).toMatch(/^[a-f0-9]{64}$/)
  return detail
}
async function openEdit(page: Page, id: string) {
  await editButton(page, id).click()
  const dialog = editDialogFor(page); await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toBeEnabled()
  return dialog
}
async function createEditable(page: Page, id: string) {
  const dialog = await openForm(page); await fillRoom(dialog, id)
  await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill('编辑测试原始职责')
  const response = waitSave(page); await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
  expect((await response).status()).toBe(200)
  await dialog.getByRole('button', {name: '关闭', exact: true}).click()
  await expect(dialog).toHaveCount(0)
  return readDetail(page, id)
}
async function saveEdit(page: Page, dialog: Locator, id: string) {
  const response = waitPatch(page, id)
  await dialog.getByRole('button', {name: '保存渠道修改', exact: true}).click()
  return response
}


test('新增群聊切换清除旧目标，键盘与中文 IME 不误交，保存仅显示待重启', async ({page}) => {
  await login(page)
  const dialog = await openForm(page); await fillRoom(dialog, 'browser-created-room')
  await expect(dialog.getByLabel('钉钉 profile', {exact: true})).toHaveCount(0)
  await expect(dialog).toContainText('使用 Bot 运行环境当前登录账号，无需填写账号或凭据。')
  await dialog.getByLabel('渠道标识', {exact: true}).focus(); await page.keyboard.press('Tab')
  await expect(dialog.getByLabel('会话类型', {exact: true})).toBeFocused()
  await dialog.getByLabel('会话类型', {exact: true}).selectOption('chat')
  await expect(dialog.getByLabel('用户 ID', {exact: true})).toHaveValue('')
  await dialog.getByLabel('用户 ID', {exact: true}).fill('must-not-survive')
  await dialog.getByLabel('目标填写方式', {exact: true}).selectOption('name')
  await expect(dialog.getByLabel('用户名称', {exact: true})).toHaveValue('')
  await dialog.getByLabel('用户名称', {exact: true}).fill('不应带入群聊')
  await dialog.getByLabel('会话类型', {exact: true}).selectOption('chat-room')
  await expect(dialog.getByLabel('群名称', {exact: true})).toHaveValue('')
  await dialog.getByLabel('目标填写方式', {exact: true}).selectOption('id')
  const target = dialog.getByLabel('群 ID', {exact: true}); await expect(target).toHaveValue(''); await target.fill('fixture-room-id')
  await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('浏览器隔离群聊')
  await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill('只保存本地测试配置，不连接真实账号')
  const writes: unknown[] = []
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON())})
  await target.dispatchEvent('compositionstart', {data: '群'})
  await target.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229})
  await expect(dialog).toBeVisible(); expect(writes).toHaveLength(0)
  await target.dispatchEvent('compositionend', {data: '群'})
  const response = waitSave(page); await target.press('Enter'); const saved = await response
  expect(saved.status()).toBe(200)
  expect(await saved.json()).toMatchObject({ok: true, changed: true, restartRequired: true, liveApplied: false, channel: {channelId: 'browser-created-room', conversationType: 'chat-room', writesAuthorized: false, connected: false, connectionState: 'pending-restart'}})
  expect(writes).toEqual([{channelId: 'browser-created-room', conversationType: 'chat-room', targetKind: 'id', target: 'fixture-room-id', name: '浏览器隔离群聊', prompt: '只保存本地测试配置，不连接真实账号', writesAuthorized: false}])
  await expect(cardFor(page, 'browser-created-room')).toContainText('待重启')
  await expect(cardFor(page, 'browser-created-room')).not.toContainText('健康检查正常')
})

test('外发授权默认关闭，新增显式授权、编辑撤销及目标变更不继承授权', async ({page}) => {
  await login(page)
  const id = 'browser-outbound-authorization', dialog = await openForm(page)
  await fillRoom(dialog, id)
  const authorization = dialog.getByLabel('外发授权', {exact: true})
  await expect(authorization).toHaveValue('false')
  await authorization.selectOption('true')
  const created = waitSave(page)
  await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
  expect(await (await created).json()).toMatchObject({channel: {writesAuthorized: true}, restartRequired: true, liveApplied: false})
  await expect(dialog).toContainText('已保存外发授权')
  await dialog.getByRole('button', {name: '关闭', exact: true}).click()
  const editing = await openEdit(page, id), control = editing.getByLabel('外发授权', {exact: true})
  await expect(control).toHaveValue('true')
  await control.selectOption('false')
  const revoked = await saveEdit(page, editing, id)
  expect(await revoked.json()).toMatchObject({detail: {writesAuthorized: false}, channel: {writesAuthorized: false}})
  expect((await readDetail(page, id)).writesAuthorized).toBe(false)
  await editing.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
  await control.selectOption('true')
  expect((await saveEdit(page, editing, id)).status()).toBe(200)
  await editing.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
  await expect(control).toHaveValue('true')
  await editing.getByLabel('群 ID', {exact: true}).fill('fixture-new-target')
  await expect(control).toHaveValue('false'); await expect(control).toBeDisabled()
  await expect(editing).toContainText('请先保存目标，再重新编辑授权')
  const changed = await saveEdit(page, editing, id)
  expect(await changed.json()).toMatchObject({detail: {target: 'fixture-new-target', writesAuthorized: false}})
  await editing.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
  await expect(control).toBeEnabled(); await expect(control).toHaveValue('false')
})

test('新增私聊按名称提交且当前渠道不被当作已热加载', async ({page}) => {
  await login(page)
  const dialog = await openForm(page); await fillRoom(dialog, 'browser-created-direct')
  await dialog.getByLabel('会话类型', {exact: true}).selectOption('chat')
  await dialog.getByLabel('目标填写方式', {exact: true}).selectOption('name')
  await dialog.getByLabel('用户名称', {exact: true}).fill('隔离私聊目标')
  const response = waitSave(page); await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click(); const saved = await response
  expect(saved.status()).toBe(200)
  expect(saved.request().postDataJSON()).toEqual({channelId: 'browser-created-direct', conversationType: 'chat', targetKind: 'name', target: '隔离私聊目标', writesAuthorized: false})
  expect(await saved.json()).toMatchObject({restartRequired: true, liveApplied: false, channel: {conversationType: 'chat', writesAuthorized: false, connected: false}})
  const rows = await page.request.get(savedChannels).then(response => response.json())
  expect(rows.items.find((row: {channelId: string}) => row.channelId === 'browser-created-direct')).toMatchObject({connectionState: 'pending-restart', restartRequired: true, liveApplied: false})
  await expect(cardFor(page, 'browser-created-direct')).toContainText('待重启')
  await expect(cardFor(page, 'dingtalk-work')).toContainText('健康检查正常')
})

test('重复渠道与已知输入错误保留字段，修正前不冒称保存成功', async ({page}) => {
  await login(page)
  const dialog = await openForm(page); await fillRoom(dialog, 'dingtalk-work')
  await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('失败时应保留的名称')
  const duplicate = waitSave(page); await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
  expect((await duplicate).status()).toBe(409)
  await expect(dialog.getByText('该渠道标识已存在，请换一个；未覆盖已有配置。', {exact: true})).toBeVisible()
  await expect(dialog.getByLabel('渠道标识', {exact: true})).toHaveValue('dingtalk-work')
  await expect(dialog.getByLabel('群 ID', {exact: true})).toHaveValue('fixture-room-id')
  await expect(dialog.getByLabel('显示名称（可选）', {exact: true})).toHaveValue('失败时应保留的名称')
  await page.route('**' + endpoint, route => route.fulfill({status: 400, json: {error: 'DINGTALK_CHANNEL_REQUEST_INVALID'}}))
  await dialog.getByLabel('渠道标识', {exact: true}).fill('browser-rejected-target')
  const rejected = waitSave(page); await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
  expect((await rejected).status()).toBe(400)
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('群 ID', {exact: true})).toHaveValue('fixture-room-id')
  await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeEnabled()
  // 此处仅验证新增账号失败的 UI 映射；真实账号选择与零写入由 Host 集成测试验证。
  for (const [status, code, copy] of [
    [409, 'DINGTALK_AUTH_REQUIRED', 'Bot 运行环境尚未登录钉钉，请先完成登录再保存渠道。'],
    [409, 'DINGTALK_CURRENT_PROFILE_AMBIGUOUS', 'Bot 运行环境存在多个当前账号，请先消除账号歧义；不会自动选择账号。'],
    [503, 'DINGTALK_CLI_UNAVAILABLE', 'Bot 运行环境的钉钉命令不可用或没有执行权限，未保存配置，请检查运行环境。'],
    [502, 'DINGTALK_QUERY_INCOMPLETE', '钉钉账号查询返回异常，未保存配置，请检查 Bot 运行环境后重试。'],
  ] as const) {
    let posts = 0
    await page.route('**' + endpoint, route => {posts++; return route.fulfill({status, json: {error: code}})})
    const response = waitSave(page); await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
    expect((await response).status()).toBe(status)
    await expect(dialog.getByRole('alert')).toContainText(copy)
    await expect(dialog.getByLabel('渠道标识', {exact: true})).toHaveValue('browser-rejected-target')
    await expect(dialog.getByLabel('群 ID', {exact: true})).toHaveValue('fixture-room-id')
    await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeEnabled()
    await expect(dialog.getByRole('button', {name: '核对保存状态', exact: true})).toHaveCount(0)
    await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
    expect(posts).toBe(1)
  }
})

test('真实保存响应在途时锁定字段与重复提交，明确回执后才展示成功', async ({page}) => {
  await login(page)
  const dialog = await openForm(page), ready = deferred(), release = deferred(); await fillRoom(dialog, 'browser-held-save')
  let posts = 0
  await page.route('**' + endpoint, async route => {
    posts++; const response = await route.fetch(); ready.resolve(); await release.promise; await route.fulfill({response})
  })
  try {
    await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click(); await ready.promise
    await expect(dialog.getByLabel('渠道标识', {exact: true})).toBeDisabled()
    await expect(dialog.getByLabel('群 ID', {exact: true})).toBeDisabled()
    await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeDisabled()
    expect(posts).toBe(1)
    release.resolve(); await expect(cardFor(page, 'browser-held-save')).toContainText('待重启'); expect(posts).toBe(1)
  } finally {release.resolve()}
})

test('保存断线保持原标识锁，准确 ID 只读核对缺席不重发，找到不冒称目标已核实', async ({page}) => {
  await login(page)
  const dialog = await openForm(page), id = 'browser-unknown-save'; await fillRoom(dialog, id)
  let posts = 0, saved = false, reveal = false, reads = 0
  await page.route('**' + endpoint, async route => {
    posts++; const response = await route.fetch(); expect(response.status()).toBe(200); saved = true; await route.abort('failed')
  })
  await page.route('**' + savedChannels, async route => {
    const response = await route.fetch(), body = await response.json(); if (saved) reads++
    if (!reveal) body.items = body.items.filter((row: {channelId: string}) => row.channelId !== id)
    await route.fulfill({response, json: body})
  })
  await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
  const check = dialog.getByRole('button', {name: '核对保存状态', exact: true})
  await expect(check).toBeEnabled(); await expect.poll(() => reads).toBeGreaterThan(0)
  await expect(dialog.getByLabel('渠道标识', {exact: true})).toHaveValue(id)
  await expect(dialog.getByLabel('渠道标识', {exact: true})).toBeDisabled()
  await expect(dialog.getByLabel('群 ID', {exact: true})).toBeDisabled()
  await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeDisabled()
  expect(posts).toBe(1); reveal = true; await check.click()
  await expect(dialog).toContainText('已找到渠道标识「' + id + '」的配置。')
  await expect(dialog).toContainText('安全摘要不含账号和目标，无法确认本次写入')
  await expect(cardFor(page, id)).toContainText('待重启'); expect(posts).toBe(1)
})

test('认证换代后迟到保存回执不能恢复旧表单或污染新草稿', async ({page, context}) => {
  await login(page)
  const dialog = await openForm(page), ready = deferred(), release = deferred(), done = deferred()
  await fillRoom(dialog, 'browser-old-session-save')
  await page.route('**' + endpoint, async route => {
    const response = await route.fetch(); ready.resolve(); await release.promise; await route.fulfill({response}); done.resolve()
  })
  try {
    await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click(); await ready.promise
    await context.clearCookies(); await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible(); await login(page, false)
    const next = await openForm(page)
    await next.getByLabel('渠道标识', {exact: true}).fill('browser-new-session-draft')
    const response = waitSave(page); release.resolve(); await done.promise; await (await response).finished(); await rendered(page)
    await expect(next.getByLabel('渠道标识', {exact: true})).toHaveValue('browser-new-session-draft')
    await expect(next.getByLabel('渠道标识', {exact: true})).toBeEnabled()
    await expect(next.getByLabel('群 ID', {exact: true})).toHaveValue('')
    await expect(next.getByText('已保存', {exact: true})).toHaveCount(0)
  } finally {release.resolve()}
})

test('多标签 CSRF 换代只读同步且清除旧表单，不自动重发创建请求', async ({page, context}) => {
  const other = await context.newPage()
  try {
    await page.goto('/#/channels'); await other.goto('/#/channels')
    await expect(other.getByLabel('访问令牌', {exact: true})).toBeVisible(); await login(page, false)
    const dialog = await openForm(page); await fillRoom(dialog, 'browser-stale-csrf')
    await login(other, false)
    const statuses: number[] = []
    await page.route('**' + endpoint, async route => {const response = await route.fetch(); statuses.push(response.status()); await route.fulfill({response})})
    await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).click()
    await expect(dialog).toHaveCount(0); expect(statuses).toEqual([403])
    const next = await openForm(page); await expect(next.getByLabel('渠道标识', {exact: true})).toHaveValue('')
    const rows = await page.request.get(savedChannels).then(response => response.json())
    expect(rows.items.some((row: {channelId: string}) => row.channelId === 'browser-stale-csrf')).toBe(false)
    expect(statuses).toEqual([403])
  } finally {await other.close()}
})

test('390px 浅深色新增与编辑表单可操作、无横向溢出且通过局部 axe AA', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await login(page)
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', {name: '切换深色外观', exact: true}).click()
    const dialog = await openForm(page); await fillRoom(dialog, 'browser-mobile-' + theme)
    await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('移动端隔离渠道')
    await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill('长职责段落用于检查窄屏换行和表单滚动。'.repeat(8))
    await dialog.getByRole('button', {name: '保存钉钉渠道', exact: true}).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', {name: '保存钉钉渠道', exact: true})).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const axe = await new AxeBuilder({page}).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(axe.violations).toEqual([])
    await page.screenshot({path: test.info().outputPath('channel-create-390-' + theme + '.png'), fullPage: true, animations: 'disabled'})
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', {name: '添加钉钉渠道', exact: true})).toBeFocused()
    const editing = await openEdit(page, 'dingtalk-work')
    await expect(editing.getByLabel('渠道标识', {exact: true})).not.toBeEditable()
    await editing.getByLabel('显示名称（可选）', {exact: true}).fill('移动端编辑草稿')
    await editing.getByLabel('渠道职责（可选）', {exact: true}).fill('编辑职责保留多段文字。'.repeat(10))
    await editing.getByRole('button', {name: '保存渠道修改', exact: true}).scrollIntoViewIfNeeded()
    await expect(editing.getByRole('button', {name: '保存渠道修改', exact: true})).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    expect(await editing.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await page.screenshot({path: test.info().outputPath('channel-edit-390-' + theme + '.png'), fullPage: true, animations: 'disabled'})
    await page.keyboard.press('Escape'); await expect(editing).toHaveCount(0)
    await expect(editButton(page, 'dingtalk-work')).toBeFocused()
  }
})

test('编辑回填固定标识与完整字段，同 ID 待重启及无变化或未知回执不冒称应用', async ({page}) => {
  await login(page)
  const id = 'dingtalk-work', original = await readDetail(page, id)
  const conversationCount = await page.locator('.conversation-list .conversation-row').count()
  const dialog = await openEdit(page, id)
  await expect(dialog.getByLabel('渠道标识', {exact: true})).toHaveValue(id)
  await expect(dialog.getByLabel('渠道标识', {exact: true})).not.toBeEditable()
  await expect(dialog.getByLabel('钉钉 profile', {exact: true})).toHaveCount(0)
  await expect(dialog).toContainText('沿用已保存账号，无需填写账号或凭据')
  await expect(dialog.getByLabel('群 ID', {exact: true})).toHaveValue(original.target)
  await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toHaveValue(original.prompt)
  await expect(page.locator('.conversation-list .conversation-row')).toHaveCount(conversationCount)
  await expect(page.getByText('查看渠道接收的消息和 Bot 回复', {exact: true})).toBeVisible()
  await dialog.getByLabel('渠道标识', {exact: true}).focus(); await page.keyboard.press('Tab')
  await expect(dialog.getByLabel('会话类型', {exact: true})).toBeFocused()
  await dialog.getByLabel('会话类型', {exact: true}).selectOption('chat')
  await expect(dialog.getByLabel('用户 ID', {exact: true})).toHaveValue('')
  await dialog.getByLabel('用户 ID', {exact: true}).fill('不得残留的旧目标')
  await dialog.getByLabel('目标填写方式', {exact: true}).selectOption('name')
  const target = dialog.getByLabel('用户名称', {exact: true}); await expect(target).toHaveValue('')
  await target.fill('  浏览器隔离私聊目标  ')
  await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('  编辑后的渠道  ')
  const prompt = `第一行职责
  第二行保留缩进
`
  await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill(prompt)
  let patches = 0
  page.on('request', request => {if (request.method() === 'PATCH' && new URL(request.url()).pathname === editEndpoint(id)) patches++})
  await target.dispatchEvent('compositionstart', {data: '人'})
  await target.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229})
  expect(patches).toBe(0); await expect(dialog).toBeVisible()
  await target.dispatchEvent('compositionend', {data: '人'})
  const pending = waitPatch(page, id); await target.press('Enter'); const response = await pending
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({expectedVersion: original.version, name: '编辑后的渠道', prompt, conversationType: 'chat', targetKind: 'name', target: '浏览器隔离私聊目标', writesAuthorized: false})
  const saved = await response.json(), detail = await readDetail(page, id)
  expect(saved).toMatchObject({ok: true, changed: true, restartRequired: true, liveApplied: false, detail})
  expect(detail).toEqual({channelId: id, version: saved.detail.version, name: '编辑后的渠道', prompt, conversationType: 'chat', targetKind: 'name', target: '浏览器隔离私聊目标', writesAuthorized: false})
  expect(detail.version).not.toBe(original.version)
  const row = (await page.request.get(savedChannels).then(response => response.json())).items.find((row: {channelId: string}) => row.channelId === id)
  expect(row).toMatchObject({savedVersion: detail.version, runningVersion: original.version, restartRequired: true, liveApplied: false, connectionState: 'pending-restart'})
  await expect(cardFor(page, id)).toContainText('待重启')
  await expect(dialog).toContainText('当前运行态尚未应用此配置')
  await dialog.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
  await expect(dialog.getByLabel('用户名称', {exact: true})).toBeEnabled()
  const unchanged = await saveEdit(page, dialog, id)
  expect(unchanged.status()).toBe(200)
  expect(await unchanged.json()).toMatchObject({ok: true, changed: false, restartRequired: true, liveApplied: false, detail})
  await expect(dialog).toContainText('配置未变化')
  await expect(cardFor(page, id)).toContainText('待重启'); expect(patches).toBe(2)
  await dialog.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
  await expect(dialog.getByLabel('用户名称', {exact: true})).toBeEnabled()
  await page.route('**' + editEndpoint(id), async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const response = await route.fetch(); expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({changed: false, detail})
    await route.abort('failed')
  })
  await dialog.getByRole('button', {name: '保存渠道修改', exact: true}).click()
  await expect(dialog).toContainText('保存版本未变化，仍不能确认本次保存结果')
  await expect(dialog.getByRole('button', {name: '核对保存状态', exact: true})).toBeEnabled()
  await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeDisabled()
  expect(await readDetail(page, id)).toEqual(detail); expect(patches).toBe(3)
})

test('编辑旧版本明确冲突，保留原草稿并仅在显式重载后使用新版本保存', async ({page, context}) => {
  await login(page)
  const id = 'browser-edit-stale', original = await createEditable(page, id), dialog = await openEdit(page, id)
  await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('旧表单未保存的名称')
  const other = await context.newPage()
  let patches = 0
  page.on('request', request => {if (request.method() === 'PATCH' && new URL(request.url()).pathname === editEndpoint(id)) patches++})
  try {
    await other.goto('/#/channels'); const concurrent = await openEdit(other, id)
    await concurrent.getByLabel('显示名称（可选）', {exact: true}).fill('另一标签页的新版本')
    await concurrent.getByLabel('渠道职责（可选）', {exact: true}).fill('新版本职责，不可被旧草稿覆盖')
    expect((await saveEdit(other, concurrent, id)).status()).toBe(200)
    const latest = await readDetail(page, id); expect(latest.version).not.toBe(original.version)
    const rejected = await saveEdit(page, dialog, id)
    expect(rejected.status()).toBe(409); expect(await rejected.json()).toMatchObject({error: 'DINGTALK_CHANNEL_VERSION_CONFLICT'})
    await expect(dialog.getByRole('alert')).toContainText('渠道配置已被修改，未覆盖新版本')
    await expect(dialog.getByLabel('显示名称（可选）', {exact: true})).toHaveValue('旧表单未保存的名称')
    await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeDisabled()
    expect(await readDetail(page, id)).toEqual(latest); expect(patches).toBe(1)
    await dialog.getByRole('button', {name: '重新加载最新配置', exact: true}).click()
    await expect(dialog.getByLabel('显示名称（可选）', {exact: true})).toHaveValue(latest.name)
    await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toHaveValue(latest.prompt)
    await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeEnabled(); expect(patches).toBe(1)
    await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('')
    await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill('')
    const saved = await saveEdit(page, dialog, id); expect(saved.status()).toBe(200)
    expect(saved.request().postDataJSON()).toEqual({expectedVersion: latest.version, name: '', prompt: '', conversationType: latest.conversationType, targetKind: latest.targetKind, target: latest.target, writesAuthorized: latest.writesAuthorized})
    expect(await readDetail(page, id)).toMatchObject({name: '', prompt: '', target: latest.target}); expect(patches).toBe(2)
  } finally {await other.close()}
})

test('编辑断线后比较真实保存快照，字段不一致继续锁定，字段一致仅确认已保存且不重发', async ({page, context}) => {
  await login(page)
  const id = 'browser-edit-unknown', original = await createEditable(page, id), dialog = await openEdit(page, id)
  const intendedPrompt = `断线保存的职责
  缩进仍是请求的一部分
`
  await dialog.getByLabel('渠道职责（可选）', {exact: true}).fill(intendedPrompt)
  await dialog.getByLabel('外发授权', {exact: true}).selectOption('true')
  let patches = 0, saved = false, reveal = false, reads = 0
  await page.route('**' + editEndpoint(id), async route => {
    if (route.request().method() === 'PATCH') {
      patches++; const response = await route.fetch(); expect(response.status()).toBe(200)
      saved = true; await route.abort('failed')
    } else if (saved) {
      reads++
      if (!reveal) await route.fulfill({status: 503, json: {error: 'CHANNEL_CONFIGURATION_UNAVAILABLE'}})
      else await route.continue()
    } else await route.continue()
  })
  await dialog.getByRole('button', {name: '保存渠道修改', exact: true}).click()
  const check = dialog.getByRole('button', {name: '核对保存状态', exact: true})
  await expect(check).toBeEnabled(); await expect.poll(() => reads).toBeGreaterThan(0)
  await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toHaveValue(intendedPrompt)
  await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeDisabled()
  const committed = await readDetail(page, id)
  expect(committed.prompt).toBe(intendedPrompt); expect(committed.version).not.toBe(original.version); expect(patches).toBe(1)
  const other = await context.newPage()
  try {
    await other.goto('/#/channels'); const concurrent = await openEdit(other, id)
    await concurrent.getByLabel('外发授权', {exact: true}).selectOption('false')
    expect((await saveEdit(other, concurrent, id)).status()).toBe(200)
    expect((await readDetail(page, id)).writesAuthorized).toBe(false)
    reveal = true; await check.click()
    await expect(dialog).toContainText('当前保存版本或字段与本次请求不一致，保存结果仍未知')
    await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toHaveValue(intendedPrompt)
    await expect(dialog.getByLabel('渠道职责（可选）', {exact: true})).toBeDisabled()
    await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeDisabled(); expect(patches).toBe(1)
    await concurrent.getByRole('button', {name: '重新读取并编辑', exact: true}).click()
    await expect(concurrent.getByLabel('渠道职责（可选）', {exact: true})).toBeEnabled()
    await concurrent.getByLabel('外发授权', {exact: true}).selectOption('true')
    expect((await saveEdit(other, concurrent, id)).status()).toBe(200)
    const current = await readDetail(page, id)
    expect(current.prompt).toBe(intendedPrompt); expect(current.version).not.toBe(original.version)
    await check.click()
    await expect(dialog).toContainText('只读核对确认当前保存配置与本次字段一致，版本已更新')
    await expect(dialog).toContainText('实际应用与连接状态请查看渠道列表')
    await expect(dialog.getByRole('button', {name: '重新读取并编辑', exact: true})).toBeVisible()
    await expect(cardFor(page, id)).toContainText('待重启'); expect(patches).toBe(1)
  } finally {await other.close()}
})

test('编辑认证换代丢弃迟到 PATCH 回执，新认证代次草稿不会被旧响应覆盖', async ({page, context}) => {
  await login(page)
  const id = 'browser-edit-epoch'; await createEditable(page, id)
  const dialog = await openEdit(page, id), ready = deferred(), release = deferred(), done = deferred()
  await dialog.getByLabel('显示名称（可选）', {exact: true}).fill('旧认证代次已保存名称')
  let patches = 0
  await page.route('**' + editEndpoint(id), async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patches++; const response = await route.fetch(); expect(response.status()).toBe(200)
    ready.resolve(); await release.promise; await route.fulfill({response}); done.resolve()
  })
  try {
    await dialog.getByRole('button', {name: '保存渠道修改', exact: true}).click(); await ready.promise
    await expect(dialog.getByLabel('显示名称（可选）', {exact: true})).toBeDisabled()
    await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeDisabled()
    await expect(dialog.getByRole('button', {name: '关闭编辑钉钉渠道', exact: true})).toBeDisabled()
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); expect(patches).toBe(1)
    await context.clearCookies(); await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible(); await login(page, false)
    const next = await openEdit(page, id)
    await expect(next.getByLabel('显示名称（可选）', {exact: true})).toHaveValue('旧认证代次已保存名称')
    await next.getByLabel('显示名称（可选）', {exact: true}).fill('新认证代次的未保存草稿')
    const response = waitPatch(page, id); release.resolve(); await done.promise; await (await response).finished(); await rendered(page)
    await expect(next.getByLabel('显示名称（可选）', {exact: true})).toHaveValue('新认证代次的未保存草稿')
    await expect(next.getByRole('button', {name: '保存渠道修改', exact: true})).toBeEnabled()
    await expect(next.getByRole('status')).toHaveCount(0)
    expect((await readDetail(page, id)).name).toBe('旧认证代次已保存名称'); expect(patches).toBe(1)
  } finally {release.resolve()}
})

test('编辑目标被未决依赖明确拒绝时保留字段，可修正但不进入未知重放路径', async ({page}) => {
  await login(page)
  const id = 'browser-edit-blocked', original = await createEditable(page, id), dialog = await openEdit(page, id)
  await dialog.getByLabel('群 ID', {exact: true}).fill('fixture-blocked-target')
  // 仅验证已知拒绝的 UI 恢复；真实未决谓词和冷启栅栏由 Host 集成测试验证。
  let patches = 0
  await page.route('**' + editEndpoint(id), route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patches++; return route.fulfill({status: 409, json: {error: 'DINGTALK_CHANNEL_SWITCH_BLOCKED'}})
  })
  expect((await saveEdit(page, dialog, id)).status()).toBe(409)
  await expect(dialog.getByRole('alert')).toContainText('旧目标仍有未决任务、输入或投递依赖，暂不能切换目标')
  await expect(dialog.getByLabel('群 ID', {exact: true})).toHaveValue('fixture-blocked-target')
  await expect(dialog.getByRole('button', {name: '保存渠道修改', exact: true})).toBeEnabled()
  await expect(dialog.getByRole('button', {name: '核对保存状态', exact: true})).toHaveCount(0)
  expect(await readDetail(page, id)).toEqual(original); expect(patches).toBe(1)
})
