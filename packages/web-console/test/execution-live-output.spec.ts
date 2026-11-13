import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('real live snapshot contract replaces provisional output, commits once and clears on revoked access',async({page})=>{
 let phase='first';
 const live=(text:string)=>({id:'live-message',role:'assistant',text,status:'running',transient:true});
 await page.route('**/api/tasks/task-research/session?*',r=>{
  if(phase==='denied') return r.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  const items=phase==='done'?[{id:'committed',role:'assistant',text:'正在核对\n结果确认',status:'stop'}]:[];
  return r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,checkpoint:'safe-'+phase,revision:phase,live:{active:phase!=='done',items:phase==='done'?[]:[live(phase==='first'?'正在核对\n':'正在核对\n结果确认')]}}});
 });
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const transcript=page.locator('.execution-transcript');
 await expect(transcript.locator('.pi-live-message')).toHaveCount(1);
 await expect(transcript).toContainText('正在核对');
 phase='updated';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(transcript.locator('.pi-live-message')).toHaveCount(1);
 await expect(transcript).toContainText('结果确认');
 phase='done';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(transcript.locator('.pi-live-message')).toHaveCount(0);
 await expect(transcript.locator('.message-assistant')).toHaveCount(1);
 phase='denied';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.execution-transcript .message')).toHaveCount(0);
 phase='done';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.execution-transcript .message-assistant')).toHaveCount(1);
 await expect(page.locator('.pi-live-message')).toHaveCount(0);
});

test('live tool result replaces each snapshot without accumulating partial copies',async({page})=>{
 let tick=1;
 const call={id:'call',role:'tool',kind:'tool-call',toolName:'bash',callId:'tool-one',text:JSON.stringify({command:'example'}),status:'pending',source:{sessionId:'authorized'}};
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items:[call],total:1,checkpoint:'call',revision:'same',live:{active:true,items:[{...call,id:'live-result',kind:'tool-result',text:`line ${tick}\n`,status:'running',transient:true}]}}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const tool=page.locator('.pi-tool-step');await tool.locator('summary').click();
 await expect(tool).toContainText('line 1');
 tick=2;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool).toContainText('line 2');await expect(tool).not.toContainText('line 1');
 await expect(page.locator('.pi-tool-step')).toHaveCount(1);
 await expect(tool).toHaveAttribute('open');
});
