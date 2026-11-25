import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {digest} from '../server/security.js'
import {MarkdownMemoryStore} from '../../../src/memory/store.js'
import {atomicWrite} from '../../../src/runtime/files.js'
import Reflection from '../../../src/memory/reflection.js'
import {memoryScope} from '../../../src/memory/scope.js'
import {renderSkillContent} from '../../../src/native-skill-protocol.js'
import {readResourceToolContents, resourceReadCandidate} from '../server/resource-tool-content.js'

test('learned skill grant requires current exact content, scope, signature, and active evidence', async () => {
  const binding = {actorId: 'real-operator'}, scope = memoryScope(binding)
  const key = 'approved-resource', name = 'learned-' + key
  const state = {skills: {[key]: {revision: 1, active: true, origin: 'task-reflection', applicability: 'Check evidence',
    steps: ['Confirm source', 'Check current facts'], supports: [{memoryKey: 'observed-verification'}]}}}
  const witness = {topic: 'experience', key: 'observed-verification'}
  let supports = [witness]
  const reflection = Object.create(Reflection.prototype)
  const value = {name, provider: 'learned', content: reflection.renderSkill(scope, key, state.skills[key])}
  const proof = value => {
    const content = [{type: 'text', text: renderSkillContent(value)}]
    const message = {role: 'toolResult', toolName: 'skill', toolCallId: 'call-one', isError: false, content,
      details: {nativeResult: {value, content, isError: false}, unexpected: 'PRIVATE_CHILD'}}
    return resourceReadCandidate('skill', {name}, message, {type: 'message', message})
  }
  const memory = {store: {root: '/test', readHistoryBatch: async () => ({entries:supports, skillState:state})}}
  const resolve = candidate => readResourceToolContents([{id: 'one', candidate}], {memory, reflection, binding})
  const candidate = proof(value)
  assert.ok(candidate)
  assert.deepEqual([...await resolve(candidate)], [['one', {text:'1. Confirm source\n2. Check current facts', skillName:name}]])
  assert.equal((await resolve(proof({...value, content: value.content + 'FORGED_TAIL'}))).size, 0)
  assert.equal((await resolve(proof({...value, content: value.content.replace(scope.id, 'a'.repeat(64))}))).size, 0)
  assert.equal((await resolve(proof({...value, content: value.content.replace(/;key=.*$/m, '')}))).size, 0)
  supports = [{...witness, topic:'facts'}]
  assert.equal((await resolve(candidate)).size, 0)
  supports = [witness]
  state.skills[key].revision = 2
  assert.equal((await resolve(candidate)).size, 0)
  state.skills[key].revision = 1
  state.skills[key].active = false
  assert.equal((await resolve(candidate)).size, 0)
})

test('one history lease batches file reads and checks latest skill state and expiry',async t=>{
  const root=await mkdtemp(join(tmpdir(),'night-history-batch-'))
  let now=Date.now()
  const reads=[], store=new MarkdownMemoryStore(root,{now:()=>now,onRead:name=>reads.push(name)})
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
  const binding={actorId:'fixture-operator'},scope=memoryScope(binding)
  const source=key=>({messageId:'message-'+key,sessionId:'fixture-session'})
  const expiresAt=new Date(now+60_000).toISOString()
  const fact=async(key,text,expiry)=> (await store.remember(scope,{topic:'facts',key,text,expiresAt:expiry,source:source(key)})).entry
  const alpha=await fact('alpha','Independently verified fact A.')
  const beta=await fact('beta','Independently verified fact B.',expiresAt)
  await store.remember(scope,{topic:'experience',key:'support',text:'Verified skill evidence.',expiresAt,source:source('support')})
  const reflection=Object.assign(Object.create(Reflection.prototype),{host:{memory:{store}}})
  const skill=key=>({revision:1,active:true,origin:'task-reflection',applicability:'Use only after confirmation',body:`Approved ${key}`,supports:[{memoryKey:'support'}]})
  const state={skills:{alpha:skill('alpha'),beta:skill('beta')}}
  const statePath=join(reflection.directory(scope),'state.json')
  await mkdir(dirname(statePath),{recursive:true});await writeFile(statePath,JSON.stringify(state))
  const recordedSkill=key=>{
    const value={name:'learned-'+key,provider:'learned',content:reflection.renderSkill(scope,key,state.skills[key])}
    const content=[{type:'text',text:renderSkillContent(value)}]
    const message={role:'toolResult',toolName:'skill',toolCallId:'skill-'+key,isError:false,content,details:{nativeResult:{value,content,isError:false}}}
    return resourceReadCandidate('skill',{name:value.name},message,{type:'message',message})
  }
  const recordedFact=entry=>({kind:'memory-entry',value:{scopeToken:`bot/${scope.id}`,revision:0},topic:'facts',
    row:{id:entry.id,key:entry.key,revision:entry.revision,hash:digest(JSON.stringify(entry.text))}})
  const input=[['s-a',recordedSkill('alpha')],['a',recordedFact(alpha)],['b',recordedFact(beta)],
    ['a-again',{...recordedFact(alpha),topic:undefined,path:'categories/facts/entries/alpha.md'}],
    ['s-b',recordedSkill('beta')]].map(([id,candidate])=>({id,candidate}))
  const resolve=()=>readResourceToolContents(input,{memory:{store},reflection,binding})
  reads.length=0
  assert.deepEqual([...await resolve()].map(([id])=>id),input.map(({id})=>id))
  assert.equal(reads.filter(name=>name==='scope.json').length,1,'one memory lease')
  assert.equal(reads.filter(name=>name==='index.md').length,1,'one current evidence index')
  assert.equal(reads.filter(name=>name==='evolution/state.json').length,1,'one current atomic skill state')
  assert.equal(reads.filter(name=>name.startsWith('categories/facts/entries/')).length,2,'duplicate receipts read their exact fact once')

  const readFile=store.file.bind(store), currentBeta=state.skills.beta
  store.file=async(dir,name)=>{
    if(name==='evolution/state.json'){
      state.skills.beta={...currentBeta,revision:2,active:false}
      await atomicWrite(statePath,JSON.stringify(state))
    }
    return readFile(dir,name)
  }
  assert.deepEqual([...await resolve()].map(([id])=>id),['s-a','a','b','a-again'])
  store.file=readFile
  state.skills.beta=currentBeta
  await atomicWrite(statePath,JSON.stringify(state))

  store.file=async(dir,name)=>{
    const result=await readFile(dir,name)
    if(name==='evolution/state.json')now=Date.parse(expiresAt)
    return result
  }
  assert.deepEqual([...await resolve()].map(([id])=>id),['a','a-again'],'expiry during IO removes the fact and its skill support')
  store.file=readFile
  now-=1000
  await writeFile(statePath,'not valid JSON')
  assert.deepEqual([...await resolve()].map(([id])=>id),['a','b','a-again'],'invalid skill state does not hide valid facts')
  await atomicWrite(statePath,JSON.stringify(state))
  await store.forget(scope,{topic:'experience',key:'support',source:source('forget-support')})
  assert.deepEqual([...await resolve()].map(([id])=>id),['a','b','a-again'])

  const wrongPath={id:'wrong-path',candidate:{...recordedFact(alpha),path:'categories/facts/entries/beta.md'}}
  const stale={id:'stale',candidate:{...recordedFact(beta),row:{...recordedFact(beta).row,revision:beta.revision+1}}}
  await writeFile(join(store.directory(scope),'categories/facts/entries/alpha.md'),'changed outside the transaction')
  const result=await readResourceToolContents([...input,wrongPath,stale],{memory:{store},reflection,binding})
  assert.deepEqual([...result.keys()],['b'])
})
