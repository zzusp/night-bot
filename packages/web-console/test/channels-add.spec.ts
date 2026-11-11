import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

const endpoint = '**/api/settings/channels'
async function open(page: Page) {
  await page.goto('/#/channels')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await page.getByRole('button', {name: '添加渠道', exact: true}).click()
  return page.getByRole('dialog', {name: '添加渠道', exact: true})
}
async function custom(page: Page, id: string) {
  const dialog = await open(page)
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('fixture-custom')
  const form = dialog.locator('.custom-channel-form:visible')
  await form.getByLabel('渠道标识', {exact: true}).fill(id)
  await form.getByLabel('目标会话（必填）', {exact: true}).fill('generic-test-room')
  await form.getByLabel('凭据引用', {exact: true}).fill('FIXTURE_CUSTOM_KEY')
  return {dialog, form}
}
async function confirm(page: Page) {
  await page.getByRole('dialog', {name: '保存自定义渠道', exact: true}).getByRole('button', {name: '确认保存', exact: true}).click()
}

test('添加渠道发现真实插件并保存非钉钉配置，保留侧栏设置而移除顶部设置链接', async ({page}) => {
  const {dialog, form} = await custom(page, 'generic-entry-created')
  await expect(page.getByRole('link', {name: '自定义渠道设置', exact: true})).toHaveCount(0)
  await expect(page.locator('.desktop-sidebar').getByRole('link', {name: '设置', exact: true})).toHaveAttribute('href', '#/settings')
  await expect(form.getByLabel('启用渠道', {exact: true})).toHaveValue('false')
  await expect(form.getByLabel('监听（必填）', {exact: true})).toHaveValue('false')
  let dingtalkWrites = 0
  await page.route('**/api/channels/dingtalk', route => { dingtalkWrites++; return route.abort() })
  const request = page.waitForRequest(request => request.url().endsWith('/api/settings/channels') && request.method() === 'POST')
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click()
  const confirmation = page.getByRole('dialog', {name: '保存自定义渠道', exact: true})
  await expect(confirmation.getByRole('button', {name: '取消', exact: true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(form.getByRole('button', {name: '保存自定义渠道', exact: true})).toBeFocused()
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click(); await confirm(page)
  expect((await request).postDataJSON()).toMatchObject({type: 'fixture-custom', channelId: 'generic-entry-created', enabled: false, createOnly: true, config: {room: 'generic-test-room', credential: 'FIXTURE_CUSTOM_KEY', listen: false}})
  await expect(form).toContainText('渠道配置已保存，正常重启后生效。')
  expect(dingtalkWrites).toBe(0)
  const saved = await page.request.get('/api/settings/channels').then(response => response.json())
  expect(saved.channels.find((row: {channelId: string}) => row.channelId === 'generic-entry-created')).toMatchObject({type: 'fixture-custom', enabled: false, config: {room: 'generic-test-room'}})
  await dialog.getByRole('button', {name: '关闭添加渠道', exact: true}).click()
  await expect(page.getByRole('button', {name: '添加渠道', exact: true})).toBeFocused()
  await page.reload(); await page.locator('.desktop-sidebar').getByRole('link', {name: '设置', exact: true}).click()
  await expect(page.getByLabel('显示名称', {exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '自定义渠道', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: '编辑 generic-entry-created', exact: true})).toHaveCount(0)
  const retained = await page.request.get('/api/settings/channels').then(response => response.json())
  expect(retained.channels.find((row: {channelId: string}) => row.channelId === 'generic-entry-created')).toMatchObject({enabled: false, config: {room: 'generic-test-room'}})
})

test('发现慢、失败、空列表和无表单类型不假装支持；重试后新增类型自动可选', async ({page}) => {
  let mode = 'loading'
  let release!: () => void
  const gate = new Promise<void>(resolve => {release = resolve})
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'GET') return route.continue()
    if (mode === 'loading') await gate
    if (mode === 'failure') return route.fulfill({status: 503, json: {error: 'SETTINGS_UNAVAILABLE'}})
    const original = await route.fetch(), data = await original.json()
    data.items = mode === 'empty' ? [] : [{type: 'vendor-chat', name: '供应商渠道', configurable: false, fields: null}, ...data.items]
    return route.fulfill({response: original, json: data})
  })
  const dialog = await open(page)
  await expect(dialog).toContainText('正在发现渠道插件')
  mode = 'failure'; release()
  await expect(dialog).toContainText('设置暂不可用')
  await expect(dialog.getByLabel('渠道类型', {exact: true})).toBeEnabled()
  mode = 'empty'; await dialog.getByRole('button', {name: '重新发现插件', exact: true}).click()
  await expect(dialog).toContainText('暂无自定义插件')
  mode = 'supported'; await dialog.getByRole('button', {name: '重新发现插件', exact: true}).click()
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('vendor-chat')
  await expect(dialog).toContainText('此插件不支持网页配置')
  await expect(dialog.getByRole('button', {name: /^保存/})).toHaveCount(0)
  await dialog.getByLabel('渠道类型', {exact: true}).selectOption('fixture-custom')
  await expect(dialog.getByRole('button', {name: '保存自定义渠道', exact: true})).toBeVisible()
})

test('类型切换与关闭保留草稿，中文IME和校验安全，窄屏深色键盘及axe', async ({page}) => {
  const {dialog, form} = await custom(page, 'generic-draft')
  const type = dialog.getByLabel('渠道类型', {exact: true})
  await type.selectOption('dingtalk-dws')
  const dingtalkId = dialog.getByLabel('渠道标识', {exact: true}).filter({visible: true})
  await dingtalkId.fill('ding-draft')
  await type.selectOption('fixture-custom'); await expect(form.getByLabel('渠道标识', {exact: true})).toHaveValue('generic-draft')
  await form.getByLabel('渠道标识', {exact: true}).dispatchEvent('keydown', {key: 'Enter', isComposing: true, keyCode: 229})
  await expect(page.getByRole('dialog', {name: '保存自定义渠道', exact: true})).toHaveCount(0)
  await form.getByLabel('渠道标识', {exact: true}).fill('BAD ID')
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click()
  await expect(form.getByLabel('渠道标识', {exact: true})).toBeFocused()
  await expect(form.getByLabel('渠道标识', {exact: true})).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: '添加渠道', exact: true}).click()
  await expect(type).toHaveValue('fixture-custom'); await expect(form.getByLabel('渠道标识', {exact: true})).toHaveValue('BAD ID')
  await type.selectOption('dingtalk-dws'); await expect(dingtalkId).toHaveValue('ding-draft'); await type.selectOption('fixture-custom')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.setViewportSize({width: 390, height: 844})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).include('.channel-create-dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await type.focus(); await type.press('Alt+ArrowDown'); await page.screenshot({path: test.info().outputPath(`${theme}-generic-type-popup.png`)}); await type.press('Escape')
    if (!await dialog.count()) await page.getByRole('button', {name: '添加渠道', exact: true}).click()
    await page.screenshot({path: test.info().outputPath(`${theme}-custom-channel.png`)})
  }
})

test('自定义启用明确确认，保存中关闭被锁定，未知结果只读核对且不重发', async ({page}) => {
  const {dialog, form} = await custom(page, 'generic-unknown')
  await form.getByLabel('启用渠道', {exact: true}).selectOption('true')
  let writes = 0, release!: () => void
  const gate = new Promise<void>(resolve => {release = resolve})
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    writes++; await gate
    await route.fetch(); return route.abort()
  })
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click()
  await expect(page.getByRole('dialog', {name: '保存自定义渠道', exact: true})).toContainText('保存后插件可能立即接入并按自身权限处理消息。')
  await confirm(page)
  await expect(dialog.getByLabel('渠道类型', {exact: true})).toBeDisabled()
  await expect(dialog.getByRole('button', {name: '关闭添加渠道', exact: true})).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
  release(); await expect(form).toContainText('保存结果未知')
  await expect(form.getByRole('button', {name: '保存自定义渠道', exact: true})).toBeDisabled()
  await form.getByRole('button', {name: '核对保存状态', exact: true}).click()
  await expect(form).toContainText('只读核对确认当前保存配置与本次字段一致')
  expect(writes).toBe(1)
})

test('旧版本冲突保留草稿并要求重读，新增不能覆盖同名停用渠道', async ({page}) => {
  const {form} = await custom(page, 'generic-conflict')
  const session = await page.request.get('/api/session').then(response => response.json())
  const latest = await page.request.get('/api/settings').then(response => response.json())
  const headers = {origin: 'http://127.0.0.1:3081', 'x-csrf-token': session.csrfToken}
  await page.request.put('/api/settings/appearance', {headers, data: {name: 'Night Bot', icon: latest.appearance.icon === 'moon' ? 'star' : 'moon', expectedVersion: latest.version}})
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click(); await confirm(page)
  await expect(form).toContainText('设置已被修改')
  await expect(form.getByLabel('渠道标识', {exact: true})).toHaveValue('generic-conflict')
  await expect(form.getByRole('button', {name: '保存自定义渠道', exact: true})).toBeDisabled()
  await form.getByRole('button', {name: '重新读取配置版本', exact: true}).click()
  await form.getByRole('button', {name: '保存自定义渠道', exact: true}).click(); await confirm(page)
  await expect(form).toContainText('渠道配置已保存，正常重启后生效。')
  const saved = await page.request.get('/api/settings/channels').then(response => response.json())
  const collision = await page.request.post('/api/settings/channels', {headers, data: {type: 'fixture-custom', channelId: 'generic-conflict', config: {room: 'overwrite', listen: false}, enabled: false, createOnly: true, expectedVersion: saved.version}})
  expect(collision.status()).toBe(409)
  expect(await collision.json()).toMatchObject({error: 'CHANNEL_INSTANCE_EXISTS'})
  expect((await page.request.get('/api/settings/channels').then(response => response.json())).channels.find((row: {channelId: string}) => row.channelId === 'generic-conflict').config.room).toBe('generic-test-room')
})
