import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';

const pair=(id:string,toolName:string,input:object,output:unknown,extra={})=>['call','result'].map(kind=>({
 id:id+'-'+kind,toolName,callId:id,role:'tool',kind:'tool-'+kind,status:kind==='result'?'completed':'result-unrecorded',
 source:{sessionId:'task-tool-fixture',entryId:id+'-'+kind},
 text:kind==='call'?JSON.stringify(input):typeof output==='string'?output:JSON.stringify(output),
 ...kind==='result'?extra:{},
}));
async function open(page,items) {
 await page.route('**/api/tasks/task-research/session?*',route=>route.fulfill({json:{status:'ready',scope:'current-session-context',items,total:items.length,revision:'tool-polish-task',live:{active:false,items:[]}}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const record=page.locator('.execution-transcript');
 await expect(record).toBeVisible();
 return record;
}

test('todo and attempted task completion remain readable and truthful on desktop and mobile',async({page},info)=>{
 const todos={todos:[{content:'查验发布版本',status:'completed'},{content:'核对健康探针',status:'in_progress'},{content:'登记核对结论',status:'pending'}]};
 const summary='已核对版本，仍需确认生产验收。';
 const result={decision:{action:'complete',summary,evidence:['隔离环境的探针已通过。','发布记录已读回。'],limitations:['仍需独立确认线上结果。']}};
 const items=[
  ...pair('todo','todo_write',todos,'Updated todo list: 1 pending, 1 in progress, 1 completed.',{timing:{durationMs:39}}),
  ...pair('result','task_result',result,'未记录失败原因',{isError:true,status:'error',timing:{durationMs:7}}),
  {id:'break',role:'assistant',kind:'message',text:'待办后续核查。'},
  ...pair('inconsistent','todo_write',todos,'Updated todo list: 0 pending, 0 in progress, 2 completed.'),
 ];
 const record=await open(page,items);
 const row=(id:string)=>record.locator(`[data-message-id="${id}-call"]`);
 const todo=row('todo'), completion=row('result');
 await todo.locator('summary').focus();
 await page.keyboard.press('Enter');
 await completion.locator('summary').click();
 await expect(todo.getByText('待办已更新',{exact:true})).toHaveCount(1);
 await expect(todo.locator('.task-tool-todos li')).toHaveCount(3);
 await expect(todo.locator('.task-tool-todo-state')).toHaveText(['已完成','进行中','待处理']);
 await expect(todo.locator('.task-tool-counts')).toHaveCount(1);
 await expect(todo).not.toContainText('Updated todo list');
 await expect(completion.getByText(summary,{exact:true})).toBeVisible();
 await expect(completion.getByText('请求完成',{exact:true})).toBeVisible();
 await expect(completion.getByText('限制',{exact:true})).toBeVisible();
 await expect(completion.getByText('未记录失败原因',{exact:true})).toBeVisible();
 await expect(completion.getByText('失败',{exact:true}).filter({visible:true})).toHaveCount(1);
 await expect(completion).not.toContainText('任务已完成');
 await expect(completion.locator('pre')).toHaveCount(0);
 for(const [width,theme] of [[1440,'light'],[390,'dark']] as const){
  await page.setViewportSize({width,height:935});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect((await new AxeBuilder({page}).include('.task-tool-details').include('.task-tool-failure').analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  await page.mouse.move(0,0);
  const first=(await todo.boundingBox())!,last=(await completion.boundingBox())!;
  await page.screenshot({path:info.outputPath(`task-tool-polish-${width}.png`),clip:{
   x:Math.max(0,Math.floor(first.x)-3),y:Math.max(0,Math.floor(first.y)-3),width:Math.min(width,Math.ceil(first.width)+6),
   height:Math.ceil(last.y+last.height-first.y)+6,
  }});
 }
 const inconsistent=row('inconsistent');
 await inconsistent.locator('summary').click();
 await expect(inconsistent.getByText('提交的待办',{exact:true})).toBeVisible();
 await expect(inconsistent.getByText('待办已更新',{exact:true})).toBeVisible();
 await expect(inconsistent.locator('.task-tool-counts')).toHaveCount(2);
});

test('other disclosed task and platform tool shapes render human fields without turning logs into tables',async({page})=>{
 const items=[
   ...pair('query','platform_task_query',{state:'running',day:'today'},{tasks:[{title:'核对资料',status:'running'}],total:1,hasMore:false}),
   ...pair('config','platform_config_query',{}, {timeZone:'Asia/Shanghai',concurrency:2}),
   ...pair('reminder','platform_schedule_submit',{title:'复查发布',prompt:'查看当前部署版本。',at:'2026-11-24T09:00:00+08:00'},{status:'scheduled'}),
   ...pair('schedule','schedule_create',{title:'核对记录',weekly:{weekdays:[1,3],time:'09:00:00',time_zone:'Asia/Shanghai'}},'此工具尚未声明可展示的结果字段。',{redacted:true}),
   ...pair('search','web_search',{queries:['部署版本','验收规则']},'可查来源：现有检索结果。'),
   ...pair('jobs','job_list',{},'job-1 [shell] running — 核对清单'),
   ...pair('stop','job_kill',{job_id:'job-1'},'requested cancellation of job job-1'),
   ...pair('logs','job_output',{job_id:'job-1'},'first\nsecond'),
 ];
 await page.setViewportSize({width:390,height:900});
 const record=await open(page,items);
 for(const [id,expected] of [['query','执行中'],['config','Asia/Shanghai'],['reminder','2026-11-24T09:00:00+08:00'],['schedule','周一、周三 09:00:00（Asia/Shanghai）'],['search','验收规则'],['jobs','核对清单'],['stop','已请求取消'],['logs','second']]){
  const card=record.locator(`[data-message-id="${id}-call"]`);
  await card.locator('summary').click();
  await expect(card).toContainText(expected);
  if(id==='logs')await expect(card.locator('pre')).toHaveText('first\nsecond');
  if(id==='schedule')await expect(card.getByText('结果未公开。',{exact:true})).toBeVisible();
  if(id==='stop')await expect(card).not.toContainText('已取消');
  await card.locator('summary').click();
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
