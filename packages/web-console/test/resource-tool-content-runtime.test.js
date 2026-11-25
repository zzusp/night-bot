import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost, channelMessage, requestEnvelope, requestTools} from '../../../test/fixtures/resident-router-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {memoryScope} from '../../../src/memory/scope.js'
import {createWebConsole} from '../server/plugin.js'

test('authenticated HTTP reopens actual Router memory reads without disclosing changed or forgotten history', {timeout:nativeTestTimeout(40000)}, async t => {
  let selector, issued, settled
  const h = await residentRouterHost(t, body => {
    if (!requestTools(body).includes('resident_router_settle')) return {text:'Ready'}
    const input = requestEnvelope(body, 'Router 请求：')
    if (!issued) {
      issued = true
      return {tool:'memory_read', args:selector}
    }
    if (!settled) {
      settled = true
      return {tool:'resident_router_settle', args:{eventIds:input.events.map(event=>event.id), operationId:'settle-'+input.events.map(event=>event.id).join(',')}}
    }
    return {text:'已核对记忆'}
  })
  const memory = h.host.ctx.memory, scope = memoryScope({actorId:'fixture-writer'})
  const source = n => ({sessionId:'private-fixture-origin', messageId:'private-fixture-message-'+n})
  const original = '发布测试的可复用实践：先核对实际部署版本，再检查健康探针。'
  const saved = await memory.store.remember(scope,{topic:'facts',key:'release-check',text:original,source:source(1)})
  const calls = [[{topic:'facts',key:'release-check',includeSources:true},'read-fact'],
    [{path:'categories/facts/entries/release-check.md'},'read-path'], [{topic:'facts'},'read-filtered-index'], [{},'read-index']]
  const conversationId=h.host.ctx.channels.identity(channelMessage('read-fact')).sessionId
  for (const [args,id] of calls) {
    selector=args;issued=false;settled=false
    await h.receive(channelMessage(id))
    await h.service.whenIdle()
  }
  const router=await h.query('router.get',{conversationId})
  const snapshot=await h.host.ctx.sessionPersistence.readNative(router.activeSessionId,{requireComplete:true})
  assert.equal(snapshot.entries.filter(e=>e.message?.role==='toolResult'&&e.message?.toolName==='memory_read'&&e.message?.isError===false).length,4)

  const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'web-memory-read-fixture',senderId:'fixture-operator',port:0},
    getApplication:()=>({config:{channelPlugins:[]},tasks:h.service}),getMemory:()=>memory,getReflection:()=>h.host.ctx.reflection,getSessionPersistence:()=>h.host.ctx.sessionPersistence})
  try {
    const endpoint=web.origin+'/api/conversations/'+encodeURIComponent(conversationId)+'/session'
    const headers={origin:web.origin}
    assert.equal((await fetch(endpoint+'?stream=1',{headers})).status,401)
    const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
    assert.equal(login.status,200)
    headers.cookie=login.headers.get('set-cookie').split(';')[0]
    const {csrfToken}=await login.json()
    const read=async () => {
      const response=await fetch(endpoint+'?stream=1',{headers})
      assert.equal(response.status,200)
      const page=await response.json()
      assert.equal(page.status,'ready')
      const rows=page.items.filter(row=>row.kind==='tool-result'&&row.toolName==='memory_read')
      assert.equal(rows.length,4)
      assert.doesNotMatch(JSON.stringify(page),/private-fixture-origin|private-fixture-message/)
      return {page,rows}
    }
    // Pending memory authorization behaves like a held lock. An unrelated
    // one-row page and zero-new poll must not queue behind it.
    let narrowPage
    const readHistoryBatch=memory.store.readHistoryBatch
    let batchCalls=0
    const blockedBatch=Promise.withResolvers()
    memory.store.readHistoryBatch=async (...args)=>{batchCalls++;await blockedBatch.promise;return readHistoryBatch.apply(memory.store,args)}
    const events=await fetch(endpoint+'?events=1',{headers,signal:AbortSignal.timeout(nativeTestTimeout(18000))})
    assert.equal(events.status,200)
    const eventReader=events.body.pipeThrough(new TextDecoderStream()).getReader()
    let pending=''
    const nextEvent=async ()=>{
      while(!pending.includes('\n\n')){
        const chunk=await eventReader.read();assert.equal(chunk.done,false,'stream closed before next event');pending+=chunk.value
      }
      const stop=pending.indexOf('\n\n'), frame=pending.slice(0,stop);pending=pending.slice(stop+2)
      assert.ok(!frame.includes(original),'SSE never discloses stored memory text')
      return frame
    }
    const untilEvent=async type=>{for(;;){const frame=await nextEvent();if(frame.startsWith(`event: ${type}\n`))return frame}}
    try {
      await untilEvent('ready')
      await untilEvent('live')
      await untilEvent('heartbeat')
      const first=await fetch(endpoint+'?stream=1&limit=1',{headers,signal:AbortSignal.timeout(3000)})
      const page=narrowPage=await first.json()
      assert.equal(first.status,200)
      assert.equal(page.items.length,1)
      assert.equal(page.resourceProof,undefined)
      assert.doesNotMatch(first.headers.get('Server-Timing')??'',/permissions/)
      const noNew=await fetch(endpoint+'?'+new URLSearchParams({stream:'1',limit:'1',checkpoint:page.checkpoint}),{headers,signal:AbortSignal.timeout(3000)})
      assert.equal(noNew.status,200)
      assert.deepEqual((await noNew.json()).items,[])
      assert.equal(batchCalls,0)
      assert.match(noNew.headers.get('Server-Timing')??'',/journal;dur=/)
      assert.doesNotMatch(noNew.headers.get('Server-Timing')??'',/projection|permissions/)
    } finally {blockedBatch.resolve();memory.store.readHistoryBatch=readHistoryBatch}

    // Loading older history must register any newly exposed resources even
    // though the journal tail anchor does not change.
    const olderURL=endpoint+'?'+new URLSearchParams({stream:'1',limit:'50',checkpoint:narrowPage.checkpoint,before:narrowPage.before})
    const olderResponse=await fetch(olderURL,{headers})
    assert.equal(olderResponse.status,200)
    const older=await olderResponse.json()
    assert.ok(older.resourceProof)
    assert.equal(older.checkpoint,narrowPage.checkpoint+'.r')
    assert.ok(older.items.some(row=>row.resourceContent))
    const timing=Object.fromEntries([...olderResponse.headers.get('Server-Timing').matchAll(/([a-z_]+);dur=([\d.]+)/g)].map(([,name,ms])=>[name,Number(ms)]))
    assert.ok(timing.memory_wait>0,'resource authorization records its real locks')
    assert.ok(timing.memory_wait>=timing.memory_lock_write)
    assert.ok(timing.permissions>=timing.resource_memory_batch)
    assert.equal(timing.resource_memory_recheck,undefined)
    assert.ok(Number.isFinite(timing.memory_lock_release))
    const before=await read()
    assert.deepEqual(before.rows.map(row=>row.resourceContent),[true,true,true,true])
    assert.equal(before.rows[0].text,original)
    assert.equal(before.rows[1].text,original)
    assert.match(before.rows[2].text,/release-check/)

    await memory.store.remember(scope,{topic:'another',key:'checkpoint',text:'无关记忆的已核对内容。',source:source(2)})
    const unrelated=await read()
    assert.equal(unrelated.rows[0].text,original,'unrelated writes do not revoke this exact current record')
    assert.equal(unrelated.rows[1].text,original,'exact canonical links are still checked against current storage')
    assert.equal(unrelated.rows[2].text,before.rows[2].text,'unchanged filtered index remains visible')
    assert.equal(unrelated.rows[3].resourceContent,undefined,'changed root index never replaces the historical result')
    assert.doesNotMatch(unrelated.rows[3].text,/release-check|checkpoint/)
    assert.equal(unrelated.page.revision,before.page.revision,'journal identity does not change with independent grants')
    assert.ok(before.page.resourceProof)
    const stalePoll=new URLSearchParams({stream:'1',checkpoint:older.checkpoint,resources:older.resourceProof})
    assert.equal((await fetch(endpoint+'?'+stalePoll,{headers})).status,409,'an already-disclosed resource must be withdrawn without new journal bytes')
    stalePoll.delete('resources')
    assert.equal((await fetch(endpoint+'?'+stalePoll,{headers})).status,409,'a disclosure-bearing checkpoint cannot be used without its proof')
    assert.equal((await fetch(endpoint+'/messages/'+before.rows[3].id+'?revision='+before.page.revision,{headers})).status,409)
    const body=await fetch(endpoint+'/messages/'+unrelated.rows[0].id+'?revision='+unrelated.page.revision,{headers})
    assert.equal(body.status,200)
    assert.equal((await body.json()).text,original)

    const corrected='如今先核实最新版本；旧步骤停用。'
    await memory.store.remember(scope,{topic:'facts',key:'release-check',text:corrected,expectedRevision:saved.entry.revision,source:source(3)})
    const stale=await read()
    assert.ok(stale.rows.slice(0,2).every(row=>!row.resourceContent&&row.text!==original&&row.text!==corrected))
    assert.ok(stale.rows.slice(2).every(row=>!row.resourceContent))
    assert.doesNotMatch(stale.rows[2].text,/健康探针|最新版本/)
    await memory.store.forget(scope,{topic:'facts',key:'release-check',source:source(4)})
    const forgotten=await read()
    assert.ok(forgotten.rows.slice(0,2).every(row=>!row.resourceContent))
    assert.ok(forgotten.rows.slice(2).every(row=>!row.resourceContent))
    assert.doesNotMatch(forgotten.rows[2].text,/release-check|健康探针/)
    await memory.store.remember(scope,{topic:'facts',key:'release-check',text:original,source:source(5)})
    assert.ok((await read()).rows.slice(0,2).every(row=>!row.resourceContent),'same key and text cannot restore a forgotten identity')
    const logout=await fetch(web.origin+'/api/logout',{method:'POST',headers:{...headers,'content-type':'application/json','x-csrf-token':csrfToken},body:'{}'})
    assert.equal(logout.status,200)
    assert.match(await untilEvent('invalidate'),/"status":401/)
    assert.equal((await eventReader.read()).done,true,'the already open Router stream closes on logout')
  } finally {await web.close()}
})
