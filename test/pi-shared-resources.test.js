import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {openSharedResources,sharedImportRequested} from '../src/shared-resources/store.js'
import {createSharedOperatorAuth,createSharedOperatorHttp,readSharedOperatorToken,SHARED_OPERATOR_ROUTE} from '../src/shared-resources/operator.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

const source={kind:'fixture'}
const admin={operator:true,actorId:'operator',conversationId:'local-operator'}
const a={actorId:'actor',conversationId:'A'},b={actorId:'actor',conversationId:'B'},c={actorId:'other',conversationId:'B'}

test('explicit natural import retains the untouched roster and verifies the linked knowledge record',()=>{
 const path='work/contacts/group-roster.md'
 assert.equal(sharedImportRequested('请把原联系人名册 `'+path+'` 迁入知识库，确认保存后清理旧文件。',path),true)
 for(const line of ['不要把 `'+path+'` 迁入知识库','> 请把 `'+path+'` 迁入知识库','请把 `work/other.md` 迁入知识库','请把 `'+path+'` 迁入知识库这句话翻译成英文，不要执行。','请把 `'+path+'` 迁入知识库。不要执行。','请把 `'+path+'` 和 `work/other.md` 迁入知识库'])assert.equal(sharedImportRequested(line,path),false)
 const repo=openSharedResources({dbPath:':memory:',instanceId:'roster-fixture'})
 const args={action:'import',name:'公司联系人',indexPath:['企业资料','组织与通讯录'],fileName:'group-roster.md'}
 const bytes=Buffer.from('## 核验范围\n只含测试群\n## 已核实成员\n测试成员\n## 已核实机器人\n测试机器人\n')
 try{
  const {result}=repo.execute(a,args,{source,operation:'natural-import',bytes})
  assert.equal(repo.verifyImport(result).verified,true)
  assert.deepEqual(repo.execute(a,{action:'read',id:result.file.id,version:1},{source}).bytes,bytes)
  assert.equal(repo.execute(b,{action:'search',query:'公司联系人'},{source}).result.matches[0].id,result.id)
  const otherInSameConversation={...a,actorId:c.actorId}
  assert.deepEqual(repo.execute(otherInSameConversation,{action:'read',id:result.file.id,version:1},{source}).bytes,bytes)
  assert.deepEqual(repo.execute(a,args,{source,operation:'natural-import',bytes}).result,result)
 }finally{repo.close()}
})

test('local operator API requires its capability and returns original bytes as a download',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-shared-http-')),secrets=join(root,'secrets')
 await mkdir(secrets,{mode:0o700})
 const paths={mode:'portable',secrets},auth=await createSharedOperatorAuth(paths)
 const repo=openSharedResources({dbPath:':memory:',instanceId:'operator-fixture'})
 const dispatch=createSharedOperatorHttp({auth,execute:(args,options)=>repo.execute(admin,args,{...options,operation:options.requestId,source})})
 const server=createServer(async(req,res)=>{if(!await dispatch(req,res)){res.statusCode=404;res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));repo.close();await rm(root,{recursive:true,force:true})})
 const address='http://127.0.0.1:'+server.address().port+SHARED_OPERATOR_ROUTE
 const token=await readSharedOperatorToken(paths)
 const request=(input,headers={})=>fetch(address,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})
 const payload={action:'publish',kind:'file',name:'Fixture',fileName:'contacts.csv',contentBase64:Buffer.from('id,name\n1,Example').toString('base64')}
 assert.equal((await request(payload)).status,403)
 const headers={authorization:'Bearer '+token}
 assert.equal((await request(payload,{...headers,origin:'http://127.0.0.1:3080'})).status,403)
 const published=await request(payload,headers);assert.equal(published.status,200)
 const entry=await published.json()
 const download=await request({action:'read',id:entry.id,version:1},headers)
 assert.equal(download.status,200)
 assert.match(download.headers.get('content-disposition'),/^attachment;/)
 assert.equal(download.headers.get('x-night-resource-sha256'),entry.sha256)
 assert.equal(await download.text(),'id,name\n1,Example')
})

test('shared files and knowledge preserve versions, provenance, instance-wide access and withdrawal across restart',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'night-shared-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const config={dbPath:join(directory,'shared.sqlite'),instanceId:'fixture'}
 let repo=openSharedResources(config)
 let count=0
 const run=(principal,args,bytes)=>repo.execute(principal,args,{source,operation:['index','search','read','audit'].includes(args.action)?undefined:'operation-'+ ++count,bytes})
 try{
  const initial={action:'publish',kind:'file',name:'Contacts',fileName:'contacts.csv'}
  for(const action of ['grant','publisher','subjects'])assert.throws(()=>run(admin,{action}),{code:'SHARED_INVALID'})
  assert.throws(()=>run({},initial,Buffer.from('a,one')),{code:'SHARED_AUTHORITY_REQUIRED'})
  const v1=run(a,initial,Buffer.from('a,one')).result
  const knowledge=run(a,{action:'publish',kind:'knowledge',name:'Contacts guide',topic:'Directory',keywords:['roster'],indexPath:['Company','Directory'],body:'Reference the maintained list.',links:[{id:v1.id,version:1}]}).result
  assert.equal(run(b,{action:'search',query:'contact'}).result.status,'found')
  assert.equal(run(b,{action:'read',id:v1.id,version:1}).bytes.toString(),'a,one')
  assert.deepEqual(run(b,{action:'index'}).result.nodes,[{type:'index',name:'Company',indexPath:['Company']}])
  assert.deepEqual(run(b,{action:'index',indexPath:['Company']}).result.nodes,[{type:'index',name:'Directory',indexPath:['Company','Directory']}])
  assert.equal(run(b,{action:'index',indexPath:['Company','Directory']}).result.nodes[0].id,knowledge.id)
  assert.deepEqual(run(c,{action:'index'}).result.nodes,run(a,{action:'index'}).result.nodes)
  assert.equal(run(b,{action:'search',query:'roster'}).result.matches[0].id,knowledge.id)
  assert.equal(run(c,{action:'read',id:knowledge.id}).result.id,knowledge.id)
  assert.equal(run(b,{action:'forward',id:v1.id,version:1}).bytes.toString(),'a,one')
  assert.equal(run(b,{action:'read',id:knowledge.id}).result.links[0].version,1)
  const update={...initial,action:'update',id:v1.id,expectedVersion:1,knowledge:{id:knowledge.id,expectedVersion:1}}
  assert.throws(()=>run(b,{...update,knowledge:{id:knowledge.id,expectedVersion:2}},Buffer.from('b,two')),{code:'SHARED_VERSION_CONFLICT'})
  const v2=run(b,update,Buffer.from('b,two')).result
  assert.equal(v2.version,2)
  repo.close();repo=openSharedResources(config)
  assert.equal(run(b,{action:'read',id:v2.id,version:1}).bytes.toString(),'a,one')
  assert.equal(run(b,{action:'read',id:v2.id}).bytes.toString(),'b,two')
  assert.equal(run(b,{action:'read',id:knowledge.id,version:1}).result.links[0].version,1)
  assert.equal(run(b,{action:'read',id:knowledge.id}).result.links[0].version,2)
  assert.equal(run(b,{action:'search',query:'contacts',kind:'file'}).result.matches[0].version,2)
  assert.equal(run(c,{action:'withdraw',id:v1.id,expectedVersion:2}).result.status,'withdrawn')
  assert.equal(run(b,{action:'search',query:'contacts',kind:'file'}).result.status,'not-found')
  assert.throws(()=>run(b,{action:'read',id:v1.id,version:1}),{code:'SHARED_WITHDRAWN'})
  assert.deepEqual(run(b,{action:'read',id:knowledge.id}).result.links,[{status:'unavailable'}])
  assert.ok(run(admin,{action:'audit',id:v1.id}).result.records.some(row=>row.action==='publish'&&row.source.kind==='fixture'))
 }finally{repo.close()}
})

test('real Router and execution tools publish an original task file and read its version across channels and tasks',{timeout:nativeTestTimeout(60000)},async t=>{
 const decided=new Set();let version,query,local
 const receivedFiles=[]
 const done=message=>({tool:'task_result',args:{decision:{action:'complete',summary:message,evidence:[],limitations:[]}}})
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),last=body.messages.at(-1),called=body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name
  if(tools.includes('resident_task_plan')){
   const packet=requestEnvelope(body,'Router 请求：'),event=packet.events.find(row=>row.source),s=event?.source
   if(last.role==='tool'&&called==='resident_router_settle')return {text:'Settled'}
   if(s?.messageId.startsWith('forward-')){
    if(last.role!=='tool'||called!=='resident_router_shared_forward')return {tool:'resident_router_shared_forward',args:{sourceId:s.sourceId,messageVersion:s.version}}
    const receipt=last.content.startsWith('Error:')?{}:JSON.parse(last.content)
    return {tool:'resident_router_settle',args:{operationId:'settle-forward-'+s.messageId,eventIds:packet.events.map(row=>row.id),
      noTaskDispositions:[{eventId:event.id,outcome:receipt.status==='queued'||receipt.status==='delivered'?'handled-inline':'context-only',reason:receipt.status==='queued'?'Original file queued by Router.':'No further work.',sourceQuote:s.text}]}}
   }
   if(s&&!decided.has(s.messageId)){
    decided.add(s.messageId)
    const title='fixture-'+s.messageId
    return {tool:'resident_task_plan',args:{operationId:title,sourceId:s.sourceId,messageVersion:s.version,tasks:[{taskId:title,title,objective:title,request:title,requirements:[],handoff:title}],dependencies:[]}}
   }
   return {tool:'resident_router_settle',args:{operationId:'settle-'+packet.events.map(row=>row.id).join(','),eventIds:packet.events.map(row=>row.id)}}
  }
  if(!tools.includes('task_result'))return {text:'idle'}
  if(last.role==='tool'&&called==='task_result')return {text:'Done'}
  const all=requestText(body).join('\n')
  if(all.includes('fixture-publish')){
   if(last.role==='tool'&&called==='shared_resource_import')return done('Publication processed.')
   if(last.role==='tool'&&called==='write')return {tool:'shared_resource_import',args:{path:'work/contacts.txt',name:'Contacts',indexPath:['Company','Directory']}}
   return {tool:'write',args:{path:'work/contacts.txt',content:'SYNTHETIC_CONTACTS_VERSION_ONE'}}
  }
  if(all.includes('fixture-lookup')){
   if(last.role==='tool'&&called==='shared_resource_lookup'){
    const parsed=JSON.parse(last.content)
    if(parsed.contentBase64){query=parsed;return done('Read the saved version.')}
    assert.equal(parsed.matches.length,1)
    const match=parsed.matches[0]
    return {tool:'shared_resource_lookup',args:{action:'read',id:match.id,version:match.version,byteOffset:0}}
   }
   return {tool:'shared_resource_lookup',args:{action:'search',query:'Contacts',kind:'file'}}
  }
  if(all.includes('fixture-local')){
   if(last.role==='tool'&&called==='shared_resource_lookup'){
    const item=JSON.parse(last.content)
    if(item.nodes)return {tool:'shared_resource_lookup',args:{action:'read',id:item.nodes[0].id,version:item.nodes[0].version}}
    local=item;return done('Read the indexed article.')
   }
   return {tool:'shared_resource_lookup',args:{action:'index',indexPath:['Company','Directory']}}
  }
  return done('No shared work.')
 },{strictModelDecisions:true,channelIds:['resident-fixture','other-fixture'],transportCapabilities:{files:['chat-room']},async sendFile(envelope,_notification,file){
  receivedFiles.push({conversationId:envelope.conversationId,body:await readFile(file.path,'utf8')})
  return {messageId:'fixture-file'}
 },async readbackFile(envelope,notification){
  const file=notification.payload.artifact
  return {messageId:'fixture-file',conversationId:envelope.conversationId,artifactId:file.artifactId,sha256:file.sha256,size:file.size}
 }})
 const pub=channelMessage('publish',{text:'请把原联系人名单 `work/contacts.txt` 迁入知识库。不要外发。'})
 const read=channelMessage('lookup',{channelId:'other-fixture',conversationId:'other-room',senderId:'bob',text:'Find the saved Contacts file.'})
 const operate=(args,requestId)=>h.service.sharedOperator(args,{requestId}).result
 await h.receive(pub)
 await h.service.whenIdle()
 await eventually(()=>{
   const result=h.results.find(row=>row.name==='shared_resource_import')?.result
   if(!result)return
   assert.equal(result.isError,false,JSON.stringify(result))
   const imported=result.value??JSON.parse(result.content[0].text)
   assert.equal(imported.status,'imported')
   assert.equal(imported.verified,true)
   return version=imported.file
 },'task invokes verified publication')
 assert.equal(version.version,1)
 assert.equal((await h.query('notification.list')).some(row=>row.payload.artifact),false)
 await h.receive(read)
 await eventually(()=>query,'another execution reads pinned version')
 assert.equal(Buffer.from(query.contentBase64,'base64').toString(),'SYNTHETIC_CONTACTS_VERSION_ONE')
 assert.equal(query.id,version.id)
 assert.equal(query.version,1)
 await h.service.whenIdle()
 assert.ok(h.results.filter(row=>row.name==='shared_resource_lookup').every(row=>!row.result.isError))
 const forward=(id)=>channelMessage(id,{...read,messageId:id,text:'/shared '+JSON.stringify({action:'forward',id:version.id,version:1})})
 await h.receive(channelMessage('forward-no-directive',{...read,messageId:'forward-no-directive',text:'不要发送原文件。'}));await h.service.whenIdle()
 assert.equal(receivedFiles.length,0)
 assert.match(JSON.stringify(h.results.filter(row=>row.name==='resident_router_shared_forward').at(-1)?.result),/SHARED_EXPLICIT_DIRECTIVE_REQUIRED/)
 await h.receive(forward('forward-allowed'))
 await eventually(()=>receivedFiles.length,'authorized file reaches receiving channel')
 assert.deepEqual(receivedFiles,[{conversationId:'other-room',body:'SYNTHETIC_CONTACTS_VERSION_ONE'}])
 await h.service.whenIdle()
 assert.equal((await h.query('task.list')).some(task=>task.taskId.startsWith('fixture-forward')),false)
 const article=operate({action:'publish',kind:'knowledge',name:'Company contacts',indexPath:['Company','Directory'],body:'Synthetic directory',links:[{id:version.id,version:1}]},'create-article')
 assert.equal(article.status,'published')
 const previous=await h.service.createTask({requestId:'background-only-fixture',objective:'Related background only.'})
 await h.service.whenIdle()
 const oldSourceId=(await h.query('task.get',{taskId:previous.taskId})).sourceRefs[0]
 const fresh=await h.service.createTask({requestId:'local-fixture',objective:'fixture-local',sourceRefs:[oldSourceId]})
 await eventually(()=>local,'another local task reads the company knowledge index')
 assert.equal(local.id,article.id)
 await h.service.whenIdle()
 const knownSource=(await h.query('task.get',{taskId:fresh.taskId})).metadata.authorizationSourceId
 assert.notEqual(knownSource,oldSourceId)
 assert.ok(operate({action:'audit',id:article.id},'audit-local').records.some(record=>record.action==='read'&&record.source.sourceId===knownSource))
})
