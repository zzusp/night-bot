import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {coreToolInput,coreToolOutput,coreToolPolicyNames} from '../server/core-tool-activity.js'
import {communicationGuidanceReadTool} from '../../../src/channels/message-safety.js'
import {taskSessionView} from '../server/session-view.js'

const body=selected=>JSON.parse(selected.text)
const read=path=>readFile(new URL('../../../'+path,import.meta.url),'utf8')
test('native/platform schedule declarations, and communication guidance, each address an explicit projection policy',async()=>{
  const sources=await Promise.all(['src/native-tool-schedule.js','src/channels/resident-router-business.js','src/channels/message-safety.js'].map(read))
  const names=sources.flatMap(source=>[...source.matchAll(/name:\s*['"]((?:platform_)?schedule_[a-z]+|communication_guidance_read)['"]/g)].map(match=>match[1]))
  assert.equal(new Set(names).size,9)
  for(const name of names) assert.ok(coreToolPolicyNames.includes(name),name)
})
test('all schedule families expose real storage/readback, hide management IDs and distinguish empty lists',()=>{
  const sample={title:'看进度',timezone:'Asia/Shanghai',status:'scheduled',every_seconds:600,prompt:'PRIVATE_PROMPT',stopWhen:{taskIds:['PRIVATE_TASK']},scheduleId:'PRIVATE_SCHEDULE'}
  const native={kind:'weekly',title:'写周报',state:'scheduled',timeZone:'Asia/Shanghai',time:'13:00',weekdays:[1,3],scheduledAt:'2026-11-25T05:00:00Z',id:'PRIVATE_NATIVE_ID'}
  for(const name of ['schedule_list','platform_schedule_list']){
    assert.deepEqual(body(coreToolOutput(name,[])),{scheduleCount:0,schedules:[]})
    const actual=body(coreToolOutput(name,[sample,native]))
    assert.equal(actual.schedules[0].everySeconds,600)
    assert.equal(actual.schedules[0].stopTaskCount,1)
    assert.deepEqual(actual.schedules[1].weekdays,[1,3])
    assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_/)
  }
  for(const name of ['schedule_create','schedule_update','platform_schedule_submit','platform_schedule_update']){
    assert.equal(body(coreToolOutput(name,native)).state,'scheduled')
    assert.ok(coreToolInput(name,{id:'PRIVATE_ID',...sample}))
  }
  assert.deepEqual(body(coreToolOutput('schedule_delete',{deleted:false,code:'schedule_not_found',id:'PRIVATE_ID'})),{code:'schedule_not_found',deleted:false})
  assert.deepEqual(body(coreToolOutput('platform_schedule_delete',{status:'cancelled',scheduleId:'PRIVATE_ID'})),{state:'cancelled'})
})
test('authenticated task tool rows report actual guidance receipt, intentional empty, withheld, and unpaired separately',async()=>{
  const name='communication_guidance_read', extension='unknown_extension'
  const call=(id,name,args={})=>({role:'assistant',content:[{type:'toolCall',name,id,arguments:args}]})
  const result=(id,toolName,content)=>({role:'toolResult',toolName,toolCallId:id,isError:false,content:content? [{type:'text',text:JSON.stringify(content)}]:[]})
  const tool=communicationGuidanceReadTool(), guide=await tool.execute(), exact=tool.output.render({},guide)
  const native = (id,value,content) => ({...result(id,name),content,details:{nativeResult:{isError:false,value,content}}})
  const altered={id:guide.id,content:'PRIVATE_FAKE'}, alteredContent=tool.output.render({},altered)
  const messages=[call('guide',name),native('guide',guide,exact),
    call('fake',name),native('fake',altered,alteredContent),
    call('extension',extension,{password:'PRIVATE_ARGS'}),result('extension',extension,{text:'PRIVATE_OUTPUT'}),
    call('shell','bash',{command:'true'}),result('shell','bash',null),result('orphan',name,{id:'communication/v1',content:'PRIVATE_ORPHAN'})]
  const task={taskId:'task',session:{sessionId:'s',sessionBound:true}}
  const snapshot={header:{id:'s'},entries:[{id:'last'}],audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task',sessionId:'s'}}],
    context:{projection:{entries:messages.map((message,i)=>({sourceEntry:{id:String(i),type:'message',message},messages:[message]}))}}}
  const page=await taskSessionView({task,persistence:{readNative:async()=>snapshot}})
  const [valid,wrong,unknown,empty,unpaired]=page.items.filter(row=>row.kind==='tool-result')
  assert.equal(valid.text,guide.content)
  assert.equal(valid.resourceContent,true)
  assert.equal(valid.detailState,undefined)
  assert.equal(wrong.detailState,'withheld')
  assert.equal(unknown.detailState,'withheld')
  assert.equal(empty.detailState,'empty')
  assert.equal(unpaired.detailState,'not-recorded')
  assert.doesNotMatch(JSON.stringify(page),/PRIVATE_/)
})
