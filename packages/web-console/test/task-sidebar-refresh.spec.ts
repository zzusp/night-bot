import {expect,test} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('task sidebar refreshes every 15 seconds and suspends hidden detail cards', async ({page}) => {
 const path='/api/tasks/task-research';
 const hits={task:0,learning:0,context:0};
 await page.route('**/api/tasks/task-research**', async route=>{
  const target=new URL(route.request().url()).pathname;
  if(target===path) {hits.task++;return route.continue();}
  if(target===path+'/learning') {hits.learning++;return route.fulfill({json:{status:'ready',changesComplete:{memory:true,skill:true},reviews:[],changes:[]}});}
  if(target===path+'/context-window') {hits.context++;return route.fulfill({json:{status:'ready',tokens:31,contextWindow:100,categories:[{key:'messages',tokens:31}]}});}
  await route.continue();
 });
 await page.clock.install();
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const context=page.getByRole('region',{name:'上下文窗口'}), learning=page.getByRole('region',{name:'任务复盘'});
 await expect(context).toContainText('31 / 100');
 await expect(learning).toContainText('0');
 await page.clock.fastForward(13000);
 expect(hits).toEqual({task:1,learning:1,context:1});
 await page.clock.fastForward(3000);
 await expect.poll(()=>({...hits})).toEqual({task:2,learning:2,context:2});
 await page.getByRole('button',{name:'隐藏任务面板'}).click();
 await page.clock.fastForward(16000);
 await expect.poll(()=>({...hits})).toEqual({task:3,learning:2,context:2});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.fastForward(30000);
 expect(hits).toEqual({task:3,learning:2,context:2});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>hits.task).toBe(4);
 await page.getByRole('button',{name:'显示任务面板'}).click();
 await expect(context).toContainText('31 / 100');
 await expect(learning).toContainText('0');
 expect(hits).toEqual({task:4,learning:3,context:3});
});
