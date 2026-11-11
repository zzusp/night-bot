import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const manager=(page:Page)=>page.getByRole('region',{name:'模型与 API',exact:true});
async function login(page:Page){await page.goto('/#/settings');await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model')}
async function add(page:Page,id:string,name=''){await manager(page).getByRole('button',{name:'添加模型',exact:true}).click();await page.getByLabel('模型 ID',{exact:true}).fill(id);await page.getByLabel('模型显示名称（可选）',{exact:true}).fill(name);await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();await expect(manager(page).getByText('模型已添加。正常重启后生效，不中断当前执行。',{exact:true})).toBeVisible();await expect(manager(page).getByRole('button',{name:'添加模型',exact:true})).toBeEnabled()}
async function role(page:Page,label:string,id:string){await page.getByLabel(label+'模型路由',{exact:true}).selectOption('fixture-model');await page.getByLabel(label+'模型',{exact:true}).selectOption(id);await page.getByRole('button',{name:'保存'+label+'配置',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();await expect(page.getByRole('button',{name:'保存'+label+'配置',exact:true})).toBeEnabled();await expect(page.getByLabel(label+'模型',{exact:true})).toHaveValue(id)}
async function remove(page:Page,id:string){await manager(page).getByRole('button',{name:'删除模型 '+id,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();await expect(manager(page).getByRole('button',{name:'删除模型 '+id,exact:true})).toHaveCount(0);await expect(manager(page).getByRole('button',{name:'添加模型',exact:true})).toBeEnabled()}

test('同一路由模型新增编辑删除、三角色真实保存与引用保护',async({page})=>{
 await login(page);
 await add(page,'catalog-first','列表模型一');await add(page,'catalog-second','列表模型二');
 for(const label of ['一级分诊','Router','任务执行'])await role(page,label,'catalog-first');
 await expect(manager(page).getByRole('button',{name:'删除模型 catalog-first',exact:true})).toBeDisabled();
 await manager(page).getByRole('button',{name:'编辑模型 catalog-first',exact:true}).click();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveAttribute('readonly','');
 await page.getByLabel('模型显示名称（可选）',{exact:true}).fill('已使用模型的新名称');await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();await expect(manager(page).getByText('模型已保存。正常重启后生效，不中断当前执行。',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('一级分诊模型',{exact:true})).toHaveValue('catalog-first');await expect(manager(page).getByText('已使用模型的新名称',{exact:true})).toBeVisible();
 for(const label of ['一级分诊','Router','任务执行'])await role(page,label,'fixture');
 await expect(manager(page).getByRole('button',{name:'删除模型 catalog-first',exact:true})).toBeEnabled();
 await manager(page).getByRole('button',{name:'编辑模型 catalog-second',exact:true}).click();await page.getByLabel('模型 ID',{exact:true}).fill('catalog-renamed');await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();await expect(manager(page).getByRole('button',{name:'编辑模型 catalog-renamed',exact:true})).toBeEnabled();
 const deletion=manager(page).getByRole('button',{name:'删除模型 catalog-renamed',exact:true});await deletion.click();await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(deletion).toBeFocused();
 await remove(page,'catalog-renamed');await remove(page,'catalog-first');
 await expect(manager(page).getByRole('button',{name:'删除模型 fixture',exact:true})).toBeDisabled();
 const saved=await page.request.get('/api/settings/model-catalog').then(response=>response.json());expect(saved.providers.find((row:{provider:string})=>row.provider==='fixture-model').models.find((row:{id:string})=>row.id==='reasoning-fixture').reasoningEfforts).toEqual(['off','low','high']);
});

test('模型字段校验和输入法不提交，取消及离开保留清晰草稿边界',async({page})=>{
 await login(page);let writes=0;page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/settings/model-catalog'))writes++});
 await manager(page).getByRole('button',{name:'添加模型',exact:true}).click();await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await expect(page.getByLabel('模型 ID',{exact:true})).toBeFocused();
 await page.getByLabel('模型 ID',{exact:true}).fill('fixture');await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await expect(manager(page).getByText('此路由已存在相同模型 ID。',{exact:true})).toBeVisible();
 await page.getByLabel('模型 ID',{exact:true}).fill('draft-only');await page.getByLabel('模型 ID',{exact:true}).dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});expect(writes).toBe(0);
 await page.locator('.desktop-sidebar a[href="#/tasks"]').click();await expect(page.getByRole('dialog')).toContainText('未保存');await page.keyboard.press('Escape');await expect(page.getByLabel('模型 ID',{exact:true})).toHaveValue('draft-only');
 await manager(page).getByRole('button',{name:'取消编辑',exact:true}).click();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveCount(0);expect(writes).toBe(0);
});

test('模型未知回执、网络失败和版本冲突不自动重写，显式读取后恢复',async({page})=>{
 await login(page);
 for(const mode of ['network','receipt','conflict']){
  let writes=0;await page.route('**/api/settings/model-catalog',route=>{if(route.request().method()!=='PUT')return route.continue();writes++;return mode==='network'?route.abort():route.fulfill({status:mode==='conflict'?409:200,json:mode==='conflict'?{error:'SETTINGS_VERSION_CONFLICT'}:{ok:true}})});
  await manager(page).getByRole('button',{name:'添加模型',exact:true}).click();await page.getByLabel('模型 ID',{exact:true}).fill('uncertain-model');await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();
  await expect(manager(page).getByRole('button',{name:'保存模型',exact:true})).toBeDisabled();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveValue('uncertain-model');await expect(manager(page)).toContainText('草稿已保留');expect(writes).toBe(1);
  await page.unroute('**/api/settings/model-catalog');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(manager(page).getByRole('button',{name:'添加模型',exact:true})).toBeEnabled();await expect(page.getByLabel('模型 ID',{exact:true})).toHaveCount(0);
 }
});

test('模型列表分页筛选、长名称、窄屏深色可读并通过可访问性检查',async({page})=>{
 await page.route('**/api/settings/model-catalog',async route=>{const response=await route.fetch(),data=await response.json();data.providers.find((row:{provider:string})=>row.provider==='fixture-model').models.push(...Array.from({length:24},(_,index)=>({id:'paged-model-'+index,name:'用于检查很长模型名称换行与筛选的模型 '+index,reasoningEfforts:['off'],references:[]})));await route.fulfill({response,json:data})});
 await login(page);await expect(manager(page).getByRole('listitem')).toHaveCount(10);await manager(page).getByRole('button',{name:'下一页模型',exact:true}).click();await expect(manager(page)).toContainText('11–20 / 26');
 await page.getByLabel('筛选模型',{exact:true}).fill('paged-model-23');await expect(manager(page).getByRole('listitem')).toHaveCount(1);await page.getByLabel('筛选模型',{exact:true}).fill('');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [1440,390]){await page.setViewportSize({width,height:960});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await manager(page).getByRole('heading',{name:'模型列表',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`model-catalog-${theme}-${width}.png`)})}}
});

test('写入成功但回读拒绝仍锁定，只读核对后显示真实已保存模型',async({page})=>{
 await login(page);let committed=false,writes=0;
 await page.route('**/api/settings/model-catalog',async route=>{if(route.request().method()==='PUT'){writes++;const response=await route.fetch();committed=true;await route.fulfill({response})}else if(committed)await route.fulfill({status:400,json:{error:'SETTINGS_INPUT_INVALID'}});else await route.continue()});
 await manager(page).getByRole('button',{name:'添加模型',exact:true}).click();await page.getByLabel('模型 ID',{exact:true}).fill('committed-readback-failed');await manager(page).getByRole('button',{name:'保存模型',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认保存',exact:true}).click();
 await expect(manager(page)).toContainText('无法确认最新保存结果');await expect(manager(page).getByRole('button',{name:'保存模型',exact:true})).toBeDisabled();expect(writes).toBe(1);
 await page.unroute('**/api/settings/model-catalog');await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(manager(page).getByRole('button',{name:'编辑模型 committed-readback-failed',exact:true})).toBeEnabled();await remove(page,'committed-readback-failed');
});

test('删除确认绑定打开时版本，期间刷新不能替换为最新 CAS',async({page})=>{
 await login(page);await add(page,'delete-version-race');
 await manager(page).getByRole('button',{name:'删除模型 delete-version-race',exact:true}).click();
 const session=await page.request.get('/api/session').then(response=>response.json()),settings=await page.request.get('/api/settings').then(response=>response.json());
 const response=await page.request.put('/api/settings/appearance',{headers:{origin:new URL(page.url()).origin,'x-csrf-token':session.csrfToken},data:{name:settings.appearance.name,icon:settings.appearance.icon==='star'?'moon':'star',expectedVersion:settings.version}});expect(response.ok()).toBe(true);
 const refreshed=page.waitForResponse(response=>response.request().method()==='GET'&&response.url().endsWith('/api/settings/model-catalog'));
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await refreshed;
 await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();await expect(manager(page)).toContainText('设置已被修改');
 await manager(page).getByRole('button',{name:'重新读取路由配置并替换草稿',exact:true}).click();await expect(manager(page).getByRole('button',{name:'编辑模型 delete-version-race',exact:true})).toBeEnabled();await remove(page,'delete-version-race');
});
