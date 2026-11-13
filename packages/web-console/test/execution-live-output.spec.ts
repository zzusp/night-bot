import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN} from './preview.mjs';

test('HTTP live snapshot contract replaces provisional output, commits once and clears on revoked access',async({page})=>{
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
 const prior=[{...call,id:'prior',callId:'prior'},{...call,id:'prior-result',callId:'prior',kind:'tool-result',text:'previous',status:'completed'}];
 await page.route('**/api/tasks/task-research/session?*',r=>{const finished=tick===3;const items=[...prior,call,...(finished?[{...call,id:'final-result',kind:'tool-result',text:'line 3\n',status:'completed'}]:[])];return r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,checkpoint:'call',revision:'same',live:{active:!finished,items:finished?[]:[{...call,id:'live-result',kind:'tool-result',text:`line ${tick}\n`,status:'running',transient:true}]}}});});
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const tool=page.locator('[data-message-id="call"] .pi-tool-step');await tool.locator('summary').click();
 await expect(tool).toContainText('line 1');
 tick=2;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool).toContainText('line 2');await expect(tool).not.toContainText('line 1');
 await expect(page.locator('.pi-tool-step')).toHaveCount(2);
 await expect(tool).toHaveAttribute('open');
 tick=3;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.execution-tool-group')).toHaveAttribute('open');
 await expect(tool).toHaveAttribute('open');
 await expect(tool).toContainText('line 3');
 await expect(page.locator('.pi-tool-frame.is-running')).toHaveCount(0);
});

test('native model phases show without body; short deltas update one bubble and public thinking stays user controlled',async({page})=>{
 let phase='waiting';let body='';let thinking=false;
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items:phase==='done'?[{id:'final-model',role:'assistant',text:'你好，已完成。'}]:[],total:0,revision:'model',live:{active:phase!=='done',phase,phaseStartedAt:new Date(Date.now()-2200).toISOString(),items:body?[{id:thinking?'public-thought':'model-live',role:'assistant',kind:thinking?'thinking':'message',text:body,status:'running',transient:true}]:[]}}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.locator('.pi-live-phase')).toContainText('等待模型响应');
 await expect(page.locator('.execution-transcript')).not.toContainText('暂无可展示');
 phase='thinking';
 await expect(page.locator('.pi-live-phase')).toContainText('思考中');
 // Only provider-public, authorized DTO text is available to the component.
 thinking=true;body='检查已公开的步骤';
 await expect(page.locator('.thinking-message')).toHaveAttribute('open');
 const thinkingStyle=await page.locator('.thinking-message').evaluate(el=>({border:getComputedStyle(el).borderLeftWidth,padding:getComputedStyle(el).paddingLeft,bodyMargin:getComputedStyle(el.querySelector('.markdown')!).marginLeft}));
 expect(thinkingStyle).toEqual({border:'0px',padding:'17px',bodyMargin:'0px'});
 expect(await page.locator('.thinking-message').evaluate(el=>Math.abs(el.querySelector('summary > span')!.getBoundingClientRect().left-el.querySelector('.markdown')!.getBoundingClientRect().left))).toBeLessThan(0.5);
 await page.locator('.thinking-message > summary').click();
 body='检查已公开的步骤与结果';
 await expect(page.locator('.thinking-message')).not.toHaveAttribute('open');
 phase='text';thinking=false;body='你好，';
 await expect(page.locator('.pi-live-phase')).toContainText('生成中');
 await expect(page.locator('.pi-live-message')).toContainText('你好，');
 body='你好，已完成。';
 await expect(page.locator('.pi-live-message')).toHaveCount(1);
 await expect(page.locator('.pi-live-message')).toContainText('已完成');
 phase='done';body='';
 await expect(page.locator('.pi-live-phase')).toHaveCount(0);
 await expect(page.locator('.pi-live-message')).toHaveCount(0);
 await expect(page.locator('.execution-transcript .message-assistant')).toHaveCount(1);
});
