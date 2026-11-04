import test from 'node:test'
import assert from 'node:assert/strict'
import {piProviderContext} from '../src/pi-provider-context.js'
const profile={maxRequestImageBytes:1000,requestImagePixelBudget:100,requestImageMaxBytes:100},model={api:'openai-completions',input:['text','image']}
const text=value=>({type:'text',text:value}),user=content=>({role:'user',id:'u',source:{kind:'user'},content})
const empty={get:()=>undefined}
test('native provider retains leading and in-history instructions, actual tool schemas and native tool identities',async()=>{
 const tool={name:'read',description:'read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}},messages=[{role:'system',content:[text('BASE')]},user([text('ACTUAL')]),{role:'developer',content:[text('LATER'),{type:'tool-addition',toolName:'read'}]},{role:'assistant',source:{provider:'fixture',model:'m'},content:[{type:'tool-call',id:'call',name:'read',arguments:'{"path":"a"}'}]},{role:'tool',toolCallId:'call',isError:false,content:[text('REAL_RESULT')]}]
 const result=await piProviderContext({messages,tools:[tool],system:'FIRST'},{profile,model,ctx:empty,alreadyProjected:true,toolUpdate:'in-history'})
 assert.equal(result.systemPrompt,'FIRST\n\nBASE');assert.equal(result.messages[0].content,'ACTUAL');assert.deepEqual(result.messages[1].toolsAdded,[tool]);assert.equal(result.messages.at(-1).toolName,'read');assert.equal(result.messages.at(-1).content[0].text,'REAL_RESULT');assert.deepEqual(result.tools,[tool])
})
test('multimodal projection reads bounded request versions and preserves per-occurrence names and readonly access',async()=>{
 const ref={attachmentId:'sha256:abcdefgh',name:'first.png',width:100,height:100,mediaType:'image/png'},reads=[]
 const attachments={readImageRequest:async(r,target)=>{reads.push({r,target});return{width:10,height:10,bytes:3,data:Buffer.from([1,2,3]),mediaType:'image/png'}},imageHostPath:()=>'/host/image.png'}
 const ctx={get:name=>name==='attachments'?attachments:name==='fs'?{processPathFromHostPath:()=>'/readonly/image.png'}:undefined}
 const result=await piProviderContext({messages:[user([{type:'image',attachment:ref},{type:'image',attachment:{...ref,name:'second.png'}}])]},{profile,model,ctx})
 assert.equal(reads.length,1);assert.equal(reads[0].target.width*reads[0].target.height,100);assert.equal(reads[0].target.maxBytes,100);const content=result.messages[0].content;assert.ok(content[0].text.includes('first.png'));assert.ok(content[2].text.includes('second.png'));assert.ok(content[0].text.includes('/readonly/image.png'));assert.equal(content[1].data,'AQID');assert.equal(content[3].data,'AQID')
})
test('image overflow asks for explicit oldest-occurrence offload and does not silently remove input',async()=>{
 const ref={attachmentId:'sha256:abcdefgh',width:1,height:1,mediaType:'image/png'},messages=[user([{type:'image',attachment:ref},{type:'image',attachment:ref}])],ctx={get:()=>({readImageRequest:async()=>({width:1,height:1,bytes:3,data:Buffer.from([1,2,3]),mediaType:'image/png'})})}
 await assert.rejects(piProviderContext({messages},{profile:{...profile,maxRequestImageBytes:4},model,ctx}),e=>e.code==='IMAGE_OFFLOAD_REQUIRED'&&e.failure.offloadImages===1);assert.equal(messages[0].content.length,2);assert.equal(messages[0].content[0].offloaded,undefined)
})
test('files and text-only images retain honest read handles while unsupported image roles fail before reading',async()=>{
 const ref={attachmentId:'sha256:abcdefgh',name:'evidence.txt',bytes:20},ctx={get:name=>name==='attachments'?{fileHostPath:()=>'/host/evidence.txt'}:name==='fs'?{processPathFromHostPath:()=>'/readonly/evidence.txt'}:undefined}
 const result=await piProviderContext({messages:[user([{type:'file',attachment:ref},{type:'image',attachment:{attachmentId:'sha256:abcdefgh'}}])]},{profile,model:{...model,input:['text']},ctx})
 assert.ok(result.messages[0].content.includes('/readonly/evidence.txt'));assert.ok(result.messages[0].content.includes('text only'))
 await assert.rejects(piProviderContext({messages:[{role:'assistant',source:{provider:'fixture',model:'m'},content:[{type:'image',attachment:ref}]}]},{profile,model,ctx:empty}),e=>e.code==='UNSUPPORTED_CONTENT')
})
test('offloaded images do not reread the binary and unknown tool changes cannot invent a declaration',async()=>{
 const result=await piProviderContext({messages:[user([{type:'image',offloaded:true,attachment:{attachmentId:'sha256:abcdefgh',width:1,height:1,mediaType:'image/png'}}])]},{profile,model,ctx:empty})
 assert.ok(result.messages[0].content.includes('omitted to fit request'))
 await assert.rejects(piProviderContext({messages:[{role:'developer',content:[{type:'tool-addition',toolName:'hidden'}]}]},{profile,model,ctx:empty,alreadyProjected:true}),e=>e.code==='INVALID_REQUEST')
})
