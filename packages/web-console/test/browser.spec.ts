import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {FIXTURE_TOKEN} from './preview.mjs'

const evidence = fileURLToPath(new URL('../../../docs/acceptance/web-console/round-2/', import.meta.url))
async function screenshot(page: Page, name: string) {
  await mkdir(evidence, {recursive: true})
  await page.screenshot({path: join(evidence, name + '.png'), fullPage: true, animations: 'disabled'})
}
async function login(page: Page) {
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
  await expect(page.getByText('已连接', {exact: true})).toBeVisible()
}

test('访问令牌掩码、失败提示、真实登录和退出', async ({page}) => {
  await page.goto('/')
  const token = page.getByLabel('访问令牌', {exact: true})
  await expect(token).toHaveAttribute('type', 'password')
  await token.fill('wrong-token')
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByRole('alert')).toContainText('连接失败')
  await token.fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '显示访问令牌', exact: true}).click()
  await expect(token).toHaveAttribute('type', 'text')
  await page.getByRole('button', {name: '隐藏访问令牌', exact: true}).click()
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(FIXTURE_TOKEN)
  const session = await page.request.get('/api/session')
  expect(session.status()).toBe(200)
  expect((await page.context().cookies()).some(cookie => cookie.httpOnly && cookie.sameSite === 'Strict')).toBe(true)
  await page.getByRole('button', {name: '退出登录', exact: true}).first().click()
  await expect(token).toBeVisible()
  expect((await page.request.get('/api/session')).status()).toBe(401)
})

test('聊天经真实服务器接纳、IME不误发、回复与刷新后历史保留', async ({page}) => {
  await login(page)
  await screenshot(page, 'desktop-overview')
  let sends = 0
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat') sends++})
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('验证中文输入法')
  await input.dispatchEvent('compositionstart', {data: '法'})
  await input.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229})
  expect(sends).toBe(0)
  await expect(input).toHaveValue('验证中文输入法')
  await input.dispatchEvent('compositionend', {data: '法'})
  await input.press('End')
  await input.press('Shift+Enter')
  await input.type('保留原始上下文')
  expect(sends).toBe(0)
  await input.press('Enter')
  await expect(page.locator('.message-assistant')).toContainText('这是本地隔离验收回复')
  expect(sends).toBe(1)
  await expect(input).toHaveValue('')
  await page.reload()
  await expect(page.locator('.message-user')).toContainText('验证中文输入法')
  await expect(page.locator('.message-assistant')).toContainText('回复写入独立的 SQLite 交付账本')
  await screenshot(page, 'chat')
})

test('任务列表筛选、分页、详情与执行记录', async ({page}) => {
  await login(page)
  await page.goto('/#/tasks')
  await expect(page.locator('.task-table tbody tr')).toHaveCount(20)
  await page.getByRole('button', {name: '下一页', exact: true}).click()
  await expect(page.locator('.task-table tbody tr')).toHaveCount(3)
  await page.getByRole('button', {name: '上一页', exact: true}).click()
  await page.getByRole('navigation', {name: '任务状态'}).getByRole('link', {name: '排队中', exact: true}).click()
  await expect(page.getByRole('heading', {name: '这里还没有任务', exact: true})).toBeVisible()
  await page.getByRole('navigation', {name: '任务状态'}).getByRole('link', {name: '全部', exact: true}).click()
  const search = page.getByRole('searchbox', {name: '筛选当前页', exact: true})
  await search.fill('无匹配验收关键词')
  await expect(page.getByRole('heading', {name: '这一页没有匹配的任务', exact: true})).toBeVisible()
  await page.getByRole('button', {name: '清除搜索', exact: true}).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await screenshot(page, 'tasks')
  await page.locator('.task-table').getByRole('link', {name: '整理本周产品调研', exact: true}).click()
  await expect(page.getByRole('heading', {name: '整理本周产品调研', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '执行动态', exact: true})).toBeVisible()
  await screenshot(page, 'task-detail')
  await page.getByRole('button', {name: '执行记录', exact: true}).click()
  await expect(page.locator('.message-assistant').filter({hasText: '已开始核对现有资料'})).toBeVisible()
  await expect(page.locator('.execution-scope')).toContainText('当前执行上下文')
  await expect(page.locator('.message-tool')).toHaveCount(2)
  await expect(page.locator('.message-tool').first()).toContainText('read')
  await expect(page.locator('.message-tool').last()).toContainText('已读取 3 份资料')
  await page.locator('.message-tool').last().locator('summary').click()
  await expect(page.locator('.message-tool').last().getByText('已读取 3 份资料，发现 2 处待确认差异。', {exact: true})).toBeVisible()
  await expect(page.locator('.task-dialogue')).not.toContainText('TASK_DIALOGUE_NOT_EXECUTION')
  await expect(page.locator('.task-dialogue')).not.toContainText('SECRET_THINKING_FIXTURE')
  await expect(page.locator('.task-dialogue')).not.toContainText('SECRET_ARGUMENT_FIXTURE')
  expect(await page.getByLabel('消息内容', {exact: true}).count()).toBe(0)
  await screenshot(page, 'execution-context')
})

test('执行上下文区分提交中和不可用，不展示空白成功状态', async ({page}) => {
  await login(page)
  for (const [id, state] of [['task-schedule', 'pending'], ['task-inventory', 'unavailable']]) {
    await page.goto('/#/tasks/' + id)
    const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/tasks/${id}/session`)
    await page.getByRole('button', {name: '执行记录', exact: true}).click()
    expect((await (await response).json()).status).toBe(state)
    const context = page.locator('.task-dialogue')
    await expect(context).toContainText(state === 'pending' ? /提交|写入/ : /不可用|无法|暂时不能/)
    expect(await context.locator('.message').count()).toBe(0)
    await expect(context).not.toContainText('TASK_DIALOGUE_NOT_EXECUTION')
  }
})

test('真实形状的任务阻断项经白名单投影显示等待处理，不泄露操作输入', async ({page}) => {
  await login(page)
  const detailResponse = page.waitForResponse(result => new URL(result.url()).pathname === '/api/tasks/task-schedule')
  await page.goto('/#/tasks/task-schedule')
  const response = await detailResponse
  expect(response.status()).toBe(200)
  const detail = await response.json()
  expect(detail.blockers).toEqual([{kind: 'operation', id: expect.stringMatching(/^[a-f0-9]{64}$/), title: '待核实操作：pwsh', status: 'unknown', toolName: 'pwsh'}])
  expect(JSON.stringify(detail)).not.toContain('SECRET_OPERATION_INPUT_FIXTURE')
  await expect(page.getByRole('heading', {name: '等待处理', exact: true})).toBeVisible()
  await expect(page.locator('.blockers')).toContainText('待核实操作：pwsh')
  await expect(page.locator('.blockers').getByText('待核实', {exact: true})).toBeVisible()
  await expect(page.locator('.blockers')).not.toContainText('SECRET_OPERATION_INPUT_FIXTURE')
  await screenshot(page, 'task-blockers')
})

test('丢失发送回执后先核对，恢复连接只读原收据且不重放', async ({page}) => {
  await login(page)
  let admissions = 0, admittedConversation = ''
  await page.route('**/api/requests/**', route => route.abort('failed'))
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    admissions++
    const response = await route.fetch()
    expect(response.status()).toBe(202)
    admittedConversation = (await response.json()).conversationId
    // 服务端真实提交成功，只丢弃浏览器回执，不能用mock成功代替持久接纳。
    await route.abort('failed')
  })
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('验证回执丢失后只核对一次')
  await input.press('Enter')
  await expect(page.getByRole('button', {name: '核对发送状态', exact: true})).toBeVisible()
  expect(admissions).toBe(1)
  expect(admittedConversation).not.toBe('')
  await expect(input).toHaveValue('验证回执丢失后只核对一次')
  await expect(input).toBeDisabled()
  await expect(page.getByRole('button', {name: '重试这条消息', exact: true})).toHaveCount(0)
  await page.unroute('**/api/requests/**')
  await page.getByRole('button', {name: '核对发送状态', exact: true}).click()
  await expect(page).toHaveURL(new RegExp('/chat/' + admittedConversation))
  await expect(page.locator('.message-user')).toHaveCount(1)
  await expect(page.locator('.message-assistant')).toContainText('这是本地隔离验收回复')
  expect(admissions).toBe(1)
  await expect(input).toHaveValue('')
  await expect(input).toBeEnabled()
})

for (const fixture of [
  {name: 'POST 202 pending accepted:false 保留草稿，核对 accepted 后才清空', loseResponse: false, terminal: 'accepted'},
  {name: '丢失 POST 回执后 pending 到 rejected 保留草稿并恢复编辑', loseResponse: true, terminal: 'rejected'},
  {name: '丢失 POST 回执后 pending 到 accepted 才清空草稿', loseResponse: true, terminal: 'accepted'},
] as const) {
  test(`协议 fixture：${fixture.name}，仅发送一次`, async ({page}) => {
    await login(page)
    // 协议边界使用显式回执 fixture；真实持久接纳与丢失回执由前一用例验证。
    let submitted: {conversationId: string; requestId: string; text: string} | undefined
    let sends = 0, readbacks = 0
    let receiptStatus: 'pending' | 'accepted' | 'rejected' = 'pending'
    await page.route('**/api/chat', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      sends++
      submitted = route.request().postDataJSON()
      if (fixture.loseResponse) return route.abort('failed')
      return route.fulfill({status: 202, json: {...submitted, status: 'pending', accepted: false, duplicate: true}})
    })
    await page.route('**/api/requests/**', async route => {
      expect(route.request().method()).toBe('GET')
      expect(new URL(route.request().url()).pathname).toBe(`/api/requests/${submitted?.requestId}`)
      readbacks++
      return route.fulfill({json: {...submitted, status: receiptStatus}})
    })
    await page.route('**/api/chat/*', async route => {
      expect(new URL(route.request().url()).pathname).toBe(`/api/chat/${submitted?.conversationId}`)
      return route.fulfill({json: {conversationId: submitted?.conversationId, status: 'ready', messages: [
        {id: 'protocol-fixture-message', role: 'user', text: submitted?.text, requestId: submitted?.requestId, createdAt: '2026-11-07T00:00:00.000Z'},
      ]}})
    })
    const text = `协议回执验收：${fixture.name}`
    const input = page.getByLabel('消息内容', {exact: true})
    await input.fill(text)
    await input.press('Enter')
    const reconcile = page.getByRole('button', {name: '核对发送状态', exact: true})
    await expect(reconcile).toBeVisible()
    await expect(input).toHaveValue(text)
    await expect(input).toBeDisabled()
    await expect(page).toHaveURL(/\/#\/chat$/)
    await expect(page.getByRole('button', {name: '重试这条消息', exact: true})).toHaveCount(0)
    expect(sends).toBe(1)
    expect(readbacks).toBe(fixture.loseResponse ? 1 : 0)

    const previousReadbacks = readbacks
    await reconcile.click()
    await expect.poll(() => readbacks).toBe(previousReadbacks + 1)
    await expect(input).toHaveValue(text)
    await expect(input).toBeDisabled()
    await expect(page).toHaveURL(/\/#\/chat$/)
    expect(sends).toBe(1)

    receiptStatus = fixture.terminal
    await reconcile.click()
    await expect(input).toBeEnabled()
    if (fixture.terminal === 'rejected') {
      await expect(page.getByRole('alert')).toContainText('未接纳')
      await expect(input).toHaveValue(text)
      await expect(page).toHaveURL(/\/#\/chat$/)
      await input.fill(text + '（调整后的草稿）')
      await expect(input).toHaveValue(text + '（调整后的草稿）')
    } else {
      await expect(page).toHaveURL(new RegExp('/chat/' + submitted?.conversationId))
      await expect(input).toHaveValue('')
      await expect(page.locator('.message-user')).toHaveCount(1)
      await expect(page.locator('.message-user')).toContainText(text)
    }
    await expect(reconcile).toHaveCount(0)
    expect(sends).toBe(1)
    expect(readbacks).toBe(previousReadbacks + 2)
  })
}

test('渠道会话按聊天展示、只读、保留不确定发送状态及空态', async ({page}) => {
  await login(page)
  await page.goto('/#/channels')
  await expect(page.locator('.channel-card')).toHaveCount(3)
  await screenshot(page, 'channels')
  await page.getByRole('searchbox', {name: '搜索会话', exact: true}).fill('不存在')
  await expect(page.getByRole('heading', {name: '没有匹配的会话', exact: true})).toBeVisible()
  await page.getByRole('button', {name: '清除搜索', exact: true}).click()
  await page.locator('.conversation-list').getByRole('link', {name: /产品协作/}).click()
  await expect(page.locator('.message')).toHaveCount(4)
  await expect(page.locator('.message').getByText('待核实', {exact: true})).toBeVisible()
  await expect(page.locator('.channel-chat-header').getByText('只读', {exact: true})).toBeVisible()
  expect(await page.getByLabel('消息内容', {exact: true}).count()).toBe(0)
  await screenshot(page, 'channel-chat')
  await page.goto('/#/channels/room-empty')
  await expect(page.getByRole('heading', {name: '暂无消息', exact: true})).toBeVisible()
})

test('请求失败保留已读内容并可恢复，失效登录后保留未发送草稿', async ({page}) => {
  await login(page)
  await page.goto('/#/tasks')
  await expect(page.locator('.task-table tbody tr')).toHaveCount(20)
  await page.route('**/api/tasks?**', route => route.abort('failed'))
  await expect(page.locator('.tasks-page .notice')).toContainText('当前显示上次获取的数据', {timeout: 15_000})
  await expect(page.locator('.task-table tbody tr')).toHaveCount(20)
  await page.unroute('**/api/tasks?**')
  await page.locator('.tasks-page').getByRole('button', {name: '重新获取', exact: true}).click()
  await expect(page.locator('.tasks-page .notice')).toHaveCount(0)
  await page.goto('/#/chat')
  await page.getByLabel('消息内容', {exact: true}).fill('尚未发送的草稿要保留')
  await page.context().clearCookies()
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveValue('尚未发送的草稿要保留')
})

test('窄屏导航、键盘关闭与深色页面没有横向溢出', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await login(page)
  await screenshot(page, 'mobile-chat')
  const open = page.getByRole('button', {name: '打开导航', exact: true})
  await open.click()
  await expect(page.getByRole('dialog', {name: '导航', exact: true})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', {name: '导航', exact: true})).not.toBeVisible()
  await expect(open).toBeFocused()
  await open.click()
  await page.getByRole('dialog', {name: '导航', exact: true}).locator('a[href="#/tasks"]').click()
  await expect(page.getByRole('heading', {name: '每一项工作，都有迹可循', exact: true})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, 'mobile-tasks')
  await page.setViewportSize({width: 1440, height: 960})
  await page.goto('/#/chat')
  await page.getByRole('button', {name: '切换深色外观', exact: true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await screenshot(page, 'dark-chat')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarColor)).not.toBe('auto')
})

test('主要页面通过 axe WCAG AA，减弱动态设置保持可操作', async ({page}) => {
  test.setTimeout(70_000)
  await page.emulateMedia({reducedMotion: 'reduce'})
  await login(page)
  for (const route of ['/chat', '/tasks', '/tasks/task-research', '/channels', '/channels/room-product']) {
    await page.goto('/#' + route)
    await expect(page.getByText('已连接', {exact: true})).toBeVisible()
    await expect(page.locator('main .loading')).toHaveCount(0)
    const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations, `${route}: ${JSON.stringify(results.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})))}`).toEqual([])
  }
})

test('深色聊天、任务、执行上下文与渠道通过 axe WCAG AA', async ({page}) => {
  test.setTimeout(70_000)
  await login(page)
  await page.getByRole('button', {name: '切换深色外观', exact: true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  for (const route of ['/chat', '/tasks', '/tasks/task-research', '/channels', '/channels/room-product']) {
    await page.goto('/#' + route)
    await expect(page.getByText('已连接', {exact: true})).toBeVisible()
    await expect(page.locator('main .loading')).toHaveCount(0)
    if (route === '/tasks/task-research') {
      await page.getByRole('button', {name: '执行记录', exact: true}).click()
      await expect(page.locator('.message-tool')).toHaveCount(2)
    }
    const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations, `dark ${route}: ${JSON.stringify(results.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})))}`).toEqual([])
  }
})
