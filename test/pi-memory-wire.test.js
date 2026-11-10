import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {randomUUID} from 'node:crypto'
import {hash} from '../src/memory/format.js'

test('default portable Host immediately remembers, corrects and forgets while temporary preferences stay ephemeral',async t=>{
  const f=await memoryHost(t),h=await f.agent('alice',{actorId:'alice'})
  await f.say(h.agent,'记住 preferences/style：简短回答')
  let data=await f.host.ctx.memory.read(h.agent,{topic:'preferences'});assert.equal(data.entries[0].text,'简短回答')
  await f.say(h.agent,'修改记忆 preferences/style：详细回答')
  data=await f.host.ctx.memory.read(h.agent,{topic:'preferences'});assert.equal(data.entries[0].text,'详细回答');assert.equal(data.entries[0].revision,2)
  await f.say(h.agent,'记住 preferences/today：这次用英文')
  assert.equal((await f.host.ctx.memory.read(h.agent,{topic:'preferences',key:'today'})).entries.length,0)
  assert.match(JSON.stringify(f.requests.at(-1)),/Current user instructions/)
  await f.say(h.agent,'忘记 preferences/style')
  assert.equal((await f.host.ctx.memory.search(h.agent,{query:'回答'})).entries.length,0)
  assert.ok(h.agent.piSession.sessionManager.getEntries().some(e=>e.type==='custom_message'&&e.customType==='night.business-input'&&e.content.some(p=>p.text==='记住 preferences/style：简短回答')),'original Pi history retained')
  assert.deepEqual(f.errors,[])
})
test('real model tools read on demand, honor source consent and revoke stale recalled facts after forget',async t=>{
  let stage=0,sourceMessage
  const f=await memoryHost(t,body=>{
    if(stage===1){stage++;return {tool:'memory_read',args:{topic:'preferences'}}}
    if(stage===3){stage++;return {tool:'memory_remember',args:{topic:'preferences',key:'evil',text:'made up',sourceMessageId:sourceMessage,sourceQuote:'made up'}}}
  })
  const h=await f.agent('tools',{actorId:'alice'})
  await f.say(h.agent,'记住 preferences/style：RECALLED_PRIVATE_MARKER')
  stage=1;await f.say(h.agent,'读取我之前保存的偏好')
  assert.match(JSON.stringify(f.requests.at(-1)),/RECALLED_PRIVATE_MARKER/)
  await f.say(h.agent,'忘记 preferences/style')
  const latest=f.requests.at(-1);assert.ok(latest.messages.some(m=>m.role==='tool'&&String(m.content).includes('revoked')))
  sourceMessage='not-current';stage=3;await f.say(h.agent,'普通聊天，不授权保存')
  assert.equal((await f.host.ctx.memory.read(h.agent,{topic:'preferences',key:'evil'})).entries.length,0)
  assert.match(JSON.stringify(f.requests.at(-1)),/MEMORY_EXPLICIT_AUTHORIZATION_REQUIRED/)
})
test('authenticated users and channels share Bot memory while message authority remains bound',async t=>{
  const f=await memoryHost(t),a=await f.agent('a',{actorId:'alice'}),b=await f.agent('b',{actorId:'bob'}),g1=await f.agent('g1',{actorId:'alice',groupId:'one',groupWrite:true}),g2=await f.agent('g2',{actorId:'alice',groupId:'two',groupWrite:true}),p=await f.agent('p',{actorId:'alice',projects:[{id:'p1',write:true}]})
  await f.say(a.agent,'记住 preferences/style：ONLY_ALICE');await f.say(g1.agent,'记住 本群 facts/name：ONLY_GROUP_ONE')
  assert.equal((await f.host.ctx.memory.search(b.agent,{query:'ONLY'})).entries.length,2)
  assert.equal((await f.host.ctx.memory.search(g2.agent,{query:'ONLY'})).entries.length,2)
  assert.equal((await f.host.ctx.memory.read(g1.agent,{scope:'personal',topic:'preferences'})).entries[0].text,'ONLY_ALICE')
  await f.say(p.agent,'记住 项目[p1] facts/version：v2')
  assert.equal((await f.host.ctx.memory.read(p.agent,{scope:'project',projectId:'p2',topic:'facts',key:'version'})).entries[0].text,'v2')
  assert.equal((await f.host.ctx.memory.read(p.agent,{scope:'project',projectId:'p1',topic:'facts',key:'version'})).entries[0].text,'v2')
})
test('bindings and Markdown facts survive a real default Host cold reopen',async t=>{
  const f=await memoryHost(t),h=await f.agent('cold',{actorId:'alice'});await f.say(h.agent,'记住 facts/project：night-bot')
  await f.close();await f.boot()
  const result=await f.host.ctx.agents.resume({resumeSessionId:'cold',agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:ctx=>f.host.ctx.agentPresets.mount(ctx,'night-bot')});assert.ok(result.agent)
  assert.equal((await f.host.ctx.memory.read(result.agent,{topic:'facts'})).entries[0].text,'night-bot')
  await f.say(result.agent,'忘记 facts/project');assert.equal((await f.host.ctx.memory.read(result.agent,{topic:'facts'})).entries.length,0)
})
test('ordinary completed turns extract literal candidates in background without promoting them',async t=>{
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_MEMORY_CANDIDATES')){const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content);return {text:JSON.stringify({candidates:[{topic:'preferences',key:'format',messageId:input[0].messageId,quote:'我长期偏好文字说明'}]})}}
  },{background:true})
  const h=await f.agent('candidates',{actorId:'alice'})
  await f.say(h.agent,'我长期偏好文字说明')
  assert.equal((await f.host.ctx.memory.search(h.agent,{query:'文字'})).entries.length,0)
  assert.equal((await f.host.ctx.memory.read(h.agent,{candidates:true})).entries.length,1)
  await f.say(h.agent,'记住候选 preferences/format')
  assert.equal((await f.host.ctx.memory.read(h.agent,{topic:'preferences'})).entries[0].text,'我长期偏好文字说明')
  assert.equal((await f.host.ctx.memory.read(h.agent,{candidates:true})).entries.length,0)
})
test('secrets are refused with failure feedback and never reach Markdown memory files',async t=>{
  const f=await memoryHost(t),h=await f.agent('secrets',{actorId:'alice'})
  await f.say(h.agent,'记住 preferences/password：password: DO_NOT_PERSIST_THIS')
  assert.equal((await f.host.ctx.memory.read(h.agent,{topic:'preferences'})).entries.length,0)
  assert.match(JSON.stringify(f.requests.at(-1)),/MEMORY_SECRET_REFUSED/)
})

test('an in-flight candidate extraction cannot resurrect a fact forgotten by a later user turn',async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers()
  const f=await memoryHost(t,async body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_MEMORY_CANDIDATES')){const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content);entered.resolve();await release.promise;return {text:JSON.stringify({candidates:[{topic:'preferences',key:'format',messageId:input[0].messageId,quote:'我长期偏好文字说明'}]})}}
  },{background:true})
  t.after(()=>release.resolve())
  const h=await f.agent('race',{actorId:'alice'})
  const first=f.say(h.agent,'我长期偏好文字说明');await entered.promise
  const forget={id:randomUUID(),source:{kind:'user'},content:[{type:'text',text:'忘记 preferences/format'}]};await h.agent.input.enqueue(forget);await h.agent.input.deliver(forget.id);await h.agent.whenIdle()
  release.resolve();await first;await f.host.ctx.memory.whenIdle()
  assert.equal((await f.host.ctx.memory.read(h.agent,{candidates:true})).entries.length,0)
  assert.equal((await f.host.ctx.memory.search(h.agent,{query:'文字'})).entries.length,0)
  assert.equal((await f.host.ctx.memory.status(h.agent)).maintenanceCode,'MEMORY_SCOPE_CHANGED')
})

test('unbound sessions receive failure feedback and a session cannot be reassigned to another user',async t=>{
  const f=await memoryHost(t),h=await f.agent('unbound')
  await f.say(h.agent,'记住 preferences/style：简短回答')
  assert.match(JSON.stringify(f.requests.at(-1)),/MEMORY_SESSION_UNBOUND/)
  await f.host.ctx.memory.bindSession('unbound',{actorId:'alice'})
  await assert.rejects(f.host.ctx.memory.bindSession('unbound',{actorId:'bob'}),/REBIND_REQUIRED/)
})

test('read-only and group read-only bindings cannot persist or forget memory',async t=>{
  const f=await memoryHost(t),h=await f.agent('readonly',{actorId:'alice'}),g=await f.agent('group-readonly',{actorId:'alice',groupId:'group'})
  await h.agent.ctx.get('permissionPresets').set(h.agent,'read-only')
  await f.say(h.agent,'记住 preferences/style：不可持久化')
  assert.match(JSON.stringify(f.requests.at(-1)),/MEMORY_READ_ONLY/)
  await f.say(g.agent,'记住 本群 facts/name：不可群写')
  assert.match(JSON.stringify(f.requests.at(-1)),/MEMORY_SCOPE_FORBIDDEN/)
  assert.equal((await f.host.ctx.memory.read(h.agent,{topic:'preferences'})).entries.length,0)
})

test('generic model file tools cannot bypass the shared memory service through raw application files',async t=>{
  let path,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'read',args:{path:path}}}})
  const a=await f.agent('private-a',{actorId:'alice'}),b=await f.agent('private-b',{actorId:'bob'})
  await f.say(a.agent,'记住 facts/value：PRIVATE_BODY_FROM_FILE')
  const scope=await f.host.ctx.memory.scope(a.agent,{})
  path=join(f.host.ctx.memory.store.directory(scope),'topics',hash('facts')+'.md')
  attempt=true;await f.say(b.agent,'try reading this raw application file')
  assert.doesNotMatch(JSON.stringify(f.requests.at(-1)),/PRIVATE_BODY_FROM_FILE/)
  assert.match(JSON.stringify(f.requests.at(-1)),/private|sandbox|denied/i)
})

test('native memory tool accepts context with Host-bound subject and shares it as reference-only for another actor',async t=>{
  const text='以后请默认用简短文字汇报。',background='本次汇报已另附一份报告。',context={background:{source:'quote',quote:background},scenario:'工作结果汇报',boundaries:['当前明确要求的文件照常交付。']}
  let stage=0,outcome
  const f=await memoryHost(t,body=>{
    if(stage++===0){
      assert.ok(body.tools.find(row=>row.function.name==='memory_remember').function.parameters.properties.context)
      return {tool:'memory_remember',args:{topic:'preferences',key:'reports',text,sourceMessageId:'native-context-source',sourceQuote:text,context}}
    }
    if(body.messages.at(-1).role==='tool'){outcome=JSON.parse(body.messages.at(-1).content);assert.equal(outcome.ok,true);assert.equal(outcome.entry.context.subject.actor,hash('alice'));assert.equal(outcome.entry.context.interpretation.status,'inference')}
    return {text:'Memory transaction has succeeded.'}
  })
  const a=await f.agent('context-alice',{actorId:'alice'}),packet={id:'native-context-source',source:{kind:'user',quotedMessage:{messageId:'native-quoted-report',text:background}},content:[{type:'text',text}]}
  await a.agent.input.enqueue(packet);await a.agent.input.deliver(packet.id);await a.agent.whenIdle()
  assert.equal(outcome.entry.text,text);assert.equal(outcome.entry.context.background.messageId,'native-quoted-report');assert.equal(outcome.entry.context.background.quote,background)
  const b=await f.agent('context-bob',{actorId:'bob'}),read=await f.host.ctx.memory.search(b.agent,{query:'工作结果汇报'})
  assert.equal(read.entries[0].applicability.status,'reference-only');assert.deepEqual(read.entries[0].context,outcome.entry.context)
  const own=await f.host.ctx.memory.read(a.agent,{topic:'preferences'})
  assert.equal(own.entries[0].applicability.status,'matching-subject');assert.deepEqual(own.entries[0].applicability.sourceMessageIds,[packet.id])
})
