import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const manager=(page:Page)=>page.getByRole('region',{name:'模型与 API',exact:true});
async function login(page:Page){
 await page.goto('/#/settings');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();
 await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model');
}

test('模型配置紧凑布局：路由同行、空反馈无占位、响应式与浅深色',async({page})=>{
 await login(page);
 const card=manager(page),api=card.locator('.provider-api'),secret=card.locator('.provider-secret');
 await expect(card.locator('p:empty')).toHaveCount(0);
 await expect(card).not.toContainText('先选择路由');
 await expect(card).not.toContainText('显示名称仅用于识别');
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const width of [1440,1024,768,390]){
   await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();
   const route=await page.getByLabel('模型路由',{exact:true}).boundingBox(),addRoute=await card.getByRole('button',{name:'添加路由',exact:true}).boundingBox();
   expect(route).not.toBeNull();expect(addRoute).not.toBeNull();
   expect(Math.abs(route!.y+route!.height/2-addRoute!.y-addRoute!.height/2)).toBeLessThan(2);
   const apiBox=await api.boundingBox(),secretBox=await secret.boundingBox();
   if(width>760){expect(Math.abs(apiBox!.y-secretBox!.y)).toBeLessThan(2);expect(secretBox!.x).toBeGreaterThan(apiBox!.x+apiBox!.width)}
   else{expect(secretBox!.y).toBeGreaterThan(apiBox!.y+apiBox!.height);expect(Math.abs(secretBox!.x-apiBox!.x)).toBeLessThan(2)}
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   const overflowing=await card.locator('input,select,button').evaluateAll(nodes=>nodes.filter(node=>{const box=node.getBoundingClientRect();return box.left<0||box.right>innerWidth}).length);
   expect(overflowing).toBe(0);
   if(width===1440||width===390){
    expect((await new AxeBuilder({page}).include('.model-catalog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await card.screenshot({path:test.info().outputPath(`model-settings-${theme}-${width}.png`)});
   }
  }
 }
 // Empty and active filters do not strand the clear button or add action.
 await page.getByLabel('筛选模型',{exact:true}).fill('no-model-matches');
 await expect(card).toContainText('没有匹配的模型');
 await card.getByRole('button',{name:'清除筛选',exact:true}).click();
 await expect(page.getByLabel('筛选模型',{exact:true})).toBeFocused();
 await expect(card.getByRole('listitem').first()).toBeVisible();
});

test('环境只读密钥只展示真实状态，没有不可用表单或额外密钥请求',async({page})=>{
 let writes=0;
 page.on('request',request=>{if(request.method()==='PUT'&&request.url().includes('/settings/secrets/'))writes++});
 await page.route('**/api/settings/model-catalog',async route=>{
  const response=await route.fetch(),data=await response.json(),provider=data.providers.find((row:{provider:string})=>row.provider==='fixture-model');
  provider.secret={...provider.secret,configured:true,writable:false};
  provider.models=provider.models.slice(0,1);
  await route.fulfill({response,json:data});
 });
 await login(page);const card=manager(page),secret=card.getByRole('region',{name:'模型 API Key',exact:true});
 await expect(secret.getByText('已配置',{exact:true})).toBeVisible();
 await expect(secret.getByText('由环境提供',{exact:true})).toBeVisible();
 await expect(secret.getByText('只读',{exact:true})).toBeVisible();
 await expect(secret.locator('input,button,form')).toHaveCount(0);
 await expect(card.getByText('唯一模型',{exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:/^删除模型 /})).toBeDisabled();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.screenshot({path:test.info().outputPath(`model-settings-readonly-${width}.png`)});
 }
 expect(writes).toBe(0);
});

test('编辑与新增弹窗保留标签、验证和安全确认且无空说明块',async({page})=>{
 await login(page);const card=manager(page);
 await card.getByRole('button',{name:'添加模型',exact:true}).click();
 await expect(card.locator('.model-catalog-form p:empty')).toHaveCount(0);
 await card.getByRole('button',{name:'保存模型',exact:true}).click();
 const model=page.getByLabel('模型 ID',{exact:true});
 await expect(model).toBeFocused();await expect(model).toHaveAttribute('aria-invalid','true');
 await model.fill('layout-test-not-saved');await card.getByRole('button',{name:'保存模型',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('正常重启后生效');
 await expect(page.getByRole('dialog').getByRole('button',{name:'取消',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(card.getByRole('button',{name:'保存模型',exact:true})).toBeFocused();
 await card.getByRole('button',{name:'取消编辑',exact:true}).click();
 await card.getByRole('button',{name:'添加路由',exact:true}).click();
 await expect(card.getByLabel('路由标识',{exact:true})).toBeVisible();
 await expect(card.locator('p:empty')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await card.getByRole('button',{name:'取消添加路由',exact:true}).click();
 await expect(page.getByLabel('模型路由',{exact:true})).toBeVisible();
});
