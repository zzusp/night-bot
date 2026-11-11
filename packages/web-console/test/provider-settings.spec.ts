import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
const manager=(page:Page)=>page.getByRole('region',{name:'模型与 API',exact:true});
async function login(page:Page){await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model')}
async function confirm(page:Page){await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click()}
async function state(page:Page){return page.request.get('/api/settings').then(response=>response.json())}
async function catalog(page:Page){return page.request.get('/api/settings/model-catalog').then(response=>response.json())}

test('路由 API、凭据与模型同卡配置，新建路由不切换默认或角色',async({page})=>{
 await login(page);const before=await state(page);
 await manager(page).getByRole('button',{name:'添加路由',exact:true}).click();await page.getByLabel('路由标识',{exact:true}).fill('provider-flow');await page.getByLabel('API 地址',{exact:true}).fill('https://route.example.invalid/v1');await page.getByLabel('首个模型 ID',{exact:true}).fill('route-model');await page.getByRole('button',{name:'创建路由',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('provider-flow');await confirm(page);
 await expect(page.getByLabel('模型路由',{exact:true})).toHaveValue('provider-flow');await expect(manager(page).getByRole('button',{name:'编辑模型 route-model',exact:true})).toBeEnabled();
 await expect(manager(page).getByLabel('API 地址',{exact:true})).toHaveValue('https://route.example.invalid/v1');await expect(manager(page).getByRole('region',{name:'模型 API Key',exact:true})).toContainText('未配置');
 let body:any;page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/settings/secrets/model'))body=request.postDataJSON()});
 await page.getByLabel('新的模型 API Key',{exact:true}).fill('TEST_ROUTE_ONLY_SECRET');await page.getByRole('button',{name:'替换模型 API Key',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('provider-flow');await expect(page.getByRole('dialog')).not.toContainText('TEST_ROUTE_ONLY_SECRET');await page.getByRole('dialog').getByRole('button',{name:'确认替换',exact:true}).click();await expect(page.getByLabel('新的模型 API Key',{exact:true})).toHaveValue('');await expect(manager(page).getByRole('region',{name:'模型 API Key',exact:true})).toContainText('已配置');expect(body.provider).toBe('provider-flow');
 const after=await state(page);expect(after.model).toEqual(before.model);expect(after.roleModels.roles.map((row:any)=>row.saved)).toEqual(before.roleModels.roles.map((row:any)=>row.saved));
 await expect(page.getByLabel('模型路由',{exact:true})).toBeEnabled();await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model');await expect(manager(page).getByRole('button',{name:'编辑模型 fixture',exact:true})).toBeEnabled();await expect(manager(page).getByLabel('API 地址',{exact:true})).not.toHaveValue('https://route.example.invalid/v1');await expect(manager(page).getByRole('button',{name:'编辑模型 route-model',exact:true})).toHaveCount(0);
 expect(JSON.stringify(await catalog(page))).not.toContain('TEST_ROUTE_ONLY_SECRET');expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('TEST_ROUTE_ONLY_SECRET');
});

test('修改选定路由 API 只提交修改字段，保留模型并保护草稿和键盘焦点',async({page})=>{
 await login(page);const before=await catalog(page),models=before.providers.find((row:any)=>row.provider==='fixture-model').models;let body:any;
 page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/settings/provider'))body=request.postDataJSON()});
 await page.getByLabel('API 地址',{exact:true}).fill('https://edited.example.invalid/v1');await expect(page.getByLabel('模型路由',{exact:true})).toBeDisabled();await expect(manager(page).getByRole('button',{name:'添加模型',exact:true})).toBeDisabled();
 await page.locator('.desktop-sidebar a[href="#/tasks"]').click();await expect(page.getByRole('dialog')).toContainText('未保存');await page.keyboard.press('Escape');
 const save=page.getByRole('button',{name:'保存 API 配置',exact:true});await save.click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(save).toBeFocused();await save.click();await confirm(page);
 await expect(manager(page).getByText('API 配置已保存，正常重启后生效。',{exact:true})).toBeVisible();await expect(page.getByLabel('模型路由',{exact:true})).toBeEnabled();expect(body).toEqual({provider:'fixture-model',baseURL:'https://edited.example.invalid/v1',expectedVersion:before.version});expect((await catalog(page)).providers.find((row:any)=>row.provider==='fixture-model').models).toEqual(models);
 await page.reload();await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://edited.example.invalid/v1');
});

test('API 未知回执、断网和冲突保留草稿，明确重读前不能重写或换路由',async({page})=>{
 await login(page);
 for(const mode of ['network','receipt','conflict']){let writes=0;
  await page.route('**/api/settings/provider',route=>{writes++;return mode==='network'?route.abort():route.fulfill({status:mode==='conflict'?409:200,json:mode==='conflict'?{error:'SETTINGS_VERSION_CONFLICT'}:{ok:true}})});
  await page.getByLabel('API 地址',{exact:true}).fill('https://uncertain.example.invalid/v1');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await confirm(page);
  await expect(manager(page)).toContainText('草稿已保留');await expect(page.getByRole('button',{name:'保存 API 配置',exact:true})).toBeDisabled();await expect(page.getByLabel('模型路由',{exact:true})).toBeDisabled();await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://uncertain.example.invalid/v1');expect(writes).toBe(1);
  await page.unroute('**/api/settings/provider');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(page.getByLabel('模型路由',{exact:true})).toBeEnabled();await expect(page.getByLabel('API 地址',{exact:true})).not.toHaveValue('https://uncertain.example.invalid/v1');
 }
});

test('API 写回成功但回读失败锁定，凭据未知结果同样禁止重复提交',async({page})=>{
 await login(page);let saved=false,writes=0;
 await page.route('**/api/settings/provider',async route=>{writes++;const response=await route.fetch();saved=true;await route.fulfill({response})});await page.route('**/api/settings/model-catalog',route=>saved?route.fulfill({status:400,json:{error:'SETTINGS_INPUT_INVALID'}}):route.continue());
 await page.getByLabel('API 地址',{exact:true}).fill('https://committed.example.invalid/v1');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await confirm(page);await expect(manager(page)).toContainText('无法确认最新保存结果');await expect(page.getByRole('button',{name:'保存 API 配置',exact:true})).toBeDisabled();expect(writes).toBe(1);
 await page.unroute('**/api/settings/provider');await page.unroute('**/api/settings/model-catalog');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://committed.example.invalid/v1');
 let keyWrites=0;await page.route('**/api/settings/secrets/model',route=>{keyWrites++;return route.fulfill({status:200,json:{ok:true}})});await page.getByLabel('新的模型 API Key',{exact:true}).fill('TEST_UNKNOWN_PROVIDER_SECRET');await page.getByRole('button',{name:'替换模型 API Key',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认替换',exact:true}).click();await expect(page.getByLabel('新的模型 API Key',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'替换模型 API Key',exact:true})).toBeDisabled();await expect(page.getByLabel('模型路由',{exact:true})).toBeDisabled();expect(keyWrites).toBe(1);
 await page.unroute('**/api/settings/secrets/model');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(page.getByRole('button',{name:'替换模型 API Key',exact:true})).toBeEnabled();
});

test('凭据共享警示、内置协议默认值与私密地址不会被便利表单隐式清除',async({page})=>{
 await page.route('**/api/settings/model-catalog',async route=>{const response=await route.fetch(),data=await response.json(),provider=data.providers.find((row:any)=>row.provider==='fixture-model');provider.api='';provider.baseURL='';provider.baseURLConfigured=true;provider.secret.sharedWith=['second-route'];await route.fulfill({response,json:data})});await login(page);
 await expect(page.getByLabel('API 协议',{exact:true})).toHaveValue('');await expect(page.getByLabel('API 地址',{exact:true})).toHaveAttribute('placeholder','已有地址包含私密参数，不回显');await expect(manager(page)).toContainText('此凭据还供 second-route 使用');
 await page.getByLabel('新的模型 API Key',{exact:true}).fill('TEST_NOT_SUBMITTED');await page.getByRole('button',{name:'替换模型 API Key',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('second-route');await page.keyboard.press('Escape');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();
 let body:any;await page.route('**/api/settings/provider',route=>{body=route.request().postDataJSON();return route.fulfill({status:400,json:{error:'SETTINGS_INPUT_INVALID'}})});await page.getByLabel('API 协议',{exact:true}).selectOption('openai-responses');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await confirm(page);await expect(manager(page).getByRole('alert')).toBeVisible();expect(body.api).toBe('openai-responses');expect(body).not.toHaveProperty('baseURL');
});

test('同一卡片的加载、失败、字段校验与窄屏深色可访问性',async({page})=>{
 await page.route('**/api/settings/model-catalog',route=>route.fulfill({status:503,json:{error:'SETTINGS_UNAVAILABLE'}}));await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(manager(page)).toContainText('设置暂不可用');await expect(manager(page).getByLabel('API 地址',{exact:true})).toHaveCount(0);await page.unroute('**/api/settings/model-catalog');await manager(page).getByRole('button',{name:'重新获取',exact:true}).click();await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();
 await page.getByLabel('API 地址',{exact:true}).fill('https://user:secret@example.invalid/v1');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await expect(page.getByLabel('API 地址',{exact:true})).toBeFocused();await expect(page.getByLabel('API 地址',{exact:true})).toHaveAttribute('aria-invalid','true');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();
 await page.getByLabel('API 协议',{exact:true}).focus();await page.keyboard.press('Alt+ArrowDown');await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'reduce'});
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [1440,390]){await page.setViewportSize({width,height:960});await manager(page).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:test.info().outputPath(`provider-settings-${theme}-${width}.png`),fullPage:true})}}
});

test('其它设置的恢复按钮不能在 API 保存途中重挂表单并丢失写入锁',async({page})=>{
 await login(page);
 await page.route('**/api/settings/role-model',route=>route.fulfill({status:409,json:{error:'SETTINGS_VERSION_CONFLICT'}}));await page.getByRole('button',{name:'保存Router配置',exact:true}).click();await confirm(page);const reload=page.getByRole('button',{name:'重新读取设置并替换草稿',exact:true});await expect(reload).toBeEnabled();await page.unroute('**/api/settings/role-model');
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let writes=0;await page.route('**/api/settings/provider',async route=>{writes++;await pending;await route.abort()});
 await page.getByLabel('API 地址',{exact:true}).fill('https://pending.example.invalid/v1');await page.getByRole('button',{name:'保存 API 配置',exact:true}).click();await confirm(page);await expect(reload).toBeDisabled();await expect(page.getByRole('button',{name:'重新读取设置',exact:true})).toBeDisabled();await expect(manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true})).toBeDisabled();release();await expect(manager(page)).toContainText('无法确认最新保存结果');expect(writes).toBe(1);await expect(page.getByRole('button',{name:'保存 API 配置',exact:true})).toBeDisabled();
});
