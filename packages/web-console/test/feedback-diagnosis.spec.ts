import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('diagnostic status is compact and aligned, with honest state and cancellation', async ({page}) => {
  let state = 'collecting'
  const writes: string[] = []
  const record = () => ({id:'diagnosis',state,target:'zzusp/night-bot',title:'渠道消息拉取异常',body:'合成诊断结果'})
  await page.route('**/api/feedback**', route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if(req.method() !== 'GET') writes.push(req.method() + ' ' + path)
    if(req.method() === 'DELETE') return route.fulfill({json:{ok:true}})
    if(path === '/api/feedback') return route.fulfill({json:{target:'zzusp/night-bot',model:'fixture/model',revision:'fixture-1'}})
    return route.fulfill({json:record()})
  })
  await page.goto('/#/feedback')
  await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name:'连接工作空间',exact:true}).click()
  await page.getByLabel('标题',{exact:true}).fill('渠道消息拉取异常')
  await page.getByLabel('问题详情',{exact:true}).fill('历史消息恢复失败，请核对渠道日志与恢复记录。')
  await page.getByRole('radio',{name:'由 AI 收集诊断',exact:true}).check()
  await page.getByRole('button',{name:'开始诊断',exact:true}).click()
  const panel = page.getByRole('region',{name:'AI 排查',exact:true})
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('status')).toHaveText('AI 正在诊断')
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900})
    const box = await panel.boundingBox(), form = await page.locator('.feedback-page > .settings-card').first().boundingBox()
    expect(Math.abs(box!.x - form!.x)).toBeLessThan(2)
    expect(Math.abs(box!.width - form!.width)).toBeLessThan(2)
    expect(box!.height).toBeLessThan(100)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:test.info().outputPath(`diagnosis-light-${width}.png`)})
  }
  await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:'切换深色外观',exact:true}).click()
  await page.screenshot({path:test.info().outputPath('diagnosis-dark-1440.png')})
  await page.getByRole('button',{name:'切换浅色外观',exact:true}).click()
  await page.getByRole('button',{name:'停止并清除',exact:true}).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue('渠道消息拉取异常')
  await page.getByRole('button',{name:'开始诊断',exact:true}).click()
  state='ready'
  await expect(page.getByLabel('提交正文',{exact:true})).toBeVisible()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('button',{name:'确认提交 Issue',exact:true})).toBeDisabled()
  await expect(page.locator('.feedback-preview .settings-card-heading').getByRole('button',{name:'清除暂存',exact:true})).toBeVisible()
  await page.screenshot({path:test.info().outputPath('diagnosis-ready-1440.png')})
  expect(writes).toEqual(['POST /api/feedback/collect','DELETE /api/feedback/diagnosis','POST /api/feedback/collect'])
})

test('an expired diagnosis unlocks the original form without replay; a new failure explains the timeout', async ({page}) => {
  const writes: string[] = []
  await page.route('**/api/feedback**', route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (path === '/api/feedback') return route.fulfill({json:{target:'zzusp/night-bot',model:'fixture/model',revision:'fixture-1'}})
    if (req.method() !== 'GET') writes.push(req.method() + ' ' + path)
    const record = {id:`diagnosis-${writes.length}`,state:'collecting',target:'zzusp/night-bot',title:'合成问题',body:''}
    if (req.method() === 'POST') return route.fulfill({status:202,json:record})
    if (writes.length === 1) return route.fulfill({status:404,json:{error:'FEEDBACK_NOT_FOUND'}})
    return route.fulfill({json:{...record,state:'failed',error:'FEEDBACK_MODEL_TIMEOUT'}})
  })
  await page.goto('/#/feedback')
  await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name:'连接工作空间',exact:true}).click()
  await page.getByLabel('标题',{exact:true}).fill('合成问题')
  await page.getByLabel('问题详情',{exact:true}).fill('操作后报错')
  await page.getByRole('radio',{name:'由 AI 收集诊断',exact:true}).check()
  const start = page.getByRole('button',{name:'开始诊断',exact:true})
  await start.click()
  await expect(page.getByText(/本次诊断已不再可用/)).toBeVisible()
  await expect(start).toBeEnabled()
  await expect(page.getByLabel('问题详情',{exact:true})).toHaveValue('操作后报错')
  expect(writes).toEqual(['POST /api/feedback/collect'])
  await start.click()
  await expect(page.getByText(/模型请求超时/)).toBeVisible()
  await expect(page.getByText(/诊断编号：diagnosis-2/)).toBeVisible()
  await expect(page.getByRole('button',{name:'确认提交 Issue'})).toHaveCount(0)
  expect(writes).toEqual(['POST /api/feedback/collect','POST /api/feedback/collect'])
})
