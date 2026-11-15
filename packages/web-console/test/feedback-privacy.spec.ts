import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('explicit diagnostic action and publication stay separate without collection confirmation', async ({page}) => {
  const writes: string[] = []
  await page.route('**/api/feedback**', route => {
    const request = route.request()
    if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname)
    if (request.method() === 'GET') return route.fulfill({json:{target:'zzusp/night-bot',model:'fixture/model',revision:'fixture-1',endpoint:'https://models.example'}})
    if (request.url().endsWith('/collect')) return route.fulfill({json:{id:'fixture',state:'ready',target:'zzusp/night-bot',title:'诊断预览',body:'脱敏后的诊断内容'}})
    return route.fulfill({status:500,json:{error:'Unexpected write'}})
  })
  await page.goto('/#/feedback')
  await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name:'连接工作空间',exact:true}).click()
  await expect(page.getByRole('radio', {name:'不收集',exact:true})).toBeChecked()
  await expect(page.locator('.feedback-disclosure')).toHaveCount(0)
  await expect(page.locator('#feedback-privacy-summary')).toHaveCount(0)
  await expect(page.getByText('了解详情', {exact:true})).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({width,height:960})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path:test.info().outputPath(`feedback-inline-${width}.png`)})
  }
  await page.getByRole('radio', {name:'由 AI 收集诊断',exact:true}).check()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', {name:'开始诊断',exact:true})).toBeEnabled()
  for (const width of [1440, 390]) {
    await page.setViewportSize({width,height:960})
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path:test.info().outputPath(`feedback-ai-inline-${width}.png`)})
  }
  expect(writes).toEqual([])
  await page.getByLabel('标题',{exact:true}).fill('测试问题')
  await page.getByLabel('问题详情',{exact:true}).fill('仅使用合成测试数据')
  await page.getByRole('button', {name:'开始诊断',exact:true}).click()
  await expect(page.getByRole('button', {name:'确认提交 Issue',exact:true})).toBeDisabled()
  await expect(page.getByLabel('提交正文',{exact:true})).toBeEditable()
  await expect(page.locator('#feedback-privacy-summary')).toHaveCount(0)
  expect(writes).toEqual(['/api/feedback/collect'])
})
