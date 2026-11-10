import {test, expect, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

// Synthetic readable snapshots. The complete comparison matches both texts.
const updatedAt = '2026-11-10T05:30:00Z';
const item = {id: 'reader-fixture', name: '项目交付检查清单', kind: 'memory', scope: 'bot', status: 'candidate', revision: 2, updatedAt};
const common = ['1. 核对需求', '逐项确认需求范围、交付物和验收条件。', '', '2. 验证结果'];
const oldResult = '核对测试记录，确认主要流程已经完成。';
const newResult = '核对测试记录，并复查失败重试、键盘操作和窄屏显示。';
const oldDelivery = '整理交付说明，列出已完成的工作。';
const newDelivery = '整理交付说明，附上验证结果、已知限制与后续事项。';
const currentText = [...common, newResult, '', '3. 整理交付', newDelivery].join('\n');
const previousText = [...common, oldResult, '', '3. 整理交付', oldDelivery].join('\n');
const lines = [...common.map(text => ({type:'unchanged', text})), {type:'removed',text:oldResult}, {type:'added',text:newResult}, {type:'unchanged',text:''}, {type:'unchanged',text:'3. 整理交付'}, {type:'removed',text:oldDelivery}, {type:'added',text:newDelivery}];
const body = {id:item.id,kind:item.kind,name:item.name,revision:2,current:{text:currentText,revision:2,updatedAt},previous:{text:previousText,revision:1,updatedAt},comparison:{status:'available',added:2,removed:2,lines},redacted:false};
async function open(page: Page) {
  await page.route('**/api/evolution?*',route=>route.fulfill({json:{status:'ready',coverage:'bot-shared-current-state',items:[item],total:1,offset:0,nextOffset:null,memory:{},skills:{}}}));
  await page.route('**/api/evolution/items/**',route=>route.fulfill({json:body}));
  await page.goto('/#/evolution');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
}
for(const theme of ['light','dark']) for(const width of [1440,390]) test(`阅读区真实渲染：${theme} ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?1100:1000}); await open(page);
  if(theme==='dark') await page.getByRole('button',{name:'切换深色外观',exact:true}).click();
  const action=page.getByRole('button',{name:'查看内容：项目交付检查清单',exact:true});
  await expect(action).toBeVisible(); await action.click();
  const reader=page.locator('.evolution-content');
  await expect(reader.getByRole('heading',{level:2,name:item.name,exact:true})).toBeFocused();
  await expect(page.locator('.evolution-summary')).toBeHidden(); await expect(page.locator('.evolution-library')).toBeHidden();
  await expect(reader.locator('.evolution-plain-text')).toHaveText(currentText);
  await expect(reader).not.toContainText('候选');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.mouse.move(0,0); await reader.screenshot({path:test.info().outputPath(`reader-current-${theme}-${width}.png`),animations:'disabled'});
  await reader.getByRole('button',{name:'最近差异',exact:true}).click();
  await expect(reader.locator('.evolution-diff-line--removed [data-line="old"]')).toHaveText(['5','8']);
  await expect(reader.locator('.evolution-diff-line--added [data-line="new"]')).toHaveText(['5','8']);
  await expect(reader.locator('.evolution-diff-line--added [data-line="old"]')).toHaveText(['','']);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.mouse.move(0,0); await reader.screenshot({path:test.info().outputPath(`reader-diff-${theme}-${width}.png`),animations:'disabled'});
  await reader.locator('.evolution-entry-details > summary').click();
  await expect(reader.locator('.evolution-entry-version')).toHaveText('2');
  await reader.getByRole('button',{name:'返回列表',exact:true}).click();
  await expect(action).toBeFocused(); await expect(page.locator('.evolution-summary')).toBeVisible();
});
