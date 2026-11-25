import {test,expect} from '@playwright/test';
import {FIXTURE_TOKEN,startPreview} from './preview.mjs';

const marker='fixture-tool-input-275';
const source={sessionId:'perf-journal',entryId:'fixture'};
const items=Array.from({length:10},(_,i)=>[
  {id:`source-${i}`,role:'user',kind:'source',source,createdAt:'2026-11-24T02:00:00Z',text:'请核对发布前检查清单。'},
  ...Array.from({length:8},(_,j)=>[
    {id:`call-${i}-${j}`,callId:`call-${i}-${j}`,role:'tool',kind:'tool-call',toolName:'resident_task_action',source,
      status:'result-unrecorded',text:JSON.stringify({kind:'supplement',taskId:`task-${j}`,handoff:marker,objective:'确保版本一致。',requirements:['先核对总体状态。']})},
    {id:`result-${i}-${j}`,callId:`call-${i}-${j}`,role:'tool',kind:'tool-result',toolName:'resident_task_action',source,status:'completed',
      text:JSON.stringify({result:{task:{taskId:`task-${j}`,title:j===3&&i===5?'检索独一回执':'核对发布记录',objective:'确保版本一致。',status:'active'}}})},
  ]).flat(),
  {id:`thought-${i}`,role:'assistant',kind:'thinking',text:'核对授权范围，整理前后资料。',source},
  {id:`answer-${i}`,role:'assistant',kind:'message',status:'stop',text:'已核对发布前检查清单。',source,createdAt:'2026-11-24T02:00:08Z'},
]).flat();

for(const router of [false,true])test(`${router?'Router':'任务详情'}按需展开旧处理，空轮询不再解析已挂载工具`,async({page})=>{
 const bench=process.env.NIGHT_TRANSCRIPT_BENCH==='1';
 if(bench) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 }
 await page.addInitScript(({marker})=>{
  const proof={toolReads:0};
  Object.assign(window,{__transcriptProbe:proof});
  const parse=JSON.parse;
  JSON.parse=function(text, reviver) {
   if(typeof text==='string'&&text.includes(marker)) proof.toolReads++;
   return parse(text,reviver);
  };
  const nativeFetch=window.fetch;
  window.fetch=async(input,init)=>{
   const track=String(input).includes('/session?')&&String(input).includes('stream=1')&&!String(input).includes('checkpoint=');
   if(track&&!performance.getEntriesByName('execution-request').length) performance.mark('execution-request');
   const response=await nativeFetch(input,init);
   if(!track||performance.getEntriesByName('execution-headers').length)return response;
   performance.mark('execution-headers');
   const json=response.json.bind(response);
   response.json=async()=>{const ret=await json();performance.mark('execution-json');return ret;};
   return response;
  };
  new MutationObserver(()=>{
   if(document.querySelectorAll('.execution-turn-process').length!==10||performance.getEntriesByName('execution-usable').length)return;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
     if(performance.getEntriesByName('execution-json').length&&!performance.getEntriesByName('execution-usable').length)performance.mark('execution-usable');
   }));
  }).observe(document,{childList:true,subtree:true});
 },{marker});
 let durationMs=200;
 const endpoint=router?'**/api/chat/sample-plan/session?*':'**/api/tasks/task-research/session?*';
 await page.route(endpoint,route=>{
  const url=new URL(route.request().url());
  return route.fulfill({json:{status:'ready',revision:'perf-initial-transcript',scope:'current-context',total:items.length,
   items:url.searchParams.has('checkpoint')?[]:items,checkpoint:'fixture-checkpoint',timingUpdates:{'result-5-3':{durationMs}}}});
 });
 await page.goto(router?'/#/chat/sample-plan':'/#/tasks');
 await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
 await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const entrance=router?page.getByRole('tab',{name:'路由',exact:true}):page.getByRole('link',{name:'整理本周产品调研',exact:true});
 await entrance.evaluate(el=>el.addEventListener('click',()=>performance.mark('execution-click'),{once:true,capture:true}));
 await entrance.click();
 const turns=page.locator('.execution-turn-process');
 await expect(turns).toHaveCount(10);
 await expect(page.locator('.execution-turn-process[open]')).toHaveCount(0);
 if(bench) {
  await page.waitForFunction(()=>performance.getEntriesByName('execution-usable').length>0);
  const report=await page.evaluate(()=>{
   const mark=(name:string)=>performance.getEntriesByName('execution-'+name)[0].startTime;
   return {clickMs:mark('usable')-mark('click'),clickToRequestMs:mark('request')-mark('click'),
    requestMs:mark('headers')-mark('request'),decodeMs:mark('json')-mark('headers'),renderMs:mark('usable')-mark('json'),
    tools:document.querySelectorAll('.pi-tool-frame').length,nodes:document.querySelectorAll('.execution-transcript *').length};
  });
  console.log(JSON.stringify({benchmark:router?'router':'task',...report}));
  return;
 }
 await expect(page.locator('.pi-tool-frame')).toHaveCount(0);
 await expect(turns.locator('.thinking-message')).toHaveCount(0);
 await page.getByRole('button',{name:'搜索执行记录',exact:true}).click();
 const search=page.getByRole('searchbox',{name:'搜索已载入记录'});
 await search.fill('检索独一回执');
 await search.press('Enter');
 const tool=page.locator('[data-message-id="call-5-3"]');
 await expect(tool).toContainText('检索独一回执');
 await expect(tool).toBeInViewport();
 await expect(page.locator('.execution-turn-process[open]')).toHaveCount(1);
 await expect(page.locator('.pi-tool-frame')).toHaveCount(8);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const before=await page.evaluate(()=>(window as any).__transcriptProbe.toolReads);
 expect(before).toBeGreaterThan(0);
 const response=page.waitForResponse(result=>result.url().includes('checkpoint=fixture-checkpoint')&&result.ok());
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await response;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect(await page.evaluate(()=>(window as any).__transcriptProbe.toolReads)).toBe(before);
 await expect(tool.getByText('检索独一回执',{exact:true})).toBeVisible();
 await expect(tool.locator('.pi-web-tool-duration')).toHaveText('0.2s');
 durationMs=700;
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(tool.locator('.pi-web-tool-duration')).toHaveText('0.7s');
 const opened=page.locator('.execution-turn-process[open]');
 const summary=opened.locator(':scope > summary');
 await summary.click();
 await expect(tool.getByText('检索独一回执',{exact:true})).toBeHidden();
 await tool.locator('xpath=ancestor::details[contains(@class,"execution-turn-process")]/summary').click();
 await expect(tool.getByText('检索独一回执',{exact:true})).toBeVisible();
});

test('流连接健康时，已展示的独立正文仍会复核，撤权后先清除再重读',async({page})=>{
 const privateText='合成正文：这段记忆后来不可查看';
 const replacement={id:'sanitized',role:'assistant',text:'权限刷新后的记录。'};
 const items=[
  {id:'call',callId:'read',role:'tool',kind:'tool-call',toolName:'memory_read',text:'{}',status:'result-unrecorded'},
  {id:'result',callId:'read',role:'tool',kind:'tool-result',toolName:'memory_read',text:privateText,status:'completed',resourceContent:true},
 ];
 const ready=(extra:object)=>({status:'ready',revision:'protected-history',scope:'current-context',total:2,checkpoint:'proof-cp',...extra});
 const preview=await startPreview({port:0,persistenceOverride:{subscribeSessionView(){return ()=>{}},
  async readNative(id:string){return {header:{id},audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-research',sessionId:id}}],entries:[],context:{projection:{entries:[]}}};},
 }});
 const requests:URL[]=[];
 let polls=0, revoked=false, resetting=false;
 let release!:()=>void;
 const resetGate=new Promise<void>(done=>{release=done;});
 try{
  await page.route('**/api/tasks/task-research/session?*',async route=>{
   const url=new URL(route.request().url());
   if(url.searchParams.has('events'))return route.continue();
   requests.push(url);
   if(url.searchParams.has('checkpoint')||url.searchParams.has('live')){
    polls++;
    if(!revoked)return route.fulfill({json:ready({items:[],liveProof:'ignored-when-protected'})});
    resetting=true;
    return route.fulfill({status:409,json:{error:'SESSION_PAGE_STALE'}});
   }
   if(!resetting)return route.fulfill({json:ready({items,resourceProof:'proof-one',liveProof:'ignored-when-protected'})});
   await resetGate;
   return route.fulfill({json:ready({items:[replacement]})});
  });
  const stream=page.waitForResponse(res=>res.url().endsWith('/session?events=1'));
  await page.goto(preview.origin+'/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(preview.token);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  expect((await stream).headers()['content-type']).toMatch(/^text\/event-stream/);
  const tool=page.locator('[data-message-id="call"]');
  await tool.locator('summary').click();
  await expect(tool.getByText(privateText,{exact:true})).toBeVisible();
  const before=polls;
  await expect.poll(()=>polls).toBeGreaterThan(before);
  await expect(tool.getByText(privateText,{exact:true})).toBeVisible();
  revoked=true;
  await expect.poll(()=>resetting).toBe(true);
  await expect(page.getByText(privateText,{exact:true})).toHaveCount(0);
  await expect.poll(()=>requests.length).toBeGreaterThanOrEqual(4);
  expect(requests.filter(url=>url.searchParams.has('checkpoint')).every(url=>url.searchParams.get('resources')==='proof-one')).toBe(true);
  expect(requests.some(url=>url.searchParams.has('live'))).toBe(false);
  expect(requests.at(-1)?.searchParams.has('checkpoint')).toBe(false);
  expect(requests.at(-1)?.searchParams.has('resources')).toBe(false);
  release();
  await expect(page.getByText(replacement.text,{exact:true})).toBeVisible();
 } finally {release();await preview.close();}
});
