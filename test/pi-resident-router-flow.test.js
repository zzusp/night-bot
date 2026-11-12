import test from 'node:test'
import assert from 'node:assert/strict'
import {hash} from '../src/memory/format.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools,eventually} from './fixtures/resident-router-host.js'

const triage=body=>requestEnvelope(body,'一级分诊请求：')
const router=body=>requestEnvelope(body,'Router 请求：')
function memoryToolResult(body){
  const content=body.messages.at(-1).content
  try{return JSON.parse(content)}catch{throw Error('Expected structured memory result, received: '+content)}
}
function memoryDraft(source,context={scenario:'面向原提出者的后续答复。',boundaries:['当前明确要求优先，不推广给其他人。']}){
  return {summary:source.text,why:'原提出者明确给出的长期要求。',howToApply:context.boundaries.join(' '),
    appliesTo:{kind:'actor',description:context.scenario},
    evidence:[{id:'E1',source:'message',sourceId:source.sourceId,messageVersion:source.version,quote:source.text},
      ...context.background?[{id:'E2',source:context.background.source,sourceId:source.sourceId,messageVersion:source.version,quote:context.background.quote}]:[]]}
}
function handoff(body) {
  const input=requestEnvelope(body,'Router 交接请求：')
  if(!input||requestTools(body).length)return
  return {text:JSON.stringify({currentIntent:'Retain necessary original source references and consult the current task ledger',
    unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}
}
function submit(input,select) {
  return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({sourceId:message.sourceId,
    messageVersion:message.version??message.messageVersion,...select(message),reason:'Use the directly available original context'}))}}
}
function settle(body,input) {
  if(body.messages.at(-1)?.role==='tool')return {text:'The necessary business disposition is committed.'}
  return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.eventId).join(',')}}
}

test('explicit channel preference is accepted memory before acknowledgement and survives cold cross-conversation recall',{timeout:nativeTestTimeout(180000)},async t=>{
  const preference='以后没说要提供文档，就不用附报告文档',background='随附部署报告，包含验证证据、部署前版本、回滚路径和验证边界。'
  const context={background:{source:'quote',quote:background},scenario:'面向原提出者的工作结果汇报，原例为部署验证后的额外报告。',boundaries:['未明确要求时不额外附报告；明确要求的文档及成果文件照常交付。','不禁止其他附件，也不限制内部验收证据或必要代码文档；当前明确要求优先。']}
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
  const steps=new Map(),recalls=[];let writes=0,historyRebound=false,recallSession
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
      if(step===0&&source.text===preference){writes++;return {tool:'resident_memory_remember',args:{sourceId:source.sourceId,messageVersion:source.version,topic:'preferences',key:'report-documents',sourceQuote:preference,memory:memoryDraft(source,context)}}}
      if(step===0){
        assert.ok(requestTools(body).includes('memory_search'),'Router exposes its scoped memory reader')
        if(source.messageId==='bob-same-router'){
          assert.equal((await h.query('router.get',{conversationId:input.conversationId})).activeSessionId,recallSession,'queued second author runs before generation handoff')
          const prior=body.messages.filter(row=>row.role==='tool').flatMap(row=>{try{return JSON.parse(row.content).entries??[]}catch{return []}}).filter(row=>row.key==='report-documents')
          assert.ok(prior.length,'previous recall remains in this Router history')
          assert.ok(prior.every(row=>row.applicability.status==='reference-only'),'old tool results are rebound without a memory revision change');historyRebound=true
        }
        if(source.messageId==='explicit-document-request'){
          assert.match(JSON.stringify(body),/这次明确要求提供报告文档/)
          assert.match(JSON.stringify(body),/Current explicit deliverable requirements override prior preferences/)
        }
        return {tool:'memory_search',args:{query:'工作结果汇报',topic:'preferences',mode:'fulltext',includeSources:true}}
      }
      if(step===1){
        const result=memoryToolResult(body)
        if(source.text===preference){assert.equal(result.ok,true);assert.equal(result.persisted,true);assert.match(result.entry.text,/Summary:/);assert.equal(result.entry.context.summary,preference)}
        else {
          const recalled=result.entries.find(entry=>entry.key==='report-documents')
          assert.ok(recalled,'scenario search returns the original preference with context')
          assert.deepEqual(recalled.context,entry.context)
          assert.equal(recalled.applicability.status,source.messageId==='bob-same-router'?'reference-only':'matching-subject')
          assert.deepEqual(recalled.applicability.sourceMessageIds,source.messageId==='bob-same-router'?[]:[source.sourceId])
          recalls.push({messageId:source.messageId,status:recalled.applicability.status})
          if(source.messageId==='recall-after-cold-reopen'){entered.resolve();await release.promise}
        }
        return {tool:'resident_router_reply',args:{operationId:'memory-ack:'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,text:source.text===preference?'已保存这个长期偏好。':'已读回长期偏好：未要求文档时不附报告文档。'}}
      }
      if(step===2)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'memory-settle:'+source.messageId}}
      return {text:'Preference handling is committed.'}
    }
    return {text:'No other work'}
  })
  const message=channelMessage('durable-report-preference',{text:preference,quotedMessage:{messageId:'deployment-summary',senderId:'assistant',text:'验证完成。'+background+'不相关的额外背景。'}})
  await h.receive(message);await h.service.whenIdle()
  const original=(await h.query('source.list')).find(source=>source.messageId===message.messageId)
  const scope={kind:'bot',id:hash('bot:shared')}
  const saved=await h.host.ctx.memory.store.read(scope,{topic:'preferences',key:'report-documents',includeSources:true}),entry=saved.entries[0]
  assert.notEqual(entry.text,preference);assert.equal(entry.context.summary,preference);assert.equal(entry.source.messageId,original.sourceId)
  assert.equal(entry.context.subject.actor,hash(original.actorId));assert.equal(entry.context.evidence[1].quote,background)
  assert.equal(entry.context.evidence[1].messageId,'deployment-summary');assert.equal(entry.context.evidence[1].quoteSha256,hash(background))
  assert.equal(entry.context.version,3);assert.equal(entry.context.howToApply,context.boundaries.join(' '))
  assert.doesNotMatch(JSON.stringify(entry.context),/不相关的额外背景/)
  assert.equal(entry.source.actor,hash(original.actorId));assert.equal(entry.source.quoteSha256,hash(preference))
  assert.equal(entry.provenance.messageId,message.messageId);assert.equal(entry.provenance.conversationId,message.conversationId)
  assert.equal((await h.host.ctx.memory.store.read({kind:'bot',id:hash('bot:shared')},{candidates:true})).entries.length,0)
  assert.equal((await h.query('task.list')).length,0)
  assert.equal((await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(message).sessionId})).length,0)
  const active=await h.query('router.get',{conversationId:h.host.ctx.channels.identity(message).sessionId})
  await assert.rejects(h.host.ctx.memory.scope(h.host.ctx.agents.get(active.activeSessionId),{},true),{code:'MEMORY_SCOPE_FORBIDDEN'},'ordinary group Router write grant remains closed')
  const priorRequests=h.requests.length,priorSends=h.sent.length
  await h.restart();await h.receive(message);await h.service.whenIdle()
  assert.equal(h.requests.length,priorRequests,'cold replay never re-infers or rewrites a consumed source')
  assert.equal(h.sent.length,priorSends,'acknowledgement is not resent')
  assert.equal((await h.host.ctx.memory.store.read(scope,{topic:'preferences',key:'report-documents'})).entries[0].revision,1)
  await h.receive(channelMessage('recall-after-cold-reopen',{conversationId:'different-room',text:'查一下之前的交付偏好。'}));await entered.promise
  const recallConversation=h.host.ctx.channels.identity(channelMessage('id',{conversationId:'different-room'})).sessionId
  recallSession=(await h.query('router.get',{conversationId:recallConversation})).activeSessionId
  await h.receive(channelMessage('bob-same-router',{conversationId:'different-room',senderId:'bob',text:'也查一下我适用的交付偏好。'}))
  await eventually(async()=> (await h.query('router.inbox',{conversationId:recallConversation})).length===2,'second author durably queued during first recall')
  release.resolve();await h.service.whenIdle()
  await h.receive(channelMessage('explicit-document-request',{conversationId:'different-room',text:'这次明确要求提供报告文档，请先说明交付安排。'}));await h.service.whenIdle()
  assert.equal(writes,1);assert.equal(h.sent.length,4);assert.equal(historyRebound,true)
  assert.deepEqual(recalls.map(row=>row.status),['matching-subject','reference-only','matching-subject'])
  assert.ok(h.results.some(result=>result.name==='memory_search'&&result.result.value?.entries?.some(row=>row.key==='report-documents')))
  assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'channel-preference-memory',accepted:true,candidate:false,memoryRevision:saved.revision,entryRevision:entry.revision,quoteSha256:entry.source.quoteSha256,diskHashVerified:true,originalActorAndMessageBound:true,groupRouterWriteGrantUnchanged:true,writeBeforeAcknowledgement:true,coldRestart:true,crossConversationRecall:true,contextVerified:true,scenarioSearch:true,subjectApplicability:recalls.map(row=>row.status),historicalResultRebound:historyRebound,currentDocumentRequestPreserved:true,replayWrites:0,realVendorMessages:0}))
})

test('channel memory follows Router decisions while preserving current source and literal evidence boundaries',{timeout:nativeTestTimeout(150000)},async t=>{
  const cases=[
    {id:'valid-source',text:'以后请优先用简短回答。',ok:true},
    {id:'addressed-repository-request',text:'小小鹏，你要记住最好每个代码仓库维护一个固定的目录，每次分析排查某个代码仓库时，拉取最新的代码就行，这样不用每次都重新拉取整个代码仓库',ok:true},
    {id:'authorized-repository-request',text:'我授权你将以下习惯保存为长期记忆：每个代码仓库维护一个固定目录；每次分析排查时复用该目录并更新代码，避免重复克隆，保留已有本地改动。',ok:true},
    {id:'background-before-request',text:'小助手，代码仓库、生产只读数据库、线上 K3S 其他 Pod 日志、Redis 和 OSS 的访问都已经可达了，请你记住访问方式或沉淀skill，在后续你的日常工作中，这些内容你会经常用到。对了漏了一个 playwright 无头浏览网页，这个也会很常用',ok:true},
    {id:'router-selected-fact',text:'仓库检索使用已有固定目录，并保留本地改动。',ok:true},
    {id:'durable-fact-with-temporary-word',text:'今天的复盘确认了长期约定：全部渠道共享Bot学习库。',ok:true},
    {id:'historical-source',text:'查一下当前状态。',borrow:true,code:'MEMORY_CURRENT_SOURCE_REQUIRED'},
    {id:'foreign-source',text:'请看另一会话的进度。',borrow:true,room:'foreign-room',code:'ROUTER_SOURCE_FORBIDDEN'},
    {id:'stale-version',text:'以后请直接说明结论。',version:2,code:'ROUTER_SOURCE_FORBIDDEN'},
    {id:'quoted-source',text:'这是他人说过的话。',quote:'以后请不要附报告。',code:'MEMORY_SOURCE_QUOTE_REQUIRED'},
    {id:'shortened-condition',text:'以后没要求文档时，不用附报告。',short:'不用附报告。',code:'MEMORY_SOURCE_QUOTE_REQUIRED'},
    {id:'context-required',text:'以后请默认先说结论。',shortEvidence:true,code:'MEMORY_SOURCE_QUOTE_REQUIRED'},
    {id:'foreign-evidence',text:'请记住这个项目背景。',room:'evidence-foreign-room',evidenceBorrow:true,code:'ROUTER_SOURCE_FORBIDDEN'},
    {id:'old-evidence-version',text:'保存当前消息的背景。',evidenceVersion:2,code:'ROUTER_SOURCE_FORBIDDEN'},
    {id:'missing-evidence-source',text:'请保留这个背景。',evidenceMissing:true,code:'ROUTER_SOURCE_FORBIDDEN'},
    {id:'missing-why',text:'后续使用该编辑器看板。',missingWhy:true},
    {id:'duplicate-evidence-id',text:'这个信息需要保留。',duplicateEvidence:true,code:'MEMORY_EVIDENCE_INVALID'},
    {id:'speculation-refused',text:'这是一条直接原消息。',speculation:true},
    {id:'context-forged-quote',text:'以后请直接用文字汇报。',context:{background:{source:'quote',quote:'伪造的背景片段'},scenario:'工作汇报',boundaries:['当前明确要求优先']},code:'MEMORY_CONTEXT_SOURCE_REQUIRED'},
    {id:'context-secret',text:'以后请优先用中文汇报。',context:{scenario:'password: never-store-in-context',boundaries:['当前要求优先']},code:'MEMORY_SECRET_REFUSED'},
    {id:'secret-preference',text:'以后请使用密码：never-store-this-value',code:'MEMORY_SECRET_REFUSED'},
  ],steps=new Map(),outcomes=new Map();let borrowed,h
  h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      const item=cases.find(row=>row.id===source.messageId),step=steps.get(item.id)??0;steps.set(item.id,step+1)
      if(step===0){if(item.ok)borrowed=source;const text=item.short??item.quote??item.text
        const memory=memoryDraft(source,item.context);if(item.shortEvidence)memory.evidence[0].quote=source.text.slice(1)
        if(item.evidenceBorrow)memory.evidence.push({id:'E2',source:'message',sourceId:borrowed.sourceId,messageVersion:borrowed.version,quote:borrowed.text})
        if(item.evidenceVersion)memory.evidence[0].messageVersion=item.evidenceVersion
        if(item.evidenceMissing)memory.evidence[0].sourceId='missing-source'
        if(item.missingWhy)delete memory.why
        if(item.duplicateEvidence)memory.evidence.push({...memory.evidence[0]})
        if(item.speculation)memory.hypothesis='未经证实的推测'
        return {tool:'resident_memory_remember',args:{sourceId:item.borrow?borrowed.sourceId:source.sourceId,messageVersion:item.version??(item.borrow?borrowed.version:source.version),topic:'preferences',key:item.id,sourceQuote:text,memory}}}
      if(step===1){outcomes.set(item.id,item.missingWhy||item.speculation?body.messages.at(-1).content:memoryToolResult(body));return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'reject-settle:'+item.id}}}
      return {text:'The memory outcome was inspected.'}
    }
    return {text:'No other work'}
  })
  for(const item of cases){await h.receive(channelMessage(item.id,{text:item.text,...item.room?{conversationId:item.room}:{},...item.quote?{quotedMessage:{messageId:'quoted-prior',senderId:'bob',text:item.quote}}:{}}));await h.service.whenIdle()}
  for(const item of cases){const result=outcomes.get(item.id);assert.ok(result,item.id)
    if(item.ok){assert.equal(result.persisted,true,item.id);continue}
    if(item.missingWhy||item.speculation){assert.equal(typeof result,'string');assert.match(result,/invalid arguments/);assert.match(result,item.missingWhy?/memory.why/:/hypothesis/);continue}
    assert.equal(result.ok,false,item.id);assert.equal(result.code,item.code,item.id)
  }
  const saved=await h.host.ctx.memory.store.read({kind:'bot',id:hash('bot:shared')},{topic:'preferences'})
  const originals=await h.query('source.list')
  assert.deepEqual(saved.entries.map(row=>row.key).sort(),cases.filter(item=>item.ok).map(item=>item.id).sort())
  for(const item of cases.filter(item=>item.ok)){
    const entry=saved.entries.find(row=>row.key===item.id),original=originals.find(source=>source.messageId===item.id)
    assert.equal(entry.context.summary,item.text);assert.equal(entry.source.messageId,original.sourceId)
    assert.equal(entry.source.actor,hash(original.actorId));assert.equal(entry.source.quoteSha256,hash(item.text))
  }
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'channel-memory-authority',checks:cases.length,routerDecidesWithoutPhraseGate:true,currentSourceAndFullQuoteRequired:true,secretRefused:true}))
})

test('read-only Router reports actual memory and Skill refusals without persisting either',{timeout:nativeTestTimeout(40000)},async t=>{
  let h,step=0,outcome,skillOutcome
  h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events[0]?.source
      if(!source)return settle(body,input)
      if(step++===0){const row=await h.query('router.get',{conversationId:input.conversationId});const actor=h.host.ctx.agents.get(row.activeSessionId);await actor.ctx.get('permissionPresets').set(actor,'read-only')
        return {tool:'resident_memory_remember',args:{sourceId:source.sourceId,messageVersion:source.version,topic:'preferences',key:'read-only-preference',memory:memoryDraft(source),sourceQuote:source.text}}}
      if(step===2){outcome=memoryToolResult(body);assert.equal(outcome.ok,false);assert.equal(outcome.code,'MEMORY_READ_ONLY')
        return {tool:'resident_skill_mutate',args:{operationId:'readonly-skill',sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,action:'upsert',key:'readonly-skill',steps:['先读证据'],reason:'复用方法',applicability:'日常检索'}}}
      if(step===3){skillOutcome=memoryToolResult(body);assert.equal(skillOutcome.code,'MEMORY_READ_ONLY')
        return {tool:'resident_router_reply',args:{operationId:'readonly-memory-failure',sourceId:source.sourceId,messageVersion:source.version,text:'当前只读权限下没有保存这个长期偏好或Skill。'}}}
      if(step===4)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'readonly-settle'}}
      return {text:'No memory was saved.'}
    }
    return {text:'No other work'}
  })
  await h.receive(channelMessage('readonly-memory',{text:'以后请不要附报告文档。'}));await h.service.whenIdle()
  assert.equal(outcome.code,'MEMORY_READ_ONLY');assert.equal(skillOutcome.code,'MEMORY_READ_ONLY')
  assert.deepEqual((await h.host.ctx.reflection.readSkills({kind:'bot',id:hash('bot:shared')})).entries,[])
  assert.equal((await h.host.ctx.memory.store.read({kind:'bot',id:hash('bot:shared')},{topic:'preferences'})).entries.length,0)
  assert.equal(h.sent.length,1);assert.match(h.sent[0].text,/没有保存/)
})

test('all four default dispositions keep original handling independent of an unknown short reply and survive cold deduplication',{timeout:nativeTestTimeout(40000)},async t=>{
  const observed=[],handoffs=[];let h
  h=await residentRouterHost(t,body=>{
    const summary=handoff(body)
    if(summary){handoffs.push(body);return summary}
    const first=triage(body)
    if(requestTools(body).includes('channel_triage_submit'))return submit(first,source=>({needsHandling:source.text.includes('HANDLE'),
      ...source.text.includes('REPLY')?{reply:'Concise '+source.messageId}:{}}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);observed.push(input);return settle(body,input)}
    return {text:'No other work'}
  },{send:async()=>{throw Error('Simulated lost acknowledgement after external send')},readback:async()=>{throw Error('Readback not yet available')}})
  const originals=[channelMessage('silent',{text:'QUIET'}),channelMessage('reply',{text:'REPLY'}),
    channelMessage('handle',{text:'HANDLE',quotedMessage:{messageId:'prior',senderId:'bob',text:'Quoted source only'}}),
    channelMessage('both',{text:'HANDLE REPLY',senderId:'bob'})]
  for(const input of originals)await h.receive(input)
  await eventually(async()=>(await h.query('source.list')).filter(source=>source.routed).length===4,'all first-tier dispositions durably committed',t.signal)
  await h.service.whenIdle()
  const handled=new Map(observed.flatMap(input=>input.events).filter(event=>event.sourceId).map(event=>[event.source.messageId,event.source]))
  assert.deepEqual([...handled.keys()].sort(),['both','handle'])
  for(const input of originals.filter(input=>input.text.includes('HANDLE'))){const source=handled.get(input.messageId)
    assert.equal(source.text,input.text);assert.equal(source.version,1);assert.ok(source.actorId)
    if(input.quotedMessage){assert.equal(source.quote.messageId,input.quotedMessage.messageId);assert.match(JSON.stringify(source.quote),/Quoted source only/)}
  }
  assert.equal(h.sent.length,2);assert.equal(new Set(h.sent.map(envelope=>envelope.deliveryKey)).size,2)
  const notices=(await h.query('notification.list')).filter(notice=>notice.kind==='triage-reply')
  assert.equal(notices.length,2);assert.ok(notices.every(notice=>notice.state==='unknown'))
  assert.ok(observed.flatMap(input=>input.events).find(event=>event.source?.messageId==='both')?.triageReply,'Router sees the independently prepared short reply')
  assert.equal((await h.query('task.list')).length,0,'handled dialogue can settle without empty task creation')
  assert.ok(handoffs.length>0);assert.ok(handoffs.every(body=>requestTools(body).length===0),'idle handoff must be tool-free')
  assert.equal((await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(originals[0]).sessionId})).length,0)
  const sendCount=h.sent.length,requestCount=h.requests.length
  await h.restart()
  for(const input of originals)await h.receive(input)
  await h.service.whenIdle()
  assert.equal(h.sent.length,sendCount,'unknown short replies are never resent after cold restart')
  assert.equal(h.requests.length,requestCount,'committed dispositions and Router actions are not replayed after cold restart')
})

test('durable receipt echoes tolerate later DWS flags without replacing existing message facts',{timeout:nativeTestTimeout(40000)},async t=>{
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path'),{hash}=await import('../src/memory/format.js'),{apply:applyDws,validateConfig:validateDws}=await import('../src/channels/plugins/dingtalk-dws.js')
  const sent=[],readbacks=[],revisionReads=[],at=new Date().toISOString(),flag=(args,key)=>args[args.indexOf(key)+1]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),source=>({needsHandling:false,...source.text==='Original request receipt-original'?{reply:'Bounded synthetic reply'}:{}}))
    return {text:'No additional business work'}
  })
  const runner={async run(args){
    let value
    if(args[0]==='profile')value={success:true,profiles:[{profile:'synthetic-corp:synthetic-user',corpId:'synthetic-corp',userId:'synthetic-user',userName:'Synthetic Self',isOrgCurrent:true}]}
    else if(args.includes('get-self'))value={result:[{orgEmployeeModel:{corpId:'synthetic-corp',userId:'synthetic-user',orgUserName:'Synthetic Self'}}]}
    else if(args.includes('+search-user'))value={ok:true,outcome:'success',data:{count:1,users:[{userId:'synthetic-user',openDingTalkId:'same-account'}]}}
    else if(args.includes('conversation-info'))value={success:true,result:{conversationInfo:{openConversationId:flag(args,'--group'),singleChat:false},friendlyHint:'',retryable:false}}
    else if(args.includes('+messages-send')||args[1]==='message'&&args[2]==='reply'){
      const message={messageId:'synthetic-visible-'+(sent.length+1),conversationId:flag(args,'--group'),text:flag(args,args.includes('--content')?'--content':'--markdown'),senderOpenDingTalkId:'same-account',openTaskId:'synthetic-send-'+(sent.length+1)}
      sent.push(message);value={sendReceipt:{openTaskId:message.openTaskId}}
    }else if(args.includes('+messages-query-send-status')){
      const message=sent.find(row=>row.openTaskId===flag(args,'--open-task-id'));value={result:{sendStatus:'SUCCESS',openConversationId:message.conversationId,openMessageId:message.messageId}}
    }else if(args.includes('+messages-mget')){
      const id=flag(args,'--msg-ids');let message=sent.find(row=>row.messageId===id)
      if(message)readbacks.push(message)
      else if(id===original.messageId){revisionReads.push(id);message={messageId:id,conversationId:original.conversationId,senderOpenDingTalkId:original.senderId,text:original.text,createTime:at}}
      value={complete:true,hasMore:false,failedCount:0,failures:[],foundCount:message?1:0,notFoundMessageIds:message?[]:[id],messages:message?[message]:[]}
    }else throw Error('Unexpected synthetic DWS command: '+args.slice(0,3).join(' '))
    return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
  },spawn(){throw Error('No listener in the local receipt regression')}}
  async function mount(channelId='dingtalk-dws',groupId='shared-room'){
    const ctx=h.host.ctx,config={...validateDws({dingtalk_profile:'synthetic-corp:synthetic-user',dingtalk_conversation_type:'chat-room',dingtalk_group_id:groupId,dingtalk_listen:false,dingtalk_writes_authorized:true}),enabled:true,channelId}
    await ctx.plugin({inject:['channels','runtimePaths'],apply:child=>applyDws(child,config,{runner,environment:{USERPROFILE:h.root,HOME:h.root,DWS_CONFIG_DIR:h.root,DWS_KEYCHAIN_DIR:h.root}})})
    await ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:h.service})
    const plugin=ctx.channels.plugins.get(channelId);assert.equal(plugin.health.state,'ready',JSON.stringify(plugin.health));return plugin
  }
  let plugin=await mount()
  const receive=(input,target=plugin)=>target.acceptHistoryMessage({groupId:input.conversationId,messageId:input.messageId,senderOpenDingTalkId:input.senderId,text:input.text,occurredAt:at,...input.platformFlags?.messageAiSendFlag?{messageAiSendFlag:input.platformFlags.messageAiSendFlag}:{}})
  const original=channelMessage('receipt-original',{channelId:'dingtalk-dws'}),channels=h.host.ctx.channels,identity=channels.identity(original)
  await receive(original);await h.service.whenIdle()
  const notices=await h.query('notification.list'),notice=notices.find(row=>row.state==='delivered')
  assert.ok(notice);assert.equal(sent.length,1);assert.equal(readbacks.length,1)
  const echo=channelMessage(notice.receipt.messageId,{channelId:'dingtalk-dws',senderId:'same-account',text:sent[0].text})
  // 复现原部署在精确回声过滤前已持久登记的事实，必须保留七字段摘要。
  await channels.registerConversation(echo)
  const file=join(h.host.ctx.runtimePaths.state,'channels','contexts.json'),saved=JSON.parse(await readFile(file,'utf8'))
  for(const input of [original,echo])assert.equal(saved[identity.sessionId].messageFacts[input.messageId].payloadHash,hash(JSON.stringify([channels.identity(input).principal,input.text,[],null,null,[],{}])))
  const beforeFacts=structuredClone(saved[identity.sessionId].messageFacts),requests=h.requests.length,sends=sent.length
  await h.restart();plugin=await mount()
  await receive(original)
  assert.equal((await receive({...echo,platformFlags:{messageAiSendFlag:'DWS',automated:true}})).reason,'own-notification')
  await h.service.whenIdle()
  assert.equal(h.requests.length,requests);assert.equal(sent.length,sends)
  assert.equal((await h.query('source.list')).length,1);assert.equal((await h.query('task.list')).length,0)
  assert.deepEqual(JSON.parse(await readFile(file,'utf8'))[identity.sessionId].messageFacts,beforeFacts,'cold replay and receipt echo preserve existing facts')
  const beforeSources=await h.query('source.list')
  const enriched=await receive({...original,platformFlags:{messageAiSendFlag:'DWS',automated:true}})
  assert.equal(enriched.accepted,false);assert.equal(enriched.duplicate,true);assert.equal(enriched.reason,'retained-source')
  await h.service.whenIdle()
  assert.equal(h.requests.length,requests);assert.equal(sent.length,sends)
  assert.deepEqual(await h.query('source.list'),beforeSources)
  assert.deepEqual(JSON.parse(await readFile(file,'utf8'))[identity.sessionId].messageFacts,beforeFacts,'proven historical flag enrichment never replaces frozen facts')
  for(const platformFlags of [undefined,{messageAiSendFlag:'DWS',automated:true}]){
    await receive({...original,text:'Changed actual content',...platformFlags?{platformFlags}:{}})
    await assert.rejects(receive({...original,senderId:'foreign-actor',...platformFlags?{platformFlags}:{}}),{code:'CHANNEL_MESSAGE_ID_CONFLICT'})
  }
  assert.deepEqual(revisionReads,[original.messageId,original.messageId],'迟到差异必须精确回读当前版本')
  await h.service.whenIdle()
  assert.deepEqual(await h.query('source.list'),beforeSources)
  assert.deepEqual(JSON.parse(await readFile(file,'utf8'))[identity.sessionId].messageFacts,beforeFacts)
  assert.equal(h.requests.length,requests);assert.equal(sent.length,sends)
  await assert.rejects(h.host.ctx.channels.registerConversation({...original,platformFlags:{messageAiSendFlag:'DWS',automated:true,unproven:true}}),{code:'CHANNEL_MESSAGE_ID_CONFLICT'},'core fingerprint stays strict; only the plugin may consume a proven routed duplicate')
  const fresh={...echo,messageId:'fresh-same-account',platformFlags:{messageAiSendFlag:'DWS',automated:true}}
  assert.notEqual((await receive(fresh)).reason,'own-notification')
  const otherRoom=await mount('other-room-dws','other-room')
  assert.equal(h.service.isOwnNotification({groupId:h.host.ctx.channels.identity({...echo,conversationId:'other-room'}).sessionId,messageId:echo.messageId}),false)
  assert.notEqual((await receive({...echo,conversationId:'other-room'},otherRoom)).reason,'own-notification')
  const other=await mount('other-dws')
  assert.notEqual((await receive(echo,other)).reason,'own-notification')
  await h.service.whenIdle()
  assert.equal((await h.query('source.list')).length,4,'only exact conversation/message receipts are echoes; account, flags and text alone are insufficient')
  assert.equal(sent.length,sends);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'existing-fact-dws-echo',coldFactsUnchanged:true,preciseEchoIgnored:true,provenFlagEnrichmentConsumed:true,lateDifferenceReadback:true,foreignActorRejected:true,coreFingerprintStrict:true,crossChannelAndConversationKept:true,receiptlessSameAccountKept:true,realDwsExecuted:false}))
})

test('in-flight first tier steers at most 15 original messages and leaves the sixteenth durably queued',{timeout:nativeTestTimeout(45000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),batches=[],business=[];let paused=false
  t.after(()=>release.resolve())
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit')){
      if(!paused){paused=true;entered.resolve();await release.promise}
      const input=triage(body);batches.push(input.messages.map(source=>source.sourceId));return submit(input,()=>({needsHandling:true}))
    }
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);business.push(input);return settle(body,input)}
    return {text:'No other work'}
  })
  await h.receive(channelMessage('1'));await entered.promise
  await Promise.all(Array.from({length:15},(_,index)=>h.receive(channelMessage(String(index+2)))))
  const sources=await h.query('source.list')
  assert.equal(sources.length,16,'overflow must be durable before the original model turn is released')
  assert.equal((await h.query('triage.pending',{conversationId:h.host.ctx.channels.identity(channelMessage('1')).sessionId})).length,15)
  release.resolve()
  await h.service.whenIdle()
  const committed=(await h.query('source.list')).filter(source=>source.routed)
  assert.equal(committed.length,16)
  for(const source of committed){
    const spans=source.stages.filter(stage=>stage.stage==='triage')
    assert.ok(spans.length&&spans.every(stage=>stage.completedAt),'each accepted source has joined observed triage spans')
    assert.ok(spans.every(stage=>Date.parse(stage.startedAt)>=Date.parse(source.receivedAt)),'late sources are never backdated before Host receipt')
  }
  assert.ok(committed.find(source=>source.messageId==='1').stages.some(stage=>stage.stage==='triage'&&stage.shared),'original source becomes explicitly shared after a steer append')
  assert.ok(batches.every(batch=>batch.length<=15))
  assert.ok(batches.some(batch=>batch.length===15),'arrivals must use the active batch rather than 16 unrelated one-item sessions')
  for(const input of business)assert.ok(input.events.filter(event=>event.sourceId).length<=15)
  // Each official turn asks again after its tool result; dedup request snapshots.
  const sets=new Set(business.map(input=>input.events.map(event=>event.id).join(',')))
  const unique=business.filter((input,index,array)=>array.findIndex(other=>other.events.map(event=>event.id).join(',')===input.events.map(event=>event.id).join(','))===index)
  assert.equal(new Set(unique.flatMap(input=>input.events.map(event=>event.sourceId))).size,16)
  assert.equal(unique.reduce((sum,input)=>sum+input.events.filter(event=>event.sourceId).length,0),16)
  assert.ok(sets.size>=2);assert.equal(h.sent.length,0)
})

test('a message arriving during tool-free handoff is delivered exactly once to the next generation',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),observed=[];let held=false
  t.after(()=>release.resolve())
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body)
    if(summary){if(!held){held=true;entered.resolve();await release.promise}return summary}
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);observed.push(input);return settle(body,input)}
    return {text:'No other work'}
  })
  const first=channelMessage('before-handoff'),late=channelMessage('during-handoff')
  const id=h.host.ctx.channels.identity(first).sessionId
  await h.receive(first);await entered.promise
  const old=await h.query('router.get',{conversationId:id})
  assert.equal(old.phase,'handoff')
  await h.receive(late)
  await eventually(async()=>(await h.query('router.inbox',{conversationId:id})).some(event=>event.source?.messageId===late.messageId),'late source durably queues during handoff',t.signal)
  assert.ok(observed.every(input=>input.events.every(event=>event.source?.messageId!==late.messageId)),'old actor does not receive a cutoff-late message')
  release.resolve();await h.service.whenIdle()
  const firstTurn=observed.find(input=>input.events.some(event=>event.source?.messageId===first.messageId))
  const lateTurn=observed.find(input=>input.events.some(event=>event.source?.messageId===late.messageId))
  assert.equal(lateTurn.generation,firstTurn.generation+1)
  const current=await h.query('router.get',{conversationId:id})
  assert.equal(current.phase,'active');assert.equal(current.cursor,2);assert.equal(current.generation,3)
  const native=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.ok(native.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'))
  assert.equal((await h.query('router.inbox',{conversationId:id})).length,0)
})

for(const failureStage of ['router.candidate.commit','router.publish'])test('cold recovery completes the uniquely committed next generation after '+failureStage+' fails',{timeout:nativeTestTimeout(40000)},async t=>{
  let injected=false,crashArmed=true;const business=[]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);business.push(input);return settle(body,input)}
    return {text:'No other work'}
  },{wrapStore:store=>({...store,command:async command=>{
    if(crashArmed&&command.kind===failureStage){injected=true;throw Object.assign(Error('Injected crash window'),{code:'TEST_CRASH_WINDOW'})}
    return store.command(command)
  }})})
  const input=channelMessage('crash-window'),id=h.host.ctx.channels.identity(input).sessionId
  await h.receive(input)
  await eventually(()=>injected,'native next-generation commit before injected failure',t.signal)
  await h.service.whenIdle().catch(error=>assert.match(error.message,/TEST_CRASH_WINDOW|Injected crash/))
  const before=await h.query('router.get',{conversationId:id})
  assert.equal(before.generation,1);assert.equal(before.phase,'handoff');assert.equal(before.cursor,1)
  const rotation=(await h.query('router.rotations',{conversationId:id}))[0]
  assert.equal(rotation.state,failureStage==='router.publish'?'candidate-committed':'summarized')
  const requestCount=h.requests.length
  await h.close().catch(error=>assert.match(error.message,/Router shutdown failed|TEST_CRASH_WINDOW/))
  crashArmed=false;await h.restart();await h.service.whenIdle()
  const after=await h.query('router.get',{conversationId:id})
  assert.equal(after.generation,2);assert.equal(after.phase,'active');assert.equal(after.cursor,1)
  assert.equal(h.requests.length,requestCount,'recovery publishes the committed seed, not a replayed model/business turn')
  const native=await h.host.ctx.sessionPersistence.readNative(after.activeSessionId,{requireComplete:true})
  assert.ok(native.entries.some(entry=>entry.customType==='night.router-handoff'))
  assert.ok(native.entries.some(entry=>entry.customType==='night.commit'))
  assert.equal((await h.query('router.rotations',{conversationId:id}))[0].state,'published')
})

test('successive idle cycles retain the short handoff without reloading old payloads or self-triggering empty rotations',{timeout:nativeTestTimeout(60000)},async t=>{
  const initialTurns=[],summaries=[]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary){summaries.push(body);return summary}
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body)
      if(body.messages.at(-1)?.role!=='tool')initialTurns.push(body)
      return settle(body,input)
    }
    return {text:'No other work'}
  })
  for(let round=0;round<4;round++){
    await h.receive(channelMessage('cycle-'+round,{text:'PAYLOAD_ROUND_'+round+':'+String(round).repeat(3000)}))
    await h.service.whenIdle()
  }
  assert.equal(initialTurns.length,4);assert.equal(summaries.length,4)
  for(let round=1;round<initialTurns.length;round++){
    const context=JSON.stringify(initialTurns[round].messages)
    assert.match(context,/Retain necessary original source references/)
    for(let old=0;old<round;old++)assert.ok(!context.includes('PAYLOAD_ROUND_'+old+':'),'new generation does not reload the old source payload')
    assert.ok(context.length<JSON.stringify(initialTurns[0].messages).length+8000,'context growth is not proportional to all historical payloads')
  }
  const current=await h.query('router.get',{conversationId:h.host.ctx.channels.identity(channelMessage('cycle-0')).sessionId})
  assert.equal(current.generation,5);assert.equal(current.cursor,4);assert.equal(current.lastHandoffCursor,4)
  const count=h.requests.length;await h.service.whenIdle();assert.equal(h.requests.length,count,'seed creation and settled summary cannot recursively trigger another handoff')
})

for(const invalid of ['blank-intent','missing-source','utf8-budget','referents-object'])test(`invalid tool-free handoff retains the current native generation without publishing a candidate: ${invalid}`,{timeout:nativeTestTimeout(40000)},async t=>{
  let summaries=0
  const h=await residentRouterHost(t,body=>{
    const input=requestEnvelope(body,'Router 交接请求：')
    if(input&&!requestTools(body).length){
      summaries++
      const value={currentIntent:'Preserve the original request',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff}
      if(invalid==='blank-intent')value.currentIntent='   '
      if(invalid==='referents-object')value.referents=[{name:'A',meaning:'Object elements remain forbidden'}]
      if(invalid==='missing-source')value.evidenceRefs=[]
      if(invalid==='utf8-budget')value.assumptions=Array(16).fill('中'.repeat(800))
      return {text:JSON.stringify(value)}
    }
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle'))return settle(body,router(body))
    return {text:'No other work'}
  })
  const message=channelMessage('invalid-'+invalid),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message)
  await eventually(async()=>summaries>0&&(await h.query('router.rotations',{conversationId})).some(row=>row.state==='aborted'),'invalid summary abort is durably committed',t.signal)
  // Triage commit and triage completion may both enqueue a router drain.
  // An aborted earlier rotation does not mean the queued retry is already idle.
  await eventually(async()=>{
    try{await h.service.whenIdle();return true}
    catch(error){assert.equal(error.routerSafeToResume,true);return false}
  },'all queued invalid handoffs have settled',t.signal)
  const current=await h.query('router.get',{conversationId}),rotations=await h.query('router.rotations',{conversationId})
  assert.equal(current.generation,1);assert.equal(current.phase,'active');assert.equal(current.cursor,1);assert.equal(current.lastHandoffCursor,0)
  assert.ok(rotations.length>0);assert.ok(rotations.every(row=>row.state==='aborted'&&!row.candidateSessionId))
  assert.equal((await h.query('router.inbox',{conversationId})).length,0,'committed handling is not replayed when its later summary fails')
  const saved=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.equal(saved.header.generation,1);assert.ok(saved.entries.some(entry=>entry.customType==='night.commit'))
  assert.equal((await h.query('task.list')).length,0)
})

test('legacy prepared replyRequest and cold unknown retain original payload bytes while neutral retries stay idempotent',{timeout:nativeTestTimeout(60000)},async t=>{
  const steps=new Map();let h,original,frozen,notificationId
  h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(!requestTools(body).includes('resident_router_reply'))return {text:'No additional work'}
    const input=router(body),key=input.events.map(event=>event.id).join(','),step=steps.get(key)??0;steps.set(key,step+1)
    if(!original){
      original=input.events.find(event=>event.source)?.source
      assert.ok(original)
      notificationId='router-operation:'+hash(JSON.stringify([original.conversationId,'legacy-frozen-reply']))
      const request={kind:'router-reply',sourceId:original.sourceId,sourceVersion:original.version,text:'Frozen legacy response',atOpenDingTalkIds:[original.actorId],artifactFiles:[]}
      await h.store.command({id:'fixture-old-producer',kind:'notification.prepare',args:{notificationId,taskId:null,requirementRevision:1,kind:'router-reply',payload:{text:request.text,conversationId:original.conversationId,sourceId:original.sourceId,sourceVersion:original.version,sourceRef:{messageId:original.messageId,messageVersion:original.version,actorId:original.actorId},atOpenDingTalkIds:[original.actorId],replyKind:'substantive',taskIds:[],topicRefs:[],replyRequest:request}}})
      frozen=await h.query('notification.get',{notificationId})
    }
    const args={operationId:'legacy-frozen-reply',sourceId:original.sourceId,messageVersion:original.version,text:'Frozen legacy response',recipientActorIds:[original.actorId]}
    if(step===0)return {tool:'resident_router_reply',args}
    if(step===1)return {tool:'resident_router_reply',args:{...args,text:'Changed frozen content'}}
    if(step===2)return {tool:'resident_router_reply',args:{...args,recipientActorIds:[]}}
    if(step===3)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'legacy-settle:'+key}}
    return {text:'Original frozen notification reused without preparing another send'}
  },{readback:async()=>{throw Error('Synthetic unknown readback remains unavailable')}})
  h.host.ctx.channels.transports.get('resident-fixture').canSend=()=>false
  const input=channelMessage('legacy-original',{text:'Preserve this existing bounded response'})
  await h.receive(input);await h.service.whenIdle()
  assert.match(frozen.payloadDigest,/^[a-f0-9]{64}$/);assert.equal(frozen.state,'prepared');assert.deepEqual(await h.query('notification.get',{notificationId}),frozen);assert.equal(h.sent.length,0)
  assert.ok(Object.hasOwn(frozen.payload,'atOpenDingTalkIds'));assert.ok(Object.hasOwn(frozen.payload.replyRequest,'atOpenDingTalkIds'));assert.equal(Object.hasOwn(frozen.payload,'recipientActorIds'),false)
  const preparedResult=h.results.find(row=>row.name==='resident_router_reply'&&!row.result.isError)
  assert.ok(preparedResult);assert.deepEqual(preparedResult.result.value.notification.payload.recipientActorIds,[original.actorId])
  await h.store.command({id:'fixture-old-send-start',kind:'notification.start',args:{notificationId}})
  await h.restart()
  const cold=await h.query('notification.get',{notificationId})
  assert.equal(cold.sendAttemptCount,1);assert.equal(cold.state,'unknown');assert.deepEqual(cold.payload,frozen.payload);assert.equal(cold.payloadDigest,frozen.payloadDigest);assert.equal(h.sent.length,0)
  await h.receive(channelMessage('legacy-neutral-retry',{text:'Review the existing frozen response without changing its audience or content'}));await h.service.whenIdle()
  const current=await h.query('notification.get',{notificationId})
  assert.equal(current.state,'unknown');assert.deepEqual(current.payload,frozen.payload);assert.equal(current.payloadDigest,frozen.payloadDigest);assert.equal(current.sendAttemptCount,cold.sendAttemptCount);assert.equal(h.sent.length,0)
  const replays=h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError),conflicts=h.results.filter(row=>row.name==='resident_router_reply'&&row.result.isError)
  assert.equal(replays.length,2);assert.equal(conflicts.length,4);assert.ok(conflicts.every(row=>JSON.stringify(row.result).includes('DYNAMIC_COMMAND_ID_CONFLICT')))
  assert.equal((await h.query('notification.list')).length,1)
  t.diagnostic(JSON.stringify({case:'legacy-reply-request-neutral-retry',preparedReused:true,coldState:current.state,originalPayloadAndDigestPreserved:true,semanticParameterConflicts:conflicts.length,additionalSends:h.sent.length,realVendorExecuted:false}))
})


test('cold Router resumes an exact legacy pending packet before a later event without changing its body or replaying either batch',{timeout:nativeTestTimeout(60000)},async t=>{
  const batches=[];let injected=false,legacyPacket
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body)
      if(body.messages.at(-1)?.role!=='tool')batches.push(structuredClone(input))
      return settle(body,input)
    }
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){
    const handle=await create.call(this,options)
    if(options.meta?.runtimeOwner==='conversation-router'&&!injected){
      const enqueue=handle.enqueue.bind(handle)
      handle.enqueue=async packet=>{
        if(injected)throw Object.assign(Error('TEST_ROUTER_ENQUEUE_INTERRUPTED'),{code:'TEST_ROUTER_ENQUEUE_INTERRUPTED'})
        if(!injected){
          const input=JSON.parse(packet.content[0].text.slice('Router 请求：'.length))
          for(const event of input.events)if(event.source)event.source=await h.query('source.get',{sourceId:event.source.sourceId})
          // 模拟旧Host编码，在正式enqueue提交后、SDK接纳前中断；不改journal或SQLite。
          packet.content[0].text='Router 请求：'+JSON.stringify(input)
          legacyPacket=structuredClone(packet)
          await enqueue(packet);injected=true
          throw Object.assign(Error('TEST_ROUTER_ENQUEUE_INTERRUPTED'),{code:'TEST_ROUTER_ENQUEUE_INTERRUPTED'})
        }
        return enqueue(packet)
      }
    }
    return handle
  }
  t.after(()=>{registry.create=create})
  const input=channelMessage('legacy-pending',{text:'Original pending business input',quotedMessage:{messageId:'quoted',senderId:'bob',text:'Preserve this original context'}}),conversationId=h.host.ctx.channels.identity(input).sessionId
  await h.receive(input)
  await eventually(()=>injected,'legacy packet durably enqueued before SDK admission',t.signal)
  await h.service.whenIdle().catch(error=>assert.match(error.message,/TEST_ROUTER_ENQUEUE_INTERRUPTED/))
  const before=await h.query('router.get',{conversationId}),stored=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  const original=stored.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued')
  assert.equal(original.length,1);assert.deepEqual(original[0].payload,legacyPacket)
  assert.equal(stored.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted').length,0)
  assert.equal(stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').length,0);assert.equal(batches.length,0)
  assert.equal((await h.query('router.inbox',{conversationId})).length,1)
  const originalBody=JSON.parse(legacyPacket.content[0].text.slice('Router 请求：'.length)),source=originalBody.events[0].source
  assert.equal(source.groupId,conversationId);assert.equal(Object.hasOwn(source,'conversationId'),false)
  await h.store.command({id:'fixture-later-source',kind:'source.record-direct',args:{source:{sourceId:'late-router-source',groupId:conversationId,messageId:'late-router-message',actorId:source.actorId,channel:source.channel,version:1,text:'LATE_EVENT_NOT_IN_COMMITTED_PACKET',resources:[]},conversation:{conversationId}}})
  await h.store.command({id:'fixture-later-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'late-router-source',messageVersion:1,needsHandling:true,reason:'A later independently recorded event'}]}})
  const pending=await h.query('router.inbox',{conversationId});assert.equal(pending.length,2)
  assert.ok(!legacyPacket.content[0].text.includes('LATE_EVENT_NOT_IN_COMMITTED_PACKET'))
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.deepEqual(closed.audit,stored.audit);assert.equal(closed.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
  await h.restart();await h.service.whenIdle()
  const after=await h.query('router.get',{conversationId}),recovered=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  const enqueued=recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='conversation-router'),ids=new Set(enqueued.map(row=>row.payload.id)),admitted=recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted'&&ids.has(row.payload.id))
  assert.ok(recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'&&!ids.has(row.payload.id)).every(row=>row.payload.source.kind==='router-handoff'),'only the separate tool-free handoff may add another input')
  assert.equal(enqueued.length,2);assert.equal(admitted.length,2);assert.deepEqual(enqueued[0].payload,legacyPacket)
  assert.deepEqual(recovered.entries.slice(0,stored.entries.length),stored.entries)
  const originalEntries=recovered.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===legacyPacket.id)
  assert.equal(originalEntries.length,1);assert.deepEqual(originalEntries[0].content,legacyPacket.content);assert.deepEqual(originalEntries[0].details.source,legacyPacket.source)
  assert.equal(batches.length,2);assert.equal(batches[0].generation,before.generation);assert.deepEqual(batches[0],originalBody)
  assert.equal(batches[1].events.length,1);assert.equal(batches[1].events[0].source.sourceId,'late-router-source');assert.notEqual(enqueued[1].payload.id,legacyPacket.id)
  assert.deepEqual(batches[1].events.map(event=>event.id),[pending.find(event=>event.sourceId==='late-router-source').id])
  assert.equal((await h.query('router.inbox',{conversationId})).length,0);assert.equal(after.cursor,2)
  assert.equal(h.results.filter(row=>row.name==='resident_router_settle'&&!row.result.isError&&row.sessionId===before.activeSessionId).length,2);assert.equal(h.sent.length,0)
  const requests=h.requests.length
  await h.restart();await h.service.whenIdle()
  assert.equal(h.requests.length,requests);assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})).entries,recovered.entries)
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'legacy-router-pending-before-later-event',originalGeneration:before.generation,originalPacketPreserved:true,originalAdmissions:originalEntries.length,laterEventHandledSeparately:true,restartModelReplay:false,realVendorExecuted:false}))
})


for(const outcome of ['complete','newer-input','fails-again','unrelated-error'])test(outcome==='unrelated-error'?'an unsettled Router cannot mask an unrelated conversation recovery failure':outcome==='newer-input'?'an admitted failed Router checkpoint refuses a newer pending business input before inference':outcome==='fails-again'?'a second failed Router continuation retains its checkpoint history and cannot replay the consumed proof':'an admitted failed Router batch resumes only through an explicit Host checkpoint after strict cold recovery',{timeout:nativeTestTimeout(60000)},async t=>{
  const continuationAdmissions=[]
  let failModel=true,resumeEntered,releaseResume,holdResume=false,fatalConversation,continuationPacket,continuationSessionId,observeHandoffRecovery
  const entered=new Promise(resolve=>resumeEntered=resolve),released=new Promise(resolve=>releaseResume=resolve)
  const handoffEntered=Promise.withResolvers(),handoffReleased=Promise.withResolvers(),recoveryListed=Promise.withResolvers()
  t.after(()=>{releaseResume();handoffReleased.resolve()})
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary){if(outcome==='complete'){handoffEntered.resolve();await handoffReleased.promise}return summary}
    if(requestTools(body).includes('channel_triage_submit')){
      if(outcome==='newer-input'){
        const conversationId=h.host.ctx.channels.identity(channelMessage('explicit-failed-batch')).sessionId,taskId='paused-inbox-fixture'
        await h.store.command({id:'fixture-paused-task',kind:'task.create',args:{taskId,conversationId,groupId:conversationId,ownerActorId:'owner',request:'A paused task used only to produce real internal ledger events'}})
        // 29个正式内部变更加本次用户来源构成30项原批次，不放宽15条用户输入上限。
        for(let index=0;index<29;index++)await h.store.command({id:'fixture-paused-control-'+index,kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:index+1}})
      }
      return submit(triage(body),()=>({needsHandling:true}))
    }
    if(requestTools(body).includes('resident_router_settle')){
      if(continuationPacket)continuationAdmissions.push(await h.host.ctx.agents.get(continuationSessionId).admission.current())
      if(failModel)return {error:'TEST_ROUTER_MODEL_CHECKPOINT_FAILURE'}
      if(holdResume&&body.messages.at(-1)?.role!=='tool'){holdResume=false;resumeEntered();await released}
      return settle(body,router(body))
    }
    return {text:'No other work'}
  },{wrapStore:store=>({...store,query:q=>{
    if(fatalConversation&&q.kind==='router.inbox'&&q.conversationId===fatalConversation)throw Object.assign(Error('TEST_UNRELATED_ROUTER_STORE_FAILURE'),{code:'EACCES'})
    const result=store.query(q)
    if(observeHandoffRecovery&&q.kind==='router.list'){observeHandoffRecovery=false;recoveryListed.resolve()}
    return result
  }})})
  const message=channelMessage('explicit-failed-batch'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message)
  await assert.rejects(h.service.whenIdle(),{code:'ROUTER_BATCH_UNSETTLED'})
  const row=await h.query('router.get',{conversationId}),failed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  const business=failed.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.source.kind==='conversation-router')
  assert.equal(business.length,1)
  const assistant=failed.entries.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
  assert.equal(assistant.message.stopReason,'error');assert.match(assistant.message.errorMessage,/TEST_ROUTER_MODEL_CHECKPOINT_FAILURE/)
  const packetId=business[0].details.packetId
  assert.equal(failed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).length,1)
  assert.equal(failed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packetId).length,1)
  const inbox=await h.query('router.inbox',{conversationId});assert.equal(inbox.length,outcome==='newer-input'?30:1);assert.equal(row.cursor,0)
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),requests=h.requests.length
  await h.restart()
  assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'),'an unsettled batch remains an explicit degraded recovery issue')
  await h.service.recover()
  assert.equal(h.requests.length,requests,'cold and ordinary recovery must not replay an already admitted model turn')
  assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
  const proof={conversationId,generation:row.generation,sessionId:row.activeSessionId,packetId,failedEntryId:assistant.id}
  async function rejectedWithoutInference(candidate){
    const count=h.requests.length
    await assert.rejects(h.service.resumeRouterBatch(candidate),error=>typeof error.code==='string'&&/^(?:PI_)?ROUTER_/.test(error.code))
    assert.equal(h.requests.length,count,'a refused continuation must not call the model')
  }
  for(const candidate of [{...proof,conversationId:'foreign-conversation'},{...proof,generation:row.generation+1},{...proof,sessionId:'foreign-router-session'},{...proof,packetId:packetId+':foreign'},{...proof,failedEntryId:business[0].id}])await rejectedWithoutInference(candidate)
  if(outcome==='unrelated-error'){
    const source=await h.query('source.get',{sourceId:inbox.find(event=>event.sourceId).sourceId}),other='unrelated-failed-conversation'
    await h.store.command({id:'fixture-unrelated-source',kind:'source.record-direct',args:{source:{sourceId:'unrelated-recovery-source',groupId:other,messageId:'unrelated-recovery-message',actorId:source.actorId,channel:source.channel,version:1,text:'A separate recovery scope must still be inspected',resources:[]},conversation:{conversationId:other}}})
    await h.store.command({id:'fixture-unrelated-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'unrelated-recovery-source',messageVersion:1,needsHandling:true,reason:'A distinct pending recovery scope'}]}})
    const count=h.requests.length;fatalConversation=other
    try{await assert.rejects(h.service.recover(),{code:'EACCES'})}finally{fatalConversation=undefined}
    assert.equal(h.requests.length,count)
    assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'))
    assert.equal((await h.query('router.inbox',{conversationId:other})).length,1)
    assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
    t.diagnostic(JSON.stringify({case:'unsettled-router-does-not-mask-other-recovery-error',originalUnsettledRetained:true,unrelatedStoreFailurePropagated:true,modelRequestsUnchanged:true,realVendorExecuted:false}))
    return
  }
  if(outcome==='newer-input'){
    const source=await h.query('source.get',{sourceId:inbox.find(event=>event.sourceId).sourceId})
    await h.store.command({id:'fixture-resume-later-source',kind:'source.record-direct',args:{source:{sourceId:'resume-later-source',groupId:conversationId,messageId:'resume-later-message',actorId:source.actorId,channel:source.channel,version:1,text:'A later input must not be bypassed by the old checkpoint',resources:[]},conversation:{conversationId}}})
    await h.store.command({id:'fixture-resume-later-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'resume-later-source',messageVersion:1,needsHandling:true,reason:'The original failed batch is no longer the complete current inbox'}]}})
    await rejectedWithoutInference(proof)
    assert.equal((await h.query('router.inbox-count',{conversationId})),31)
    assert.deepEqual((await h.query('router.inbox',{conversationId})).map(event=>event.id),inbox.map(event=>event.id),'the later 31st event stays outside the default 30-item projection')
    assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
    assert.equal(h.sent.length,0)
    t.diagnostic(JSON.stringify({case:'failed-router-newer-pending-refusal',originalBatch:30,pendingTotal:31,pagedOverflowInvisible:true,originalPrefixUnchanged:true,newerEventRetained:true,modelRequestsUnchanged:true,realVendorExecuted:false}))
    return
  }
  continuationPacket=failed.audit.find(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).payload
  continuationSessionId=row.activeSessionId
  const priorCurrent=await h.host.ctx.agents.get(continuationSessionId).admission.current()
  assert.equal(priorCurrent,undefined,'cold recovery must not invent a current business turn')
  const assertOriginalAdmission=()=>{
    assert.ok(continuationAdmissions.length>0,'the actual model endpoint must observe the continuation')
    for(const admitted of continuationAdmissions)assert.deepEqual(admitted,{id:packetId,messages:[continuationPacket]},'memory must see only the exact original business packet, not the Host control message')
  }
  if(outcome==='fails-again'){
    await assert.rejects(h.service.resumeRouterBatch(proof),error=>typeof error.code==='string'&&/^(?:PI_)?ROUTER_/.test(error.code))
    assertOriginalAdmission()
    assert.equal(await h.host.ctx.agents.get(continuationSessionId).admission.current(),priorCurrent,'a failed continuation must restore the original current delegate')
    const again=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),latest=again.entries.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
    assert.equal(latest.message.stopReason,'error');assert.notEqual(latest.id,assistant.id)
    assert.deepEqual(again.entries.slice(0,closed.entries.length),closed.entries)
    assert.equal(again.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===packetId).length,1)
    assert.equal((await h.query('router.inbox',{conversationId})).length,1)
    assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'))
    const failedRequests=h.requests.length
    await h.restart();await rejectedWithoutInference(proof)
    assert.equal(h.requests.length,failedRequests);assert.equal((await h.query('router.get',{conversationId})).cursor,0)
    t.diagnostic(JSON.stringify({case:'router-continuation-fails-again',originalMemoryAdmissionBound:true,currentRestoredAfterFailure:true,newNativeFailureRetained:true,originalInputUnique:true,consumedCheckpointRefusedAfterCold:true,modelRequestsUnchangedAfterCold:true,realVendorExecuted:false}))
    return
  }
  failModel=false;holdResume=true
  const resumed=h.service.resumeRouterBatch(proof)
  try{await Promise.race([entered,resumed.then(()=>assert.fail('continuation completed before its model gate'))]);await rejectedWithoutInference(proof)}finally{releaseResume()}
  await Promise.race([handoffEntered.promise,resumed.then(()=>assert.fail('continuation completed before its handoff gate'))])
  observeHandoffRecovery=true
  const recovery=h.service.recover();void recovery.catch(()=>{})
  try{
    await recoveryListed.promise
    assert.equal((await h.query('router.get',{conversationId})).phase,'handoff')
    assert.equal(h.host.ctx.agents.get(continuationSessionId).lifecycle.signal.aborted,false,'ordinary recovery must not dispose the live handoff owner')
  }finally{handoffReleased.resolve()}
  await Promise.all([resumed,recovery]);await h.service.whenIdle();assertOriginalAdmission()
  const completed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),current=await h.query('router.get',{conversationId})
  assert.deepEqual(completed.entries.slice(0,closed.entries.length),closed.entries)
  assert.equal(completed.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===packetId).length,1)
  assert.equal(completed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).length,1)
  assert.equal(completed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packetId).length,1)
  assert.equal(h.results.filter(result=>result.name==='resident_router_settle'&&!result.result.isError&&result.sessionId===row.activeSessionId).length,1)
  assert.equal((await h.query('router.inbox',{conversationId})).length,0);assert.equal(current.cursor,1);assert.equal(current.generation,row.generation+1)
  const candidate=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.equal(candidate.header.conversationId,conversationId);assert.equal(candidate.header.generation,current.generation)
  const rotation=(await h.query('router.rotations',{conversationId})).find(item=>item.oldSessionId===row.activeSessionId&&item.state==='published')
  assert.equal(rotation?.candidateSessionId,current.activeSessionId)
  assert.ok(candidate.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'&&entry.details.handoffId===rotation.id&&entry.details.conversationId===conversationId))
  await rejectedWithoutInference(proof)
  const finishedRequests=h.requests.length
  await h.restart();await h.service.whenIdle()
  assert.equal(h.requests.length,finishedRequests);assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries,completed.entries)
  await rejectedWithoutInference(proof)
  assert.ok(!h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'),'only a settled batch clears its recovery issue')
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'explicit-failed-router-batch-continuation',originalMemoryAdmissionBound:true,liveHandoffRecoverySerialized:true,strictCold:true,originalPacketUnique:true,originalAdmissionUnique:true,originalPrefixUnchanged:true,concurrentAndStaleRejectedBeforeInference:true,settled:true,legalHandoff:true,coldReplay:false,realVendorExecuted:false}))
})

// 等待真实模型请求，关停必须先取消 SDK；放行模型夹具不能成为关闭条件。
test('Router close interrupts an active official Pi request before joining its tail without replaying the settled tool',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
  let requests=0,aborts=0,handle
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      if(++requests===2){entered.resolve();await release.promise}
      return {tool:'resident_router_settle',args:{eventIds:router(body).events.map(event=>event.id),operationId:'shutdown-original-settle'}}
    }
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){
    handle=value;const abort=value.session.abort.bind(value.session);value.session.abort=async(...args)=>{aborts++;assert.equal(value.agent.lifecycle.signal.aborted,true);return abort(...args)}
  }return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('active-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise
  assert.equal(handle.session.isStreaming,true);assert.equal(handle.agent.lifecycle.signal.aborted,false)
  const before=await h.query('router.get',{conversationId});assert.equal(before.cursor,1);assert.equal(before.generation,1)
  await h.close();assert.ok(aborts>0);assert.equal(handle.session.isStreaming,false);assert.equal(registry.get(before.activeSessionId),undefined)
  const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
  assert.equal(cold.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='resident_router_settle'&&!entry.message.isError).length,1)
  release.resolve();await h.restart();await h.service.whenIdle()
  assert.equal(requests,2,'cold recovery cannot issue the admitted business batch or repeat its settled tool')
  assert.equal((await h.query('router.get',{conversationId})).cursor,1);assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})

test('Router close joins the exact native Pi cancellation during request preparation without replaying its committed tool',{timeout:nativeTestTimeout(40000)},async t=>{
 const entered=Promise.withResolvers();let handle,nativeSignal,prepares=0,requests=0,interrupted=false
 const h=await residentRouterHost(t,body=>{
  const summary=handoff(body);if(summary)return summary
  if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
  if(requestTools(body).includes('resident_router_settle')){requests++;return settle(body,router(body))}
  return {text:'No other work'}
 })
 const registry=h.host.ctx.agents,create=registry.create
 registry.create=async function(options){
  if(options.meta?.runtimeOwner==='conversation-router'){
   const beforeRequest=options.beforeRequest
   options={...options,beforeRequest:async(actor,...args)=>{
    await beforeRequest?.(actor,...args)
    if(++prepares!==2)return
    nativeSignal=actor.piSession.agent.signal;entered.resolve()
    await new Promise((resolve,reject)=>nativeSignal.addEventListener('abort',()=>reject(nativeSignal.reason),{once:true}))
   }}
  }
  const value=await create.call(this,options)
  if(options.meta?.runtimeOwner==='conversation-router'){
   handle=value;const interrupt=value.interrupt.bind(value)
   value.interrupt=(...args)=>{const result=interrupt(...args);void result.then(()=>{interrupted=true},()=>{});return result}
  }
  return value
 }
 t.after(()=>{registry.create=create})
 const message=channelMessage('native-prepare-cancel'),conversationId=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await entered.promise
 const before=await h.query('router.get',{conversationId});assert.equal(before.cursor,1);assert.equal(requests,1)
 try{await h.close()}catch(error){
  const contains=value=>value===nativeSignal.reason||value?.errors?.some(contains)
  t.diagnostic(JSON.stringify({case:'native-prepare-cancel',interrupted,nativeAborted:nativeSignal.aborted,aggregateContainsExactNativeReason:!!contains(error)}))
  throw error
 }
 assert.equal(interrupted,true);assert.equal(nativeSignal.aborted,true);assert.equal(handle.session.isStreaming,false);assert.equal(registry.get(before.activeSessionId),undefined)
 const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
 assert.equal(cold.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
 assert.equal(cold.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='resident_router_settle'&&!entry.message.isError).length,1)
 await h.restart();await h.service.whenIdle();assert.equal(requests,1);assert.equal((await h.query('router.get',{conversationId})).cursor,1)
})

test('Router close preserves an actually committed undelivered packet and cold recovery admits it only once',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers();let held=false,packet,handle,modelBatches=0
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){if(body.messages.at(-1)?.role!=='tool')modelBatches++;return settle(body,router(body))}
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'&&!held){
    handle=value;const enqueue=value.enqueue.bind(value);value.enqueue=async input=>{const result=await enqueue(input);packet=structuredClone(input);held=true;entered.resolve();await new Promise((resolve,reject)=>{const signal=value.agent.lifecycle.signal;if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});return result}
  }return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('pending-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise
  const row=await h.query('router.get',{conversationId}),before=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.equal(handle.agent.admission.status(packet.id),'pending');assert.equal(modelBatches,0)
  assert.deepEqual(before.audit.filter(receipt=>receipt.domain==='admission').map(receipt=>receipt.kind),['enqueued'])
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.deepEqual(closed.audit,before.audit);assert.deepEqual(closed.audit.find(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued').payload,packet)
  await h.restart();await h.service.whenIdle()
  const cold=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packet.id).length,1)
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packet.id).length,1)
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='cancelled').length,0);assert.equal(modelBatches,1)
  const requests=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,requests)
  assert.equal((await h.query('router.inbox',{conversationId})).length,0)
})

test('Router close joins and disposes an actual late-created official handle without admitting a batch or rotating generation',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let handle
  const h=await residentRouterHost(t,body=>requestTools(body).includes('channel_triage_submit')?submit(triage(body),()=>({needsHandling:true})):{text:'No Router dispatch expected'})
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){handle=value;entered.resolve();await release.promise}return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('opening-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise;const before=await h.query('router.get',{conversationId});assert.equal(registry.get(before.activeSessionId),handle.agent)
  let finished=false;const closing=h.close().then(()=>{finished=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false)
  release.resolve();await closing
  assert.equal(handle.agent.lifecycle.signal.aborted,true);assert.equal(registry.get(before.activeSessionId),undefined)
  const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission').length,0);assert.equal(cold.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff').length,0)
  assert.equal(cold.header.generation,before.generation);assert.equal(before.cursor,0);assert.equal(h.requests.length,1)
})

test('Router close cannot swallow an admission PAUSED failure produced before its own interruption',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),aborted=Promise.withResolvers();t.after(()=>release.resolve());let prior;const trace=[]
  const h=await residentRouterHost(t,body=>requestTools(body).includes('channel_triage_submit')?submit(triage(body),()=>({needsHandling:true})):{text:'No Router dispatch expected'})
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){
    const interrupt=value.interrupt.bind(value),dispose=value.dispose.bind(value)
    value.interrupt=(...args)=>{trace.push({at:'interrupt',priorCode:prior?.code,sameReason:prior===value.agent.lifecycle.signal.reason});return interrupt(...args)}
    value.dispose=(...args)=>{trace.push({at:'dispose',aborted:value.agent.lifecycle.signal.aborted});return dispose(...args)}
    value.agent.lifecycle.signal.addEventListener('abort',()=>{trace.push({at:'abort',code:value.agent.lifecycle.signal.reason?.code});aborted.resolve()},{once:true})
    const maintenance=Error('maintenance failed before shutdown');await assert.rejects(value.runMaintenance(()=>{throw maintenance}),error=>error===maintenance)
    const deliver=value.deliver.bind(value);value.deliver=async(...args)=>{try{return await deliver(...args)}catch(error){prior=error;entered.resolve();await release.promise;throw error}}
  }return value}
  t.after(()=>{registry.create=create})
  await h.receive(channelMessage('paused-router-close'));await entered.promise;assert.equal(prior.code,'PI_BUSINESS_ADMISSION_PAUSED')
  const closing=h.close(),rejected=assert.rejects(closing,error=>{const contains=value=>value===prior||value?.errors?.some(contains);return contains(error)})
  await aborted.promise;trace.push({at:'release',code:prior.code,safe:prior.routerSafeToResume});t.diagnostic(JSON.stringify({pausedCloseTrace:trace}));release.resolve();await rejected;assert.equal(h.requests.length,1)
})

for(const audience of ['operator','requester'])test(`Router resumes a waiting task in its original Pi session after ${audience} information arrives`,{timeout:nativeTestTimeout(60000)},async t=>{
  const steps=new Map(),runs=[],seenInputs=[];let taskStep=0,writes=0,reads=0
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
      if(step===0){
        if(source.messageId==='request')return {tool:'resident_task_plan',args:{operationId:'plan:'+audience,sourceId:source.sourceId,messageVersion:source.version,
          tasks:[{taskId:'wait-resume-'+audience,title:'Verify the original proof',objective:'Read the original proof after the missing environment information arrives',requirements:['Keep the original session and verify the file']}],dependencies:[]}}
        const task=await h.query('task.get',{taskId:'wait-resume-'+audience})
        return {tool:'resident_task_action',args:{operationId:'action:'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,
          taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,
          ...(source.messageId==='answer'?{kind:'resume',humanRequestId:task.humanRequests.at(-1).requestId,expectedContextRevision:task.contextRevision??0,reason:'The original answer supplies the missing variable; continue verification'}:{kind:'supplement'}),text:source.text}}
      }
      if(step===1)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+source.messageId}}
      return {text:'Task action and original source are committed.'}
    }
    if(requestTools(body).includes('task_result')){
      let input
      for(const message of body.messages.toReversed().filter(row=>row.role==='user')){
        const texts=typeof message.content==='string'?[message.content]:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text)
        for(const text of texts){try{const value=JSON.parse(text);if(value.task){input=value;break}}catch{}}
        if(input)break
      }
      assert.ok(input,'execution receives a real task-input packet');seenInputs.push(input)
      assert.equal(input.humanReview,undefined,'Router alone judges whether the supplemental information answers the question')
      runs.push(input.task.sessionId)
      if(taskStep++===0){writes++;return {tool:'write',args:{path:'work/proof.txt',content:'original-session-proof'}}}
      if(!input.task.humanRequests?.some(row=>row.status==='answered'))return {tool:'task_result',args:{decision:{action:'wait',audience,question:'Which environment variable identifies the read-only target?',summary:'Waiting for the target variable name',evidence:['Original proof saved'],limitations:['Target variable name missing']}}}
      if(reads++===0)return {tool:'read',args:{path:'work/proof.txt'}}
      assert.match(JSON.stringify(body),/original-session-proof/,'continuation reads the actual original file')
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Original proof read after the Router continuation',evidence:['Original proof read: original-session-proof'],limitations:[]}}}
    }
    return {text:'No other work'}
  })
  await h.receive(channelMessage('request',{text:'Verify the proof after obtaining the read-only target variable name.'}));await h.service.whenIdle()
  const taskId='wait-resume-'+audience,waiting=await h.query('task.get',{taskId})
  assert.equal(waiting.humanRequests.at(-1).status,'waiting-reply');assert.equal(waiting.drained,true)
  const originalSession=waiting.sessionId,executionCalls=runs.length
  await h.receive(channelMessage('partial',{senderId:'bob',text:'The configuration is in the environment; the exact variable name is not yet supplied.'}));await h.service.whenIdle()
  const partial=await h.query('task.get',{taskId})
  assert.equal(partial.humanRequests.at(-1).status,'waiting-reply')
  assert.equal(runs.length,executionCalls,'ordinary supplements do not start an execution-side semantic review')
  assert.equal(partial.contextRevision,(waiting.contextRevision??0)+1)
  const conversationId=partial.conversationId,generation=(await h.query('router.get',{conversationId})).generation
  const sources=await h.query('source.list'),owner=sources.find(row=>row.messageId==='request'),other=sources.find(row=>row.messageId==='partial')
  const record=async(suffix,extra)=>{await h.store.command({id:'negative-source:'+suffix,kind:'source.record',args:{sourceId:'negative:'+suffix,groupId:conversationId,messageId:'negative:'+suffix,
    actorId:partial.ownerActorId,version:1,channel:'chat-room',text:'A boundary test source',timestamp:new Date().toISOString(),...extra}});await h.store.command({id:'negative-routed:'+suffix,kind:'source.routed',args:{sourceId:'negative:'+suffix,receipt:{kind:'boundary-test'}}})}
  await record('current',{});await record('internal',{channel:'internal'});await record('foreign',{groupId:'foreign-conversation'})
  await record('edited',{});await record('edited-v2',{messageId:'negative:edited',version:2})
  const base={conversationId,generation,sourceId:'negative:current',messageVersion:1,kind:'task.resume',action:{taskId,
    expectedRequirementRevision:partial.requirementRevision,expectedControlRevision:partial.controlRevision,expectedContextRevision:partial.contextRevision,
    humanRequestId:partial.humanRequests.at(-1).requestId,messageId:'never-admit',text:'Do not admit invalid continuation',reason:'Structural boundary probe'}}
  const negatives=[['request',{action:{...base.action,humanRequestId:'another-task-request'}},/HUMAN_REQUEST_STALE/],
    ['requirement',{action:{...base.action,expectedRequirementRevision:99}},/REVISION_STALE/],
    ['control',{action:{...base.action,expectedControlRevision:99}},/REVISION_STALE/],
    ['context',{action:{...base.action,expectedContextRevision:partial.contextRevision-1}},/CONTEXT_STALE/],
    ['internal',{sourceId:'negative:internal'},/HUMAN_RESPONSE_SOURCE_INVALID/],
    ['foreign',{sourceId:'negative:foreign'},/CONVERSATION_SCOPE/],
    ['reason',{action:{...base.action,reason:' '}},/ARGUMENT_INVALID/]]
  const beforeWakes=await h.query('wake.list',{taskId})
  for(const [name,change,error] of negatives){
    await assert.rejects(h.store.command({id:'negative:'+name,kind:'router.task-action',args:{...base,...change,operationId:'negative:'+name}}),error)
    assert.deepEqual(await h.query('task.get',{taskId}),partial,'rejected actions leave no partial answer or supplement')
  }
  assert.deepEqual(await h.query('wake.list',{taskId}),beforeWakes)
  await h.restart();await h.service.whenIdle()
  assert.equal(runs.length,executionCalls,'cold recovery preserves the unresolved wait and pending supplement')
  await h.receive(channelMessage('answer',{senderId:audience==='operator'?'alice':'bob',text:'The existing read-only target is configured in VERIFY_TARGET; continue the original verification.'}));await h.service.whenIdle()
  const action=h.results.findLast(row=>row.name==='resident_task_action')
  assert.ok(action&&!action.result.isError,JSON.stringify(action?.result??h.service.listAlerts()))
  const completed=await h.query('task.get',{taskId})
  assert.equal(completed.status,'completed');assert.equal(completed.drained,true)
  assert.equal(completed.sessionId,originalSession);assert.equal(completed.humanRequests.at(-1).status,'answered')
  assert.equal(completed.humanRequests.at(-1).resolution.reason,'The original answer supplies the missing variable; continue verification')
  assert.equal(completed.claimContextRevision,completed.contextRevision)
  assert.ok(seenInputs.at(-1).sources.some(source=>source.text.includes('VERIFY_TARGET')))
  assert.ok(seenInputs.at(-1).sources.some(source=>source.text.includes('not yet supplied')))
  assert.equal((await h.query('task.list')).length,1);assert.equal((await h.query('execution.list')).length,0)
  assert.ok((await h.query('wake.list',{taskId})).every(row=>row.state==='acked'))
  assert.equal(writes,1);assert.equal(reads,2)
  const answered=completed.humanRequests.at(-1),answerSource=await h.query('source.get',{sourceId:answered.sourceId}),operationId=answered.resolution.operationId
  const retry={conversationId,generation:999,sourceId:answered.sourceId,messageVersion:answerSource.version,kind:'task.resume',operationId,
    action:{taskId,expectedRequirementRevision:completed.requirementRevision,expectedControlRevision:completed.controlRevision,operationId,
      messageId:operationId,text:answerSource.text,humanRequestId:answered.requestId,expectedContextRevision:completed.contextRevision-1,reason:answered.resolution.reason}}
  await h.store.command({id:'resume-retry-after-completion',kind:'router.task-action',args:retry})
  assert.deepEqual(await h.query('task.get',{taskId}),completed,'stable Router action retry never appends or resumes again')
  await assert.rejects(h.store.command({id:'resume-conflict',kind:'router.task-action',args:{...retry,action:{...retry.action,reason:'Different semantic decision'}}}),/OPERATION_CONFLICT/)
  const persisted=await h.host.ctx.sessionPersistence.readNative(originalSession,{requireComplete:true})
  const results=persisted.entries.filter(row=>row.type==='message'&&row.message.role==='toolResult').map(row=>row.message)
  assert.equal(results.filter(row=>row.toolName==='write'&&!row.isError).length,1)
  assert.ok(results.some(row=>row.toolName==='read'&&!row.isError&&JSON.stringify(row.content).includes('original-session-proof')))
  const calls=runs.length;await h.restart();await h.receive(channelMessage('answer',{senderId:audience==='operator'?'alice':'bob',text:'The existing read-only target is configured in VERIFY_TARGET; continue the original verification.'}));await h.service.whenIdle()
  assert.equal(runs.length,calls,'committed original source and task completion are not replayed after restart')
  assert.equal(writes,1)
})

test('Router directly maintains memory and learned skills with cold persistence, revocation and no empty tasks',{timeout:nativeTestTimeout(180000)},async t=>{
  const {readFile,stat}=await import('node:fs/promises'),{join}=await import('node:path')
  const {createPiProjectionRequest}=await import('../src/runtime/pi-request-context.js')
  const key='repository-checkout',context={scenario:'代码排障的工作目录选择。',boundaries:['保留已有改动；这不是外部操作授权。']}
  const skill={key,steps:['复用已存在的仓库目录','更新前检查并保留本地改动'],reason:'日常检索需要复用工作目录',applicability:'同一仓库的后续检索'}
  const cases=[
    {id:'memory-create',text:'仓库排障复用固定目录，并保留本地改动。',tool:'resident_memory_remember',args:{topic:'preferences',key,expectedRevision:0},revision:1},
    {id:'memory-update',text:'更正一下：先检查未提交改动，再更新固定目录中的代码。',tool:'resident_memory_remember',args:{topic:'preferences',key,expectedRevision:1},revision:2},
    {id:'memory-conflict',text:'按上次的版本直接覆盖这条习惯。',tool:'resident_memory_remember',args:{topic:'preferences',key,expectedRevision:1},code:'MEMORY_REVISION_CONFLICT'},
    {id:'memory-delete',text:'刚才的目录习惯不再适用，清掉那条记录。',tool:'resident_memory_forget',args:{topic:'preferences',key,expectedRevision:2}},
    {id:'skill-create',text:'把复用工作目录的方法整理成后续可用的操作步骤。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',expectedRevision:0},revision:1},
    {id:'skill-query',text:'看一下已经整理的方法。',tool:'resident_skill_query',args:{key},query:true,revision:1},
    {id:'skill-update',text:'调整方法，读取仓库之前先检查现有改动。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',steps:['首先检查现有改动','再读取仓库证据'],expectedRevision:1},revision:2},
    {id:'skill-conflict',text:'还是用旧版本的方法修改。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',expectedRevision:1},code:'REFLECTION_REVISION_CONFLICT'},
    {id:'skill-short-quote',text:'背景信息：只在原授权范围内操作。更新方法时保留这个限制。',tool:'resident_skill_mutate',quote:'更新方法',args:{...skill,action:'upsert'},code:'MEMORY_SOURCE_QUOTE_REQUIRED'},
    {id:'skill-secret',text:'不要把凭据放入方法正文。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',steps:['password: never-store-this-value']},code:'MEMORY_SECRET_REFUSED'},
    {id:'skill-path',text:'将方法写到安装模板位置。',tool:'resident_skill_mutate',args:{...skill,key:'../installed-template',action:'upsert'},code:'REFLECTION_SKILL_INVALID'},
    {id:'skill-delete',text:'这个方法已经过时，移除它。',tool:'resident_skill_mutate',args:{action:'delete',key,expectedRevision:2},revision:3},
    {id:'skill-stale-create',text:'沿用最初的空版本重新创建。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',expectedRevision:0},code:'REFLECTION_REVISION_CONFLICT'},
    {id:'skill-recreate',text:'依据目前需求重新整理同名方法。',tool:'resident_skill_mutate',args:{...skill,action:'upsert',expectedRevision:3},revision:4},
    {id:'skill-final-delete',text:'不再保留这个学习方法。',tool:'resident_skill_mutate',args:{action:'delete',key,expectedRevision:4},revision:5},
    {id:'skill-query-deleted',text:'确认删除后的版本。',tool:'resident_skill_query',args:{key},query:true,revision:5},
  ],steps=new Map(),outcomes=new Map()
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      const item=cases.find(row=>row.id===source.messageId),step=steps.get(item.id)??0;steps.set(item.id,step+1)
      if(step===0){const args=item.query?item.args:{operationId:item.id,sourceId:source.sourceId,messageVersion:source.version,sourceQuote:item.quote??source.text,...item.args}
        if(item.tool==='resident_memory_remember'){delete args.operationId;Object.assign(args,{memory:memoryDraft(source,context)})}
        if(item.tool==='resident_memory_forget')delete args.operationId
        return {tool:item.tool,args}}
      if(step===1){outcomes.set(item.id,item.missingWhy||item.speculation?body.messages.at(-1).content:memoryToolResult(body));return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'learning-settle:'+item.id}}}
      return {text:'Learning result inspected.'}
    }
    return {text:'No task execution required.'}
  })
  const scope={kind:'bot',id:hash('bot:shared')};let viewer,loaded,historyId
  for(const item of cases){
    await h.receive(channelMessage(item.id,{text:item.text}));await h.service.whenIdle()
    const result=outcomes.get(item.id);assert.ok(result,item.id)
    if(item.code){assert.equal(result.ok,false,item.id);assert.equal(result.code,item.code,item.id)}
    else if(item.query){assert.equal(result.revision,item.revision,item.id);assert.equal(result.entries.length,item.id==='skill-query'?1:0);if(result.entries.length)assert.deepEqual(result.entries[0].steps,skill.steps)}
    else{assert.equal(result.ok,true,item.id);assert.equal(result.persisted,true,item.id);if(item.revision!==undefined)assert.equal(item.tool==='resident_memory_remember'?result.entry.revision:result.revision,item.revision,item.id)}
    if(item.id==='memory-delete')assert.deepEqual((await h.host.ctx.memory.store.read(scope,{topic:'preferences',key})).entries,[])
    if(item.id==='skill-create'){
      assert.deepEqual((await h.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,[],'Skill does not require artificial experience records')
      viewer=await h.agent('learned-viewer',{actorId:'reader'})
      loaded=await h.host.ctx.skills.get('learned-'+key,{scope:viewer.agent});assert.match(loaded.content,/复用已存在的仓库目录/)
      historyId=viewer.session.sessionManager.appendCustomMessageEntry('night.tool-context',[{type:'text',text:loaded.content}],false)
      const original=(await h.query('source.list')).find(row=>row.messageId===item.id)
      const value=(await h.host.ctx.reflection.state(scope)).skills[key]
      assert.equal(value.source.messageId,original.sourceId);assert.equal(value.source.actor,hash(original.actorId));assert.equal(value.source.quoteSha256,hash(item.text))
    }
    if(item.id==='skill-update'){
      const projection=viewer.session.sessionManager.buildSessionProjection(),entry=projection.entries.find(row=>row.sourceEntry.id===historyId).messages[0]
      const filtered=await h.host.ctx.memory.filterRequest(createPiProjectionRequest(projection),viewer.agent)
      assert.match(filtered.messages[projection.messages.indexOf(entry)].content[0].text,/revoked/)
      assert.equal(viewer.session.sessionManager.buildSessionProjection().entries.find(row=>row.sourceEntry.id===historyId).messages[0].content[0].text,loaded.content,'durable audit stays intact')
      await viewer.dispose();await h.restart()
      viewer=await h.agent('cold-learned-viewer',{actorId:'other-reader'})
      const current=await h.host.ctx.skills.get('learned-'+key,{scope:viewer.agent});assert.match(current.content,/首先检查现有改动/)
      assert.match(await readFile(join(h.host.ctx.reflection.directory(scope),'skills',key,'SKILL.md'),'utf8'),/首先检查现有改动/)
    }
    if(item.id==='skill-delete'||item.id==='skill-final-delete'){
      assert.equal((await h.host.ctx.skills.list({scope:viewer.agent})).some(row=>row.name==='learned-'+key),false)
      await assert.rejects(stat(join(h.host.ctx.reflection.directory(scope),'skills',key)),{code:'ENOENT'})
    }
  }
  await viewer.dispose();await h.restart()
  assert.equal((await h.host.ctx.reflection.readSkills(scope,{key})).revision,5)
  assert.deepEqual((await h.host.ctx.reflection.readSkills(scope,{key})).entries,[])
  assert.deepEqual((await h.host.ctx.memory.store.read(scope,{topic:'preferences',key})).entries,[])
  assert.equal((await h.query('task.list')).length,0);assert.equal(h.sent.length,0)
  t.diagnostic(JSON.stringify({case:'router-learning-crud',checks:cases.length,memoryCrud:true,skillCrud:true,coldRestart:true,sharedProvider:true,oldLoadedSkillRevoked:true,deletedDirectoryAbsent:true,versionsMonotonic:true,emptyTasks:0,realVendorMessages:0}))
})

test('Router synthesizes project memory with linked evidence, cold recall and revision history',{timeout:nativeTestTimeout(180000)},async t=>{
  const url='https://github.com/orgs/example/projects/6',nextUrl='https://github.com/orgs/example/projects/7'
  const announcement='编辑器看板汇总截至公告时已提测未上线的需求和bug，用于开发进度与发版计划；进展同步issue和PR。后续迭代可以另建Project。 '+url
  const request='这个信息记录一下，后续开发任务要看这个Project的。',key='editor-project-reference',steps=new Map(),outcomes=new Map()
  let background,draft,entry,h
  h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),source=>({needsHandling:source.messageId!=='project-announcement'}))
    if(!requestTools(body).includes('resident_router_settle'))return {text:'No other work'}
    const input=router(body),source=input.events.find(event=>event.source)?.source
    if(!source)return settle(body,input)
    const id=source.messageId,step=steps.get(id)??0;steps.set(id,step+1)
    const write=memory=>({tool:'resident_memory_remember',args:{sourceId:source.sourceId,messageVersion:source.version,topic:'projects',key,sourceQuote:source.text,memory,expectedRevision:id==='project-record'?0:1}})
    if(step===0){
      if(id==='project-recall')return {tool:'memory_read',args:{topic:'projects',key,includeSources:true}}
      if(id==='project-delete')return {tool:'resident_memory_forget',args:{sourceId:source.sourceId,messageVersion:source.version,topic:'projects',key,sourceQuote:source.text,expectedRevision:2}}
      if(id==='project-record'){
        draft={summary:'后续编辑器开发任务参考 GitHub Project：'+url,
          why:'公告将看板用于已提测未上线需求和bug的进度与发版协调。',
          howToApply:'当前编辑器迭代先看该看板，再结合issue和PR同步进展；后续迭代按实际Project使用。',
          appliesTo:{kind:'context',description:'编辑器相关迭代的开发协作，不自动覆盖其他项目或所有未来迭代。'},
          evidence:[{id:'E1',source:'message',sourceId:source.sourceId,messageVersion:source.version,quote:source.text},
            {id:'E2',source:'quote',sourceId:source.sourceId,messageVersion:source.version,quote:announcement},
            {id:'E3',source:'message',sourceId:background.sourceId,messageVersion:background.version,quote:'编辑器看板汇总截至公告时已提测未上线的需求和bug'}]}
        return write(draft)
      }
      return write({summary:'后续编辑器该迭代改用 GitHub Project：'+nextUrl,why:'当前消息明确更正了看板。',howToApply:'当前迭代查看新看板，旧看板只作历史。',appliesTo:{kind:'context',description:'当前编辑器迭代；旧看板仅保留历史。'},evidence:[{id:'E1',source:'message',sourceId:source.sourceId,messageVersion:source.version,quote:source.text}]})
    }
    if(step===1){
      const result=memoryToolResult(body);outcomes.set(id,result)
      if(id==='project-record'){assert.equal(result.persisted,true);entry=result.entry;return write(draft)}
      if(id==='project-recall'){
        const recalled=result.entries.find(item=>item.key===key);assert.ok(recalled)
        assert.deepEqual(recalled.context,entry.context);assert.equal(recalled.text,entry.text)
        assert.equal(recalled.applicability.status,'context-dependent');assert.deepEqual(recalled.applicability.sourceMessageIds,[])
      }else assert.equal(result.persisted,true)
    }
    if(id==='project-record'&&step===2){
      const result=memoryToolResult(body);assert.equal(result.duplicate,true);assert.equal(result.persisted,true);assert.equal(result.entry.revision,1)
      return write({...draft,appliesTo:{...draft.appliesTo,kind:'actor'}})
    }
    if(id==='project-record'&&step===3){
      const result=memoryToolResult(body);assert.equal(result.ok,false);assert.equal(result.code,'MEMORY_WRITE_UNCONFIRMED');assert.equal(result.committed,true)
      return {tool:'resident_router_reply',args:{operationId:'project-memory-ack',sourceId:source.sourceId,messageVersion:source.version,text:'已保存编辑器看板、协作背景和适用范围。'}}
    }
    if(step===(id==='project-record'?4:1))return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'project-settle:'+id}}
    return {text:'The memory result and event settlement are committed.'}
  })
  await h.receive(channelMessage('project-announcement',{text:announcement}));await h.service.whenIdle()
  background=(await h.query('source.list')).find(item=>item.messageId==='project-announcement')
  const original=channelMessage('project-record',{text:request,quotedMessage:{messageId:'project-announcement',senderId:'alice',text:announcement}})
  await h.receive(original);await h.service.whenIdle()
  assert.ok(entry);assert.notEqual(entry.text,request);assert.equal(entry.context.version,3);assert.equal(entry.context.subject.kind,'context');assert.equal(entry.context.subject.actor,undefined)
  const observationText=entry.context.summary
  assert.match(observationText,/后续编辑器开发任务参考 GitHub Project/);assert.ok(observationText.includes(url));assert.doesNotMatch(observationText,/这个信息|这个Project/)
  for(const title of ['Summary:','**Why:**','**How to apply:**'])assert.ok(entry.text.includes(title))
  assert.doesNotMatch(entry.text,/Model observation|Hypothesis|Possible direct path|Evidence:|E1|sourceId|无额外假设/)
  const scope={kind:'bot',id:hash('bot:shared')}
  const disk=(await h.host.ctx.memory.store.read(scope,{topic:'projects',key,includeSources:true})).entries[0]
  assert.equal(entry.context.evidence,undefined,'ordinary mutation recall does not automatically expand source excerpts')
  const {evidence,...withoutEvidence}=disk.context;assert.deepEqual(withoutEvidence,entry.context);assert.equal(disk.text,entry.text);entry=disk
  for(const evidence of entry.context.evidence)assert.equal(evidence.quoteSha256,hash(evidence.quote))
  assert.equal(entry.context.evidence[2].sourceId,background.sourceId);assert.equal(entry.context.evidence[1].messageId,'project-announcement')
  const binding={actorId:'operator'},inventory=await h.host.ctx.memory.inspectEvolution(binding),item=inventory.items.find(item=>item.name==='projects/'+key)
  const detail=await h.host.ctx.memory.inspectEvolutionItem(binding,{id:item.id,revision:String(item.revision)});assert.equal(detail.current.text,entry.text)
  const before=h.requests.length;await h.restart();await h.receive(original);await h.service.whenIdle();assert.equal(h.requests.length,before,'cold duplicate does not re-infer a consumed source')
  await h.receive(channelMessage('project-recall',{conversationId:'another-room',senderId:'bob',text:'读取编辑器开发看板背景。'}));await h.service.whenIdle()
  await h.receive(channelMessage('project-update',{text:'更正：这个编辑器迭代改看 '+nextUrl+'，旧看板只保留历史。'}));await h.service.whenIdle()
  const updated=outcomes.get('project-update').entry;assert.equal(updated.id,entry.id);assert.equal(updated.revision,2);assert.equal(updated.context.hypothesis,undefined);assert.equal(updated.context.directPath,undefined)
  assert.match(updated.text,/当前消息明确更正了看板/);assert.doesNotMatch(updated.text,/假设|推测|Evidence:/)
  const changed=await h.host.ctx.memory.inspectEvolutionItem(binding,{id:item.id,revision:'2'});assert.equal(changed.previous.text,entry.text);assert.ok(changed.comparison.lines.some(line=>line.type==='added'&&line.text.includes(nextUrl)))
  await h.restart();assert.equal((await h.host.ctx.memory.store.read(scope,{topic:'projects',key})).entries[0].text,updated.text)
  await h.receive(channelMessage('project-delete',{text:'这条编辑器看板约定已过时，删除它。'}));await h.service.whenIdle();assert.deepEqual((await h.host.ctx.memory.store.read(scope,{topic:'projects',key})).entries,[])
  assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'router-contextual-memory',sections:3,contextResolved:true,historyIsEvidenceOnly:true,subject:'context-dependent',diskAndDetailVerified:true,coldRecall:true,duplicateNoReplay:true,updateAndDiff:true,noSpeculation:true,deleted:true,realMessages:0}))
})

test('taskless triage persists preparation phases and native metrics through disposal and restart',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await residentRouterHost(t,body=>{
  if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:false}))
  return {text:'No further work'}
 })
 const message=channelMessage('triage-phase-metrics',{text:'PRIVATE_TRIAGE_BODY'})
 await h.receive(message);await h.service.whenIdle()
 const rows=await eventually(()=>{
  const rows=h.service.listPerformance({runtimeOwner:'channel-triage'}).rows
  return rows.some(row=>row.phaseMs['triage-total'])&&rows
 },'durable triage tail')
 assert.equal(rows.length,1);const row=rows[0]
 assert.equal(row.taskId,undefined);assert.equal(row.groupId,h.host.ctx.channels.identity(message).sessionId)
 assert.ok(row.sessionId.startsWith('session-triage-'));assert.equal(h.host.ctx.agents.get(row.sessionId),undefined)
 assert.equal(row.modelCalls,1);assert.equal(row.toolCalls,1);assert.equal(row.toolResults,1)
 for(const phase of ['triage-total','session-create','workspace','session-store-open','session-prepare-actor','session-resolve-resources','session-sdk-create','resources-create','resources-deliver','resources-before-run','instructions','skills','sdk-reload','input-enqueue','input-acknowledge','request-prepare','request-guards','request-commit','triage-commit','session-dispose']){
  assert.ok(row.phaseMs[phase]?.count>0,phase);assert.equal(row.phaseMs[phase].failures,0,phase)
 }
 assert.ok(row.phaseMs['triage-total'].sum>=row.phaseMs['session-create'].sum)
 assert.equal(JSON.stringify(rows).includes(message.text),false)
 assert.equal((await h.query('task.list')).length,0);assert.equal(h.sent.length,0)
 const requests=h.requests.length
 await h.restart();await h.receive(message);await h.service.whenIdle()
 const restored=h.service.listPerformance({sessionId:row.sessionId}).rows[0]
 assert.deepEqual(restored,row);assert.equal(h.requests.length,requests)
})

test('Router schedules the same execution session across wait, stop, cancellation, completion and restart without operator grants',{timeout:nativeTestTimeout(100000)},async t=>{
  const actions=new Set(),settled=new Set(),turns=new Map(),owners=[],gate=Promise.withResolvers(),entered=Promise.withResolvers()
  let phase='initial',proofWrites=0,h
  t.after(()=>gate.resolve())
  h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      assert.match(JSON.stringify(body.messages),/你对所属conversation的执行会话拥有完整调度权/)
      assert.doesNotMatch(JSON.stringify(body.messages),/技术等待仅原作者或配置操作者可续接/)
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      if(!actions.has(source.messageId)){
        actions.add(source.messageId)
        if(source.messageId==='schedule-create')return {tool:'resident_task_plan',args:{operationId:'create',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'schedule-authority',title:'Preserve the execution proof',objective:'Verify retained proof under Router scheduling',requirements:['Use one session; do not repeat the first write']}],dependencies:[]}}
        const task=await h.query('task.get',{taskId:'schedule-authority'})
        const action={operationId:source.messageId,taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}
        // 唤醒不要求新的人类授权来源；停止则以另一作者来源验证无作者白名单。
        if(['schedule-pause','schedule-cancel'].includes(source.messageId))Object.assign(action,{sourceId:source.sourceId,messageVersion:source.version,kind:'control',control:source.messageId==='schedule-pause'?'paused':'cancelled'})
        else if(source.messageId==='schedule-reopen')Object.assign(action,{kind:'reopen',sameGoal:true})
        else Object.assign(action,{kind:'resume',reason:'Router independently schedules the original session'})
        return {tool:'resident_task_action',args:action}
      }
      if(!settled.has(source.messageId)){settled.add(source.messageId);return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+source.messageId}}}
      return settle(body,input)
    }
    if(requestTools(body).includes('task_result')){
      const input=requestText(body).toReversed().map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.task)
      assert.ok(input)
      owners.push(input.task.sessionId)
      const lease=input.task.leaseEpoch,step=turns.get(lease)??0;turns.set(lease,step+1)
      if(phase==='initial'){
        if(step===0){proofWrites++;return {tool:'write',args:{path:'work/router-proof.txt',content:'retained scheduling proof'}}}
        return {tool:'task_result',args:{decision:{action:'wait',audience:'operator',question:'Await a Router decision',summary:'Original session is waiting',evidence:['Original proof written'],limitations:['Waiting']}}}
      }
      if(step===0)return {tool:'read',args:{path:'work/router-proof.txt'}}
      assert.match(JSON.stringify(body),/retained scheduling proof/)
      if(phase==='inflight'){entered.resolve();await gate.promise}
      return {tool:'task_result',args:{decision:{action:'complete',summary:'The current Router-scheduled run verified retained proof',evidence:['work/router-proof.txt'],limitations:[]}}}
    }
    return {text:'No other work'}
  })
  await h.receive(channelMessage('schedule-create'));await h.service.whenIdle()
  const initial=await h.query('task.get',{taskId:'schedule-authority'}),sessionId=initial.sessionId
  assert.equal(initial.lastDecision.action,'wait');assert.equal(initial.humanRequests.at(-1).status,'waiting-reply')
  await h.receive(channelMessage('schedule-pause',{senderId:'bob'}));await h.service.whenIdle()
  let task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.control,'paused');assert.equal(task.drained,true)
  phase='inflight'
  const waking=h.receive(channelMessage('schedule-wake',{senderId:'carol'}))
  await entered.promise;await waking
  task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.drained,false);assert.equal(task.sessionId,sessionId)
  assert.ok(task.humanRequests.every(row=>row.status!=='waiting-reply'),'Router wake does not require or fabricate a human answer')
  await h.receive(channelMessage('schedule-cancel',{senderId:'bob'}));await h.service.whenIdle()
  task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.status,'cancelled');assert.equal(task.drained,true);assert.equal(h.host.ctx.agents.get(sessionId),undefined,'Stop joins the actual original owner')
  gate.resolve();phase='complete'
  await h.receive(channelMessage('schedule-restart',{senderId:'dave'}));await h.service.whenIdle()
  task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.status,'completed');assert.equal(task.sessionId,sessionId)
  await h.restart()
  await h.receive(channelMessage('schedule-reopen',{senderId:'eve'}));await h.service.whenIdle()
  task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.status,'completed');assert.equal(task.sessionId,sessionId);assert.equal(task.drained,true)
  const priorCompletionEvents=(await h.query('task.events')).events.filter(row=>row.taskId===initial.taskId&&row.kind==='task.completed').map(row=>row.id)
  await h.store.command({id:'archive-for-rescheduling',kind:'task.archive',args:{taskId:initial.taskId,actorId:'owner'}})
  assert.ok((await h.query('task.get',{taskId:initial.taskId})).archivedAt)
  await h.receive(channelMessage('schedule-unarchive',{senderId:'frank'}));await h.service.whenIdle()
  task=await h.query('task.get',{taskId:initial.taskId});assert.equal(task.status,'completed');assert.equal(task.archivedAt,undefined);assert.equal(task.sessionId,sessionId)
  const allEvents=(await h.query('task.events')).events
  assert.ok(priorCompletionEvents.every(id=>allEvents.some(row=>row.id===id)),'Unarchive preserves the original task events and receipt identities')
  assert.equal(proofWrites,1);assert.deepEqual([...new Set(owners)],[sessionId]);assert.equal((await h.query('task.list')).length,1)
  assert.ok(!h.results.some(row=>JSON.stringify(row.result).includes('TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED')))
  assert.ok(!(await h.query('source.list')).some(row=>row.requestIdentity?.effectAuthorization))
  assert.deepEqual(h.sent,[],'Scheduling requires no external messages')
})

for(const cut of ['prepared-only','journal-committed'])test(`Router resumes through an interrupted effect closure without a new operator grant: ${cut}`,{timeout:nativeTestTimeout(60000)},async t=>{
  const {mkdir,writeFile,readFile}=await import('node:fs/promises'),{join}=await import('node:path'),{createHash}=await import('node:crypto')
  const steps=new Map();let phase='unknown',effects=0,trip=true,h
  h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body),source=input.events.find(event=>event.source)?.source
      if(!source)return settle(body,input)
      const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
      if(step===0){
        if(source.messageId==='closure-create')return {tool:'resident_task_plan',args:{operationId:'create',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'closure-router',title:'Continue independent work',objective:'Read old evidence and complete independent work',requirements:['Do not replay an old invocation']}],dependencies:[]}}
        const task=await h.query('task.get',{taskId:'closure-router'})
        return {tool:'resident_task_action',args:{operationId:'resume',kind:'resume',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}}
      }
      if(step===1)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+source.messageId}}
      return {text:'Committed'}
    }
    if(requestTools(body).includes('partial_router_write')){
      if(phase==='unknown')return {tool:'partial_router_write',args:{}}
      if(phase==='write'){phase='finish';return {tool:'write',args:{path:'work/independent.txt',content:'new independent work'}}}
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Independent work complete; the old invocation remains closed with possible partial effects.',evidence:['work/independent.txt'],limitations:['Old partial effects retained']}}}
    }
    return {text:'No other work'}
  },{wrapStore:store=>({...store,command:async command=>{
    const interrupted=trip&&command.kind===(cut==='prepared-only'?'task.effect-reconciliation.prepare':'task.effect-reconciliation.commit')
    if(interrupted&&cut==='journal-committed'){trip=false;throw Object.assign(Error('Projection interrupted'),{code:'FIXTURE_CLOSURE_CUT'})}
    const result=await store.command(command)
    if(interrupted){trip=false;throw Object.assign(Error('Prepare response interrupted'),{code:'FIXTURE_CLOSURE_CUT'})}
    return result
  }})})
  h.host.ctx.get('tools').register({name:'partial_router_write',description:'Actual local write with a lost response',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'retained original effect');throw Error('response lost')}})
  await h.receive(channelMessage('closure-create'));await h.service.whenIdle()
  const before=await h.query('task.get',{taskId:'closure-router'}),native=await h.host.ctx.sessionPersistence.readNative(before.sessionId,{requireComplete:true}),intent=native.auditEntries.find(row=>row.data.kind==='effect-intent')
  const inspection=await h.service.inspectTaskEffect({taskId:before.taskId,intentEntryId:intent.entryId})
  const fields=['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest']
  const evidence={version:1,kind:'task-effect-readback',...Object.fromEntries(fields.map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'The original output exists and may have partial effects.',outcome:'partial-or-unknown',noReplay:true}
  const bytes=Buffer.from(JSON.stringify(evidence)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json'
  await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
  await assert.rejects(h.service.reconcileTaskEffect({...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'original-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'I close only the original attempt with possible partial effects; do not replay it.'}),{code:'FIXTURE_CLOSURE_CUT'})
  assert.equal((await h.query('task.get',{taskId:before.taskId})).effectReconciliations[0].state,'prepared')
  phase='write';await h.receive(channelMessage('closure-resume',{senderId:'bob'}));await h.service.whenIdle()
  const task=await h.query('task.get',{taskId:before.taskId})
  assert.equal(task.status,'completed',JSON.stringify({task,alerts:h.service.listAlerts(),results:h.results}));assert.equal(task.sessionId,before.sessionId);assert.equal(task.drained,true);assert.equal(effects,1)
  assert.equal(task.effectReconciliations[0].state,'committed');assert.equal(task.effectReconciliations[0].receipt.payload.noReplay,true)
  assert.equal(await readFile(join(inspection.scope.taskRoot,'work/independent.txt'),'utf8'),'new independent work')
  assert.ok(!(await h.query('source.list')).some(row=>row.requestIdentity?.effectAuthorization))
})
