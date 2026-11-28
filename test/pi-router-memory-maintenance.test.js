import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {channelMessage,eventually,requestEnvelope,requestText,residentRouterHost} from './fixtures/resident-router-host.js'
import {memoryScope} from '../src/memory/scope.js'
import {recordUsage} from '../src/memory/evolution.js'
import {atomicWrite} from '../src/runtime/files.js'

const scope=memoryScope({actorId:'host'})
const reply=value=>({text:JSON.stringify(value)})
const input=body=>JSON.parse(body.messages.findLast(row=>row.role==='user').content)
test('two-hour Router wake curates shared memory and learned skills once, without blocking Router or replay on restart',{timeout:45000},async t=>{
 const hold=Promise.withResolvers();t.after(()=>hold.resolve())
 let h,indexCalls=0,planCalls=0,routerWakes=0
 h=await residentRouterHost(t,async body=>{
  const text=requestText(body).join('\n')
  if(text.includes('NIGHT_BOT_MEMORY_MAINTENANCE_INDEX')){
   const data=input(body);indexCalls++
   assert.equal(body.tools,undefined)
   assert.equal(data.reason,'router-self-check')
   assert.equal(data.items.some(row=>row.key==='keep-preference'),false)
   assert.ok(data.usage.skillEntryTrackingSince)
   assert.equal(data.usage.skills.find(row=>row.id==='skill:rare-but-valid').loadCount,1)
   assert.equal(data.usage.skills.find(row=>row.id==='skill:redundant').loadCount,0)
   await hold.promise
   return reply({groups:[data.items.map(row=>row.id)],deferred:[]})
  }
  if(text.includes('NIGHT_BOT_MEMORY_MAINTENANCE_PLAN')){
   planCalls++
   const {items}=input(body),id=key=>items.find(row=>row.key===key).id
   return reply({actions:[
    {kind:'memory',operation:'update',sources:[id('original')],evidence:[id('original'),id('duplicate')],reason:'明确生效条件',outputs:[{topic:'experience',key:'original',text:'只用于已核验的 CSV 表头；不适用于 XLSX。'}]},
    {kind:'memory',operation:'delete',sources:[id('duplicate')],evidence:[id('original'),id('duplicate')],reason:'内容重复且没有独有条件',outputs:[]},
    {kind:'skill',operation:'delete',sources:[id('redundant')],evidence:[id('redundant'),id('rare-but-valid')],reason:'与已保留的可用 Skill 完全重复',outputs:[]},
   ],deferred:[]})
  }
  const envelope=requestEnvelope(body,'Router 请求：')
  if(!envelope||body.messages.at(-1)?.role==='tool')return {text:'已处理'}
  routerWakes+=Number(envelope.events.some(row=>row.kind==='router.self-check'))
  return {tool:'resident_router_settle',args:{operationId:'settle-'+envelope.events[0].id,eventIds:envelope.events.map(row=>row.id),noTaskDispositions:envelope.events.filter(row=>row.source).map(row=>({eventId:row.id,outcome:'context-only',reason:'仅背景',sourceQuote:row.source.text}))}}
 },{config:{globalRouter:true}})
 const reflection=h.host.ctx.reflection,m=reflection.maintenance,store=h.host.ctx.memory.store
 for(const [topic,key,text]of [['experience','original','只用于已核验的 CSV 表头。'],['experience','duplicate','只用于已核验的 CSV 表头。'],['preferences','keep-preference','关键场景仍要确认版本。']])
  await store.remember(scope,{topic,key,text,source:{sessionId:'fixture',messageId:key}})
 const initial=await reflection.state(scope)
 for(const key of ['rare-but-valid','redundant'])initial.skills[key]={active:true,steps:['核查 CSV 表头'],reason:'已核验证据',applicability:'CSV 检查',revision:1,updatedAt:new Date().toISOString(),supports:[{taskId:'fixture',memoryKey:'original'}]}
 await atomicWrite(join(m.directory,'state.json'),JSON.stringify(initial))
 await recordUsage(store,scope,'loadCount',{skillKey:'rare-but-valid'})
 const installed=join(h.host.ctx.runtimePaths.skills,'manual','SKILL.md')
 await atomicWrite(installed,'INSTALLER_MANAGED')
 const now=Date.now()
 await h.service.routerSelfCheck(now);const {nextAt}=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(nextAt-1);assert.equal(indexCalls,0)
 try{
  await h.service.routerSelfCheck(nextAt)
  await eventually(()=>routerWakes===1&&indexCalls===1,'Router and background maintenance both run')
  await h.receive(channelMessage('live-during-maintenance'))
  await h.service.whenIdle()
  assert.equal(planCalls,0)
  assert.equal(h.sent.length,0)
 }finally{hold.resolve()}
 await reflection.whenIdle()
 assert.equal(planCalls,1)
 assert.deepEqual((await store.read(scope,{topic:'experience'})).entries.map(row=>row.text),['只用于已核验的 CSV 表头；不适用于 XLSX。'])
 assert.equal((await store.read(scope,{topic:'preferences'})).entries[0].key,'keep-preference')
 assert.deepEqual(Object.keys((await reflection.state(scope)).skills),['rare-but-valid'])
 assert.equal(await readFile(installed,'utf8'),'INSTALLER_MANAGED')
 assert.equal((await m.state()).lastSelfCheckAt,nextAt)
 await h.restart();await h.host.ctx.reflection.whenIdle()
 assert.equal(indexCalls,1)
})

test('a restart after the self-check clock commits but before the cleaner starts picks up that occurrence',{timeout:45000},async t=>{
 let indexCalls=0
 const h=await residentRouterHost(t,body=>{
  if(requestText(body).join('\n').includes('NIGHT_BOT_MEMORY_MAINTENANCE_INDEX')){
   indexCalls++;return reply({groups:[],deferred:[]})
  }
  const envelope=requestEnvelope(body,'Router 请求：')
  return envelope&&body.messages.at(-1)?.role!=='tool'?{tool:'resident_router_settle',args:{operationId:'recover-'+envelope.events[0].id,eventIds:envelope.events.map(row=>row.id)}}:{text:'完成'}
 },{config:{globalRouter:true}})
 await h.host.ctx.memory.store.remember(scope,{topic:'experience',key:'check',text:'核对版本号。',source:{sessionId:'fixture',messageId:'source'}})
 const now=Date.now()
 await h.service.routerSelfCheck(now-2*60*60*1000)
 const {nextAt}=await h.query('router.self-check.clock')
 // Simulate losing the in-process handoff after the durable wake was committed.
 h.host.ctx.reflection.maintenance.scheduleSelfCheck=()=>{}
 await h.service.routerSelfCheck(nextAt)
 await h.service.whenIdle()
 assert.equal(indexCalls,0)
 assert.equal((await h.query('router.self-check.clock')).lastOccurrenceAt,nextAt)
 await h.restart()
 await h.host.ctx.reflection.whenIdle()
 assert.equal(indexCalls,1)
 assert.equal((await h.host.ctx.reflection.maintenance.state()).lastSelfCheckAt,nextAt)
})
