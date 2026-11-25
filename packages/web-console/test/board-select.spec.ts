import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
import {selectOption} from './select-control';
async function expectInlineSelect(trigger: import('@playwright/test').Locator) {
 const box=(await trigger.boundingBox())!;
 const value=(await trigger.locator('span').first().boundingBox())!;
 const arrow=(await trigger.locator('.board-select-chevron').boundingBox())!;
 expect(Math.abs(value.y+value.height/2-(arrow.y+arrow.height/2))).toBeLessThanOrEqual(1);
 expect(arrow.x).toBeGreaterThanOrEqual(value.x+value.width);
 expect(box.x+box.width-(arrow.x+arrow.width)).toBeLessThanOrEqual(14);
}
for(const width of [1440,390])for(const theme of ['light','dark'])test(`统一下拉框 ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/#/settings');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const provider=page.getByLabel('模型路由',{exact:true});
 await selectOption(provider,'fixture-model');
 await page.getByRole('tab',{name:'模型分工',exact:true}).click();
 const control=page.getByLabel('Router模型路由',{exact:true});
 await expectInlineSelect(control);
 const trigger=await control.boundingBox();
 await control.click();
 const popup=page.getByRole('listbox');
 await expect(popup).toBeVisible();
 const box=await popup.boundingBox();
 expect(Math.abs(box!.width-trigger!.width)).toBeLessThanOrEqual(1);
 expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
 await page.screenshot({path:test.info().outputPath(`select-${width}-${theme}.png`)});
 expect((await new AxeBuilder({page}).include('.settings-modal').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(control).toBeFocused();await expect(popup).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'助手外观',exact:true}).click();
 const icon=page.getByLabel('助手图标',{exact:true});
 await icon.focus();await page.keyboard.press('Space');await expect(popup).toBeVisible();await page.keyboard.press('End');await expect(page.getByRole('option').last()).toBeFocused();await page.keyboard.press('Enter');
 await expect(icon).toHaveAttribute('data-value','leaf');await expect(icon).toBeFocused();
 await icon.focus();await page.keyboard.press('Space');await expect(popup).toBeVisible();await page.keyboard.press('Home');await expect(page.getByRole('option').first()).toBeFocused();await page.keyboard.press('Enter');await expect(icon).toHaveAttribute('data-value','moon');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


for(const width of [1440,390])test(`编辑渠道的下拉框与输入框同行同高 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:960});
 await page.goto('/#/channels');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await page.getByRole('button',{name:'渠道操作：dingtalk-work',exact:true}).click();
 await page.getByRole('menuitem',{name:'编辑配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'编辑钉钉渠道',exact:true});
 const neighbor=dialog.getByLabel('渠道标识',{exact:true});
 await expect(neighbor).toBeVisible();
 const height=(await neighbor.boundingBox())!.height;
 for(const label of ['会话类型','目标填写方式','外发授权']){
  const trigger=dialog.getByLabel(label,{exact:true});
  await expectInlineSelect(trigger);
  expect(Math.abs((await trigger.boundingBox())!.height-height)).toBeLessThanOrEqual(1);
 }
 const trigger=dialog.getByLabel('会话类型',{exact:true});
 const triggerWidth=(await trigger.boundingBox())!.width;
 await trigger.click();
 const popup=dialog.getByRole('listbox');
 await expect(popup).toBeVisible();
 expect(Math.abs((await popup.boundingBox())!.width-triggerWidth)).toBeLessThanOrEqual(1);
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 await expect(dialog).toBeVisible();
 await dialog.screenshot({path:test.info().outputPath(`channel-edit-select-${width}.png`)});
});
