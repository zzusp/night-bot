import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {Context} from '@deepseek-ai/cordis';
import {AgentSession} from '@earendil-works/pi-coding-agent';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import PiPersistence from '../../../src/pi-session-persistence.js';
import * as Authority from '../../../src/pi-authority.js';
import {startPreview} from './preview.mjs';
const usage=(n:number)=>({input:100*n,output:10*n,cacheRead:400*n,cacheWrite:20*n,totalTokens:999999,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}});
test('真实原生提交→授权HTTP→未拦截UI，压缩与分支全量统计、重连及撤权',async({page,context})=>{
 const root=await mkdtemp(join(tmpdir(),'night-token-native-')),ctx=new Context();await ctx.plugin(Authority);
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')});let preview:Awaited<ReturnType<typeof startPreview>>|undefined,writer:any;
 const id='fixture-pi-task-research';let releaseRecovery:(()=>void)|undefined;
 try{
  writer=await backend.createNative({version:4,id,createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':(v:any)=>v.taskId==='task-research'&&v.sessionId===id}});
  writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:'task-research',sessionId:id}});
  const manager=writer.manager;
  let fixtureTask:any,missingTask:any,recoveryGate:Promise<void>|undefined,gateEntered=false;
  const badId='fixture-bad-identity';
  const bad=await backend.createNative({version:4,id:badId,createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':()=>true}});
  bad.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:'foreign-task',sessionId:badId}});bad.manager.appendUsage('fixture','fixture','fixture',usage(999));await bad.close();
  const first=manager.appendMessage({role:'user',content:[{type:'text',text:'隔离模拟：核对资料并记录经验。'}],timestamp:Date.now()});
  const old=manager.appendMessage({role:'assistant',api:'openai-completions',provider:'fixture',model:'fixture',content:[{type:'text',text:'隔离模拟：压缩前的核对记录。'}],usage:usage(1),stopReason:'stop',timestamp:Date.now()});
  manager.appendCompaction('隔离模拟压缩摘要',undefined,1000,undefined,false,usage(2));
  manager.branchWithSummary(first,'隔离模拟分支摘要',undefined,false,usage(3));
  manager.appendUsage('fixture','fixture','fixture',usage(4));
  manager.appendMessage({role:'toolResult',toolCallId:'fixture-tool',toolName:'read',content:[{type:'text',text:'隔离模拟资料。'}],usage:usage(5),isError:false,timestamp:Date.now()});
  manager.appendMessage({role:'assistant',api:'openai-completions',provider:'fixture',model:'fixture',content:[{type:'text',text:'隔离模拟：资料核对已完成，保留来源与限制。'}],usage:usage(6),stopReason:'error',timestamp:Date.now()});
  await writer.commit();
  const native=await backend.readNative(id,{requireComplete:true});
  expect(native.context.projection.entries.some((row:any)=>row.sourceEntry.id===old)).toBe(false);
  const official=AgentSession.prototype.getSessionStats.call({sessionManager:manager,getContextUsage:()=>undefined} as any).tokens;expect(official.total).toBe(11130);
  let reads=0,failRead=false,liveRequests=0;
  page.on('request',request=>{if(new URL(request.url()).searchParams.has('live'))liveRequests++;});
  const persistence={identity:backend.identity,readNative:async(...args:any[])=>{reads++;if(args[0]===id && recoveryGate){gateEntered=true;await recoveryGate;}if(failRead)throw Object.assign(Error('controlled unavailable'),{code:'FIXTURE_UNAVAILABLE'});return backend.readNative(...args)},readNativeDigest:(...args:any[])=>backend.readNativeDigest(...args),readLive:async()=>({sessionId:id,active:true,revision:'synthetic-live',assistant:{id:'live-fixture',message:{role:'assistant',usage:usage(1000),content:[{type:'text',text:'隔离模拟：正在整理记录。',complete:true}]}},tools:[]})};
  preview=await startPreview({port:0,persistenceOverride:persistence,configureTasks:(tasks:any[])=>{fixtureTask=tasks.find(task=>task.taskId==='task-research');missingTask=tasks.find(task=>task.taskId==='task-documents');missingTask.session.sessionId='fixture-never-created';missingTask.session.sessionBound=false;}});
  await page.goto(preview.origin+'/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill(preview.token);await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  const card=page.getByRole('region',{name:'消耗 Tokens',exact:true});
  await expect(card.locator('.task-token-total strong')).toHaveText('11.1K');await expect(card.locator('dd')).toHaveText(['2.1K','210','420','8.4K']);
  const pending=await(await page.request.get(preview.origin+'/api/tasks/task-documents/session')).json();expect(pending.status).toBe('pending');expect(pending.reason).toBe('SESSION_NOT_STARTED');expect(pending.tokenUsage).toBeUndefined();
  const before=reads,response=await page.request.get(preview.origin+'/api/tasks/task-research/session?limit=1');expect(reads-before).toBe(1);
  const dto=await response.json();expect(dto.tokenUsage).toEqual({...official,basis:'committed-native-entries'});
  const light=await(await page.request.get(preview.origin+'/api/tasks/task-research/session?live='+dto.liveProof)).json();expect(light.tokenUsage).toBeUndefined();
  const full=await(await page.request.get(preview.origin+'/api/tasks/task-research/session?limit=50')).json();expect(full.tokenUsage).toEqual(dto.tokenUsage);
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:960});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await card.scrollIntoViewIfNeeded();
   const rail=page.locator('.task-info-rail');await expect(rail.locator('.detail-section').nth(2)).toHaveClass(/task-token-card/);await expect(rail.locator('.detail-section').nth(3)).toHaveClass(/task-learning-summary/);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   expect(await card.locator('.token-ring-segment').count()).toBe(4);
   const shares=await card.locator('.token-ring-segment').evaluateAll(elements=>elements.map(element=>parseFloat(element.getAttribute('data-share')!)));
   for(const [index,value] of [2100,210,420,8400].entries())expect(shares[index]).toBeCloseTo(value/11130*100,6);
   expect(shares.reduce((sum,value)=>sum+value,0)).toBeCloseTo(100,6);
   expect((await new AxeBuilder({page}).include('.task-info-rail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
   await rail.screenshot({path:test.info().outputPath(`tokens-rail-${width}-${theme}.png`)});
   if(width===1440){await page.locator('main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:test.info().outputPath(`tokens-full-${width}-${theme}.png`)});}
  }
  const zeroId=missingTask.session.sessionId;
  const zero=await backend.createNative({version:4,id:zeroId,createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':()=>true}});
  zero.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:'task-documents',sessionId:zeroId}});await zero.close();missingTask.session.sessionBound=true;
  await page.goto(preview.origin+'/#/tasks/task-documents');await expect(card.locator('.task-token-total strong')).toHaveText('0');await expect(card.locator('.token-ring-segment')).toHaveCount(0);
  await card.screenshot({path:test.info().outputPath('ring-real-zero-390-dark.png')});
  await page.goto(preview.origin+'/#/tasks/task-research');await expect(card.locator('.task-token-total strong')).toHaveText('11.1K');
  await expect.poll(()=>liveRequests).toBeGreaterThan(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(card.locator('.task-token-total strong')).toHaveText('11.1K');
  const fresh=page.waitForResponse(response=>response.url().includes('/api/tasks/task-research/session?stream=')&&response.status()===200);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));const saved=await(await fresh).json();
  fixtureTask.session.sessionId=badId;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(card.locator('.task-token-total strong')).toHaveText('未知');await expect(card.getByRole('alert')).toBeVisible();
  const badResponse=await page.request.get(preview.origin+'/api/tasks/task-research/session');expect(badResponse.status()).toBe(503);const badBody=await badResponse.json();expect(badBody.error).toBe('SESSION_IDENTITY_INVALID');expect(badBody.tokenUsage).toBeUndefined();
  recoveryGate=new Promise<void>(resolve=>{releaseRecovery=resolve;});const previousLive=liveRequests;
  fixtureTask.session.sessionId=id;
  // The old proof is still valid on the restored bytes, but is not a new full
  // authorization snapshot and cannot restore the cleared client token value.
  const oldLight=await(await page.request.get(preview.origin+'/api/tasks/task-research/session?live='+saved.liveProof)).json();expect(oldLight.historyChanged).toBe(false);expect(oldLight.tokenUsage).toBeUndefined();
  await expect.poll(()=>gateEntered).toBe(true);await expect(card.locator('.task-token-total strong')).toHaveText('未知');expect(liveRequests).toBe(previousLive);
  await card.getByRole('button',{name:'重新获取',exact:true}).click();await expect(card.locator('.task-token-total strong')).toHaveText('未知');
  recoveryGate=undefined;releaseRecovery!();await expect(card.locator('.task-token-total strong')).toHaveText('11.1K');
  failRead=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(card.locator('.task-token-total strong')).toHaveText('未知');failRead=false;
  manager.appendMessage({role:'assistant',api:'host',provider:'host',model:'host',content:[],usage:usage(0),_hostUsage:undefined,stopReason:'error',timestamp:Date.now()});await writer.commit();
  const serialized=await backend.readNative(id,{requireComplete:true});const host=serialized.entries.findLast((entry:any)=>entry.type==='message'&&entry.message.api==='host');expect(Object.hasOwn(host.message,'_hostUsage')).toBe(false);expect(host.message.api).toBe('host');
  const unknown=await(await page.request.get(preview.origin+'/api/tasks/task-research/session')).json();expect(unknown.tokenUsage).toMatchObject({input:null,output:null,cacheWrite:null,cacheRead:null,total:null});
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(card.locator('.task-token-total strong')).toHaveText('未知');await expect(card.locator('.token-ring-segment')).toHaveCount(0);
  await card.screenshot({path:test.info().outputPath('ring-real-unknown-390-dark.png')});
  await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.getByLabel('访问令牌',{exact:true})).toBeVisible();await expect(card).toHaveCount(0);
  console.log(JSON.stringify({evidence:'real-native-journal + official SessionManager + production persistence/HTTP + un-intercepted UI; synthetic entries; no model',official,oldEntryExcludedFromProjection:true,unboundMissingPending:true,identityRecoveryFullOnly:true,serializedHostUsageUnknown:true,liveIgnored:true,liveRequests,nativeReads:reads}));
 }finally{releaseRecovery?.();await preview?.close();await writer?.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('UI受控DTO区分真实零、部分未知、503旧值及403清除',async({page})=>{
 let mode='zero',release:(()=>void)|undefined;
 await page.route('**/api/tasks/task-research/session?*',async route=>{
  if(mode==='slow')await new Promise<void>(resolve=>{release=resolve;});
  if(mode==='failed')return route.fulfill({status:503,json:{error:'REQUEST_FAILED'}});
  if(mode==='denied')return route.fulfill({status:403,json:{error:'RESOURCE_FORBIDDEN'}});
  const data=await(await route.fetch()).json();
  return route.fulfill({json:{...data,tokenUsage:{input:mode==='partial'?4:0,output:0,cacheWrite:mode==='partial'?null:0,cacheRead:0,total:mode==='partial'?null:0,basis:'committed-native-entries'}}});
 });
 await page.goto('/#/tasks/task-research');await page.getByLabel('访问令牌',{exact:true}).fill('night-web-fixture-only-00000000000000000000');await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
 const card=page.getByRole('region',{name:'消耗 Tokens',exact:true}),total=card.locator('.task-token-total strong');
 await expect(total).toHaveText('0');await expect(card.locator('dd')).toHaveText(['0','0','0','0']);await expect(card.locator('.token-ring-segment')).toHaveCount(0);
 const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('online')));
 mode='partial';await refresh();await expect(total).toHaveText('未知');await expect(card.locator('dd')).toHaveText(['4','0','未知','0']);
 await card.screenshot({path:test.info().outputPath('ring-ui-partial-1440-light.png')});
 mode='zero';await refresh();await expect(total).toHaveText('0');
 mode='failed';await refresh();await expect(card).toContainText('上次获取的数据');await expect(total).toHaveText('0');
 mode='denied';await refresh();await expect(total).toHaveText('未知');await expect(card.locator('dd')).toHaveText(['未知','未知','未知','未知']);
 mode='slow';await refresh();await expect.poll(()=>!!release).toBe(true);await expect(total).toHaveText('未知');release!();await expect(total).toHaveText('0');
});
