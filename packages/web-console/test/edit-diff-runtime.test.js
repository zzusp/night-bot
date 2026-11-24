import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost, channelMessage, requestEnvelope, requestTools} from '../../../test/fixtures/resident-router-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {createWebConsole} from '../server/plugin.js'
import {parsePiEditDiff} from '../src/edit-diff.ts'

test('real task Pi edit shows only the committed paired numbered diff via authenticated history', {timeout:nativeTestTimeout(40000)}, async t => {
 const taskId='edit-transcript-fixture',path='work/fixture.ts',privatePath='work/private-fixture.ts'
 const oldText='const value = 1;',newText='const value = 2;\nconst ready = true;'
 const text=['// start','// neighboring context',oldText,'console.log(value);','// end',''].join('\n')
 const secret='ghp_fixtureNeverPublic123456789'
 const secretFile='// auth token below\nconst access_token = "'+secret+'";\n'+oldText+'\n'
 const calls=[
  {tool:'write',args:{path,content:text}}, {tool:'read',args:{path}},
  {tool:'edit',args:{path,edits:[{oldText,newText}]}},
  {tool:'edit',args:{path,edits:[{oldText:'not present anywhere',newText:'not applied'}]}},
  {tool:'write',args:{path:privatePath,content:secretFile}}, {tool:'read',args:{path:privatePath}},
  {tool:'edit',args:{path:privatePath,edits:[{oldText,newText}]}},
 ]
 let step=0,planned=false
 const h=await residentRouterHost(t, body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')) return calls[step++]??{tool:'task_result',args:{decision:{action:'complete',summary:'Verified file changes',evidence:[],limitations:[]}}}
  if(!tools.includes('resident_router_settle'))return {text:'Ready'}
  const input=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  if(!planned){planned=true;const source=input.events.find(event=>event.source).source
   return {tool:'resident_task_plan',args:{operationId:'plan-fixture-edit',sourceId:source.sourceId,messageVersion:source.version,
    tasks:[{taskId,title:'Fixture edit',objective:'Check edit projection',requirements:[],handoff:'Check fixture labels.'}],dependencies:[]}}}
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 },{strictModelDecisions:true})
 await h.receive(channelMessage('verified-edit'))
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.status,'completed')
 const snapshot=await h.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 const edits=snapshot.entries.filter(e=>e.message?.role==='toolResult'&&e.message?.toolName==='edit').map(e=>e.message)
 assert.deepEqual(edits.map(edit=>edit.isError),[false,true,false],JSON.stringify(h.results.filter(row=>['write','read','edit'].includes(row.name)).map(row=>[row.name,row.result.error?.message])))
 assert.match(edits[0].details.nativeResult.value.details.patch,/^--- work\/fixture\.ts/m)
 assert.match(edits[2].details.nativeResult.value.details.diff,new RegExp(secret))
 const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'web-edit-test',senderId:'fixture-operator',port:0},
  getApplication:()=>({config:{channelPlugins:[]},tasks:h.service}),getSessionPersistence:()=>h.host.ctx.sessionPersistence})
 try{
  const endpoint=web.origin+'/api/tasks/'+taskId+'/session'
  const headers={origin:web.origin}
  assert.equal((await fetch(endpoint+'?stream=1',{headers})).status,401)
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{...headers,'content-type':'application/json'},
   body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
  assert.equal(login.status,200)
  headers.cookie=login.headers.get('set-cookie').split(';')[0]
  const response=await fetch(endpoint+'?stream=1',{headers})
  assert.equal(response.status,200)
  const page=await response.json()
  const visible=page.items.filter(row=>row.toolName==='edit'&&row.kind==='tool-result')
  assert.deepEqual(visible.map(row=>row.editDiff),[true,undefined,undefined])
  const rows=parsePiEditDiff(visible[0].text)
  assert.deepEqual(rows.map(row=>[row.kind,row.line,row.text]),[
   ['context',1,'// start'],['context',2,'// neighboring context'],['removed',3,oldText],
   ['added',3,'const value = 2;'],['added',4,'const ready = true;'],['context',4,'console.log(value);'],['context',5,'// end'],
  ])
  assert.equal(visible[1].isError,true)
  assert.match(visible[2].text,/Successfully replaced/)
  assert.doesNotMatch(JSON.stringify(page),new RegExp(secret+'|nativeResult|firstChangedLine|--- work\/fixture'))
 }finally{await web.close()}
})
