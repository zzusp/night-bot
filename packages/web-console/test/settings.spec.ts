import {test, expect, type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
async function login(page:Page){await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByLabel('显示名称',{exact:true})).toBeVisible()}
async function confirm(page:Page){await page.getByRole('dialog').getByRole('button',{name:/^确认(?:保存|清除|替换)$/,exact:true}).click()}
async function reset(page:Page){const session=await page.request.get('/api/session').then(r=>r.json());const settings=await page.request.get('/api/settings').then(r=>r.json());if(!settings.version)return;await page.request.put('/api/settings/appearance',{headers:{origin:new URL(page.url()).origin,'x-csrf-token':session.csrfToken},data:{name:'Night Bot',icon:'moon',expectedVersion:settings.version}})}
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
  const origin=new URL(page.url()).origin,anonymous=await browser.newContext();try{const loginPage=await anonymous.newPage();await loginPage.goto(origin+'/');await expect(loginPage.locator('.login-brand .board-logo')).toContainText('测试助手');await expect(loginPage.getByRole('heading',{name:'欢迎回到 测试助手',exact:true})).toBeVisible();expect((await loginPage.request.get(origin+'/api/settings')).status()).toBe(401)}finally{await anonymous.close()}
  await page.goto('/#/channels/room-product');await expect(page.locator('.message-assistant .message-meta strong').first()).toHaveText('测试助手');await expect(page.locator('.message-assistant .bot-avatar').first()).toHaveText('🤖')
  await page.goto('/#/chat');await expect(page.getByLabel('消息内容',{exact:true})).toHaveAttribute('placeholder','给 测试助手 发消息…')
  await page.goto('/#/settings')
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([])}}
 }finally{await reset(page)}
})
test('设置仅显示外观、角色模型和密钥，不展示或请求自定义渠道',async({page})=>{
 let channelRequests=0
 await page.route('**/api/settings/channels',route=>{channelRequests++;return route.fulfill({status:503,json:{error:'SETTINGS_UNAVAILABLE'}})})
 await login(page)
 const settings=page.locator('.settings-page')
 for(const name of ['助手外观','模型 API','模型 API Key','GitHub Token'])await expect(settings.getByRole('heading',{name,exact:true})).toBeVisible()
 await expect(settings.locator('.settings-card')).toHaveCount(8)
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
   await expect(settings.locator('.settings-card')).toHaveCount(8)
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

test('角色模型独立保存、原生选项、取消焦点、确认重启与刷新持久化',async({page})=>{
 await login(page)
 for(const label of ['一级分诊','Router','任务执行']){
  await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible()
  await page.getByLabel(label+'模型路由',{exact:true}).selectOption('fixture-model')
  await page.getByLabel(label+'模型',{exact:true}).selectOption('reasoning-fixture')
  const effort=page.getByLabel(label+'推理深度',{exact:true})
  await expect(effort.locator('option')).toHaveText(['模型默认','关闭 (off)','低 (low)','高 (high)'])
  await effort.selectOption(label==='Router'?'high':'low')
  const button=page.getByRole('button',{name:'保存'+label+'配置',exact:true})
  await button.click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused()
  await page.keyboard.press('Escape');await expect(button).toBeFocused()
  await button.click();await expect(page.getByRole('dialog')).toContainText('正常重启后生效');await confirm(page)
  await expect(page.getByText(label+'配置已保存，正常重启后生效。',{exact:true})).toBeVisible()
  await expect(button).toBeEnabled()
 }
 await page.reload()
 for(const label of ['一级分诊','Router','任务执行']){await expect(page.getByLabel(label+'模型',{exact:true})).toHaveValue('reasoning-fixture');await expect(page.getByLabel(label+'推理深度',{exact:true})).toHaveValue(label==='Router'?'high':'low')}
 await page.getByLabel('任务执行模型',{exact:true}).selectOption('fixture');await expect(page.getByLabel('任务执行推理深度',{exact:true})).toHaveValue('model-default')
 await expect(page.getByLabel('任务执行推理深度',{exact:true}).locator('option')).toHaveText(['模型默认','关闭 (off)'])
 await page.getByRole('button',{name:'保存任务执行配置',exact:true}).click();await confirm(page);await expect(page.getByText('任务执行配置已保存，正常重启后生效。',{exact:true})).toBeVisible()
 const settings=await page.request.get('/api/settings').then(r=>r.json())
 expect(settings.roleModels.roles.find((row:{role:string})=>row.role==='task').saved.reasoningEffort).toBeUndefined()
 await page.getByLabel('一级分诊模型路由',{exact:true}).focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:test.info().outputPath(`roles-${width}.png`),fullPage:true})}
})

test('角色保存失败、未知回执和版本冲突保留草稿且禁止重复提交',async({page})=>{
 await login(page)
 for(const mode of ['network','receipt','conflict']){
  let writes=0
  await page.route('**/api/settings/role-model',route=>{writes++;return mode==='network'?route.abort():route.fulfill({status:mode==='conflict'?409:200,json:mode==='conflict'?{error:'SETTINGS_VERSION_CONFLICT'}:{ok:true}})})
  await page.getByLabel('Router模型路由',{exact:true}).selectOption('fixture-model');await page.getByLabel('Router模型',{exact:true}).selectOption('reasoning-fixture');await page.getByLabel('Router推理深度',{exact:true}).selectOption('high')
  await page.getByRole('button',{name:'保存Router配置',exact:true}).click();await confirm(page)
  await expect(page.getByRole('button',{name:'保存Router配置',exact:true})).toBeDisabled();await expect(page.getByLabel('Router推理深度',{exact:true})).toHaveValue('high');await expect(page.getByText(/草稿已保留/).last()).toBeVisible();expect(writes).toBe(1)
  await expect(page.getByText('Router配置已保存，正常重启后生效。',{exact:true})).toHaveCount(0)
  await page.unroute('**/api/settings/role-model');await page.getByRole('button',{name:'重新读取设置并替换草稿',exact:true}).click();await expect(page.getByRole('button',{name:'保存Router配置',exact:true})).toBeEnabled()
 }
})

test('角色模型环境覆盖来源明确，忙碌禁用，确认保存不声称已运行',async({page})=>{
 await page.route('**/api/settings',async route=>{
  const response=await route.fetch(),data=await response.json()
  const row=data.roleModels.roles.find((row:{role:string})=>row.role==='triage')
  row.environmentOverrides=[{name:'NIGHT_BOT_TRIAGE_MODEL',source:'process'}];row.nextStart=row.running
  await route.fulfill({response,json:data})
 })
 await login(page)
 const section=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'一级分诊',exact:true})})
 await expect(section).toContainText('环境变量优先于保存配置');await expect(section).toContainText('NIGHT_BOT_TRIAGE_MODEL · 进程环境');await expect(section).toContainText('按当前环境重启')
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/api/settings/role-model',async route=>{await pending;await route.fulfill({status:503,json:{error:'SETTINGS_SAVE_UNAVAILABLE'}})})
 await page.getByRole('button',{name:'保存一级分诊配置',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('只保存网页配置不会移除覆盖');await confirm(page)
 await expect(page.getByLabel('一级分诊模型',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'保存一级分诊配置',exact:true})).toBeDisabled();release()
 await expect(section).toContainText('无法确认最新保存结果')
})
