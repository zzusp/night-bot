import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile,access} from 'node:fs/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {memoryScope} from '../src/memory/scope.js'
import {atomicWrite} from '../src/runtime/files.js'
import {hash} from '../src/memory/format.js'
import {recordUsage} from '../src/memory/evolution.js'

const input=body=>JSON.parse(body.messages.findLast(row=>row.role==='user').content)
const reply=value=>({text:JSON.stringify(value)})
const isIndex=body=>JSON.stringify(body).includes('NIGHT_BOT_MEMORY_MAINTENANCE_INDEX')
const isPlan=body=>JSON.stringify(body).includes('NIGHT_BOT_MEMORY_MAINTENANCE_PLAN')
const scope=memoryScope({actorId:'host'})
async function remember(f,topic,key,text,{candidate=false}={}){
 return f.host.ctx.memory.store.remember(scope,{topic,key,text,candidate,source:{sessionId:'PRIVATE_SOURCE_SESSION',messageId:'source-'+topic+'-'+key}})
}
function action(kind,operation,sources,outputs,evidence=sources){return {kind,operation,sources,evidence,reason:'当前条目证据支持此次整理',outputs}}
async function audit(m){const state=JSON.parse(await readFile(m.file,'utf8'));return JSON.parse(await readFile(join(m.directory,'maintenance',state.lastRunId+'.json'),'utf8'))}

test('默认 Host 的事件维护先索引后正文，保持来源隔离、无工具和正常记住回读',async t=>{
 let indexCount=0,planCount=0,readback=false
 const f=await memoryHost(t,body=>{
  if(isIndex(body)){indexCount++;const data=input(body);assert.equal(data.items.length,1);assert.equal(data.items[0].text,undefined);return reply({groups:[[data.items[0].id]],deferred:[]})}
  if(isPlan(body)){planCount++;assert.equal(input(body).items[0].text,'简短回答');return reply({actions:[],deferred:['保留明确偏好，无需调整']})}
  if(!readback){readback=true;return {tool:'memory_read',args:{topic:'preferences',key:'style'}}}
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 const a=await f.agent('maintainer',{actorId:'owner'})
 await f.say(a.agent,'记住 preferences/style：简短回答');await f.host.ctx.reflection.whenIdle()
 assert.equal(indexCount,1);assert.equal(planCount,1)
 const saved=await f.host.ctx.memory.read(a.agent,{topic:'preferences'});assert.equal(saved.entries[0].text,'简短回答')
 const status=await f.host.ctx.memory.status(a.agent);assert.equal(status.review.status,'deferred');assert.equal(status.review.deferredCount,1);assert.equal(status.review.running,false)
 const calls=f.requests.filter(body=>isIndex(body)||isPlan(body))
 for(const body of calls){assert.equal(body.tools,undefined);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_SOURCE_SESSION/)}
 assert.equal((await audit(f.host.ctx.reflection.maintenance)).changes.length,0)
 const before=f.requests.length;await a.agent.ctx.get('permissionPresets').set(a.agent,'read-only');await f.say(a.agent,'记住 preferences/no：不可保存');await f.host.ctx.reflection.whenIdle()
 assert.equal((await f.host.ctx.memory.read(a.agent,{topic:'preferences',key:'no'})).entries.length,0)
 assert.equal(f.requests.slice(before).filter(body=>isIndex(body)||isPlan(body)).length,0)
})

test('周期复盘对记忆和受管 Skill 执行四种动作，候选不晋升、来源和审计持久化',async t=>{
 const f=await memoryHost(t,body=>{
  if(isIndex(body)){assert.equal(input(body).usage.readCount,1);assert.ok(input(body).usage.entries.some(row=>row.readCount===1));return reply({groups:[input(body).items.map(item=>item.id)],deferred:[]})}
  if(!isPlan(body))return
  const items=input(body).items,id=(kind,key)=>items.find(item=>item.kind===kind&&item.key===key).id
  const mem=(key,text)=>({topic:'preferences',key,text})
  const skill=(key,scenario)=>({key,guidance:'事项：证据核对。目标：结果与证据一致。环节：了解材料、判断适用场景、核对结果，可按实际情况调整。信息来源：当前产物和执行回执。正向示例：'+scenario+'。反向示例：照搬旧命令而不确认场景。',reason:'实际经验支持可复用步骤',applicability:'本地证据核对',evidenceBacked:true})
  const evidence=[id('memory','verified-experience')]
  return reply({actions:[
   action('memory','delete',[id('memory','obsolete')],[]),
   action('memory','merge',[id('memory','duplicate-a'),id('memory','duplicate-b')],[mem('duplicate-a','简短回答')]),
   action('memory','split',[id('memory','mixed')],[mem('paragraphs','长文分段'),mem('units','表格附单位')]),
   action('memory','update',[id('memory','format')],[mem('format','按最新明确要求分段回答')],[id('memory','format'),id('memory','latest-format')]),
   action('candidate','delete',[id('candidate','pending-duplicate')],[]),
   action('skill','delete',[id('skill','obsolete-skill')],[]),
   action('skill','update',[id('skill','inactive-skill')],[skill('inactive-skill','保持未启用状态')],evidence),
   action('skill','merge',[id('skill','merge-a'),id('skill','merge-b')],[skill('merge-a','合并重复的已验证核对步骤')],evidence),
   action('skill','split',[id('skill','mixed-skill')],[skill('check-input','核对输入证据'),skill('check-output','核对输出结果')],evidence),
   action('skill','update',[id('skill','update-skill')],[skill('update-skill','使用已验证的新核对步骤')],evidence),
  ],deferred:[]})
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 for(const [key,text]of [['obsolete','已被新规则替代'],['duplicate-a','简短回答'],['duplicate-b','简短回答'],['mixed','长文分段；表格附单位'],['format','原格式要求'],['latest-format','按最新明确要求分段回答']])await remember(f,'preferences',key,text)
 await remember(f,'experience','verified-experience','已验证的本地核对步骤和结果')
 await recordUsage(f.host.ctx.memory.store,scope,'readCount',{entries:(await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,provenance:{actorId:'PRIVATE_USAGE_ACTOR',sessionId:'PRIVATE_USAGE_SESSION',taskId:'PRIVATE_USAGE_TASK'}})
 await remember(f,'preferences','pending-duplicate','待接受候选',{candidate:true})
 const reflection=f.host.ctx.reflection,m=reflection.maintenance,state=await reflection.state(scope)
 for(const key of ['obsolete-skill','merge-a','merge-b','mixed-skill','update-skill','inactive-skill']){
  const value={active:key!=='inactive-skill',steps:['已验证的本地核对步骤'],reason:'当前任务证据',applicability:'本地证据核对',signature:'signature',revision:1,taskIds:['source-task'],supports:[{taskId:'source-task',memoryKey:'verified-experience'}],memoryKeys:['verified-experience']}
  state.skills[key]=value
  await atomicWrite(join(m.directory,'skills',key,'SKILL.md'),reflection.renderSkill(scope,key,value,0))
 }
 await atomicWrite(join(m.directory,'state.json'),JSON.stringify(state))
 const installed=join(f.host.ctx.runtimePaths.skills,'user-managed','SKILL.md');await atomicWrite(installed,'USER_MANAGED_SKILL_UNCHANGED')
 await m.trigger('manual');await reflection.whenIdle()
 assert.equal(m.status().code,null)
 const prefs=(await f.host.ctx.memory.store.read(scope,{topic:'preferences'})).entries
 assert.deepEqual(prefs.map(row=>row.key).sort(),['duplicate-a','format','latest-format','paragraphs','units'])
 assert.equal(prefs.find(row=>row.key==='format').text,'按最新明确要求分段回答')
 assert.equal(prefs.find(row=>row.key==='duplicate-a').maintenanceSources.length,2)
 assert.equal((await f.host.ctx.memory.store.read(scope,{candidates:true})).entries.length,0)
 const learned=(await reflection.state(scope)).skills
 assert.deepEqual(Object.keys(learned).sort(),['check-input','check-output','inactive-skill','merge-a','update-skill']);assert.equal(learned['update-skill'].revision,2);assert.equal(learned['inactive-skill'].active,false)
 assert.equal(await readFile(installed,'utf8'),'USER_MANAGED_SKILL_UNCHANGED')
 await access(join(m.directory,'skills','obsolete-skill','SKILL.md'))
 const report=await audit(m);assert.equal(report.status,'applied');assert.equal(report.changes.length,10);assert.ok(report.changes.every(row=>row.before.every(value=>value.hash)&&row.evidence.length))
 assert.doesNotMatch(JSON.stringify(report),/长文分段；表格附单位|原格式要求/)
 const before=f.requests.length;await f.close();await f.boot();await f.host.ctx.reflection.whenIdle()
 assert.equal(f.requests.length,before);assert.equal((await f.host.ctx.reflection.state(scope)).skills['update-skill'].revision,2)
 for(const body of f.requests.filter(body=>isIndex(body)||isPlan(body)))assert.doesNotMatch(JSON.stringify(body),/PRIVATE_USAGE_ACTOR|PRIVATE_USAGE_SESSION|PRIVATE_USAGE_TASK/)
})

test('来源版本并发变化或非法动作使整个维护计划拒绝，不能部分应用或晋升候选',async t=>{
 for(const scenario of ['race','unknown','promote','collision','shape','unsupported'])await t.test(scenario,async t=>{
  let f,planCalls=0
  f=await memoryHost(t,async body=>{
   if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)],deferred:[]})
   if(!isPlan(body))return
   planCalls++;const items=input(body).items,first=items.find(row=>row.kind==='memory'),candidate=items.find(row=>row.kind==='candidate')
   const actions=[action('memory','update',[first.id],[{topic:'preferences',key:'original',text:'不得部分应用'}])]
   if(scenario==='race')await remember(f,'preferences','concurrent','并发新增的明确要求')
   if(scenario==='unknown')actions.push(action('memory','delete',['unknown'],[]))
   if(scenario==='promote')actions.push(action('memory','update',[candidate.id],[{topic:'preferences',key:'pending',text:'不得自动晋升'}]))
   if(scenario==='collision')actions[0].outputs[0].key='occupied'
   if(scenario==='shape')actions[0].operation='split'
   if(scenario==='unsupported')actions.push(action('skill','update',[items.find(row=>row.kind==='skill').id],[{key:'supported',guidance:'事项与目标需要实际经验支持；信息来源和正反场景须先核实。',reason:'没有 experience 证据不能使用',applicability:'本地核对',evidenceBacked:true}],[first.id]))
   return reply({actions,deferred:[]})
  },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
  await remember(f,'preferences','original','原始明确要求');await remember(f,'preferences','occupied','其他明确要求');await remember(f,'preferences','pending','未接受候选',{candidate:true})
  if(scenario==='unsupported'){
   await remember(f,'experience','support','实际经验')
   const state=await f.host.ctx.reflection.state(scope);state.skills.supported={active:true,steps:['原步骤'],reason:'实际经验',applicability:'本地核对',revision:1,taskIds:['task'],memoryKeys:['support'],supports:[{taskId:'task',memoryKey:'support'}]};await atomicWrite(join(f.host.ctx.reflection.maintenance.directory,'state.json'),JSON.stringify(state))
  }
  const m=f.host.ctx.reflection.maintenance;await m.trigger('manual');await f.host.ctx.reflection.whenIdle()
  assert.equal(planCalls,1);assert.equal(m.status().status,'failed')
  assert.equal((await f.host.ctx.memory.store.read(scope,{topic:'preferences',key:'original'})).entries[0].text,'原始明确要求')
  assert.equal((await f.host.ctx.memory.store.read(scope,{candidates:true})).entries.length,1)
  assert.equal((await f.host.ctx.memory.store.read(scope,{topic:'preferences',key:'pending'})).entries.length,0)
  assert.equal((await audit(m)).status,'failed')
 })
})

test('维护 journal 中断后恢复同一原子结果，冷启动不重复模型调用或重放动作',async t=>{
 const f=await memoryHost(t,body=>{
  if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)],deferred:[]})
  if(isPlan(body)){const row=input(body).items[0];return reply({actions:[action('memory','update',[row.id],[{topic:row.topic,key:row.key,text:'已验证更新'}])],deferred:[]})}
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 await remember(f,'preferences','style','原始要求')
 const store=f.host.ctx.memory.store,m=f.host.ctx.reflection.maintenance
 store.beforeApply=()=>{throw new Error('simulate interruption after durable journal')}
 await m.trigger('manual');await f.host.ctx.reflection.whenIdle();assert.equal(m.status().code,'MEMORY_COMMIT_UNCERTAIN')
 store.beforeApply=undefined
 assert.equal((await store.read(scope,{topic:'preferences'})).entries[0].text,'已验证更新')
 assert.equal((await audit(m)).status,'applied')
 const before=f.requests.length;await f.close();await f.boot();await f.host.ctx.reflection.whenIdle()
 assert.equal(f.requests.length,before);assert.equal(f.host.ctx.reflection.maintenance.status().status,'applied')
})

test('到期定时器与冷启动到期检查执行集中复盘，已完成空复盘不增加记忆版本',async t=>{
 const entered=Promise.withResolvers()
 const f=await memoryHost(t,body=>{if(isIndex(body)){entered.resolve();return reply({groups:[],deferred:[]})}},{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 await remember(f,'preferences','style','明确长期要求')
 const m=f.host.ctx.reflection.maintenance,before=(await f.host.ctx.memory.store.index(scope)).revision
 const state=await m.state();state.nextDueAt=Date.now()+30;await atomicWrite(m.file,JSON.stringify(state));m.current=state;m.arm()
 await entered.promise;await f.host.ctx.reflection.whenIdle()
 assert.equal((await audit(m)).reason,'periodic');assert.equal((await f.host.ctx.memory.store.index(scope)).revision,before)
 const next=await m.state();assert.ok(next.nextDueAt>Date.now()+6*24*3600000)
 await f.close();next.nextDueAt=0;await atomicWrite(m.file,JSON.stringify(next));const count=f.requests.length;await f.boot();await f.host.ctx.reflection.whenIdle()
 assert.equal(f.requests.length,count+1);assert.equal((await audit(f.host.ctx.reflection.maintenance)).reason,'periodic')
})

test('整理经验同步撤销派生 Skill 和复盘正文，不移动仍在使用的技能文件',async t=>{
 const f=await memoryHost(t,body=>{
  if(isIndex(body)){const row=input(body).items.find(row=>row.kind==='memory');return reply({groups:[[row.id]],deferred:[]})}
  if(isPlan(body))return reply({actions:[action('memory','delete',[input(body).items[0].id],[])],deferred:[]})
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 const m=f.host.ctx.reflection.maintenance,id=hash('completed-event'),key='lesson'
 await remember(f,'experience',key,'需要撤销的旧经验')
 const state={version:1,reviews:{[id]:{memoryKeyVersion:1,status:'done',eventId:'completed-event',taskId:'task',lessons:[{key:'lesson',memoryKey:key,summary:'需要撤销的旧经验'}],destinations:[{memory:{key}}]}},skills:{derived:{active:true,steps:['旧步骤'],reason:'旧经验',applicability:'本地核对',revision:1,taskIds:['task'],memoryKeys:[key],supports:[{taskId:'task',memoryKey:key}]}}}
 await atomicWrite(join(m.directory,'state.json'),JSON.stringify(state));await atomicWrite(join(m.directory,'skills','derived','SKILL.md'),'RUNNING_FILE_RETAINED')
 let archiveCalls=0,lastArchive
 const source={store:{query:async args=>args.kind==='task.get'?{taskId:args.taskId}:{events:[],nextCursor:0,hasMore:false}},ownerActorId:'owner',after:0,pending:new Map(),archivePending:new Map(),onReview:async(_task,report)=>{archiveCalls++;if(archiveCalls===1)throw Object.assign(new Error('archive temporarily unavailable'),{code:'TASK_REVIEW_ARCHIVE_FAILED'});lastArchive=report}}
 f.host.ctx.reflection.sources.add(source)
 await m.trigger('manual');await f.host.ctx.reflection.whenIdle()
 assert.equal(source.archivePending.size,1)
 f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle()
 assert.equal(source.archivePending.size,0);assert.equal(archiveCalls,2);assert.equal(lastArchive.forgotten,true)
 const current=await f.host.ctx.reflection.state(scope);assert.equal(current.forgetGeneration,1);assert.equal(current.skillRevisions.derived,2);assert.deepEqual(current.skills,{});assert.deepEqual(current.reviews[id].lessons,[]);assert.deepEqual(current.reviews[id].destinations,[])
 assert.equal(await readFile(join(m.directory,'skills','derived','SKILL.md'),'utf8'),'RUNNING_FILE_RETAINED')
 assert.doesNotMatch(await readFile(join(m.directory,'reviews',id+'.json'),'utf8'),/需要撤销的旧经验/)
})

test('未获安装级显式启用时，不因普通写入启动自动整理',async t=>{
 const f=await memoryHost(t,()=>undefined,{hostConfig:{reflection:{maintenance:{}}}}),a=await f.agent('owner',{actorId:'owner'})
 await f.say(a.agent,'记住 preferences/style：简短回答');await f.host.ctx.reflection.whenIdle()
 assert.equal(f.host.ctx.reflection.maintenance.status().enabled,false)
 assert.equal(f.requests.filter(body=>isIndex(body)||isPlan(body)).length,0)
 assert.equal((await f.host.ctx.memory.read(a.agent,{topic:'preferences'})).entries[0].text,'简短回答')
})

test('既有凭据格式和显式过期项在本地清理，绝不把凭据正文发给整理模型',async t=>{
 const f=await memoryHost(t,()=>{assert.fail('本地已知清理不需要模型请求')},{hostConfig:{reflection:{maintenance:{enabled:true}}}}),store=f.host.ctx.memory.store
 await remember(f,'experience','old-import','原导入内容');await remember(f,'experience','expired','已过期内容')
 await store.transaction(scope,s=>{const entries=s.topics.get('experience').entries;entries.find(row=>row.key==='old-import').text='password=PRIVATE_OLD_CREDENTIAL';entries.find(row=>row.key==='expired').expiresAt='2000-01-01T00:00:00.000Z';s.mark()})
 const reflection=f.host.ctx.reflection,m=reflection.maintenance,state=await reflection.state(scope)
 state.skills['old-supported']={active:true,guidance:'按当前证据核对结果',reason:'历史经验',applicability:'本地核对',revision:1,taskIds:['old-task'],memoryKeys:['old-import'],supports:[{taskId:'old-task',memoryKey:'old-import'}]}
 await atomicWrite(join(m.directory,'state.json'),JSON.stringify(state))
 await m.trigger('manual');await reflection.whenIdle()
 assert.deepEqual((await reflection.state(scope)).skills,{})
 assert.equal((await store.read(scope,{topic:'experience'})).entries.length,0)
 assert.equal(f.requests.length,0);assert.equal((await audit(m)).changes.length,3)
 assert.doesNotMatch(JSON.stringify(await audit(m)),/PRIVATE_OLD_CREDENTIAL/)
 await assert.rejects(store.transaction(scope,s=>{s.writes.push(['evolution/../../outside.json','forbidden'])}),{code:'MEMORY_JOURNAL_INVALID'})
 await assert.rejects(access(join(store.directory(scope),'pending.json')),{code:'ENOENT'})
})

test('Host 关闭取消并排空正在推理的维护，未提交计划不会应用',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await memoryHost(t,async body=>{
  if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)],deferred:[]})
  if(isPlan(body)){entered.resolve();await release.promise;return reply({actions:[action('memory','delete',[input(body).items[0].id],[])],deferred:[]})}
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 await remember(f,'preferences','style','取消时必须保留')
 const m=f.host.ctx.reflection.maintenance,job=m.trigger('manual');await entered.promise
 const closing=f.close();release.resolve();await closing;await job
 assert.equal(m.status().running,false);assert.equal(m.status().status,'cancelled')
 assert.match(await readFile(join(m.store.directory(scope),'categories','preferences','entries','style.md'),'utf8'),/取消时必须保留/)
 assert.equal((await audit(m)).status,'cancelled')
})

const routerArgs=(key,operationId,expectedRevision)=>({action:'upsert',key,operationId,expectedRevision,source:{sessionId:'router',messageId:'authenticated-source',actor:hash('owner'),quoteSha256:hash('Explicit verified scenario')},steps:['Identify the objective and inspect relevant evidence'],reason:'Verified scenario with an authenticated source',applicability:'Evidence-guided local changes'})
const guidance='事项：核对证据。目标：结论与当前材料一致。主要环节：识别目标，判断场景，选择核对方式。信息：从当前源文件和回读结果获取。正例：发现材料变化后调整核对方式。反例：忽略场景机械照搬旧命令。'

test('Router 独立来源技能经真实 creator 维护，保留来源、previous、墓碑和旧操作幂等',async t=>{
 const f=await memoryHost(t,body=>{
  if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)]})
  if(isPlan(body)){const row=input(body).items[0];return reply({actions:[action('skill','update',[row.id],[{key:row.key,guidance,reason:'完善已验证场景',applicability:'依据当前证据核对结果',evidenceBacked:true}]) ]})}
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 const r=f.host.ctx.reflection,args=routerArgs('router-only','original-create',0)
 await r.mutateSkill(scope,{...args,model:f.config.model})
 const original=(await r.state(scope)).skills['router-only'],marker=r.skillMarker(scope,'router-only',original)
 await r.maintenance.trigger('manual');await r.whenIdle()
 assert.equal(r.maintenance.status().code,null)
 const current=(await r.state(scope)).skills['router-only']
 assert.equal(current.revision,2);assert.deepEqual(current.source,original.source);assert.equal(current.origin,'router');assert.ok(current.previous.text.includes(original.body));assert.equal(current.body,guidance)
 assert.equal(current.generation.creator.name,'skill-creator');assert.ok(current.generation.creator.callId)
 assert.equal(await r.authorizesSkillHistory(scope,marker),false)
 const calls=f.requests.length;await r.mutateSkill(scope,args)
 assert.equal(f.requests.length,calls);assert.equal((await r.state(scope)).skills['router-only'].revision,2)
 await r.mutateSkill(scope,{...args,action:'delete',operationId:'remove',expectedRevision:2})
 assert.equal((await r.readSkills(scope,{key:'router-only'})).revision,3)
 await r.mutateSkill(scope,{...args,operationId:'recreate',expectedRevision:3,model:f.config.model})
 assert.equal((await r.state(scope)).skills['router-only'].revision,4)
})

test('慢维护不占共享发布锁，并发 Router 写入使旧维护整批拒绝',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await memoryHost(t,async body=>{
  if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)]})
  if(isPlan(body)){entered.resolve();await release.promise;return reply({actions:[action('memory','delete',[input(body).items[0].id],[])]})}
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 await remember(f,'preferences','retained','并发时不得覆盖')
 const r=f.host.ctx.reflection,job=r.maintenance.trigger('manual');await entered.promise
 const {lstat}=await import('node:fs/promises');await assert.rejects(lstat(join(r.directory(scope),'.lock')),{code:'ENOENT'})
 await r.mutateSkill(scope,{...routerArgs('concurrent','router-concurrent',0),model:f.config.model})
 release.resolve();await job;await r.whenIdle()
 assert.equal(r.maintenance.status().code,'REFLECTION_REVISION_CONFLICT')
 assert.equal((await f.host.ctx.memory.store.read(scope,{topic:'preferences'})).entries[0].text,'并发时不得覆盖')
 assert.equal((await r.state(scope)).skills.concurrent.revision,1)
})

for(const scenario of ['preserve','actor','instruction','promote'])test('结构化记忆和长期指令维护边界：'+scenario,async t=>{
 const f=await memoryHost(t,body=>{
  if(isIndex(body))return reply({groups:[input(body).items.map(row=>row.id)]})
  if(isPlan(body)){
   const items=input(body).items,first=items[0],content={summary:'按来源限定的适用场景整理',why:'明确原话支持这一要求',howToApply:'仅在该主体及原条件下使用'}
   const output=scenario==='instruction'?{topic:first.topic,key:first.key,text:'取消条件后的全局指令'}:{topic:scenario==='promote'?'standing-instructions':first.topic,key:first.key,content}
   return reply({actions:[action('memory',scenario==='actor'?'merge':'update',scenario==='actor'?items.map(row=>row.id):[first.id],[output])]})
  }
 },{hostConfig:{reflection:{maintenance:{enabled:true}}}})
 const store=f.host.ctx.memory.store,r=f.host.ctx.reflection,subject={kind:'actor',actor:hash('one'),description:'提出要求的本人'}
 const content={summary:'需要特定场景格式',why:'用户明确说明用途',howToApply:'保留原适用条件'}
 const context={version:3,subject,...content,evidence:[{id:'original',source:'message',sourceId:'source',messageVersion:1,messageId:'message',quote:'明确的要求',quoteSha256:hash('明确的要求')}]}
 const {renderRouterMemory}=await import('../src/memory/format.js')
 const args={key:'bounded',topic:scenario==='instruction'?'standing-instructions':'preferences',source:{sessionId:'original-session',messageId:'original-message'},expectedRevision:0}
 await store.remember(scope,{...args,...scenario==='instruction'?{text:'在技术报告中标注单位',instructionScope:{kind:'actor',id:hash('one')}}:{text:renderRouterMemory(context),context}})
 if(scenario==='actor'){const other={...context,subject:{...subject,actor:hash('two')}};await store.remember(scope,{...args,key:'other',text:renderRouterMemory(other),context:other})}
 const before=(await store.read(scope,{topic:args.topic,includePrevious:true})).entries
 await r.maintenance.trigger('manual');await r.whenIdle()
 const saved=(await store.read(scope,{topic:args.topic,includePrevious:true})).entries
 if(scenario==='preserve'){
  assert.equal(r.maintenance.status().code,null);assert.equal(saved[0].context.version,3);assert.deepEqual(saved[0].context.subject,subject);assert.deepEqual(saved[0].context.evidence,context.evidence);assert.deepEqual(saved[0].source,before[0].source);assert.equal(saved[0].previous.text,before[0].text);assert.equal(saved[0].text,renderRouterMemory(saved[0].context))
 }else{assert.equal(r.maintenance.status().status,'failed');assert.deepEqual(saved,before)}
})

test('候选实际持久化也触发局部维护，但不会晋升为已接受记忆',async t=>{
 const f=await memoryHost(t,body=>{
  if(JSON.stringify(body.messages).includes('NIGHT_BOT_MEMORY_CANDIDATES')){const row=input(body)[0];return reply({candidates:[{topic:'preferences',key:'format',messageId:row.messageId,quote:row.text}]})}
  if(isIndex(body)){assert.equal(input(body).items[0].kind,'candidate');return reply({groups:[[input(body).items[0].id]]})}
  if(isPlan(body))return reply({actions:[],deferred:['候选需保留待用户确认']})
 },{background:true,hostConfig:{reflection:{maintenance:{enabled:true}}}})
 const a=await f.agent('candidate-author',{actorId:'author'})
 await f.say(a.agent,'我长期偏好文字说明');await f.host.ctx.reflection.whenIdle()
 assert.equal(f.host.ctx.reflection.maintenance.status().status,'deferred')
 assert.equal((await f.host.ctx.memory.store.read(scope,{candidates:true})).entries.length,1)
 assert.equal((await f.host.ctx.memory.store.read(scope,{topic:'preferences'})).entries.length,0)
})
