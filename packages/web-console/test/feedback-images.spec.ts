import {test, expect} from '@playwright/test'
import {FIXTURE_TOKEN} from './preview.mjs'

test('image feedback hands off to GitHub without uploading or creating an issue', async ({page, context}) => {
  const requests: string[] = []
  const body = '已核对的问题详情\n' + '完整正文不能放入 URL。'.repeat(3000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/api/feedback**', async route => {
    const request = route.request()
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
    if (request.method() === 'GET') return route.fulfill({json:{target:'zzusp/night-bot',model:null}})
    if (request.url().endsWith('/draft')) return route.fulfill({json:{id:'fixture-feedback',state:'ready',target:'zzusp/night-bot',title:'图片问题',body}})
    return route.fulfill({status:500,json:{error:'Unexpected feedback mutation'}})
  })
  // Never contact real GitHub, upload a real image, or create a real issue.
  await context.route('https://github.com/**', route => route.fulfill({body:'Mock GitHub editor',contentType:'text/plain'}))
  await page.goto('/#/feedback')
  await page.getByLabel('访问令牌', {exact:true}).fill(FIXTURE_TOKEN)
  await page.getByRole('button', {name:'连接工作空间',exact:true}).click()
  await page.getByLabel('标题', {exact:true}).fill('图片问题')
  await page.getByLabel('问题详情', {exact:true}).fill('图片需要说明的问题')
  await page.getByRole('button', {name:'生成预览',exact:true}).click()
  await page.getByRole('radio', {name:'在 GitHub 添加图片',exact:true}).check()
  await expect(page.getByRole('button', {name:'确认提交 Issue',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button', {name:'打开 GitHub 编辑页 ↗',exact:true})).toBeDisabled()
  await page.getByRole('button', {name:'复制完整正文',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('完整正文已复制')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body)
  await page.getByRole('checkbox').check()
  const link = page.getByRole('button', {name:'打开 GitHub 编辑页 ↗',exact:true})
  await expect(link).toBeEnabled()
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:960})
    await link.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path:test.info().outputPath(`feedback-images-${width}.png`)})
  }
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL('https://github.com/zzusp/night-bot/issues/new')
  await popup.close()
  await expect(page.getByRole('radio', {name:'不添加图片',exact:true})).toBeDisabled()
  expect(requests.filter(value => value.startsWith('POST'))).toEqual(['POST /api/feedback/draft'])
  await expect(page.locator('input[type=file]')).toHaveCount(0)
})
