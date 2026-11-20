import test from 'node:test'
import assert from 'node:assert/strict'
import {hash} from '../src/memory/format.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools} from './fixtures/resident-router-host.js'

test('Router keeps a requested dated snapshot separate and updates the matching reusable Skill', {timeout:nativeTestTimeout(90000)}, async t=>{
 const key='fixture-inventory-crosscheck', snapshotKey='fixture-inventory-2026-04-15', lessonKey='fixture-inventory-discrepancy'
 const report='2026-04-15 18:00 双人盘点演示仓 A 区：蓝箱 24 件；抽点结果与盘点单一致。'
 const save='请记住上面这次盘点的结果，留作下次比较的历史记录。'
 const seed='请把核对实物与盘点单的方法整理成演示仓复核技能。'
 const learned='演示仓复核时，盘点单和复点不一致；按批次隔离复点后确认标签串批，修正标签再复点，结果一致。把这个经验记下来，更新原来的复核技能。'
 const priorSteps=['核对同一库区和批次','比较实物数与盘点单']
 const updatedSteps=[...priorSteps,'有差异时按批次隔离复点，先核标签；查不清就保留差异，不修改数量','证实标签有误且有权处理时更正；独立复点并确认实物数与盘点单一致']
 const applicability='有可比盘点单的库区实物复核；不适用于未完成或范围不同的盘点'
 const reason='隔离批次后复点确认是标签串批，更正并独立复点后与盘点单相符；不应把未核明的差异直接当作数量错误。'
 const steps=new Map(),outcomes={};let h,previous,policyChecked=false
 const toolResult=body=>JSON.parse(body.messages.at(-1).content)
 const evidence=(row,id,quote=row.text)=>({id,source:'message',sourceId:row.sourceId,messageVersion:row.version,quote})
 h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No additional work'}
  const input=requestEnvelope(body,'Router 请求：')
  const event=input.events.find(row=>row.source),source=event?.source
  assert.ok(source)
  const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
  const tool=(name,args)=>({tool:name,args:{sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,...args}})
  const remember=(memoryKey,memory)=>tool('resident_memory_remember',{topic:'projects',key:memoryKey,expectedRevision:0,memory})
  const skill=(revision,skills)=>tool('resident_skill_mutate',{operationId:'skill:'+source.messageId,action:'upsert',key,expectedRevision:revision,steps:skills,applicability,reason})
  const settle=(replied=false)=>({tool:'resident_router_settle',args:{operationId:'settle:'+source.messageId,eventIds:input.events.map(row=>row.id),
    noTaskDispositions:[{eventId:event.id,outcome:replied?'handled-inline':'context-only',reason:replied?'记录已写入并回读。':'仅供已核实的历史背景，不是交办。',sourceQuote:source.text}]}})
  const ack=text=>({tool:'resident_router_reply',args:{operationId:'ack:'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,text}})
  switch(source.messageId){
   case 'dated-report':
    return step===0?settle():{text:'Context retained'}
   case 'save-dated-snapshot':
    if(step===0){
     const prompt=requestText(body).join('\n')
     assert.match(prompt,/权威.{0,12}稳定|稳定.{0,12}权威/)
     assert.match(prompt,/快照.{0,60}(?:日期|时间)|(?:日期|时间).{0,60}快照/)
     policyChecked=true
     return remember(snapshotKey,{summary:'2026-04-15 18:00，演示仓 A 区的蓝箱盘点为 24 件。',
      why:'双人盘点，抽点与同次盘点单一致。',howToApply:'仅作为该时间和库区的对比基线；现有数量要重新盘点。',
      appliesTo:{kind:'context',description:'演示仓 A 区的历史盘点快照，不表示当前库存。'},evidence:[evidence(source,'request'),evidence(previous,'verified-report')]})
    }
    if(step===1){outcomes.snapshot=toolResult(body);assert.equal(outcomes.snapshot.persisted,true);return ack('已保存 4 月 15 日 A 区的盘点记录，下次可以拿来对比。')}
    return step===2?settle(true):{text:'Snapshot stored'}
   case 'seed-inventory-skill':
    if(step===0)return skill(0,priorSteps)
    if(step===1){outcomes.seed=toolResult(body);assert.equal(outcomes.seed.revision,1);return ack('已保存盘点复核方法。')}
    return step===2?settle(true):{text:'Skill seeded'}
   case 'learn-inventory-discrepancy':
    if(step===0)return {tool:'resident_skill_query',args:{}}
    if(step===1){
     const result=toolResult(body)
     assert.equal(result.entries.length,1);assert.equal(result.entries[0].key,key)
     assert.equal(result.entries[0].revision,1)
     return remember(lessonKey,{summary:'同批库存账实不符时，先隔离复点并核对批次标签；演示中的差异由串批标签造成。',
      why:reason,howToApply:'库区、时间和批次口径一致时再比对；标签未核实不调整数量；更正后独立复点并比对盘点单。',
      appliesTo:{kind:'context',description:'同批号账实差异的复核，不授予库存或标签写入权限。'},evidence:[evidence(source,'verified-discrepancy')]})
    }
    if(step===2){outcomes.lesson=toolResult(body);assert.equal(outcomes.lesson.persisted,true);return skill(1,updatedSteps)}
    if(step===3){outcomes.skill=toolResult(body);assert.equal(outcomes.skill.revision,2);return ack('已记下这个排查经验，并更新了原来的复核技能。')}
    return step===4?settle(true):{text:'Reusable learning stored'}
   default: throw Error('Unexpected fixture source '+source.messageId)
  }
 },{strictModelDecisions:true})
 const scope={kind:'bot',id:hash('bot:shared')}
 await h.receive(channelMessage('dated-report',{text:report}));await h.service.whenIdle()
 previous=(await h.query('source.list')).find(row=>row.messageId==='dated-report')
 assert.ok(previous)
 await h.receive(channelMessage('save-dated-snapshot',{text:save}));await h.service.whenIdle()
 assert.equal(policyChecked,true)
 assert.deepEqual((await h.host.ctx.reflection.readSkills(scope,{})).entries,[],'a dated snapshot is not a skill')
 await h.receive(channelMessage('seed-inventory-skill',{text:seed}));await h.service.whenIdle()
 await h.receive(channelMessage('learn-inventory-discrepancy',{text:learned}));await h.service.whenIdle()
 const saved=(await h.host.ctx.memory.store.read(scope,{topic:'projects',includeSources:true})).entries
 const snapshot=saved.find(row=>row.key===snapshotKey),lesson=saved.find(row=>row.key===lessonKey)
 assert.match(snapshot.text,/2026-04-15.*A 区.*24 件/);assert.match(snapshot.text,/现有数量要重新盘点/)
 assert.equal(snapshot.context.evidence.find(row=>row.id==='verified-report').sourceId,previous.sourceId)
 assert.match(lesson.text,/先隔离复点/);assert.match(lesson.text,/独立复点并比对盘点单/)
 assert.doesNotMatch(lesson.text,/2026-04-15|24 件/)
 const skills=(await h.host.ctx.reflection.readSkills(scope,{})).entries
 assert.deepEqual(skills.map(row=>[row.key,row.revision]),[[key,2]])
 const updated=(await h.host.ctx.reflection.readSkills(scope,{key})).entries[0]
 assert.deepEqual(updated.steps,updatedSteps)
 assert.deepEqual(await h.query('task.list'),[])
 assert.equal(h.sent.length,3)
})
