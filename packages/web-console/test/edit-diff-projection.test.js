import test from 'node:test'
import assert from 'node:assert/strict'
import {routerSessionView, taskSessionView} from '../server/session-view.js'
import {parsePiEditDiff, requestedEditRows} from '../src/edit-diff.ts'

const path='work/fixture.ts', text='Successfully replaced 1 block(s) in '+path+'.'
const content=[{type:'text',text}]
const args={path,edits:[{oldText:'const n = 1;',newText:'const n = 2;'}]}
const nativeDetails={diff:' 20 // PUBLIC_CONTEXT\n-21 const n = 1;\n+21 const n = 2;',firstChangedLine:21,
 patch:'--- '+path+'\n+++ '+path+'\n@@ -20,2 +20,2 @@\n // PUBLIC_CONTEXT\n-const n = 1;\n+const n = 2;'}
const source=(id,message)=>({sourceEntry:{id,type:'message',message},messages:[message]})
const edit=source('call',{role:'assistant',content:[{type:'toolCall',name:'edit',id:'one',arguments:args}]})
const result=(details=nativeDetails)=>source('result',{role:'toolResult',toolName:'edit',toolCallId:'one',isError:false,
 content,details:{nativeResult:{value:{text,images:[],details},content,isError:false},other:'UNRELATED_NATIVE_DETAIL'}})
const task={taskId:'task-one',session:{sessionId:'task-session',sessionBound:true}}
const readTask=entries=>taskSessionView({task,executionActivity:true,persistence:{readNative:async()=>({
 header:{id:'task-session'},entries:[{id:'commit'}],
 audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'task-session'}}],context:{projection:{entries}},
})}})

test('edit evidence is read only from the genuine exact successful native result in an authorized task', async()=>{
 const ready=(await readTask([edit,result()])).items.at(-1)
 assert.equal(ready.editDiff,true)
 assert.equal(ready.text,nativeDetails.diff)
 assert.doesNotMatch(JSON.stringify(ready),/UNRELATED_NATIVE_DETAIL|firstChangedLine|--- work/)
 const altered=result()
 altered.messages=[{...altered.messages[0],content:[{type:'text',text:'edited projection'}]}]
 const failed=result()
 failed.sourceEntry.message.isError=true
 for(const entries of [[result()],[edit,{...edit,sourceEntry:{...edit.sourceEntry,id:'duplicate'}},result()],
   [edit,altered],[edit,failed],
   [edit,result({...nativeDetails,extra:'UNRELATED_NATIVE_DETAIL'})],
   [edit,result({...nativeDetails,diff:' 20 // access_token: ghp_syntheticOnly123456789\n-21 const n = 1;\n+21 const n = 2;'})],
   [edit,result({...nativeDetails,diff:'-21 '+ 'x'.repeat(12001)})]]){
  const page=await readTask(entries)
  assert.equal(page.items.at(-1).editDiff,undefined)
  assert.doesNotMatch(JSON.stringify(page),/PUBLIC_CONTEXT|UNRELATED_NATIVE_DETAIL|syntheticOnly/)
 }
 const router={id:'conversation-one',activeSessionId:'router-session',generation:1,phase:'idle'}
 const page=await routerSessionView({conversationId:router.id,readRouter:async()=>router,executionActivity:true,persistence:{readNative:async()=>({
  header:{id:'router-session',runtimeOwner:'conversation-router',conversationId:router.id,generation:1},entries:[{id:'commit'}],context:{projection:{entries:[edit,result()]}},
 })}})
 assert.equal(page.items.at(-1).editDiff,undefined)
 assert.doesNotMatch(JSON.stringify(page),/PUBLIC_CONTEXT|UNRELATED_NATIVE_DETAIL/)
})

test('the edit diff parser keeps supplied line numbers, and request rows never invent file numbers',()=>{
 assert.deepEqual(parsePiEditDiff('    ...\n-25 a\n+31 b\n 32 c'),[
  {kind:'omitted',text:'…'},{kind:'removed',line:25,text:'a'},{kind:'added',line:31,text:'b'},{kind:'context',line:32,text:'c'},
 ])
 assert.equal(parsePiEditDiff('-0 a\n+1 b'),null)
 assert.equal(parsePiEditDiff(' 1 context only'),null)
 assert.equal(parsePiEditDiff('-1 a\n+1 b\n\u001b[32m'),null)
 assert.deepEqual(requestedEditRows('same\nold\nend','same\nnew\nend'),[
  {kind:'context',text:'same'},{kind:'removed',text:'old'},{kind:'added',text:'new'},{kind:'context',text:'end'},
 ])
})
