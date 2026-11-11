import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'

async function screenshot(page: Page, name: string) {
  await page.screenshot({path: test.info().outputPath(name + '.png'), fullPage: true, animations: 'disabled'})
}
async function login(page: Page) {
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
  await expect(page.getByText('已连接', {exact: true})).toBeVisible()
}

async function openReadActivity(page: Page) {
  await page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name: '执行', exact: true}).click()
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/tasks/task-research/session')
  await page.getByRole('button', {name: '获取最新记录', exact: true}).click()
  const session = await (await response).json()
  // Refresh now reads only additions. The already-rendered calls remain in the
  // continuous reader; inspect a fresh bounded snapshot for source assertions.
  expect(session.items).toEqual([])
  const snapshot = await (await page.request.get('/api/tasks/task-research/session?stream=1&limit=200')).json()
  const tools = snapshot.items.filter((row: {role: string}) => row.role === 'tool')
  expect(tools.map((row: {kind: string}) => row.kind)).toEqual(['tool-call', 'tool-result'])
  const [call, result] = tools
  expect(call.callId).toMatch(/^[a-f0-9]{64}$/)
  expect(result.callId).toBe(call.callId)
  expect(result.source.entryId).not.toBe(call.source.entryId)
  expect(result.status).toBe('completed')
  const activity = page.locator('.message-tool')
  await expect(activity).toHaveCount(1)
  await expect(activity.locator('.execution-tool-input > summary > strong')).toHaveText('read')
  await expect(activity.getByText('已完成', {exact: true})).toBeVisible()
  await expect(activity.locator('.tool-content')).toHaveCount(0)
  await activity.locator('.execution-tool-input > summary').click()
  await activity.locator('.execution-tool-output > summary').click()
  const parts = activity.locator('.execution-tool-input-row, .execution-tool-output-row')
  await expect(parts).toHaveCount(2)
  await expect(parts.nth(0).locator('h4')).toHaveText('输入')
  await expect(parts.nth(1).locator('h4')).toHaveText('输出')
  expect(JSON.parse(await parts.nth(0).locator('.tool-content').innerText())).toEqual({})
  await expect(parts.nth(1).locator('.tool-content')).toHaveText('已读取 3 份资料，发现 2 处待确认差异。')
  for (const [index, row] of tools.entries()) {
    expect(row.source.callId).toBe(call.callId)
    expect(row.source.sessionId).toBe(snapshot.sessionId)
    await expect(parts.nth(index).locator('.message-source')).toHaveCount(0)
    await expect(parts.nth(index)).not.toContainText(row.source.entryId)
    await expect(parts.nth(index)).not.toContainText(call.callId)
  }
  await expect(activity).not.toContainText('仅展示获准公开的工具字段')
  await expect(activity).not.toContainText('Pi 会话')
  await expect(activity).not.toContainText('/not/browser-safe')
  await expect(activity).not.toContainText('SECRET_ARGUMENT_FIXTURE')
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
  await expect(page.locator('.message-assistant').last()).toContainText('这是本地隔离验收回复')
  expect(sends).toBe(1)
  await expect(input).toHaveValue('')
  await page.reload()
  await expect(page.locator('.message-user').last()).toContainText('验证中文输入法')
  await expect(page.locator('.message-assistant').last()).toContainText('回复写入独立的 SQLite 交付账本')
  await screenshot(page, 'chat')
})

test('概览请求未完成时聊天仍独立读取、编辑与切换，释放后才显示连接', async ({page}) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started = false, completed = false
  await page.route('**/api/overview', async route => {
    started = true
    const response = await route.fetch()
    await gate
    await route.fulfill({response})
    completed = true
  })
  try {
    await page.goto('/#/chat')
    await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
    await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
    const input = page.getByLabel('消息内容', {exact: true})
    await expect(input).toBeVisible()
    await expect.poll(() => started).toBe(true)
    const chat = page.getByRole('navigation', {name: '最近对话'}).getByRole('link').first()
    await expect(chat).toBeVisible()
    await chat.click()
    await expect(page.locator('.message-user').first()).toBeVisible()
    await input.fill('概览未完成时仍可编辑的草稿')
    await input.press('End')
    await input.press('Shift+Enter')
    await input.type('保留换行')
    await expect(input).toHaveValue(`概览未完成时仍可编辑的草稿
保留换行`)
    expect(completed).toBe(false)
    await expect(page.getByText('已连接', {exact: true})).toHaveCount(0)
    release()
    await expect.poll(() => completed).toBe(true)
    await expect(page.getByText('已连接', {exact: true})).toBeVisible()
    await expect(input).toHaveValue(`概览未完成时仍可编辑的草稿
保留换行`)
  } finally { release() }
})

test('任务列表筛选、分页、详情与执行记录', async ({page}) => {
  await login(page)
  await page.goto('/#/tasks')
  await expect(page.locator('.task-table tbody tr')).toHaveCount(20)
  await page.getByRole('button', {name: '下一页', exact: true}).click()
  await expect(page.locator('.task-table tbody tr')).toHaveCount(3)
  await page.getByRole('button', {name: '上一页', exact: true}).click()
  await page.getByRole('navigation', {name: '任务状态'}).getByRole('link', {name: '排队中', exact: true}).click()
  await expect(page.getByRole('heading', {name: '暂无任务', exact: true})).toBeVisible()
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
  await page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name: '执行', exact: true}).click()
  await expect(page.getByRole('heading', {name: '执行动态', exact: true})).toBeVisible()
  await screenshot(page, 'task-detail')
  await openReadActivity(page)
  await expect(page.locator('.message-assistant').filter({hasText: '已开始核对现有资料'})).toBeVisible()
  await expect(page.locator('.execution-scope')).toContainText('当前执行上下文')
  await expect(page.locator('.task-dialogue')).not.toContainText('TASK_DIALOGUE_NOT_EXECUTION')
  await expect(page.locator('.task-dialogue')).not.toContainText('SECRET_THINKING_FIXTURE')
  await expect(page.locator('.task-dialogue')).not.toContainText('SECRET_ARGUMENT_FIXTURE')
  expect(await page.getByLabel('消息内容', {exact: true}).count()).toBe(0)
  await screenshot(page, 'execution-context')
})

test('执行上下文区分提交中和不可用，不展示空白成功状态', async ({page}) => {
  await login(page)
  for (const [id, state] of [['task-schedule', 'pending'], ['task-inventory', 'unavailable']]) {
    await page.goto('/#/tasks/' + id + '?view=execution')
    const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/tasks/${id}/session`)
    await page.getByRole('button', {name: '获取最新记录', exact: true}).click()
    expect((await (await response).json()).status).toBe(state)
    const context = page.locator('.task-dialogue')
    await expect(context).toContainText(state === 'pending' ? /提交|写入/ : /暂不可读/)
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
  const initialMessages = await page.locator('.message-user').count()
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
  await expect(page.locator('.message-user')).toHaveCount(initialMessages + 1)
  await expect(page.locator('.message-assistant').last()).toContainText('这是本地隔离验收回复')
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
      if (!submitted) return route.continue()
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

test('渠道认证、错误、就绪与未知阶段分开显示，不从 enabled 推断健康', async ({page}) => {
  await login(page)
  const rows = [
    {channelId: 'waiting-login', type: 'fixture-chat', enabled: true, connectionState: 'waiting-auth', errorCode: 'CHANNEL_AUTH_REQUIRED', connected: false},
    {channelId: 'adapter-error', type: 'fixture-chat', enabled: true, connectionState: 'error', errorCode: 'CHANNEL_ADAPTER_ERROR', connected: false},
    {channelId: 'actual-ready', type: 'fixture-chat', enabled: false, connectionState: 'ready', errorCode: null, connected: true},
    {channelId: 'unreported', type: 'fixture-chat', enabled: true, connectionState: 'unknown', errorCode: null},
  ]
  await page.route('**/api/channels', route => route.fulfill({json: {items: rows}}))
  await page.goto('/#/channels')
  const card = (id: string) => page.locator('.channel-card').filter({has: page.getByText(id, {exact: true})})
  await expect(card('waiting-login')).toContainText('需要认证')
  await expect(card('waiting-login')).toContainText('健康检查未就绪')
  await expect(card('adapter-error')).toContainText('健康检查异常')
  await expect(card('adapter-error')).not.toContainText('适配器异常，请查看运维说明')
  await expect(card('actual-ready')).toContainText('未启用')
  await expect(card('actual-ready')).toContainText('健康检查正常')
  await expect(card('unreported')).toContainText('健康状态未报告')
  await expect(card('unreported')).not.toContainText('健康检查正常')
  await screenshot(page, 'channel-connection-states')
})

test('学习记录区分已应用与候选，正文仅按已授权版本读取', async ({page}) => {
  await login(page)
  const source = {taskId: 'task-research', reviewId: 'r'.repeat(64), eventId: 'fixture-completed-event'}
  const version = 'a'.repeat(64), id = 'b'.repeat(64), forbiddenId = 'c'.repeat(64)
  const changes = [
    {id, reviewId: source.reviewId, taskId: source.taskId, kind: 'memory', action: 'upsert', status: 'applied', scope: 'personal', name: '核对经验', version, canRead: true, source},
    {id: forbiddenId, reviewId: source.reviewId, taskId: source.taskId, kind: 'skill', action: 'current-version', status: 'candidate', scope: 'group', name: '候选核查步骤', version, canRead: false, source},
  ]
  let bodyReads = 0
  await page.route('**/api/tasks/task-research/learning', route => route.fulfill({json: {status: 'ready', reviews: [
    {reviewId: source.reviewId, taskId: source.taskId, eventId: source.eventId, status: 'done', summary: '已记录隔离样例复盘', at: null}], changes, revision: 'd'.repeat(64)}}))
  await page.route('**/api/tasks/task-research/learning/changes/*?version=*', async route => {
    bodyReads++
    expect(new URL(route.request().url()).searchParams.get('version')).toBe(version)
    expect(route.request().url()).toContain('/changes/' + id + '?')
    await route.fulfill({json: {id, kind: 'memory', version, source, text: '已授权的经验正文。', redacted: false}})
  })
  await page.goto('/#/tasks/task-research?view=learning')
  await expect(page.getByRole('heading', {name: '记忆与技能变更记录', exact: true})).toBeVisible()
  await expect(page.locator('.learning-change').first()).toContainText('已应用')
  await expect(page.locator('.learning-change').last()).toContainText('候选，未应用')
  await expect(page.getByRole('button', {name: '正文未授权', exact: true})).toBeDisabled()
  expect(bodyReads).toBe(0)
  await page.getByRole('button', {name: '读取授权正文', exact: true}).click()
  await expect(page.getByText('已授权的经验正文。', {exact: true})).toBeVisible()
  expect(bodyReads).toBe(1)
  await screenshot(page, 'learning-scope-and-version')
})

test('渠道会话按聊天展示、隐藏输入框、保留不确定发送状态及空态', async ({page}) => {
  await login(page)
  await page.goto('/#/channels')
  await expect(page.locator('.channel-card:not(.channel-card--add)')).toHaveCount(4)
  await screenshot(page, 'channels')
  await page.getByRole('searchbox', {name: '搜索会话', exact: true}).fill('不存在')
  await expect(page.getByRole('heading', {name: '没有匹配的会话', exact: true})).toBeVisible()
  await page.getByRole('button', {name: '清除搜索', exact: true}).click()
  await page.locator('.conversation-list').getByRole('link', {name: /产品协作/}).click()
  await expect(page.locator('.message')).toHaveCount(4)
  await expect(page.locator('.message').getByText('待核实', {exact: true})).toBeVisible()
  await expect(page.locator('.channel-chat').getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('.channel-chat-header').getByText('只读', {exact: true})).toHaveCount(0)
  await expect(page.locator('.header-location h1')).toHaveText('产品协作')
  expect(await page.getByLabel('消息内容', {exact: true}).count()).toBe(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 960})
    await expect(page.locator('.message-links')).toHaveCount(0)
    await expect(page.getByRole('link', {name: '查看关联任务', exact: true})).toHaveCount(0)
    await expect(page.getByRole('button', {name: '复制消息'})).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
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
  await expect(page.getByRole('heading', {name: '任务', exact: true, level: 1})).toBeVisible()
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
      await openReadActivity(page)
    }
    const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations, `dark ${route}: ${JSON.stringify(results.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})))}`).toEqual([])
  }
})

test('初次读取失败与真实空数据分开显示，恢复路径只有一个重试入口', async ({page}) => {
  await login(page)
  await page.route('**/api/tasks?**', route => route.fulfill({status: 503, json: {error: 'FIXTURE_UNAVAILABLE'}}))
  await page.goto('/#/tasks')
  await expect(page.getByRole('heading', {name: '任务列表暂不可读', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '暂无任务', exact: true})).toHaveCount(0)
  await expect(page.locator('.tasks-page').getByRole('button', {name: '重新获取', exact: true})).toHaveCount(1)
  await page.unroute('**/api/tasks?**')
  await page.locator('.tasks-page').getByRole('button', {name: '重新获取', exact: true}).click()
  await expect(page.locator('.task-table tbody tr')).toHaveCount(20)

  await page.route('**/api/channels', route => route.fulfill({status: 503, json: {error: 'FIXTURE_UNAVAILABLE'}}))
  await page.route('**/api/conversations', route => route.fulfill({status: 503, json: {error: 'FIXTURE_UNAVAILABLE'}}))
  await page.goto('/#/channels')
  await expect(page.getByRole('heading', {name: '渠道配置暂不可读', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '渠道会话暂不可读', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '还没有配置渠道', exact: true})).toHaveCount(0)
  await expect(page.getByRole('heading', {name: '等待第一条消息', exact: true})).toHaveCount(0)
  await page.unroute('**/api/channels')
  await page.unroute('**/api/conversations')

  await page.route('**/api/conversations/room-empty/messages?**', route => route.fulfill({status: 503, json: {error: 'FIXTURE_UNAVAILABLE'}}))
  await page.goto('/#/channels/room-empty')
  await expect(page.getByRole('heading', {name: '消息记录暂不可读', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '暂无消息', exact: true})).toHaveCount(0)
  await expect(page.locator('.channel-chat').getByRole('button', {name: '重新获取', exact: true})).toHaveCount(1)
  await page.unroute('**/api/conversations/room-empty/messages?**')
  await page.locator('.channel-chat').getByRole('button', {name: '重新获取', exact: true}).click()
  await expect(page.getByRole('heading', {name: '暂无消息', exact: true})).toBeVisible()

  await page.route('**/api/tasks/task-research/session?**', route => route.fulfill({status: 503, json: {error: 'FIXTURE_UNAVAILABLE'}}))
  await page.goto('/#/tasks/task-research?view=execution')
  await page.getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(page.getByRole('heading', {name: '执行记录暂不可读', exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: '暂无可展示的执行记录', exact: true})).toHaveCount(0)
  await expect(page.locator('.task-dialogue').getByRole('button', {name: '重新获取', exact: true})).toHaveCount(1)
})

test('窄屏长发送者与工具名不撑宽消息区，未知来源不冒称当前用户', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await login(page)
  const longMarkdown = '技术内容应在自己的区域滚动。\n\n```text\n' + 'long_identifier_'.repeat(50) + '\n```\n\n| 字段 | 内容 |\n| --- | --- |\n| 来源 | ' + 'x'.repeat(180) + ' |'
  const messages = [
    {id: 'long-sender', role: 'user', senderName: 'sender_' + 'x'.repeat(180), text: longMarkdown, taskIds: Array.from({length: 8}, (_, i) => 'task-' + i)},
    {id: 'unknown-sender', role: 'user', text: '未提供发送者姓名的渠道原始消息。'},
  ]
  await page.route('**/api/conversations', async route => {
    const response = await route.fetch()
    const data = await response.json()
    await route.fulfill({json: {items: data.items.map((item: {id: string}) => item.id === 'room-product' ? {...item, type: null} : item)}})
  })
  await page.route('**/api/conversations/room-product/messages?**', route => route.fulfill({json: {items: messages, pages: {messages: {nextOffset: null, total: 2}, outbox: {nextOffset: null, total: 0}}}}))
  await page.goto('/#/channels/room-product')
  await expect(page.locator('.message-meta strong').last()).toHaveText('渠道成员')
  await expect(page.getByRole('region', {name: /会话类型未记录/})).toBeVisible()
  const transcript = page.getByRole('region', {name: '消息记录', exact: true})
  expect(await transcript.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.locator('.markdown pre').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(page.locator('.message-links')).toHaveCount(0)
  await expect(page.getByRole('link', {name: '查看关联任务', exact: true})).toHaveCount(0)
  await screenshot(page, 'mobile-long-channel')

  await page.route('**/api/tasks/task-research/session?**', route => route.fulfill({json: {status: 'ready', scope: 'current-session-context', items: [
    {id: 'source-user', role: 'user', text: '来自任务原始来源的输入。', kind: 'source'},
    {id: 'long-tool', role: 'tool', toolName: 'tool_' + 'x'.repeat(120), kind: 'tool-result', text: longMarkdown, status: 'completed'},
  ], total: 2, nextOffset: null}}))
  await page.goto('/#/tasks/task-research?view=execution')
  await page.getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(page.locator('.message-user .execution-message-role')).toHaveText('用户')
  const summary = page.locator('.execution-tool-output > summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.execution-tool-output')).toHaveAttribute('open', '')
  expect(await transcript.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, 'mobile-long-execution')
})

test('任务阻断状态中文可读，未开始的执行与提交中的记录分开提示', async ({page}) => {
  await login(page)
  const states = [['prepared', '已准备'], ['recovering', '恢复中'], ['stopping', '停止中'], ['succeeded', '已成功'], ['stale', '已失效'], ['not_started', '未开始']]
  await page.route('**/api/tasks/task-schedule', async route => {
    const response = await route.fetch()
    const data = await response.json()
    await route.fulfill({json: {...data, blockers: states.map(([status], index) => ({kind: 'execution', id: `state-${index}`, title: `执行项 ${index + 1}`, status}))}})
  })
  await page.goto('/#/tasks/task-schedule')
  for (const [, label] of states) await expect(page.locator('.blockers').getByText(label, {exact: true})).toBeVisible()
  await page.getByRole('navigation', {name: '任务信息分类'}).getByRole('link', {name: '执行', exact: true}).click()
  await page.route('**/api/tasks/task-schedule/session?**', route => route.fulfill({json: {status: 'pending', reason: 'SESSION_NOT_STARTED', scope: 'current-session-context', items: [], total: 0, nextOffset: null}}))
  await page.getByRole('button', {name: '获取最新记录', exact: true}).click()
  await expect(page.getByRole('heading', {name: '执行尚未开始', exact: true})).toBeVisible()
  await expect(page.locator('.task-dialogue')).not.toContainText('正在保存记录')
})

test('上翻历史后后台消息不拉回底部，键盘可回到最新消息', async ({page}) => {
  await login(page)
  const messages = Array.from({length: 20}, (_, index) => ({id: `scroll-${index}`, role: index % 2 ? 'assistant' : 'user', text: `第 ${index + 1} 条历史消息。\n\n` + '保留当前阅读位置。'.repeat(12)}))
  await page.route('**/api/conversations/room-product/messages?**', route => route.fulfill({json: {items: messages, pages: {messages: {nextOffset: null, total: messages.length}, outbox: {nextOffset: null, total: 0}}}}))
  await page.goto('/#/channels/room-product')
  const transcript = page.getByRole('region', {name: '消息记录', exact: true})
  await expect(page.locator('.message')).toHaveCount(20)
  await expect.poll(() => transcript.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1)
  await transcript.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => transcript.evaluate(el => el.scrollTop)).toBe(0)
  messages.push({id: 'scroll-new', role: 'assistant', text: '后台新增的消息。'})
  await expect(page.locator('.message')).toHaveCount(21, {timeout: 12_000})
  expect(await transcript.evaluate(el => el.scrollTop)).toBe(0)
  const latest = page.getByRole('button', {name: '回到最新消息', exact: true})
  await latest.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => transcript.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1)
  await expect(latest).toHaveCount(0)
})

test('最近对话包含渠道名称，点击后标题和发送人保留显示名称', async ({page}) => {
  const named={id:'stable-room-id',name:'已认证群名称',channelId:'team-channel',type:'chat-room'}
  await page.route('**/api/recent-conversations?*',route=>route.fulfill({json:{items:[{id:named.id,title:named.name,kind:'channel',updatedAt:'2026-11-09T12:00:00Z'}],total:1,nextOffset:null}}))
  await page.route('**/api/conversations',route=>route.fulfill({json:{items:[named]}}))
  await page.route('**/api/conversations/stable-room-id/messages?*',route=>route.fulfill({json:{items:[{id:'message-one',role:'user',senderName:'已认证发送人',text:'原消息'}],pages:{messages:{total:1,nextOffset:null},outbox:{total:0,nextOffset:null}}}}))
  await login(page)
  const sidebar=page.locator('.desktop-sidebar').getByRole('navigation',{name:'最近对话'})
  await sidebar.getByRole('link',{name:'已认证群名称'}).click()
  await expect(page).toHaveURL(/#\/channels\/stable-room-id$/)
  await expect(page.locator('.header-location h1')).toHaveText('已认证群名称')
  await expect(page.locator('.header-location h1')).toHaveText('已认证群名称')
  await expect(page.locator('.channel-chat .transcript')).toContainText('已认证发送人')
  await expect(page.locator('.channel-chat')).not.toContainText('stable-room-id')
})
