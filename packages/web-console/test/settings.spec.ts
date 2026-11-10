import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
async function login(page:Page){await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByLabel('显示名称',{exact:true})).toBeVisible()}
async function confirm(page:Page){await page.getByRole('dialog').getByRole('button',{name:/^确认(?:保存|清除|替换)$/,exact:true}).click()}
async function reset(page:Page){const session=await page.request.get('/api/session').then(r=>r.json());const settings=await page.request.get('/api/settings').then(r=>r.json());if(!settings.version)return;await page.request.put('/api/settings/appearance',{headers:{origin:'http://127.0.0.1:3081','x-csrf-token':session.csrfToken},data:{name:'Night Bot',icon:'moon',expectedVersion:settings.version}})}
test('模型配置、密钥替换清除、拒绝回显和重新读取状态',async({page})=>{
 await login(page)
 await page.getByLabel('API 地址',{exact:true}).fill('https://model.example.invalid/v1');await page.getByLabel('模型名称',{exact:true}).fill('web-test-model')
 await page.getByRole('button',{name:'保存模型配置',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('https://model.example.invalid/v1');await confirm(page)
 await expect(page.getByText('模型配置已保存，正常重启后生效。',{exact:true})).toBeVisible()
 await expect(page.getByText(/当前保存路由：web-model/)).toBeVisible()
 for(const [kind,label] of [['model','模型 API Key'],['github','GitHub Token']]){
  const input=page.getByLabel('新的'+label,{exact:true});await expect(input).toHaveAttribute('type','password')
  await input.fill('TEST_ONLY_'+kind+'_SECRET');await page.getByRole('button',{name:'替换'+label,exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'替换'+label,exact:true})).toBeFocused();await page.getByRole('button',{name:'替换'+label,exact:true}).click();await expect(page.getByRole('dialog')).not.toContainText('TEST_ONLY_');await confirm(page)
  await expect(input).toHaveValue('')
  await expect(page.locator('.settings-card').filter({has:page.getByRole('heading',{name:label,exact:true})})).toContainText('已配置')
  const metadata=await page.request.get('/api/settings').then(r=>r.text());expect(metadata).not.toContain('TEST_ONLY_')
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('TEST_ONLY_')
  await page.reload();await expect(page.getByLabel('新的'+label,{exact:true})).toHaveValue('')
  await page.getByRole('button',{name:'清除'+label,exact:true}).click();await confirm(page)
  await expect(page.locator('.settings-card').filter({has:page.getByRole('heading',{name:label,exact:true})})).toContainText('未配置')
 }
})
test('名称和内置图标保存、刷新及会话统一展示，窄屏与深色axe',async({page,browser})=>{
 await login(page)
 try{
  await page.getByLabel('显示名称',{exact:true}).fill('测试助手');await page.getByLabel('助手图标',{exact:true}).selectOption('robot');await page.getByRole('button',{name:'保存外观',exact:true}).click()
  await expect(page.locator('.desktop-sidebar .board-logo')).toContainText('测试助手');await expect(page.locator('.desktop-sidebar .board-logo-mark')).toHaveText('🤖')
  await page.reload();await expect(page.getByLabel('显示名称',{exact:true})).toHaveValue('测试助手');await expect(page.getByLabel('助手图标',{exact:true})).toHaveValue('robot')
  const anonymous=await browser.newContext();try{const loginPage=await anonymous.newPage();await loginPage.goto('http://127.0.0.1:3081/');await expect(loginPage.locator('.login-brand .board-logo')).toContainText('测试助手');await expect(loginPage.getByRole('heading',{name:'欢迎回到 测试助手',exact:true})).toBeVisible();expect((await loginPage.request.get('http://127.0.0.1:3081/api/settings')).status()).toBe(401)}finally{await anonymous.close()}
  await page.goto('/#/channels/room-product');await expect(page.locator('.message-assistant .message-meta strong').first()).toHaveText('测试助手');await expect(page.locator('.message-assistant .bot-avatar').first()).toHaveText('🤖')
  await page.goto('/#/chat');await expect(page.getByLabel('消息内容',{exact:true})).toHaveAttribute('placeholder','给 测试助手 发消息…')
  await page.goto('/#/settings')
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([])}}
 }finally{await reset(page)}
})
test('设置仅显示外观、模型和密钥，不展示或请求自定义渠道',async({page})=>{
 let channelRequests=0
 await page.route('**/api/settings/channels',route=>{channelRequests++;return route.fulfill({status:503,json:{error:'SETTINGS_UNAVAILABLE'}})})
 await login(page)
 const settings=page.locator('.settings-page')
 for(const name of ['助手外观','模型 API','模型 API Key','GitHub Token'])await expect(settings.getByRole('heading',{name,exact:true})).toBeVisible()
 await expect(settings.locator('.settings-card')).toHaveCount(4)
 await expect(settings.getByRole('heading',{name:'自定义渠道',exact:true})).toHaveCount(0)
 await expect(settings.getByRole('button',{name:'重新发现插件',exact:true})).toHaveCount(0)
 await expect(settings.getByLabel('渠道插件',{exact:true})).toHaveCount(0)
 await expect(settings.locator('.custom-channel-form')).toHaveCount(0)
 await page.getByRole('button',{name:'重新读取设置',exact:true}).click()
 await expect(page.getByLabel('显示名称',{exact:true})).toBeVisible()
 await page.reload();await expect(page.getByLabel('显示名称',{exact:true})).toBeVisible()
 expect(channelRequests).toBe(0)
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:960})
   await expect(settings.locator('.settings-card')).toHaveCount(4)
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
   await page.screenshot({path:test.info().outputPath(`${theme}-${width}-settings.png`),fullPage:true})
  }
 }
})
test('设置失败可恢复，字段错误不退出，未知保存不自动重复',async({page})=>{
 await login(page)
 let writes=0
 await page.route('**/api/settings/appearance',route=>{writes++;return route.abort()})
 await page.getByLabel('显示名称',{exact:true}).fill('失败后保留名称');await page.getByRole('button',{name:'保存外观',exact:true}).click()
 await expect(page.getByText('失败后保留名称',{exact:false})).toHaveCount(0)
 await expect(page.getByLabel('显示名称',{exact:true})).toHaveValue('失败后保留名称');await expect(page.getByLabel('访问令牌',{exact:true})).toHaveCount(0);expect(writes).toBe(1)
 await page.unroute('**/api/settings/appearance');await page.getByRole('button',{name:'重新读取设置',exact:true}).click()
 await expect(page.getByLabel('显示名称',{exact:true})).toHaveValue('Night Bot')
 let secretWrites=0;await page.route('**/api/settings/secrets/github',route=>{secretWrites++;return route.abort()})
 const secret=page.getByLabel('新的GitHub Token',{exact:true});await secret.fill('TEST_UNKNOWN_SECRET');await page.getByRole('button',{name:'替换GitHub Token',exact:true}).click();await confirm(page);await expect(secret).toHaveValue('');await expect(page.getByText(/密钥输入已清空，请先重新读取状态/)).toBeVisible();expect(secretWrites).toBe(1)
})
