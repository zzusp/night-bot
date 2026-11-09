import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

for (const failure of ['network', 'service', 'forbidden', 'malformed']) {
  test(`CSRF核对遇到${failure}保留会话及草稿，不误判失效或重放`, async ({page}) => {
    await page.goto('/#/chat')
    await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
    await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
    const input = page.getByLabel('消息内容', {exact: true}); await expect(input).toBeVisible()
    let sends = 0, checks = 0
    await page.route('**/api/session', async route => {
      checks++
      if (failure === 'network') return route.abort()
      return route.fulfill({status: failure === 'service' ? 503 : failure === 'forbidden' ? 403 : 200, contentType: 'application/json', body: JSON.stringify(failure === 'malformed' ? {authenticated: true} : {error: 'TEMPORARILY_UNAVAILABLE'})})
    })
    await page.route('**/api/chat', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      sends++; await route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: 'CSRF_INVALID'})})
    })
    await input.fill('核对故障不能删除此草稿'); await input.press('Enter')
    await expect(page.getByRole('button', {name: '核对发送状态', exact: true})).toBeVisible()
    await expect(input).toHaveValue('核对故障不能删除此草稿')
    await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
    expect(sends).toBe(1); expect(checks).toBe(1)
  })
}

test('资源401先核对有效会话，局部403不退出；真实会话丢失才要求重连且原令牌可用', async ({page, context}) => {
  await page.goto('/#/chat')
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  const input = page.getByLabel('消息内容', {exact: true}); await input.fill('保留这条草稿')
  let code = 401
  await page.route('**/api/overview', route => route.fulfill({status: code, contentType: 'application/json', body: JSON.stringify({error: 'RESOURCE_UNAVAILABLE'})}))
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.getByRole('button', {name: '刷新概览', exact: true})).toBeEnabled()
  await expect(input).toHaveValue('保留这条草稿')
  await expect(page.getByLabel('访问令牌', {exact: true})).toHaveCount(0)
  code = 403
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(input).toHaveValue('保留这条草稿')
  await page.unroute('**/api/overview'); await context.clearCookies()
  await page.getByRole('button', {name: '刷新概览', exact: true}).click()
  await expect(page.getByText('浏览器会话已结束，请使用访问令牌重新连接。', {exact: true})).toBeVisible()
  await page.getByLabel('访问令牌', {exact: true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name: '连接工作空间', exact: true}).click()
  await expect(input).toHaveValue('保留这条草稿')
})
