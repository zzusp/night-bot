import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {FIXTURE_TOKEN} from './preview.mjs';
import {taskSessionView, routerSessionView} from '../server/session-view.js';
import {communicationGuidanceReadTool} from '../../../src/channels/message-safety.js';

const guidance = 'communication_guidance_read';
const extension = 'fixture_unlisted_tool';
async function projected(router: boolean) {
  const sessionId='fixture-expanded-details', conversationId='room-product';
  const call=(id:string,name:string,args:object)=>({role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]});
  const result=(id:string,name:string,text:string)=>({role:'toolResult',toolCallId:id,toolName:name,isError:false,content:[{type:'text',text}]});
  const nativeTool=communicationGuidanceReadTool(), value=await nativeTool.execute();
  const nativeContent=nativeTool.output.render({},value);
  const committed={...result('guide',guidance,nativeContent[0].text),details:{nativeResult:{isError:false,value,content:nativeContent}}};
  const forged=JSON.stringify({id:'communication/v1',content:'FIXTURE_PRIVATE_GUIDANCE'});
  const messages=[
    call('guide',guidance,{}),committed,
    call('forged',guidance,{}),result('forged',guidance,forged),
    call('extension',extension,{private:'FIXTURE_PRIVATE_ARGUMENT'}),result('extension',extension,'FIXTURE_PRIVATE_OUTPUT'),
    call('empty','job_list',{}),result('empty','job_list',''),
    call('interrupted','job_list',{}),
    result('orphan',guidance,forged),
  ];
  const entries=messages.map((message,index)=>({id:`fixture-core-${index}`,type:'message',message}));
  const snapshot={header:{id:sessionId,...router?{runtimeOwner:'conversation-router',conversationId,generation:1}:{}},
    entries,audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-research',sessionId}}],
    context:{projection:{entries:entries.map(sourceEntry=>({sourceEntry,messages:[sourceEntry.message]}))}}};
  const persistence={readNative:async()=>snapshot};
  const dto = router
    ? await routerSessionView({conversationId,readRouter:async()=>({id:conversationId,activeSessionId:sessionId,generation:1,phase:'active'}),persistence})
    : await taskSessionView({task:{taskId:'task-research',session:{sessionId,sessionBound:true}},persistence});
  return {dto, actualGuidance:value.content};
}

for (const router of [true,false]) test(`${router?'Router':'任务'}所有工具都可展开，真实回执与未公开、空结果、旧记录区别展示`, async ({page},info)=>{
  const {dto,actualGuidance}=await projected(router);
  expect(JSON.stringify(dto)).not.toContain('FIXTURE_PRIVATE_');
  expect(dto.items.filter(row=>row.resourceContent).map(row=>row.text)).toEqual([actualGuidance]);
  const endpoint=router?'**/api/conversations/room-product/session?*':'**/api/tasks/task-research/session?*';
  const live={...dto,items:[...dto.items,{role:'tool',kind:'tool-call',toolName:'fixture_running_tool',id:'ongoing',text:'{}',status:'running',detailState:'empty',transient:true}]};
  await page.route(endpoint,route=>route.fulfill({json:live}));
  await page.goto(router?'/#/channels/room-product':'/#/tasks/task-research');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  if(router)await page.getByRole('tab',{name:'路由',exact:true}).click();
  const history=page.locator('.execution-history');
  for(const row of await history.locator('.execution-turn-process:not([open]) > summary, .execution-tool-group:not([open]) > summary').all())await row.click();
  const tools=history.locator('.pi-web-tool-frame');
  await expect(tools).toHaveCount(7);
  const open=async(index:number)=>{
    const card=tools.nth(index), summary=card.locator('.pi-web-tool-summary');
    await expect(card.locator('.pi-tool-body')).toHaveCount(0);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('.pi-tool-body')).toBeVisible();
    await expect(summary).toBeFocused();
    return card;
  };
  const read=await open(0);
  const document=read.locator('.pi-tool-document .markdown');
  await expect(document).toBeVisible();
  expect(await document.textContent()).toBe(actualGuidance);
  await expect(read.locator('.tool-part')).toHaveCount(1);
  await expect(read).not.toContainText(/文档版本|已读取沟通指引|读取范围/);
  const forged=await open(1);
  await expect(forged.locator('.pi-tool-document')).toHaveCount(0);
  await expect(forged.getByText('未记录可核对的沟通指引正文。',{exact:true})).toBeVisible();
  const unknown=await open(2);
  await expect(unknown.locator('.pi-tool-detail-state')).toHaveCount(2);
  await expect(unknown.getByText('参数未公开。',{exact:true})).toBeVisible();
  await expect(unknown.getByText('结果未公开。',{exact:true})).toBeVisible();
  const empty=await open(3);
  await expect(empty.getByText('无需参数。',{exact:true})).toBeVisible();
  await expect(empty.getByText('已返回，无文字输出。',{exact:true})).toBeVisible();
  const unrecorded=await open(4);
  await expect(unrecorded.getByText('未记录工具结果。',{exact:true})).toBeVisible();
  const orphan=await open(5);
  await expect(orphan.getByText('未记录输入参数。',{exact:true})).toBeVisible();
  await expect(orphan.getByText('未找到唯一对应的调用，未展示结果正文。',{exact:true})).toBeVisible();
  const running=await open(6);
  await expect(running.getByText('等待工具返回。',{exact:true})).toBeVisible();
  await expect(history).not.toContainText(/FIXTURE_PRIVATE_|尚未声明/);
  for(const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(t=>{document.documentElement.dataset.theme=t;(document.activeElement as HTMLElement)?.blur();},theme);
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('.execution-history').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    const path=info.outputPath(`guidance-${router?'router':'task'}-${width}.png`);
    if(width===390) {
      await read.locator('summary').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
      const box=(await read.boundingBox())!;
      const jump=page.getByRole('button',{name:'回到最新消息',exact:true});
      const obstruction=await jump.isVisible() ? await jump.boundingBox() : null;
      const bottom=obstruction && obstruction.y>box.y ? obstruction.y-8 : 900;
      await page.screenshot({path,clip:{x:Math.max(0,box.x),y:Math.max(0,box.y),width:box.width,height:Math.min(310,bottom-box.y)}});
    } else await read.screenshot({path});
    if(router)await unknown.screenshot({path:info.outputPath(`tool-withheld-${width}.png`)});
  }
});

test('Router结清优先显示获权任务名和消息摘录，缺少对应事件明确提示', async ({page},info)=>{
  const sessionId='fixture-router-settlement', conversationId='room-product', generation=1;
  const at='2026-11-24T01:00:00Z', completedAt='2026-11-24T01:06:00Z';
  const title='核对上线清单里的部署版本';
  const snippet='请按新上线清单核对版本和健康探针。';
  const sourceId='FIXTURE_PRIVATE_SOURCE_ID', taskId='FIXTURE_PRIVATE_TASK_ID', taskEventId='FIXTURE_PRIVATE_TASK_EVENT_ID';
  const events=[
    {id:'FIXTURE_PRIVATE_CHANNEL_ID',kind:'source.message',sourceId,messageVersion:1,source:{conversationId,text:snippet,sourceId,version:1,timestamp:at}},
    {id:taskEventId,kind:'task.completed',taskId,taskEventId,taskEvent:{id:taskEventId,taskId,kind:'task.completed',recordedAt:completedAt,result:{summary:'FIXTURE_PRIVATE_COMPLETION'}}},
  ];
  const source={kind:'conversation-router',conversationId,generation,eventIds:events.map(event=>event.id)};
  const details={source,packetId:'FIXTURE_PRIVATE_PACKET_ID'};
  const content=[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId,generation,events})}];
  const packet={type:'custom_message',customType:'night.business-input',details,content,id:'fixture-packet'};
  const toolName='resident_router_settle';
  const call=(id:string,args:object)=>({role:'assistant',content:[{type:'toolCall',id,name:toolName,arguments:args}]});
  const result=(id:string)=>({role:'toolResult',toolCallId:id,toolName,isError:false,
    content:[{type:'text',text:JSON.stringify({result:{conversation:{id:conversationId,generation,cursor:5}}})}]});
  const messages=[
    call('verified',{eventIds:[events[1].id,events[0].id,'FIXTURE_PRIVATE_UNKNOWN_EVENT'],noTaskDispositions:[{eventId:events[0].id,outcome:'context-only'}]}),
    result('verified'),call('legacy',{eventIds:['FIXTURE_PRIVATE_LEGACY_ID']}),result('legacy'),
  ];
  const entries=messages.map((message,index)=>({id:`fixture-settle-${index}`,type:'message',message}));
  const snapshot={header:{id:sessionId,runtimeOwner:'conversation-router',conversationId,generation},entries:[packet,...entries],
    audit:[{domain:'admission',version:1,kind:'enqueued',payload:{id:details.packetId,source,content}},
      {domain:'admission',version:1,kind:'admitted',payload:{id:details.packetId,entryId:packet.id}}],
    context:{projection:{entries:[{sourceEntry:packet,messages:[{role:'custom',customType:'night.business-input',details,content}]},
      ...entries.map(sourceEntry=>({sourceEntry,messages:[sourceEntry.message]}))]}}};
  const options={conversationId,readRouter:async()=>({id:conversationId,activeSessionId:sessionId,generation,phase:'active'}),
    persistence:{readNative:async()=>snapshot}};
  const dto=await routerSessionView({...options,readRouterTasks:async()=>[{groupId:conversationId,taskId,title}]});
  const forbidden=await routerSessionView({...options,readRouterTasks:async()=>[{groupId:'another-room',taskId,title:'FIXTURE_PRIVATE_OTHER_TITLE'}]});
  const projected=dto.items.filter(item=>item.toolName===toolName && item.kind==='tool-result').map(item=>JSON.parse(item.text));
  expect(projected[0].events).toEqual([{recorded:true,kind:'task.completed',at:completedAt,title},
    {recorded:true,kind:'source.message',at,snippet,disposition:'context-only'},{recorded:false}]);
  const excluded=forbidden.items.filter(item=>item.toolName===toolName && item.kind==='tool-result').map(item=>JSON.parse(item.text));
  expect(excluded[0].events[0]).toEqual({recorded:true,kind:'task.completed',at:completedAt});
  expect(JSON.stringify(forbidden)).not.toContain('FIXTURE_PRIVATE_OTHER_TITLE');
  expect(projected[1].events).toBeUndefined();
  expect(JSON.stringify(dto)).not.toContain('FIXTURE_PRIVATE_');
  await page.route('**/api/conversations/room-product/session?*',route=>route.fulfill({json:dto}));
  await page.goto('/#/channels/room-product');
  await page.getByLabel('访问令牌',{exact:true}).fill(FIXTURE_TOKEN);
  await page.getByRole('button',{name:'连接工作空间',exact:true}).click();
  await page.getByRole('tab',{name:'路由',exact:true}).click();
  const tools=page.locator('.execution-history .pi-web-tool-frame');
  await expect(tools).toHaveCount(2);
  const actual=tools.nth(0), legacy=tools.nth(1);
  await actual.locator('summary').focus(); await page.keyboard.press('Enter');
  await legacy.locator('summary').click();
  const list=actual.getByRole('list',{name:'提交的事件',exact:true});
  await expect(list.getByRole('listitem')).toHaveCount(3);
  const task=list.getByRole('listitem').nth(0);
  await expect(task.locator('.resident-settlement-event-title')).toHaveText(title);
  await expect(task.locator('.resident-settlement-event-meta')).toContainText('任务完成');
  await expect(task.locator('time')).toHaveAttribute('datetime',completedAt);
  const input=list.getByRole('listitem').nth(1);
  await expect(input.locator('.resident-settlement-event-title q')).toHaveText(snippet);
  await expect(input.locator('.resident-settlement-event-meta')).toContainText('渠道消息');
  await expect(list.getByRole('listitem').nth(2)).toContainText('未核对到原事件');
  await expect(input.locator('time')).toHaveAttribute('datetime',at);
  await expect(input).toContainText('来源处理：仅作背景');
  await expect(actual.locator('.resident-settlement')).toHaveCount(1);
  await expect(actual).not.toContainText('未列出的来源处理');
  await expect(legacy.getByRole('list',{name:'提交的事件',exact:true})).toHaveCount(0);
  await expect(legacy.getByText('该记录未保存可核对的逐项事件明细。',{exact:true})).toBeVisible();
  for(const [width,theme] of [[1440,'light'],[390,'dark']] as const) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(t=>{document.documentElement.dataset.theme=t;(document.activeElement as HTMLElement)?.blur();},theme);
    await page.mouse.move(0,0);
    expect((await new AxeBuilder({page}).include('.resident-settlement').analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for (const row of [task,input]) {
      const caption=(await row.locator('.resident-settlement-event-title').boundingBox())!;
      const meta=(await row.locator('.resident-settlement-event-meta').boundingBox())!;
      expect(meta.y).toBeGreaterThanOrEqual(caption.y+caption.height);
    }
    await actual.screenshot({path:info.outputPath(`settlement-events-${width}.png`)});
  }
});
