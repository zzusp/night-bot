import {test, expect, type Page} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

async function login(page: Page, initial = true) {
  if (initial) await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
}
const go = (page: Page, path: string) => page.evaluate(path => {location.hash = path}, path)
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done}); return {promise, resolve}}
// 网络响应完成后跨过浏览器渲染帧，确保迟到回调已消费再断言“没有导航”。
const renderResponses = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

test('未知发送跨页面恢复核对入口，只读核对后解除原草稿锁', async ({page}) => {
  await login(page); await go(page, '/chat/sample-plan')
  const input = page.getByLabel('消息内容', {exact: true})
  let sends = 0, readbackAvailable = false
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    sends++; await route.fetch(); await route.abort('failed')
  })
  await page.route('**/api/requests/**', route => readbackAvailable ? route.continue() : route.abort('failed'))
  await input.fill('跨页面保留未知发送及核对入口'); await input.press('Enter')
  await expect(page.getByRole('button', {name: '核对发送状态', exact: true})).toBeVisible()
  await go(page, '/tasks'); await expect(page.getByRole('heading', {name: '任务', exact: true, level: 1})).toBeVisible()
  await go(page, '/chat/sample-plan')
  await expect(input).toBeDisabled()
  await expect(input).toHaveValue('跨页面保留未知发送及核对入口')
  readbackAvailable = true
  await page.getByRole('button', {name: '核对发送状态', exact: true}).click()
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('')
  expect(sends).toBe(1)
})

test('在途发送跨卸载后收到真实回执，新挂载的同一对话及时解锁', async ({page}) => {
  await login(page); await go(page, '/chat/sample-plan')
  const held = deferred(), ready = deferred()
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch(); ready.resolve(); await held.promise; await route.fulfill({response})
  })
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('原对话延迟回执'); await input.press('Enter'); await ready.promise
  await go(page, '/tasks'); await expect(page.getByRole('heading', {name: '任务', exact: true, level: 1})).toBeVisible()
  await go(page, '/chat/sample-plan'); await expect(input).toBeDisabled()
  held.resolve()
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('')
  await expect(page.locator('.message-user').last()).toContainText('原对话延迟回执')
})

test('当前对话的迟到回执不抢路由，旧Web入口仍能正常发送', async ({page}) => {
  await login(page)
  const held = deferred(), ready = deferred(), completed = deferred()
  let sends = 0
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const index = ++sends
    const response = await route.fetch()
    if (index === 1) {ready.resolve(); await held.promise}
    await route.fulfill({response}); if (index === 1) completed.resolve()
  })
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('新对话的迟到回执'); await input.press('Enter'); await ready.promise
  await go(page, '/chat/sample-notes'); await expect(input).toBeEnabled()
  await input.fill('旧入口继续当前Web对话'); await input.press('Enter')
  await expect(page).toHaveURL(/\/#\/chat\/sample-plan$/)
  await go(page, '/tasks'); await expect(page.getByRole('heading', {name: '任务', exact: true, level: 1})).toBeVisible()
  const lateResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.text === '新对话的迟到回执')
  held.resolve(); await completed.promise; await (await lateResponse).finished(); await renderResponses(page)
  await expect(page).toHaveURL(/\/#\/tasks$/)
  expect(sends).toBe(2)
})

test('旧401不能撤销已经完成的新登录，原文缩进及换行不被改写', async ({page}) => {
  await login(page)
  const held = deferred(), ready = deferred(), completed = deferred()
  let originalText = ''
  // This case controls a late POST 401 across a new login. Background reads
  // must not discover cookie removal before that POST has been queued.
  const readsHeld = deferred(); let holdReads = true
  await page.route('**/api/**', async route => {
    if (holdReads && route.request().method() === 'GET') await readsHeld.promise
    await route.continue()
  })
  await page.context().clearCookies()
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    originalText = route.request().postDataJSON().text
    const response = await route.fetch(); expect(response.status()).toBe(401)
    ready.resolve(); await held.promise; await route.fulfill({response}); completed.resolve()
  })
  const source = '    保留代码缩进\n\n尾部换行\n'
  await page.getByLabel('消息内容', {exact: true}).fill(source)
  await page.getByRole('button', {name: '发送消息', exact: true}).click(); await ready.promise
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  holdReads = false; readsHeld.resolve()
  await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await login(page, false)
  held.resolve(); await completed.promise
  await expect(page.getByLabel('消息内容', {exact: true})).toBeEnabled()
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveValue(source)
  await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
  expect((await page.request.get('/api/session')).status()).toBe(200)
  expect(originalText).toBe(source)
})

test('退出在途时不允许旧401提前进入重登，完成后迟到消息不能恢复已退出草稿', async ({page}) => {
  await login(page)
  const exitHeld = deferred(), exitReady = deferred(), chatHeld = deferred(), chatReady = deferred(), chatDone = deferred()
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch(); chatReady.resolve(); await chatHeld.promise
    await route.fulfill({response}); chatDone.resolve()
  })
  await page.route('**/api/logout', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200)
    exitReady.resolve(); await exitHeld.promise; await route.fulfill({response})
  })
  await page.getByLabel('消息内容', {exact: true}).fill('退出时不保留这条草稿')
  await page.getByRole('button', {name: '发送消息', exact: true}).click(); await chatReady.promise
  await page.getByRole('button', {name: '退出登录', exact: true}).first().click(); await exitReady.promise
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.getByText('连接中断', {exact: true})).toBeVisible()
  await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
  exitHeld.resolve(); await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await login(page, false)
  await page.getByLabel('消息内容', {exact: true}).fill('新登录的新草稿')
  const lateResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.text === '退出时不保留这条草稿')
  chatHeld.resolve(); await chatDone.promise; await (await lateResponse).finished(); await renderResponses(page)
  await expect(page).toHaveURL(/\/#\/chat$/)
  await expect(page.getByLabel('消息内容', {exact: true})).toHaveValue('新登录的新草稿')
  await expect(page.getByLabel('消息内容', {exact: true})).toBeEnabled()
  expect((await page.request.get('/api/session')).status()).toBe(200)
})

test('同浏览器多标签登录更换cookie后只读同步会话，失败写操作不自动重放', async ({page, context}) => {
  const other = await context.newPage()
  await page.goto('/#/chat'); await other.goto('/#/chat')
  await expect(other.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await login(page, false); await login(other, false)
  let sends = 0, statuses: number[] = []
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    sends++; const response = await route.fetch(); statuses.push(response.status()); await route.fulfill({response})
  })
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('共享cookie更新后的显式发送'); await input.press('Enter')
  await expect(page.getByRole('alert')).toContainText('连接状态已变化')
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('共享cookie更新后的显式发送')
  expect(sends).toBe(1); expect(statuses).toEqual([403])
  await input.press('Enter'); await expect(input).toHaveValue('')
  expect(sends).toBe(2); expect(statuses).toEqual([403, 202])
  await page.getByRole('button', {name: '退出登录', exact: true}).first().click()
  await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await other.close()
})

test('未决回执跨登录过期仍保留核对入口与原请求，不重新发送', async ({page}) => {
  await login(page)
  let sends = 0, available = false
  await page.route('**/api/chat', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    sends++; await route.fetch(); await route.abort('failed')
  })
  await page.route('**/api/requests/**', route => available ? route.continue() : route.abort('failed'))
  const input = page.getByLabel('消息内容', {exact: true})
  await input.fill('保留未知结果，过期重登后核对'); await input.press('Enter')
  await expect(page.getByRole('button', {name: '核对发送状态', exact: true})).toBeVisible()
  await page.context().clearCookies()
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.getByLabel('访问令牌', {exact: true})).toBeVisible()
  await login(page, false)
  await expect(input).toBeDisabled(); await expect(input).toHaveValue('保留未知结果，过期重登后核对')
  available = true
  await page.getByRole('button', {name: '核对发送状态', exact: true}).click()
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('')
  expect(sends).toBe(1)
})

test('聊天和侧栏初读失败不伪装首次使用，概览局部失败明确显示且可恢复', async ({page}) => {
  await page.route('**/api/recent-conversations?*', route => route.fulfill({status: 503, json: {error: 'UNAVAILABLE'}}))
  await page.route('**/api/chat/sample-plan', route => route.fulfill({status: 503, json: {error: 'UNAVAILABLE'}}))
  await page.route('**/api/overview', async route => {
    const response = await route.fetch(), data = await response.json()
    await route.fulfill({json: {...data, channels: null, sectionErrors: {channels: 'SECTION_UNAVAILABLE'}}})
  })
  await login(page)
  await expect(page.locator('.desktop-sidebar')).toContainText('对话列表暂不可读')
  await expect(page.locator('.desktop-sidebar')).not.toContainText('从第一段对话开始')
  await expect(page.getByText('部分工作动态暂不可读，可刷新概览重新获取。')).toBeVisible()
  await expect(page.locator('.rail-task').first()).toBeVisible()
  await go(page, '/chat/sample-plan')
  await expect(page.getByRole('heading', {name: '对话暂不可读'})).toBeVisible()
  await expect(page.getByRole('heading', {name: '今天，有什么可以帮你？'})).toHaveCount(0)
  await page.unrouteAll({behavior: 'wait'})
  await page.locator('.chat-page').getByRole('button', {name: '重新获取', exact: true}).click()
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.locator('.message-user').first()).toBeVisible()
  await expect(page.locator('.desktop-sidebar').getByRole('navigation', {name: '最近对话'})).toBeVisible()
  await expect(page.getByText('部分工作动态暂不可读，可刷新概览重新获取。')).toHaveCount(0)
})

test('退出被CSRF拒绝但同步新会话成功后，不再消费先前旧401的过期标记', async ({page, context}) => {
  const other = await context.newPage()
  await page.goto('/#/chat'); await other.goto('/#/chat')
  await expect(other.getByLabel('访问令牌', {exact: true})).toBeVisible(); await login(page, false)
  const readHeld = deferred(), readReady = deferred(), readDone = deferred(), exitHeld = deferred(), exitReady = deferred()
  // 仅隔离侧栏并行刷新，让待测的真实 overview 401 决定过期事件顺序。
  const chatSnapshot = await page.request.get('/api/chat?offset=0&limit=20').then(response => response.json())
  await page.route('**/api/chat?*', route => route.fulfill({json: chatSnapshot}))
  const recentSnapshot = await page.request.get('/api/recent-conversations?offset=0&limit=20').then(response => response.json())
  const conversationSnapshot = await page.request.get('/api/conversations').then(response => response.json())
  await page.route('**/api/recent-conversations?*', route => route.fulfill({json: recentSnapshot}))
  await page.route('**/api/conversations', route => route.fulfill({json: conversationSnapshot}))
  await context.clearCookies()
  let firstOverview = true
  await page.route('**/api/overview', async route => {
    if (!firstOverview) return route.continue()
    firstOverview = false
    const response = await route.fetch(); expect(response.status()).toBe(401)
    readReady.resolve(); await readHeld.promise; await route.fulfill({response}); readDone.resolve()
  })
  await page.getByRole('button', {name: '刷新概览', exact: true}).click(); await readReady.promise
  await login(other, false)
  await page.route('**/api/logout', async route => {
    const response = await route.fetch(); expect(response.status()).toBe(403)
    exitReady.resolve(); await exitHeld.promise; await route.fulfill({response})
  })
  await page.getByRole('button', {name: '退出登录', exact: true}).first().click(); await exitReady.promise
  readHeld.resolve(); await readDone.promise
  await expect(page.getByText('连接中断', {exact: true})).toBeVisible()
  exitHeld.resolve()
  await expect(page.getByText('连接状态已变化，内容已保留。请重新确认连接后重试刚才的操作。', {exact: true})).toBeVisible()
  await expect(page.getByLabel('消息内容', {exact: true})).toBeVisible()
  await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
  expect((await page.request.get('/api/session')).status()).toBe(200)
  await page.unroute('**/api/overview'); await other.close()
})
