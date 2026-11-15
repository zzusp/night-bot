import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
async function login(page:Page){
 await page.goto('/#/settings');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByRole('tab',{name:'模型与 API',exact:true})).toHaveAttribute('aria-selected','true');
}
test('设置分类保留草稿、原生选择器与凭据保护',async({page})=>{
 await login(page);
 await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model');
 await page.getByLabel('API 地址',{exact:true}).fill('https://draft.example.invalid/v1');
 await page.getByRole('tab',{name:'模型分工',exact:true}).click();
 await expect(page.getByLabel('一级分诊模型',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'模型与 API',exact:true}).click();
 await expect(page.getByLabel('API 地址',{exact:true})).toHaveValue('https://draft.example.invalid/v1');
 await page.getByRole('tab',{name:'访问凭据',exact:true}).click();
 await expect(page.getByLabel('新的GitHub Token',{exact:true})).toHaveAttribute('type','password');
 await page.getByRole('tab',{name:'助手外观',exact:true}).click();
 await page.getByLabel('显示名称',{exact:true}).fill('未保存助手');
 await page.getByRole('tab',{name:'工作日志',exact:true}).click();
 await page.getByRole('tab',{name:'助手外观',exact:true}).click();
 await expect(page.getByLabel('显示名称',{exact:true})).toHaveValue('未保存助手');
 const first=page.getByRole('tab',{name:'模型与 API',exact:true});
 await first.focus();await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('tab',{name:'模型分工',exact:true})).toBeFocused();
 await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'访问凭据',exact:true})).toBeFocused();
 await page.keyboard.press('Home');await expect(first).toBeFocused();
});
test('设置工作台浅深色、窄屏和各分类实拍',async({page})=>{
 await login(page);
 await page.getByLabel('模型路由',{exact:true}).selectOption('fixture-model');
 for(const theme of ['light','dark']){
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const name of ['模型与 API','模型分工','助手外观','工作日志','访问凭据']){
    await page.getByRole('tab',{name,exact:true}).click();
    const panel=page.getByRole('tabpanel');
    await expect(panel).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await panel.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({page}).include('.settings-workspace').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:test.info().outputPath(`settings-${name}-${theme}-${width}.png`),fullPage:true});
   }
  }
 }
});
