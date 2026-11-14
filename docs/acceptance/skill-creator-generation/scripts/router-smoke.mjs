import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from '../../../../test/fixtures/resident-router-host.js'
import {hash} from '../../../../src/memory/format.js'
const cleanups=[],t={after:fn=>cleanups.push(fn),diagnostic:message=>console.error(message)}
let phase=0
try{
 const h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(names.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Process one synthetic local instruction'}))}}}
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(row=>row.source)?.source
   if(phase++===0)return {tool:'resident_skill_mutate',args:{operationId:'smoke-create',sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,action:'upsert',key:'local-evidence',steps:['Inspect local evidence','Read back the result'],reason:'A reusable bounded local procedure',applicability:'Local evidence-first checks',expectedRevision:0}}
   if(phase===2)return {tool:'resident_router_settle',args:{eventIds:input.events.map(row=>row.id),operationId:'smoke-settle'}}
   return {text:'The managed local skill is published.'}
  }
  return {text:'No additional execution.'}
 },{hostOptions:{hostConfig:{reflection:{enabled:false}}}})
 await h.receive(channelMessage('creator-smoke',{text:'Create a reusable skill for bounded local evidence checks.'}));await h.service.whenIdle()
 const result=h.results.find(row=>row.name==='resident_skill_mutate')?.result
 assert.equal(result?.isError,false,JSON.stringify(result))
 const scope={kind:'bot',id:hash('bot:shared')},value=(await h.host.ctx.reflection.state(scope)).skills['local-evidence']
 assert.equal(value.generation.creator.source,'bundled');assert.ok(value.generation.creator.callId)
 const file=await readFile(join(h.host.ctx.reflection.directory(scope),'skills','local-evidence','SKILL.md'),'utf8');assert.match(file,/Inspect local evidence/)
 const viewer=await h.agent('smoke-viewer',{actorId:'reader'}),loaded=await h.host.ctx.skills.get('learned-local-evidence',{scope:viewer.agent});assert.equal(loaded.content,file);await viewer.dispose()
 const tasks=await h.query('task.list');assert.equal(tasks.length,0);assert.equal(h.sent.length,0)
 const before=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,before)
 console.log(JSON.stringify({actualRouterTool:'resident_skill_mutate',creator:value.generation.creator,generatedBodyPublished:true,catalogMatchesFile:true,coldRestartNoReplay:true,emptyTasks:tasks.length,realVendorMessages:0}))
}finally{for(const cleanup of cleanups)await cleanup()}
