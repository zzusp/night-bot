import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {once} from 'node:events'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'

test('pre-policy frozen Router acknowledgement retains exact payload and recovers once without new prose review',{timeout:nativeTestTimeout(60000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-legacy-router-ack-')),code=join(root,'old-code'),install=join(root,'installation')
 let old,current
 t.after(async()=>{await current?.close();await current?.host?.close();await old?.close();await old?.host?.close();await rm(root,{recursive:true,force:true})});await mkdir(code)
 const repo=fileURLToPath(new URL('../',import.meta.url)),{stdout}=await promisify(execFile)('git',['archive','bf3a1ab730bd552976dd276343e6f752f2b5072f'],{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
 const tar=spawn('tar',['-x','-C',code]);tar.stdin.end(stdout);assert.equal((await once(tar,'exit'))[0],0)
 await symlink(join(repo,'node_modules'),join(code,'node_modules'),'dir')
 const legacy=await import(pathToFileURL(join(code,'test/fixtures/resident-router-host.js')))
 let step=0
 old=await legacy.residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No other work'}
  const input=requestEnvelope(body,'Router 请求：'),event=input.events[0]
  if(step++===0)return {tool:'resident_router_reply',args:{operationId:'frozen-old-ack',sourceId:event.sourceId,messageVersion:event.messageVersion,replyPurpose:'acknowledgement',text:'Synthetic pre-policy acknowledgement'}}
  if(step===2)return {tool:'resident_router_settle',args:{operationId:'legacy-settle',eventIds:input.events.map(event=>event.id),noTaskDispositions:[{eventId:event.id,outcome:'context-only',reason:'Synthetic historical fixture has no remaining request',sourceQuote:event.source.text}]}}
  return {text:'Old batch settled'}
 },{hostOptions:{hostConfig:{installRoot:install}}})
 old.host.ctx.channels.transports.get('resident-fixture').canSend=()=>false
 await old.receive(channelMessage('legacy-ack',{text:'Synthetic old notification fixture, no external work'}));await old.service.whenIdle()
 const [frozen]=await old.query('notification.list');assert.equal(frozen.state,'prepared');assert.equal(frozen.payload.replyPurpose,'acknowledgement');assert.equal(old.sent.length,0)
 await old.close();await old.host.close()
 let reviews=0
 current=await residentRouterHost(t,()=>({text:'No new inference expected'}),{config:{initialize:false},hostOptions:{hostConfig:{installRoot:install},replyQuality:()=>{reviews++;throw Error('old frozen text must not be reviewed again')}}})
 await current.service.recover();await current.service.whenIdle()
 const recovered=await current.query('notification.get',{notificationId:frozen.id})
 assert.equal(recovered.state,'delivered');assert.deepEqual(recovered.payload,frozen.payload);assert.equal(recovered.payloadDigest,frozen.payloadDigest);assert.equal(current.sent.length,1);assert.equal(reviews,0);assert.equal(current.requests.length,0)
 await current.restart();await current.service.whenIdle()
 assert.equal(current.sent.length,1);assert.equal((await current.query('notification.list')).length,1)
})
