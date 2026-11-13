import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'

function taskInput(body){for(const text of requestText(body).toReversed()){try{const input=JSON.parse(text);if(input.task)return input}catch{}}}
const call=(tool,args)=>({tool,args})

test('default Router creates A then B, rejects preliminary completion, reworks original A session and releases B only on current accepted evidence',{timeout:nativeTestTimeout(90000)},async t=>{
  let h,originalSession;const taskTurns=[],bStarts=[],evaluations=[],queries=[]
  h=await residentRouterHost(t,async body=>{
    if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
    const names=requestTools(body),first=requestEnvelope(body,'一级分诊请求：')
    if(names.includes('channel_triage_submit'))return call('channel_triage_submit',{dispositions:first.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Original request explicitly orders dependent tasks'}))})
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(!names.length&&handoff)return {text:JSON.stringify({currentIntent:'Verify A before B; preliminary evidence is not accepted; retain the original authorization',unresolvedQuestions:[],referents:['A is verification; B is the dependent result'],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(names.includes('task_result')){
      const input=taskInput(body),task=input.task;taskTurns.push({taskId:task.taskId,revision:task.requirementRevision})
      if(task.taskId==='a-e2e')assert.deepEqual(task.dependencies,[],'A outgoing dependencies must not become its input evidence')
      if(task.taskId==='a-e2e')return call('task_result',{decision:{action:'complete',summary:task.requirementRevision===1?'Preliminary investigation only':'Verification evidence accepted',evidence:[task.requirementRevision===1?'proof:preliminary':'proof:verified'],limitations:task.requirementRevision===1?['Verification incomplete']:[]}})
      assert.equal(task.dependencies.length,1,'B receives only its actual incoming dependency')
      const dependency=task.dependencies[0],prior=dependency.prerequisite
      assert.equal(dependency.taskId,task.taskId);assert.equal(prior.taskId,'a-e2e');assert.equal(prior.requirementRevision,2)
      assert.equal(dependency.state,'satisfied');assert.equal(dependency.prerequisiteRequirementRevision,2)
      assert.equal(dependency.evaluation.decision,'satisfied');assert.equal(dependency.evaluation.prerequisiteRequirementRevision,2)
      assert.equal(dependency.evaluation.requirementRevision,task.requirementRevision);assert.equal(dependency.evaluation.controlRevision,task.controlRevision)
      assert.equal(dependency.completionEvent.kind,'task.completed');assert.equal(dependency.completionEvent.taskId,prior.taskId);assert.equal(dependency.completionEvent.requirementRevision,2)
      assert.equal(dependency.evaluation.completionEventId,dependency.completionEvent.id)
      assert.equal(prior.completion.result.summary,'Verification evidence accepted');assert.deepEqual(prior.completion.result.evidence,['proof:verified']);assert.deepEqual(prior.completion.result.limitations,[])
      assert.equal(prior.sessionId,undefined);assert.equal(dependency.authorization.actorId,task.ownerActorId);assert.match(dependency.authorization.actorId,/^channel-actor-/);assert.equal(dependency.authorization.messageVersion,1)
      assert.ok(input.sources.some(source=>source.sourceId===dependency.authorization.sourceId&&source.version===dependency.authorization.messageVersion&&source.actorId===dependency.authorization.actorId))
      assert.ok(!JSON.stringify(dependency).includes('proof:preliminary'),'Rejected old completion evidence must not enter B input')
      bStarts.push({aRevision:prior.requirementRevision,dependencyState:dependency.state,dependency:structuredClone(dependency)})
      return call('task_result',{decision:{action:'complete',summary:'B uses the verified current A evidence',evidence:['proof:b'],limitations:[]}})
    }
    if(names.includes('resident_router_settle')){
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.result.isError)return {text:'Host rejection is retained for investigation.'}
      const input=requestEnvelope(body,'Router 请求：'),source=(await h.query('source.list')).find(source=>source.messageId==='ordered-work')
      const tasks=await h.query('task.list'),a=tasks.find(task=>task.taskId==='a-e2e'),b=tasks.find(task=>task.taskId==='b-e2e')
      if(!a)return call('resident_task_plan',{operationId:'ordered-plan',sourceId:source.sourceId,messageVersion:source.version,
        tasks:[{taskId:'a-e2e',title:'Verify A',objective:'Verify A',requirements:['Evidence must be verified']},{taskId:'b-e2e',title:'Produce B',objective:'Produce B only after verified A',requirements:['Use current verified A']}],
        dependencies:[{taskId:'b-e2e',prerequisiteTaskId:'a-e2e',condition:'A evidence is verified with no remaining verification limitation'}]})
      originalSession??=a.sessionId
      const event=input.events.find(event=>event.taskEvent?.taskId==='a-e2e'&&event.taskEvent.kind==='task.completed')
      if(event){
        const revision=event.taskEvent.requirementRevision,key=event.id
        if(!queries.includes(key)){queries.push(key);return call('resident_task_query',{taskId:'a-e2e',detail:'full'})}
        if(revision===a.requirementRevision){
          const dependency=(await h.query('router.dependencies',{taskId:'b-e2e'}))[0]
          const previous=await h.query('router.evaluations',{taskId:'b-e2e'})
          if(!previous.some(row=>row.completionEventId===event.taskEventId)){
            const decision=revision===1?'continue':'satisfied';evaluations.push({revision,decision})
            return call('resident_dependency_evaluate',{operationId:'evaluate-a-'+revision,dependencyId:dependency.id,
              completionEventId:event.taskEventId,prerequisiteRequirementRevision:revision,requirementRevision:b.requirementRevision,
              controlRevision:b.controlRevision,arrangementRevision:dependency.arrangementRevision,decision,evidence:[revision===1?'proof:preliminary':'proof:verified']})
          }
          if(revision===1)return call('resident_task_action',{operationId:'rework-a',sourceId:source.sourceId,messageVersion:source.version,
            kind:'reopen',taskId:'a-e2e',expectedRequirementRevision:a.requirementRevision,expectedControlRevision:a.controlRevision,sameGoal:true})
        }
      }
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1).result.isError)return {text:'Current batch disposition is committed.'}
      return call('resident_router_settle',{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.eventId).join(',')})
    }
    return {text:'No additional work'}
  })
  await h.receive(channelMessage('ordered-work',{text:'First verify synthetic A. Only after the evidence is verified, produce B.'}))
  await h.service.whenIdle()
  const a=await h.query('task.get',{taskId:'a-e2e'}),b=await h.query('task.get',{taskId:'b-e2e'})
  t.diagnostic(JSON.stringify({taskTurns,evaluations,errors:h.errors.map(error=>error?.message),toolErrors:h.results.filter(row=>row.result.isError),a:{status:a.status,revision:a.requirementRevision,drained:a.drained},b:{status:b.status,drained:b.drained}}))
  const planned=h.results.find(row=>row.name==='resident_task_plan'&&!row.result.isError).result.value
  assert.ok(planned.result.tasks.every(task=>task.projection==='summary'&&task.request===undefined),'plan returns compact receipts, not accumulated full input')
  const revised=h.results.find(row=>row.name==='resident_task_action'&&!row.result.isError).result.value
  assert.equal(revised.result.task.projection,'summary');assert.equal(revised.result.task.request,undefined)
  assert.match(a.request,/First verify synthetic A/,'authoritative original request is not removed by the model projection')
  assert.equal(a.requirementRevision,2);assert.equal(a.status,'completed');assert.equal(a.sessionId,originalSession)
  assert.equal(b.status,'completed');assert.equal(b.requirementRevision,1)
  assert.deepEqual(evaluations,[{revision:1,decision:'continue'},{revision:2,decision:'satisfied'}])
  assert.equal(bStarts.length,1);assert.equal(bStarts[0].aRevision,2);assert.equal(bStarts[0].dependencyState,'satisfied')
  assert.equal(taskTurns.filter(turn=>turn.taskId==='b-e2e').length,1)
  const stored=await h.host.ctx.sessionPersistence.readNative(b.sessionId,{requireComplete:true})
  const packet=stored.audit.find(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='task-input')?.payload
  assert.ok(packet,'B evidence is retained in the real official admission packet')
  const source=(await h.query('source.list')).find(row=>row.messageId==='ordered-work')
  assert.ok(packet.source.traceSources?.some(ref=>ref.sourceId===source.sourceId&&ref.sourceVersion===source.version))
  const trace=await h.service.listExecutionTrace({sourceId:source.sourceId,sourceVersion:source.version,groupId:source.groupId,limit:500})
  assert.ok(trace.items.some(row=>row.taskId==='b-e2e'&&row.sourceLinks.some(link=>link.association==='admitted-input')))
  const completion=await h.service.listExecutionTrace({taskId:'a-e2e',limit:500});assert.ok(completion.items.some(row=>row.runtimeOwner==='conversation-router'))
  await assert.rejects(h.service.listExecutionTrace({sourceId:source.sourceId,sourceVersion:source.version,groupId:'foreign'}))
  const admitted=JSON.parse(packet.content.find(part=>part.type==='text').text)
  assert.deepEqual(admitted.task.dependencies,[bStarts[0].dependency])
  assert.equal(admitted.task.sessionId,b.sessionId)
  assert.deepEqual(await h.query('execution.list'),[],'one task keeps one direct execution session, not a split team')
  assert.equal((await h.query('wake.list',{taskId:'b-e2e'})).filter(wake=>wake.kind==='dependency.satisfied').length,1)
  assert.ok(h.results.some(row=>row.name==='resident_task_query'&&!row.result.isError&&row.result.value?.task?.completion?.result?.evidence?.includes('proof:verified')),'Router reads complete current execution evidence through the actual full-detail tool')
})
