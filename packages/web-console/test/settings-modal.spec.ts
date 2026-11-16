import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN,startPreview} from './preview.mjs';
async function login(page:Page,path='/chat/sample-plan',origin=''){
 await page.goto(origin+'/#'+path);await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.locator('.workspace-topbar')).toBeVisible();
}
async function open(page:Page){if(await page.getByRole('button',{name:'打开导航',exact:true}).isVisible())await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible()}
test('设置模态保留底页和草稿，键盘取消/放弃恢复焦点',async({page})=>{
 await login(page,'/tasks/task-research');const route=page.url();
 await page.locator('.main-panel').evaluate(el=>el.scrollTop=120);const before=await page.locator('.main-panel').evaluate(el=>el.scrollTop);
 await open(page);const modal=page.getByRole('dialog',{name:'设置',exact:true});
 await page.getByLabel('API 地址',{exact:true}).fill('https://draft.example.invalid/v1');
 await page.getByRole('tab',{name:'模型分工',exact:true}).click();await page.getByRole('tab',{name:'模型与 API',exact:true}).click();await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://draft.example.invalid/v1');
 await page.keyboard.press('Escape');const confirm=page.getByRole('dialog',{name:'离开设置',exact:true});await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(modal).toBeVisible();await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://draft.example.invalid/v1');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await confirm.getByRole('button',{name:'放弃草稿并离开',exact:true}).click();await expect(modal).toHaveCount(0);expect(page.url()).toBe(route);expect(await page.locator('.main-panel').evaluate(el=>el.scrollTop)).toBe(before);await expect(page.getByRole('button',{name:'设置',exact:true}).filter({visible:true})).toBeFocused();
 await open(page);await expect(page.getByLabel('API 地址',{exact:true})).not.toHaveValue('https://draft.example.invalid/v1');
 const first=page.getByRole('tab',{name:'模型与 API',exact:true});await first.focus();await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'部署信息',exact:true})).toBeFocused();await page.keyboard.press('Home');await expect(first).toBeFocused();
 await page.getByRole('button',{name:'关闭设置',exact:true}).focus();await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('.settings-modal'))).toBe(true);
});
test('部署信息真实授权HTTP白名单、复制和撤权清除',async({page,context})=>{
 expect((await page.request.get('/api/settings/deployment')).status()).toBe(401);await login(page);await open(page);await page.getByRole('tab',{name:'部署信息',exact:true}).click();await expect(page.getByRole('heading',{name:'实例目录',exact:true})).toBeVisible();
 const response=await page.request.get('/api/settings/deployment');expect(response.status()).toBe(200);const info=await response.json();expect(info.pathScope).toBe('instance');expect(info.directories.find((r:any)=>r.id==='credentials').path).not.toContain('credentials.json');expect(info.skillDirectories).toBe(null);
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'复制安装路径',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(info.directories.find((r:any)=>r.id==='install').path);
 await page.route('**/api/settings/deployment',route=>route.fulfill({status:403,json:{error:{code:'ACCESS_DENIED'}}}));await page.getByRole('tabpanel',{name:'部署信息',exact:true}).getByRole('button',{name:'刷新',exact:true}).click();await expect(page.locator('.deployment-directories')).toHaveCount(0);await expect(page.locator('.settings-modal .read-error-summary')).toBeVisible();
});
test('设置与部署信息桌面手机浅深实拍和可访问性',async({page})=>{
 await login(page);await open(page);
 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const name of ['模型与 API','部署信息']){
   await page.getByRole('tab',{name,exact:true}).click();await expect(page.getByRole('tabpanel',{name,exact:true})).toBeVisible();if(name==='部署信息')await expect(page.getByRole('heading',{name:'实例目录',exact:true})).toBeVisible();
   const rect=await page.locator('.settings-modal').boundingBox();expect(Math.abs(rect!.x*2+rect!.width-width)).toBeLessThan(1);if(width===390){expect(rect!.width).toBe(390);expect(rect!.height).toBe(960)}
   expect(await page.locator('.settings-panels').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   expect((await new AxeBuilder({page}).include('.settings-modal').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   await page.screenshot({path:test.info().outputPath(`settings-modal-${name}-${theme}-${width}.png`)});
   if(name==='部署信息'){await page.locator('.settings-panels').evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.getByRole('heading',{name:'Skills 加载目录',exact:true})).toBeInViewport();await page.screenshot({path:test.info().outputPath(`settings-modal-部署目录-${theme}-${width}.png`)});await page.locator('.settings-panels').evaluate(el=>el.scrollTop=0)}
  }
 }
});

for(const width of [1440,390])test(`底页真实长记录滚动和聊天草稿不卸载 ${width}`,async({page})=>{
 const fixture=await startPreview({port:0,historyRounds:35});try{
  await page.setViewportSize({width,height:900});await login(page,'/tasks/task-research',fixture.origin);
  const transcript=page.locator('.execution-transcript .transcript');await expect(transcript).toBeVisible();await expect(transcript.locator('.message-user').first()).toBeAttached();
  await transcript.evaluate(el=>el.scrollTop=el.scrollHeight/2);const before=await transcript.evaluate(el=>el.scrollTop);expect(before).toBeGreaterThan(170);const original=await transcript.elementHandle();const url=page.url();
  await open(page);await expect(page.locator('.main-frame')).toHaveAttribute('inert','');await page.keyboard.press('Escape');await expect(page.locator('.settings-modal')).toHaveCount(0);expect(page.url()).toBe(url);expect(await original!.evaluate(el=>el.isConnected)).toBe(true);expect(Math.abs(await transcript.evaluate(el=>el.scrollTop)-before)).toBeLessThanOrEqual(1);
  if(width===390)await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeFocused();
  await page.goto(fixture.origin+'/#/chat/sample-plan');const draft=page.getByLabel('消息内容',{exact:true});await draft.fill('仅用于预览的未发送草稿');const composer=await draft.elementHandle();await open(page);await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(draft).toHaveValue('仅用于预览的未发送草稿');expect(await composer!.evaluate(el=>el.isConnected)).toBe(true);
 }finally{await fixture.close()}
});

test('保存中与未知回执阻止关闭，不重复写入',async({page})=>{
 await login(page);await open(page);let release!:()=>void,writes=0;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/settings/provider',async route=>{writes++;await gate;await route.fulfill({status:503,json:{error:{code:'SETTINGS_UNAVAILABLE'}}})});
 try{
  await page.getByLabel('API 地址',{exact:true}).fill('https://pending.example.invalid/v1');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await page.locator('dialog.settings-confirm').getByRole('button',{name:'确认保存',exact:true}).click();await expect(page.getByRole('button',{name:'保存 API 配置',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(page.locator('.settings-modal')).toBeVisible();await expect(page.locator('.settings-workspace > [role="status"]')).toContainText('设置正在保存');expect(writes).toBe(1);
  release();await expect(page.getByText('无法确认最新保存结果。 草稿已保留，不会自动重试。请重新读取路由配置并核对。',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.settings-modal')).toBeVisible();await expect(page.locator('dialog.settings-confirm')).toHaveCount(0);expect(writes).toBe(1);
 }finally{release()}
});
