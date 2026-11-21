import test from 'node:test'
import assert from 'node:assert/strict'
import {hash} from '../src/memory/format.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'

test('authenticated channel Router edits a learned Skill through the existing tool without creating a task', {timeout:nativeTestTimeout(90000)},async t=>{
 const key='fixture-repository-check',newKey='fixture-verify-checkout'
 const description='Use before changing a local repository to protect existing edits'
 const instructions='# Verify the checkout\n\nRead the current status, preserve existing changes, and confirm the target branch.'
 const sources=[
  {id:'seed',text:'把在更改前检查本地仓库整理成复用技能。',patch:{key,expectedRevision:0,steps:['先检查本地改动'],reason:'避免覆盖现有改动',applicability:'本地仓库操作'}},
  {id:'edit',text:'调整刚才的技能名称、触发描述和正文，强调核对目标分支并保护已有改动。',patch:{key,newKey,expectedRevision:1,description,body:instructions}},
  {id:'read',text:'核对刚修改的技能。',query:{key:newKey}},
 ]
 const steps=new Map(),outcomes=new Map()
 const h=await residentRouterHost(t,request=>{
  if(!requestTools(request).includes('resident_router_settle'))return {text:'No additional action'}
  const {events}=requestEnvelope(request,'Router 请求：'),event=events.find(item=>item.source)
  const source=event?.source,plan=sources.find(item=>item.id===source?.messageId)
  assert.ok(plan)
  const step=steps.get(plan.id)??0;steps.set(plan.id,step+1)
  if(step===0)return plan.query?{tool:'resident_skill_query',args:plan.query}:{tool:'resident_skill_mutate',args:{action:'upsert',operationId:'fixture:'+plan.id,sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,...plan.patch}}
  if(step===1){
   outcomes.set(plan.id,JSON.parse(request.messages.at(-1).content))
   return {tool:'resident_router_reply',args:{operationId:'reply:'+plan.id,sourceId:source.sourceId,messageVersion:source.version,text:'学习技能维护已结束。'}}
  }
  if(step===2){return {tool:'resident_router_settle',args:{operationId:'settle:'+plan.id,eventIds:events.map(item=>item.id),noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',reason:'直接维护并回读学习技能，不需建任务。',sourceQuote:source.text}]}}
  }
  return {text:'Completed directly'}
 },{strictModelDecisions:true})
 for(const {id,text}of sources){await h.receive(channelMessage(id,{text}));await h.service.whenIdle()}
 assert.equal(outcomes.get('seed')?.persisted,true)
 assert.equal(outcomes.get('edit')?.persisted,true)
 assert.equal(outcomes.get('edit')?.previousKey,key)
 assert.equal(outcomes.get('edit')?.generation.creator.name,'skill-creator')
 const edited=outcomes.get('read')?.entries[0]
 assert.equal(edited?.name,'learned-'+newKey)
 assert.equal(edited?.applicability,description)
 assert.equal(edited?.body,instructions)
 const scope={kind:'bot',id:hash('bot:shared')}
 assert.equal((await h.host.ctx.reflection.readSkills(scope,{key})).entries.length,0)
 assert.deepEqual(await h.query('task.list'),[])
})
