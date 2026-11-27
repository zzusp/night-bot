import {expect,test} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('task detail never asks for the retired learning card or shows a channel association',async({page})=>{
 const requests:string[]=[];
 page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.route('**/api/tasks/task-research/context-window',r=>r.fulfill({json:{status:'ready',tokens:31,contextWindow:100,categories:[{key:'messages',tokens:31}]}}));
 await page.goto('/#/tasks/task-research?view=learning');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByRole('region',{name:'上下文窗口'})).toContainText('31 / 100');
 await expect(page.getByRole('heading',{name:'任务目标'})).toBeVisible();
 await expect(page.getByText('任务复盘',{exact:true})).toHaveCount(0);
 await expect(page.getByText('来源对话',{exact:true})).toHaveCount(0);
 await expect(page.getByText('未关联渠道',{exact:true})).toHaveCount(0);
 expect(requests.filter(path=>path.includes('/learning'))).toEqual([]);
});
