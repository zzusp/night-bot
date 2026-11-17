import {test, expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('task list requests ten rows per backend page and restores page navigation',async({page})=>{
 const responses:any[]=[];
 const requests:URL[]=[];
 page.on('response',async response=>{
  const url=new URL(response.url());
  if(url.pathname==='/api/tasks'&&response.ok()){
   requests.push(url);responses.push(await response.json());
  }
 });
 await page.goto('/#/tasks');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
 const first=responses.at(-1).items.map(item=>item.taskId);
 await expect(page.locator('.pagination')).toContainText('共 23 条 · 第 1 页');
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(page.locator('.pagination')).toContainText('第 2 页');
 await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
 const second=responses.at(-1).items.map(item=>item.taskId);
 expect(second.every(id=>!first.includes(id))).toBe(true);
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(page.locator('.task-table tbody tr')).toHaveCount(3);
 await expect(page.locator('.pagination')).toContainText('第 3 页');
 await expect(page.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'上一页',exact:true}).click();
 await expect(page.locator('.pagination')).toContainText('第 2 页');
 await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
 await page.reload();
 await expect(page.locator('.pagination')).toContainText('第 2 页');
 await expect(page.locator('.task-table tbody tr')).toHaveCount(10);
 expect(requests.every(url=>url.searchParams.get('limit')==='10')).toBe(true);
 expect(requests.map(url=>url.searchParams.get('offset'))).toEqual(['0','10','20','10','10']);
 expect(responses.every(result=>result.items.length<=10&&result.total===23)).toBe(true);
});
