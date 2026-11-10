import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from '../../../test/fixtures/memory-host.js'
import {eventually} from '../../../test/fixtures/resident-router-host.js'
import {memoryScope} from '../../../src/memory/scope.js'
import {openDynamicTaskStore} from '../../../packages/dingtalk-core/dynamic-task-store.js'
import {createWebConsole} from '../server/plugin.js'
const doc=(name,body,extra='')=>`---\nname: ${name}\ndescription: Real local shared resource\n${extra}---\n${body}\n`
test('真实 Bot 公共记忆跨渠道共享且保留来源，目录盘点/真实调用/用户引用/文件读取与更新分别核实',{timeout:45000},async t=>{
 let mode='none',issued=false,file
 const f=await memoryHost(t,body=>{
  if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){const input=JSON.parse(body.messages.findLast(row=>row.role==='user').content);return {text:JSON.stringify({lessons:[{key:'shared-evidence',observation:'复盘来源与真实任务对应',hypothesis:'证据核对步骤可复用',shortcut:'先读取来源',evidenceIds:[input.eventId],skill:{steps:['读取真实来源','核对返回结果'],reason:'任务中有直接证据',applicability:'来源核对',evidenceBacked:true}}]})}}
  if((mode==='skill'||mode==='learned')&&!issued){issued=true;return {tool:'skill',args:{name:mode==='learned'?'learned-shared-evidence':'common-check'}}}
  if(mode==='file'&&!issued){issued=true;return {tool:'read',args:{path:file}}}
  return {text:'真实本地资源验证完成'}
 })
 file=join(f.host.ctx.runtimePaths.skills,'common-check','SKILL.md');await mkdir(join(file,'..'),{recursive:true});await writeFile(file,doc('common-check','LOCAL_COMMON_BODY_V1'))
 const second=join(f.host.ctx.runtimePaths.agentsHome,'skills','second-check','SKILL.md');await mkdir(join(second,'..'),{recursive:true});await writeFile(second,doc('second-check','ANOTHER_BOT_RESOURCE'))
 const disabled=join(f.host.ctx.runtimePaths.skills,'disabled-check','SKILL.md');await mkdir(join(disabled,'..'),{recursive:true});await writeFile(disabled,doc('disabled-check','DISABLED_BODY','disable-model-invocation: true\nuser-invocable: false\n'))
 const bad=join(f.host.ctx.runtimePaths.skills,'invalid-check','SKILL.md');await mkdir(join(bad,'..'),{recursive:true});await writeFile(bad,'not valid skill metadata')
 const source=(channelId,type,conversationId,messageId,text)=>({channelId,type,conversationId,messageId,text,senderId:'member',senderName:'真实成员',conversationName:type==='chat-room'?'真实项目群':'真实私聊'})
 const a=await f.host.ctx.channels.receive(source('channel-alpha','chat','direct-one','remember-one','记住 facts/shared：所有渠道共同核对真实结果'))
 const b=await f.host.ctx.channels.receive(source('channel-beta','chat-room','room-two','read-one','读取公共记忆'))
 const actor=f.host.ctx.agents.get(b.sessionId),scope=await f.host.ctx.memory.scope(actor,{})
 assert.equal(scope.kind,'bot');assert.equal(f.host.ctx.memory.store.directory(scope),f.host.ctx.memory.store.directory(memoryScope({actorId:'another'})))
 const common=await f.host.ctx.memory.read(actor,{topic:'facts'});assert.equal(common.entries[0].text,'所有渠道共同核对真实结果');assert.equal(common.entries[0].provenance.channelId,'channel-alpha');assert.equal(common.entries[0].provenance.conversationType,'chat');assert.equal(common.entries[0].provenance.conversationName,'真实私聊')
 let web,taskStore,detach
 try{
  web=await createWebConsole({channels:f.host.ctx.channels,paths:f.host.ctx.runtimePaths,config:{channelId:'web-public-evolution',senderId:'operator',port:0},getApplication:()=>({config:{channelPlugins:[]},tasks:{listObserverGroups:()=>[],boardTasks:async()=>({items:[],total:0,nextOffset:null}),store:taskStore}}),getMemory:()=>f.host.ctx.memory})
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0]
  const inspect=async()=>{const response=await fetch(web.origin+'/api/evolution?limit=50',{headers:{origin:web.origin,cookie}});assert.equal(response.status,200);return response.json()}
  let view=await inspect();assert.equal(view.coverage,'bot-shared-current-state');assert.equal(view.memory.acceptedCount,1);assert.equal(view.skills.installedCount,4);assert.equal(view.skills.installedAvailableCount,2);assert.equal(view.skills.modelUseCount,0);assert.equal(view.skills.userUseCount,0)
  assert.ok(view.items.some(row=>row.name==='invalid-check'&&row.status==='invalid'));assert.ok(view.items.some(row=>row.name==='disabled-check'&&row.status==='disabled'))
  mode='skill';issued=false;await f.host.ctx.channels.receive(source('channel-beta','chat-room','room-two','skill-one','加载并使用 common-check'));await f.host.ctx.memory.whenIdle()
  await eventually(async()=>{view=await inspect();return view.skills.modelUseCount===1},'successful native skill invocation committed')
  mode='file';issued=false;await f.host.ctx.channels.receive(source('channel-beta','chat-room','room-two','file-one','读取技能文件'));await f.host.ctx.memory.whenIdle()
  await eventually(async()=>{view=await inspect();return view.skills.fileReadCount===1},'actual native read of the exact skill file committed')
  mode='none';await f.host.ctx.channels.receive(source('channel-alpha','chat','direct-one','user-skill','/skill:common-check inspect locally'));await f.host.ctx.memory.whenIdle()
  view=await inspect();assert.equal(view.skills.userUseCount,1);assert.equal(view.skills.modelUseCount,1);assert.equal(view.skills.fileReadCount,1)
  const used=view.items.find(row=>row.name==='common-check');assert.equal(used.modelUseCount,1);assert.equal(used.userUseCount,1);assert.equal(used.fileReadCount,1);assert.equal(used.updatedSinceUse,false)
  const baseline=view.skills;await inspect();assert.deepEqual((await inspect()).skills,baseline,'inventory and dashboard reads are not skill use')
  await writeFile(file,doc('common-check','LOCAL_COMMON_BODY_V2'));f.host.ctx.skills.invalidateCache();const updated=await inspect();const changed=updated.items.find(row=>row.name==='common-check');assert.notEqual(changed.revision,used.revision);assert.equal(changed.updatedSinceUse,true);assert.equal(changed.modelUseCount,1)
  const memoryRow=updated.items.find(row=>row.kind==='memory');assert.equal(memoryRow.provenance.channelId,'channel-alpha');assert.equal(updated.memory.lastAccess.provenance.channelId,'channel-beta')
  assert.equal(memoryRow.memoryUse.readCount,1);assert.equal(memoryRow.memoryUse.lastAccess.provenance.channelId,'channel-beta')
  taskStore=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'shared-evolution-tasks.sqlite'),instanceId:'shared-evolution',initialize:true})
  await taskStore.command({id:'create-source-task',kind:'task.create',args:{taskId:'source-task',title:'真实来源核对',request:'核对真实来源',ownerActorId:'member',groupId:b.sessionId,metadata:{channelType:'chat-room',memoryGroupId:f.host.ctx.channels.groupContext(b.sessionId).memoryGroupId}}})
  const claim=await taskStore.command({id:'claim-source-task',kind:'task.claim',args:{taskId:'source-task'}})
  await taskStore.command({id:'complete-source-task',kind:'task.complete',args:{binding:claim.result.binding,summary:'已核对真实来源'}})
  detach=f.host.ctx.reflection.attachStore(taskStore,{ownerActorId:'member',model:f.config.model});await f.host.ctx.reflection.whenIdle()
  const reflected=await inspect(),fromTask=reflected.items.find(row=>row.kind==='memory'&&row.provenance?.taskId==='source-task');assert.ok(fromTask);assert.equal(fromTask.provenance.channelId,'channel-beta');assert.equal(fromTask.provenance.conversationType,'chat-room');assert.equal(fromTask.provenance.conversationName,'真实项目群')
  mode='learned';issued=false;await f.host.ctx.channels.receive(source('channel-alpha','chat','direct-one','learned-use','使用公共学习技能核对来源'));await f.host.ctx.memory.whenIdle()
  await eventually(async()=>{const current=await inspect();return current.skills.modelUseCount===2},'public learned skill used from another channel')
  mode='none';await f.host.ctx.channels.receive(source('channel-beta','chat-room','room-two','correct-shared','修改记忆 公共 facts/shared：以已确认的真实来源核对结果'))
  const corrected=await inspect(),currentMemory=corrected.items.find(row=>row.name==='facts/shared');assert.equal(currentMemory.provenance.channelId,'channel-beta');assert.equal(currentMemory.origins.length,2)
  const content=async item=>{const response=await fetch(web.origin+'/api/evolution/items/'+item.id+'?revision='+item.revision,{headers:{origin:web.origin,cookie}});assert.equal(response.status,200);return response.json()}
  const memoryContent=await content(currentMemory);assert.equal(memoryContent.current.text,'以已确认的真实来源核对结果');assert.equal(memoryContent.previous.text,'所有渠道共同核对真实结果');assert.equal(memoryContent.comparison.status,'available')
  const skillContent=await content(changed);assert.match(skillContent.current.text,/LOCAL_COMMON_BODY_V2/);assert.match(skillContent.previous.text,/LOCAL_COMMON_BODY_V1/);assert.equal(skillContent.comparison.basis,'observed')
  const learnedContent=await content(corrected.items.find(row=>row.name==='learned-shared-evidence'));assert.match(learnedContent.current.text,/核对返回结果/);assert.equal(learnedContent.previous,null)
  const beforeUsage=JSON.stringify(corrected.memory);await content(currentMemory);assert.equal(JSON.stringify((await inspect()).memory),beforeUsage,'content and comparison reads do not count as model memory use')
  const otherActor=f.host.ctx.agents.get(a.sessionId);assert.equal((await f.host.ctx.memory.read(otherActor,{topic:'facts',key:'shared'})).entries[0].text,'以已确认的真实来源核对结果')
  if(process.env.NIGHT_SHARED_EVOLUTION_BROWSER==='1'){
   const {chromium}=await import('@playwright/test'),{default:AxeBuilder}=await import('@axe-core/playwright')
   const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'})
   try{const context=await browser.newContext({viewport:{width:1440,height:960},locale:'zh-CN'}),page=await context.newPage();await page.goto(web.origin+'/#/evolution');await page.getByLabel('访问令牌',{exact:true}).fill((await readFile(web.credentialPath,'utf8')).trim());await page.getByRole('button',{name:'连接工作空间',exact:true}).click();await page.getByRole('heading',{name:'自进化',exact:true,level:2}).waitFor()
    await page.getByText('common-check',{exact:true}).waitFor();assert.match(await page.locator('.evolution-card').nth(1).innerText(),/目录技能[\s\S]*4/)
    const row=page.locator('.evolution-table tbody tr').filter({hasText:'facts/shared'});await row.getByRole('button').click();const contentPanel=page.locator('.evolution-content');await contentPanel.locator('.evolution-entry-details > summary').click();await contentPanel.locator('.evolution-entry-details .evolution-source > summary').first().click();assert.match(await contentPanel.innerText(),/channel-beta/);assert.match(await contentPanel.innerText(),/room-two/);await page.getByRole('button',{name:'返回列表',exact:true}).click()
    const taskRow=page.locator('.evolution-table tbody tr').filter({hasText:fromTask.name});await taskRow.getByRole('button').click();await contentPanel.locator('.evolution-entry-details > summary').click();await contentPanel.locator('.evolution-entry-details .evolution-source > summary').first().click();assert.match(await contentPanel.innerText(),/source-task|真实来源核对/);await page.getByRole('button',{name:'返回列表',exact:true}).click()
    for(const width of [1440,390]){await page.setViewportSize({width,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/tmp/shared-evolution-real-'+width+'.png',fullPage:true})}
    const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;assert.deepEqual(violations,[])
    assert.doesNotMatch(await page.locator('.evolution-page').innerText(),/LOCAL_COMMON_BODY_V[12]/)
   }finally{await browser.close()}
  }
  detach();detach=undefined;await web.close();web=undefined;await taskStore.close();taskStore=undefined;const requests=f.requests.length;await f.close();await f.boot()
  const cold=await f.host.ctx.memory.inspectEvolution({actorId:'cold-reader'},{limit:50});assert.equal(cold.memory.acceptedCount,2);assert.equal(cold.skills.modelUseCount,2);assert.equal(cold.skills.userUseCount,1);assert.equal(cold.skills.fileReadCount,1);assert.equal(f.requests.length,requests,'cold catalog and persisted statistics do not invoke a model')
  t.diagnostic(JSON.stringify({sharedScope:scope.kind,files:updated.skills.installedCount,available:updated.skills.installedAvailableCount,model:cold.skills.modelUseCount,user:cold.skills.userUseCount,fileReads:cold.skills.fileReadCount,bodyUpdated:changed.updatedSinceUse}))
 }finally{detach?.();await web?.close();await taskStore?.close()}
})
