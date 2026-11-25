import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN,startPreview} from './preview.mjs';

for(const router of [false,true])test(`${router?'Router':'任务详情'}用真实 EventSource 接收快照，断线按游标补读`,async({page})=>{
 const taskId='task-research',conversationId='room-product';
 const sessionId=router?'fixture-router-'+conversationId:'fixture-pi-'+taskId;
 const endpoint=router?`/api/conversations/${conversationId}/session`:`/api/tasks/${taskId}/session`;
 const rows=[{id:'first',text:'已提交的起始记录。'}];
 const away={id:'during-break',text:'断线时写入的记录。'};
 let liveText='', liveRevision=0, subscriptions=0, disconnections=0, drop=false;
 const reads:URL[]=[];
 const listeners=new Set<(kind:string)=>void>();
 const persistence={
  subscribeSessionView(id:string,listener:(kind:string)=>void){
   expect(id).toBe(sessionId);subscriptions++;listeners.add(listener);
   return ()=>{
    disconnections++;listeners.delete(listener);
    if(drop){drop=false;rows.push(away);}
   };
  },
  async readNative(id:string){
   expect(id).toBe(sessionId);
   const identity=router?{header:{id,conversationId,runtimeOwner:'conversation-router',generation:1}}
    :{header:{id},audit:[{domain:'task',kind:'identity',version:1,payload:{taskId,sessionId}}]};
   return {...identity,entries:rows.map(({id})=>({id})),
    context:{projection:{entries:rows.map(({id,text})=>({sourceEntry:{id},messages:[{role:'assistant',content:[{type:'text',text}]}]}))}}};
  },
  readLive(){
   if(drop)throw new Error('fixture: stream interrupted');
   return {sessionId,active:!!liveText,phase:'text',revision:String(liveRevision),tools:[],assistant:{id:'live-one',message:{role:'assistant',content:[{type:'text',text:liveText,complete:true}]}}};
  },
 };
 const preview=await startPreview({port:0,persistenceOverride:persistence,sessionRecords:router});
 try{
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname===endpoint&&url.searchParams.has('stream'))reads.push(url);});
  await page.goto(preview.origin+(router?'/#/channels/'+conversationId:'/#/tasks/'+taskId));
  await page.getByLabel('访问令牌',{exact:true}).fill(preview.token);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  if(router)await page.getByRole('tab',{name:'路由',exact:true}).click();
  await expect(page.getByText(rows[0].text,{exact:true})).toBeVisible();
  await expect.poll(()=>subscriptions).toBe(1);
  liveText='这一段由事件推送。';liveRevision++;
  for(const listener of listeners)listener('live');
  await expect(page.locator('.pi-live-message')).toContainText(liveText);
  const idleStart=reads.length;
  await new Promise(resolve=>setTimeout(resolve,3100)); // 超过一次旧历史轮询间隔。
  expect(reads).toHaveLength(idleStart);
  rows.push({id:'committed',text:liveText});liveText='';liveRevision++;
  for(const listener of listeners){listener('history');listener('live');}
  await expect(page.locator('.pi-live-message')).toHaveCount(0);
  await expect(page.getByText(rows[1].text,{exact:true})).toHaveCount(1);
  expect(reads).toHaveLength(idleStart+1);
  drop=true;
  for(const listener of listeners)listener('live');
  await expect.poll(()=>disconnections).toBe(1);
  await expect.poll(()=>subscriptions,{timeout:10_000}).toBe(2);
  await expect(page.getByText(away.text,{exact:true})).toBeVisible();
  for(const row of rows)await expect(page.getByText(row.text,{exact:true})).toHaveCount(1);
  expect(reads.slice(idleStart).every(url=>url.searchParams.has('checkpoint'))).toBe(true);
  await page.goto(preview.origin+'/#/tasks');
  await expect.poll(()=>disconnections).toBe(2);
 }finally{await preview.close();}
});

for(const layout of [{name:'desktop light',width:1440,height:960,theme:'light'},{name:'mobile dark',width:390,height:844,theme:'dark'}]){
 test(`commit waiting retains authorized history without a read alert and automatically catches up: ${layout.name}`,async({page},testInfo)=>{
  await page.setViewportSize({width:layout.width,height:layout.height});
  await page.addInitScript(theme=>localStorage.setItem('night-theme',theme),layout.theme);
  let phase='initial',pendingReads=0;
  const retained={id:'retained',role:'assistant',text:'这是已提交的执行记录。'};
  const live={active:true,items:[{id:'provisional',role:'assistant',text:'尚未提交的临时内容',transient:true}]};
  await page.route('**/api/tasks/task-research/session?*',r=>{
   const url=new URL(r.request().url());
   if(phase==='pending'){pendingReads++;return r.fulfill({json:{status:'pending',reason:'SESSION_COMMIT_PENDING',items:[],total:0}});}
   if(url.searchParams.has('live'))return r.fulfill({json:{status:'ready',live,historyChanged:false}});
   return r.fulfill({json:{status:'ready',scope:'current-session-context',items:phase==='ready'?[{id:'appended',role:'assistant',text:'新记录已完成提交。'}]:[retained],total:phase==='ready'?2:1,checkpoint:phase==='ready'?'committed-2':'committed-1',revision:phase,liveProof:'current-proof',live:phase==='ready'?{active:false,items:[]}:live}});
  });
  await page.goto('/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await expect(page.locator('[data-message-id="retained"]')).toHaveCount(1);
  await expect(page.locator('.pi-live-message')).toHaveCount(1);
  phase='pending';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  const waiting=page.getByRole('status').filter({hasText:'记录正在提交，当前显示上次已提交记录。'});
  await expect(waiting).toBeVisible();
  await expect(page.locator('[data-message-id="retained"]')).toHaveCount(1);
  await expect(page.locator('.pi-live-message')).toHaveCount(0);
  await expect(page.locator('.read-error-summary')).toHaveCount(0);
  await expect.poll(()=>pendingReads).toBeGreaterThanOrEqual(2);
  await expect(waiting).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('commit-pending.png')});
  phase='ready';
  await expect(page.locator('[data-message-id="appended"]')).toHaveCount(1);
  await expect(page.locator('[data-message-id="retained"]')).toHaveCount(1);
  await expect(waiting).toHaveCount(0);
  await expect(page.locator('.read-error-summary')).toHaveCount(0);
 });
}

test('commit waiting cannot hide a real read failure or resurrect revoked history',async({page})=>{
 let phase='pending';
 await page.route('**/api/tasks/task-research/session?*',r=>{
  if(phase==='denied')return r.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  if(phase==='offline')return r.fulfill({status:503,json:{error:'SESSION_UNAVAILABLE'}});
  if(phase==='pending')return r.fulfill({json:{status:'pending',reason:'SESSION_COMMIT_PENDING',items:[],total:0}});
  return r.fulfill({json:{status:'ready',scope:'current-session-context',items:[{id:'guarded-record',role:'assistant',text:'仅限获权后查看的已提交记录。'}],total:1,checkpoint:'guarded',revision:'guarded'}});
 });
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.getByText('执行记录正在提交',{exact:true})).toBeVisible();
 await expect(page.locator('.read-error-summary')).toHaveCount(0);
 phase='ready';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(1);
 phase='pending';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.getByRole('status').filter({hasText:'记录正在提交，当前显示上次已提交记录。'})).toBeVisible();
 phase='offline';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.read-error-summary')).toBeVisible();
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(1);
 phase='pending';
 const pending=page.waitForResponse(response=>response.url().includes('/tasks/task-research/session?')&&response.status()===200);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await pending;
 await expect(page.locator('.read-error-summary')).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'记录正在提交，当前显示上次已提交记录。'})).toHaveCount(0);
 const retryPending=page.waitForResponse(response=>response.url().includes('/tasks/task-research/session?')&&response.status()===200);
 await page.getByRole('alert',{name:'读取状态汇总'}).getByRole('button',{name:'重试',exact:true}).click();await retryPending;
 await expect(page.locator('.read-error-summary')).toBeVisible();
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(1);
 phase='denied';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(0);
 phase='pending';
 const revokedPending=page.waitForResponse(response=>response.url().includes('/tasks/task-research/session?')&&response.status()===200);
 await page.getByRole('alert',{name:'读取状态汇总'}).getByRole('button',{name:'重试',exact:true}).click();await revokedPending;
 await expect(page.locator('.read-error-summary')).toContainText('部分内容无法访问');
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(0);
 phase='ready';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('[data-message-id="guarded-record"]')).toHaveCount(1);
 await expect(page.locator('.read-error-summary')).toHaveCount(0);
});


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
 let tick=0;
 const call={id:'call',role:'tool',kind:'tool-call',toolName:'bash',callId:'tool-one',text:JSON.stringify({command:'example'}),status:'pending',source:{sessionId:'authorized'}};
 const prior=[{...call,id:'prior',callId:'prior'},{...call,id:'prior-result',callId:'prior',kind:'tool-result',text:'previous',status:'completed'}];
 await page.route('**/api/tasks/task-research/session?*',r=>{const finished=tick===3;const items=[...prior,call,...(finished?[{...call,id:'final-result',kind:'tool-result',text:'line 3\n',status:'completed'}]:[])];return r.fulfill({json:{status:'ready',scope:'current-context',items,total:items.length,checkpoint:'call',revision:'same',live:{active:tick>0&&!finished,items:!tick||finished?[]:[{...call,id:'live-result',kind:'tool-result',text:`line ${tick}\n`,status:'running',transient:true}]}}});});
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const tool=page.locator('[data-message-id="call"] .pi-tool-step');
 await expect(tool.locator('summary')).toContainText('结果未记录');
 await expect(tool.locator('.pi-tool-shimmer')).toHaveCount(0);
 await tool.locator('summary').click();
 tick=1;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool.locator('.pi-tool-shimmer')).toBeVisible();
 await expect(tool).toContainText('line 1');
 tick=2;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool).toContainText('line 2');await expect(tool).not.toContainText('line 1');
 await expect(page.locator('.pi-tool-step')).toHaveCount(2);
 await expect(tool).toHaveAttribute('open');
 tick=3;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool.locator('xpath=ancestor::details[contains(@class,"execution-turn-process")]')).toHaveAttribute('open');
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
 const waiting = page.locator('.pi-live-phase.phase-waiting');
 await expect(waiting.locator('.pi-live-phase-content > .pi-live-elapsed')).toHaveText(/^\d+s$/);
 await expect(waiting.locator('.pi-live-phase-label')).toHaveCSS('animation-name','pi-live-label-sweep');
 await expect(page.locator('.execution-transcript')).not.toContainText('暂无可展示');
 phase='thinking';
 await expect(page.locator('.pi-live-phase')).toContainText('思考中');
 // Only provider-public, authorized DTO text is available to the component.
 thinking=true;body='检查已公开的步骤';
 await expect(page.locator('.thinking-message')).toHaveAttribute('open');
 const thought = page.locator('.thinking-message.execution-thought');
 await expect(thought.locator('summary .execution-thought-label')).toHaveText('思考中');
 await expect(page.locator('.pi-live-phase-label')).toHaveCount(0);
 await expect(thought.locator('.execution-timing-meta .pi-live-elapsed')).toHaveText(/^用时 \d+s$/);
 await expect(thought.getByText('检查已公开的步骤', {exact:true}).last()).toBeVisible();
 expect(await thought.evaluate(el => {
  const summary = el.querySelector('summary')!.getBoundingClientRect();
  const body = el.querySelector('.markdown')!.getBoundingClientRect();
  return body.left >= summary.left && body.right <= el.getBoundingClientRect().right + 1;
 })).toBe(true);
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

test('active output polls the light lane and catches up history without duplicating a completed message',async({page})=>{
 let full=0,light=0,committed=false;
 const output={id:'live-lane-output',role:'assistant',text:'实时轻量输出',status:'running',transient:true};
 await page.route('**/api/tasks/task-research/session?*',r=>{
  const url=new URL(r.request().url());
  if(url.searchParams.has('events'))return r.fulfill({status:503});
  if(url.searchParams.has('live')){
   light++;
   return r.fulfill({json:{status:'ready',items:[],historyChanged:committed,liveProof:'proof-1',live:{active:!committed,items:committed?[]:[output]}}});
  }
  full++;
  return r.fulfill({json:{status:'ready',items:committed?[{...output,id:'final-lane-output',transient:false,status:'stop'}]:[],total:committed?1:0,checkpoint:committed?'done':'start',liveProof:'proof-1',live:{active:!committed,items:committed?[]:[output]}}});
 });
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 await expect(page.locator('.pi-live-message')).toHaveCount(1);
 await expect.poll(()=>light).toBeGreaterThanOrEqual(2);
 expect(full).toBe(1);
 committed=true;
 await expect(page.locator('.pi-live-message')).toHaveCount(0);
 await expect(page.locator('.execution-transcript .message-assistant')).toHaveCount(1);
 expect(full).toBeGreaterThanOrEqual(2);
});

test('live model waiting keeps the tool left grid, inline timer and moving label on desktop and mobile',async({page},testInfo)=>{
 const call={id:'wait-after-todo',role:'tool',kind:'tool-call',toolName:'todo_write',callId:'todo',text:'{"todos":[{"content":"核对发布清单","status":"completed"}]}'};
 const result={id:'todo-recorded',role:'tool',kind:'tool-result',toolName:'todo_write',callId:'todo',text:'已保存待办。',status:'completed',timing:{durationMs:350}};
 const live={active:true,phase:'waiting',phaseStartedAt:new Date(Date.now()-7100).toISOString(),items:[]};
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/api/tasks/task-research/session?*',r=>r.fulfill({json:{status:'ready',scope:'current-context',items:[call,result],total:2,revision:'waiting-after-todo',live}}));
 await page.goto('/#/tasks/task-research');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const record=page.locator('.execution-transcript');
 const tool=record.locator('[data-message-id="wait-after-todo"] .pi-web-tool-summary');
 const waiting=record.getByRole('status').filter({hasText:'等待模型响应'});
 await expect(tool).toBeVisible();
 await expect(waiting.locator('.pi-live-elapsed')).toHaveText(/^\d+s$/);
 for(const [width,theme] of [[1440,'light'],[390,'dark']] as const){
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'none'});
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
  const layout=await record.evaluate(el=>{
   const rect=(selector:string)=>el.querySelector(selector)!.getBoundingClientRect();
   const glyph=rect('.pi-web-tool-summary .pi-web-tool-glyph'), spinner=rect('.phase-waiting .pi-live-spinner');
   const label=rect('.pi-web-tool-summary .pi-web-tool-name'), waitLabel=rect('.phase-waiting .pi-live-phase-label');
   const duration=rect('.pi-web-tool-duration'), elapsed=rect('.phase-waiting .pi-live-elapsed');
   return {icon:spinner.left-glyph.left,label:waitLabel.left-label.left,timer:elapsed.left-waitLabel.right,fromHistorical:duration.right-elapsed.right,vertical:spinner.top-glyph.bottom};
  });
  expect(layout.vertical).toBeGreaterThan(0);
  expect.soft(layout,`actual alignment at ${width}px`).toMatchObject({icon:0,label:0,timer:6});
  expect(layout.fromHistorical).toBeGreaterThan(100);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const label=waiting.locator('.pi-live-phase-label');
  await expect(label).toHaveCSS('animation-name','none');
  await expect(label).not.toHaveCSS('color','rgba(0, 0, 0, 0)');
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await expect(label).toHaveCSS('animation-name','pi-live-label-sweep');
  const initial=await label.evaluate(el=>getComputedStyle(el).backgroundPositionX);
  await expect.poll(()=>label.evaluate(el=>getComputedStyle(el).backgroundPositionX)).not.toBe(initial);
  await expect(tool.locator('.pi-web-tool-name')).toHaveCSS('animation-name','none');
  await label.evaluate(el=>{const animation=el.getAnimations()[0]!;animation.pause();animation.currentTime=900});
  await waiting.scrollIntoViewIfNeeded();
  const row=(await waiting.boundingBox())!,fold=(await record.locator('.execution-turn-process > summary').boundingBox())!;
  await page.screenshot({path:testInfo.outputPath(`waiting-after-tool-${width}.png`),clip:{
   x:Math.max(0,Math.floor(row.x)-4), y:Math.max(0,Math.floor(fold.y)-4), width:Math.min(width,Math.ceil(row.width)+8),
   height:Math.ceil(row.y+row.height-fold.y)+8,
  }});
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'active'});
  await expect(label).toHaveCSS('animation-name','none');
  await expect(label).not.toHaveCSS('color','rgba(0, 0, 0, 0)');
 }
});
