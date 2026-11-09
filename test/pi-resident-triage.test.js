import test from 'node:test'
import assert from 'node:assert/strict'
import {TRIAGE_BATCH_LIMIT,validateTriageDecision} from '../src/channels/triage.js'

const source = (id,version=1) => ({sourceId:'source-'+id,messageId:'message-'+id,version,text:'Original '+id,actorId:'alice'})
const decide = (item,needsHandling=false,reply) => ({sourceId:item.sourceId,messageVersion:item.version,
  needsHandling,...reply===undefined?{}:{reply},reason:'Quickly available original context is sufficient for this disposition'})

test('first-tier contract preserves all four independent handling/reply dispositions without splitting tasks',()=>{
  const messages = [1,2,3,4].map(id=>source(id))
  const dispositions = [decide(messages[0]),decide(messages[1],false,'你好。'),
    decide(messages[2],true),decide(messages[3],true,'收到，会继续处理。')]
  assert.deepEqual(validateTriageDecision(messages,{dispositions}).dispositions,dispositions)
  assert.equal(dispositions[0].reply,undefined)
  assert.equal(dispositions[1].needsHandling,false)
  assert.equal(dispositions[2].reply,undefined)
  assert.equal(dispositions[3].needsHandling,true)
  for(const field of ['taskId','topicKey','tasks','dependencies','plan']) {
    const tampered = structuredClone({dispositions})
    tampered.dispositions[0][field] = field
    assert.throws(()=>validateTriageDecision(messages,tampered),undefined,'first tier cannot submit '+field)
  }
})

test('first-tier rejects incomplete, duplicate, stale and foreign source decisions rather than treating them as silence',()=>{
  const messages = [source(1,2),source(2)]
  const dispositions = messages.map(item=>decide(item))
  assert.throws(()=>validateTriageDecision(messages,{dispositions:dispositions.slice(0,1)}),/TRIAGE_BATCH_INCOMPLETE/)
  assert.throws(()=>validateTriageDecision(messages,{dispositions:[dispositions[0],dispositions[0]]}),/TRIAGE_DUPLICATE_SOURCE/)
  for(const replacement of [{...dispositions[0],messageVersion:1},{...dispositions[0],sourceId:'foreign-source'}])
    assert.throws(()=>validateTriageDecision(messages,{dispositions:[replacement,dispositions[1]]}),/TRIAGE_SOURCE_OUTSIDE_BATCH/)
  assert.throws(()=>validateTriageDecision(messages,{dispositions:[{...dispositions[0],reply:''},dispositions[1]]}))
  assert.throws(()=>validateTriageDecision(messages,{dispositions:[{...dispositions[0],reply:'x'.repeat(1001)},dispositions[1]]}))
})

test('first-tier accepts exactly 15 original messages but cannot authorize an overflow item in the current batch',()=>{
  assert.equal(TRIAGE_BATCH_LIMIT,15)
  const messages = Array.from({length:16},(_,id)=>source(id)),dispositions=messages.map(item=>decide(item,true))
  assert.equal(validateTriageDecision(messages.slice(0,15),{dispositions:dispositions.slice(0,15)}).dispositions.length,15)
  assert.throws(()=>validateTriageDecision(messages,{dispositions}),/TRIAGE_BATCH_LIMIT/)
  assert.throws(()=>validateTriageDecision(messages.slice(0,15),{dispositions:[...dispositions.slice(0,14),dispositions[15]]}),/TRIAGE_SOURCE_OUTSIDE_BATCH/)
})
