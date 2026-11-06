import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {createOfficialModelContentIndex,modelContentScope} from '../packages/dingtalk-core/model-context.js'

async function fixture(t,{install=false}={}){
 let index,actor,current=true
 const f=await officialToolsFixture(t,({owner,ctx,root})=>{
  owner.metadata=Object.freeze({id:owner.id,createdAt:1,cwd:root})
  actor=owner;index=createOfficialModelContentIndex(owner,{root:join(root,'admitted-business-content')})
  if(install)index.install(ctx,()=>current)
 })
 return {...f,index,actor,root:join(f.root,'admitted-business-content'),setCurrent:value=>{current=value}}
}
function read(index,ref,path=''){
 let text='',offset=0,page
 do{page=index.read({contentRef:typeof ref==='string'?ref:ref.contentRef,path,offset,limit:173});text+=page.text;offset=page.nextOffset}while(offset!==null)
 return page.format==='json'?JSON.parse(text):text
}
const currentTask=()=>({task:{taskId:'current-task',request:'核对事实，禁止发布。'.repeat(400),requirementRevision:3,controlRevision:2,runSequence:4,contextRevision:5,ownerActorId:'authorized-owner'},sources:[{sourceId:'original',actorId:'authorized-owner',version:1,text:'原授权仅准本地核对。'.repeat(300)},{sourceId:'restriction',actorId:'authorized-owner',version:2,corrects:'original',text:'撤销任何发布权限。'.repeat(300)}],materials:[{sourceId:'original',resources:[{kind:'file',path:'materials/original.txt',sha256:'a'.repeat(64)}]}],wakes:[{kind:'source.changed',sourceId:'restriction'}]})

test('current task business payload is bounded without losing source identity, restrictions or material references',async t=>{
 const {index}=await fixture(t),input=currentTask(),original=structuredClone(input),view=index.project(input)
 assert.deepEqual(input,original)
 assert.deepEqual(view.sources.map(({sourceId,actorId,version,corrects})=>({sourceId,actorId,version,...corrects?{corrects}:{}})),[{sourceId:'original',actorId:'authorized-owner',version:1},{sourceId:'restriction',actorId:'authorized-owner',version:2,corrects:'original'}])
 assert.equal(read(index,view.task.request),input.task.request)
 assert.equal(read(index,view.sources[1].text),input.sources[1].text)
 assert.deepEqual(view.materials,input.materials)
 assert.deepEqual(view.task.requirementRevision,3)
 assert.ok(Buffer.byteLength(JSON.stringify(index.host(input)))<=3000)
})
test('identical source bytes deduplicate files without merging authors, versions or authorization',async t=>{
 const {index}=await fixture(t),body='相同文本不是相同授权🙂'.repeat(300),input={sources:[{sourceId:'one',actorId:'owner',version:1,text:body},{sourceId:'two',actorId:'other',version:2,text:body}]}
 const view=index.project(input)
 assert.equal(view.sources[0].text.contentRef,view.sources[1].text.contentRef)
 assert.deepEqual(view.sources.map(source=>[source.sourceId,source.actorId,source.version]),[['one','owner',1],['two','other',2]])
 assert.equal(read(index,view.sources[0].text),body)
 const short=index.project({sourceId:'short',actorId:'owner',text:'仅分析，不发布。'})
 assert.equal(short.text,'仅分析，不发布。')
 assert.deepEqual(index.project(input),view,'previous projections do not become a hidden visible-history cache')
})
test('many sources, unknown effects and corrections remain exact behind the serialized UTF-8 budget',async t=>{
 const {index}=await fixture(t),input=currentTask()
 input.sources=Array.from({length:100},(_,i)=>({sourceId:'source-'+i,actorId:'author-'+i,version:i+1,text:'要求和撤销🙂'.repeat(100),corrects:i?'source-'+(i-1):undefined}))
 input.effects=Array.from({length:60},(_,i)=>({operationId:'unknown/'+i,state:'unknown',replayAllowed:false,evidence:'完整证据'.repeat(200)}))
 const before=index.project(input),host=index.host(input)
 assert.ok(Buffer.byteLength(JSON.stringify(host))<=3000)
 assert.equal(host.contextReadRequired,true)
 assert.deepEqual(read(index,host.contextRef),JSON.parse(JSON.stringify(before)))
 for(const [key,value]of Object.entries(host))if(value?.contextPath)assert.deepEqual(read(index,host.contextRef,value.contextPath),JSON.parse(JSON.stringify(before[key])))
})
test('JSON pointer pagination retains Unicode and escaped keys while refusing invalid paths and bounds',async t=>{
 const {index}=await fixture(t),value={'source/~':{text:'完整原文🙂'.repeat(1000)}},ref=index.store(value)
 assert.equal(read(index,ref,'/source~1~0/text'),value['source/~'].text)
 for(const args of [{offset:-1},{limit:16001},{offset:1.5},{path:'/missing'},{path:'/source~2/text'},{path:'/toString'}])assert.throws(()=>index.read({contentRef:ref.contentRef,...args}))
})
test('foreign scopes, changed files and symbolic links never become admitted content',async t=>{
 const {index,actor,root}=await fixture(t),ref=index.store('original evidence')
 const foreign=createOfficialModelContentIndex({...actor,id:'foreign',metadata:{...actor.metadata,id:'foreign'}},{root})
 assert.throws(()=>read(foreign,ref),{code:'MODEL_CONTENT_NOT_ADMITTED'})
 await writeFile(ref.path,JSON.stringify('changed'))
 const reopened=createOfficialModelContentIndex(actor,{root})
 assert.throws(()=>read(reopened,ref),{code:'MODEL_CONTENT_DIGEST_MISMATCH'})
 const link=join(actor.metadata.cwd,'linked-catalog');await symlink(root,link,'dir')
 assert.throws(()=>createOfficialModelContentIndex(actor,{root:link}),{code:'MODEL_CONTENT_DIRECTORY_INVALID'})
 assert.throws(()=>createOfficialModelContentIndex({...actor,id:'wrong'},{root}),{code:'MODEL_CONTENT_OFFICIAL_IDENTITY_REQUIRED'})
})
test('reopening the same business scope needs no transcript, and content files do not edit Pi history',async t=>{
 const f=await fixture(t),before=structuredClone(f.manager.getEntries()),view=f.index.host(currentTask())
 const reopened=createOfficialModelContentIndex(f.actor,{root:f.root})
 assert.deepEqual(read(reopened,view.contextRef??f.index.store(view)),read(f.index,view.contextRef??f.index.store(view)))
 assert.deepEqual(f.manager.getEntries(),before)
 const anchor=f.manager.appendMessage({role:'user',content:'public compaction anchor',timestamp:1})
 f.manager.appendCompaction('official summary',anchor,0)
 assert.deepEqual(reopened.host(currentTask()),f.index.host(currentTask()))
 assert.equal(modelContentScope(f.actor.metadata),modelContentScope({...f.actor.metadata}))
})
test('long keys, reserved context names and tool output rendering retain lossless overflow',async t=>{
 const {index}=await fixture(t),key='字段/~'+'长'.repeat(300),value={[key]:{state:'unknown',actor:'授权作者🙂',version:7},contextRef:'original-business-value',contextReadRequired:false}
 const host=index.host(value),wrapped=index.wrapOutput({render:()=>[{type:'text',text:JSON.stringify(value)}]}).render({}, {})[0].text
 assert.ok(Buffer.byteLength(JSON.stringify(host))<=3000);assert.ok(Buffer.byteLength(wrapped)<=3000)
 // Add enough distinct keys to force a complete snapshot even after projection.
 const large={...value,...Object.fromEntries(Array.from({length:100},(_,i)=>['key'+i,'正文🙂'.repeat(40)]))},bounded=index.host(large)
 assert.equal(read(index,bounded.contextRef,'/contextRef'),'original-business-value')
 assert.equal(read(index,bounded.contextRef,'/'+key.replaceAll('~','~0').replaceAll('/','~1')+'/actor'),'授权作者🙂')
})
test('official tool execution reads explicit admitted leaf content and denies stale or foreign references',async t=>{
 const f=await fixture(t,{install:true}),body='明确读取的原始正文'.repeat(200),ref=f.index.store(body)
 await f.run([{id:'body-read',name:'model_content_read',args:{contentRef:ref.contentRef,limit:100}}])
 const readback=f.results.find(result=>result.toolCallId==='body-read')
 assert.equal(readback.isError,false)
 assert.match(JSON.stringify(readback.result),/明确读取的原始正文/)
 f.setCurrent(false)
 await f.run([{id:'stale-read',name:'model_content_read',args:{contentRef:ref.contentRef}}])
 assert.equal(f.results.find(result=>result.toolCallId==='stale-read').isError,true)
 f.setCurrent(true)
 await f.run([{id:'foreign-read',name:'model_content_read',args:{contentRef:'a'.repeat(64)+':sha256:'+'b'.repeat(64)}}])
 assert.equal(f.results.find(result=>result.toolCallId==='foreign-read').isError,true)
})

test('long business instructions point to one existing exact file while short instructions stay literal',async t=>{
 const {index}=await fixture(t),instruction='核对当前来源和撤销，不执行外部动作。'.repeat(1000),stored=index.store(instruction)
 const first=index.instruction(instruction,'业务要求')
 assert.equal(index.instruction('短要求'),'短要求')
 assert.equal(index.instruction(instruction,'业务要求'),first)
 assert.ok(first.includes(stored.path));assert.ok(first.includes(stored.contentRef))
 assert.equal(JSON.parse(await readFile(stored.path,'utf8')),instruction)
 assert.ok(Buffer.byteLength(first)<Buffer.byteLength(instruction))
})
