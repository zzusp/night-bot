import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {atomicWrite} from '../src/runtime/files.js'
import {createPiProjectionRequest} from '../src/runtime/pi-request-context.js'

async function fixture(t,decide){
 const f=await memoryHost(t,decide),handle=await f.agent('history-task',{actorId:'alice'}),other=await f.agent('other-task',{actorId:'bob'})
 const memory=f.host.ctx.memory,reflection=f.host.ctx.get('reflection'),scope=await memory.scope(handle.actor,{})
 await memory.store.remember(scope,{topic:'experience',key:'evidence',text:'verified evidence',source:{sessionId:'source',messageId:'message'}})
 const value={active:true,supports:[{taskId:'task',memoryKey:'evidence'}],taskIds:['task'],memoryKeys:['evidence'],steps:['UNIQUE_VALID_SKILL_BODY'],applicability:'Testing',revision:1}
 const save=async row=>{await atomicWrite(join(reflection.directory(scope),'state.json'),JSON.stringify({version:1,reviews:{},skills:row?{verify:row}:{}}));f.host.ctx.skills.invalidateCache()}
 await save(value)
 const candidate=(await reflection.catalog(handle.actor)).find(row=>row.name==='learned-verify')
 const load=()=>reflection.skill(candidate,handle.actor,{resourceOnly:true})
 const manager=handle.session.sessionManager
 const append=content=>manager.appendMessage({role:'toolResult',toolCallId:'skill-call',toolName:'skill',timestamp:1,isError:false,content:[{type:'text',text:content}]})
 const project=()=>memory.filterRequest(createPiProjectionRequest(manager.buildSessionProjection()),handle.actor)
 const visible=async()=>JSON.stringify((await project()).messages).includes('UNIQUE_VALID_SKILL_BODY')
 return {...f,handle,other,memory,reflection,scope,value,save,load,manager,append,project,visible}
}
test('unrelated cross-task memory writes preserve skill history; fresh loads keep the same identity',async t=>{
 const f=await fixture(t),loaded=await f.load();f.append(loaded.content)
 const original=structuredClone(f.manager.buildSessionProjection().messages)
 assert.equal(await f.visible(),true)
 const otherScope=await f.memory.scope(f.other.actor,{})
 await f.memory.store.remember(otherScope,{topic:'facts',key:'unrelated',text:'Unrelated task fact',source:{sessionId:'other-task',messageId:'other-message'}})
 assert.equal(await f.visible(),true)
 assert.equal((await f.load()).content,loaded.content)
 assert.deepEqual(f.manager.buildSessionProjection().messages,original)
})
test('skill deletion, disable, support loss, version/content update and permission loss revoke old history',async t=>{
 const f=await fixture(t),loaded=await f.load();f.append(loaded.content)
 for(const row of [undefined,{...f.value,active:false},{...f.value,revision:2},{...f.value,steps:['CHANGED_BODY']},{...f.value,supports:[{taskId:'task',memoryKey:'missing'}],memoryKeys:['missing']}]){
  await f.save(row);assert.equal(await f.visible(),false)
 }
 await f.save(f.value);assert.equal(await f.visible(),true)
 await f.save({...f.value,revision:2,steps:['CURRENT_BODY']})
 const fresh=await f.load();f.append(fresh.content)
 const projection=JSON.stringify((await f.project()).messages)
 assert.match(projection,/CURRENT_BODY/);assert.doesNotMatch(projection,/UNIQUE_VALID_SKILL_BODY/)
 await f.save(f.value)
 f.memory.bindings.delete(f.handle.actor.id)
 assert.equal(await f.visible(),false)
})
test('actual forgetting invalidates support and legacy unidentifiable markers fail closed without rewriting history',async t=>{
 const f=await fixture(t),loaded=await f.load();f.append(loaded.content)
 await f.memory.store.forget(f.scope,{topic:'experience',key:'evidence'})
 assert.equal(await f.visible(),false)
 await f.memory.store.remember(f.scope,{topic:'experience',key:'evidence',text:'verified evidence',source:{sessionId:'source',messageId:'restored'}})
 assert.equal(await f.visible(),true)
 const legacy=loaded.content.replace(/;key=verify;fingerprint=[a-f0-9]+/,'')
 f.append(legacy);assert.match((await f.project()).messages.at(-1).content[0].text,/Historical learned skill revoked/)
 assert.match(JSON.stringify(f.manager.buildSessionProjection().messages),/UNIQUE_VALID_SKILL_BODY/)
})

test('native skill tool and subsequent provider requests retain an unchanged learned skill after another task writes',async t=>{
 const f=await fixture(t,body=>{
  const last=body.messages.at(-1)
  if(last?.role==='user'&&JSON.stringify(last.content).includes('LOAD_SKILL_NOW'))return {tool:'skill',args:{name:'learned-verify'}}
 })
 await f.say(f.handle.actor,'LOAD_SKILL_NOW')
 assert.equal(f.errors.length,0)
 assert.ok(f.requests.some(body=>body.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('UNIQUE_VALID_SKILL_BODY'))))
 await f.memory.store.remember(await f.memory.scope(f.other.actor,{}),{topic:'facts',key:'another-task',text:'Another task writes',source:{sessionId:'other-task',messageId:'source'}})
 await f.say(f.handle.actor,'Continue without reloading the skill')
 assert.match(JSON.stringify(f.requests.at(-1).messages),/UNIQUE_VALID_SKILL_BODY/)
 await f.memory.store.forget(f.scope,{topic:'experience',key:'evidence'})
 await f.say(f.handle.actor,'Continue after forgetting')
 assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages),/UNIQUE_VALID_SKILL_BODY/)
 assert.match(JSON.stringify(f.requests.at(-1).messages),/Historical learned skill revoked/)
})

test('more than 50 unrelated experiences do not displace an authorized supporting entry',async t=>{
 const f=await fixture(t),loaded=await f.load();f.append(loaded.content)
 for(let i=0;i<51;i++)await f.memory.store.remember(f.scope,{topic:'experience',key:'aaa-'+String(i),text:'Unrelated experience '+i,source:{sessionId:'other-task',messageId:'unrelated-'+i}})
 assert.equal(await f.visible(),true)
 assert.equal((await f.load()).content,loaded.content)
})
