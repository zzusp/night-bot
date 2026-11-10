import {test,expect,type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {FIXTURE_TOKEN} from './preview.mjs'
async function login(page:Page){await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByRole('heading',{name:'每日工作日志',exact:true})).toBeVisible()}
const card=(page:Page)=>page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'每日工作日志',exact:true})})
test('工作日志保存、读取、校验、键盘和窄屏无障碍',async({page})=>{
 await login(page);const section=card(page)
 await expect(section).toContainText('服务器本地时区');await expect(page.getByLabel('每天执行时间（24 小时制）',{exact:true})).toHaveValue('23:59')
 await page.getByLabel('每天执行时间（24 小时制）',{exact:true}).fill('25:00');await section.getByRole('button',{name:'保存工作日志配置',exact:true}).click()
 await expect(page.getByLabel('每天执行时间（24 小时制）',{exact:true})).toBeFocused();await expect(section).toContainText('请填写 00:00 至 23:59')
 await page.getByLabel('每天执行时间（24 小时制）',{exact:true}).fill('22:45');await page.getByLabel('执行时区',{exact:true}).fill('Asia/Shanghai');await page.getByLabel('自动记录',{exact:true}).selectOption('false')
 await section.getByRole('button',{name:'保存工作日志配置',exact:true}).click();await expect(section).toContainText('工作日志配置已保存，正常重启后生效。');await expect(section.getByRole('button',{name:'保存工作日志配置',exact:true})).toBeEnabled()
 await page.reload();await expect(page.getByLabel('每天执行时间（24 小时制）',{exact:true})).toHaveValue('22:45');await expect(page.getByLabel('执行时区',{exact:true})).toHaveValue('Asia/Shanghai');await expect(page.getByLabel('自动记录',{exact:true})).toHaveValue('false')
 await expect(section).toContainText('当前运行：已开启');await expect(section).toContainText('当前保存：已关闭')
 await page.getByLabel('自动记录',{exact:true}).focus();await page.keyboard.press('Space');await page.keyboard.press('Escape')
 for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:test.info().outputPath(`work-log-${width}.png`),fullPage:true})}
})
test('工作日志未知保存与冲突保持草稿且不重复提交',async({page})=>{
 await login(page)
 for(const mode of ['network','conflict','receipt']){
  let writes=0;await page.route('**/api/settings/work-log',route=>{writes++;return mode==='network'?route.abort():route.fulfill({status:mode==='conflict'?409:200,json:mode==='conflict'?{error:'SETTINGS_VERSION_CONFLICT'}:{ok:true}})})
  await page.getByLabel('每天执行时间（24 小时制）',{exact:true}).fill('20:30');await card(page).getByRole('button',{name:'保存工作日志配置',exact:true}).click();await expect(card(page)).toContainText('草稿已保留');await expect(page.getByLabel('每天执行时间（24 小时制）',{exact:true})).toHaveValue('20:30');await expect(card(page).getByRole('button',{name:'保存工作日志配置',exact:true})).toBeDisabled();expect(writes).toBe(1)
  await page.unroute('**/api/settings/work-log');await card(page).getByRole('button',{name:'重新读取设置并替换草稿',exact:true}).click();await expect(card(page).getByRole('button',{name:'保存工作日志配置',exact:true})).toBeEnabled()
 }
})
test('工作日志环境覆盖、忙碌防重复、离开保留草稿',async({page})=>{
 await page.route('**/api/settings',async route=>{const response=await route.fetch(),data=await response.json();data.workLog.environmentOverrides=[{name:'NIGHT_BOT_WORK_LOG_TIME',source:'process'}];await route.fulfill({response,json:data})})
 await login(page);await expect(card(page)).toContainText('NIGHT_BOT_WORK_LOG_TIME');await page.getByLabel('每天执行时间（24 小时制）',{exact:true}).fill('21:00')
 await page.locator('.desktop-sidebar a[href="#/channels"]').click();await expect(page.getByRole('dialog')).toContainText('设置还有未保存的修改');await page.keyboard.press('Escape');await expect(page.getByLabel('每天执行时间（24 小时制）',{exact:true})).toHaveValue('21:00')
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let writes=0
 await page.route('**/api/settings/work-log',async route=>{writes++;await pending;await route.fulfill({status:503,json:{error:'SETTINGS_SAVE_UNAVAILABLE'}})})
 await card(page).getByRole('button',{name:'保存工作日志配置',exact:true}).click();await expect(page.getByLabel('执行时区',{exact:true})).toBeDisabled();await expect(card(page).getByRole('button',{name:'保存工作日志配置',exact:true})).toBeDisabled();expect(writes).toBe(1);release();await expect(card(page)).toContainText('无法确认最新保存结果')
})
