import test from 'node:test'
import assert from 'node:assert/strict'
import {definition,officialToolsFixture} from './fixtures/pi-official-tools.js'
import {bindBusinessTurnYield} from '../src/runtime/pi-business-turn-yield.js'

test('public SDK reports strict argument rejection and business yield ends only the current turn',async t=>{
 let effects=0
 const h=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('typed',async()=>{effects++;return{}},{parameters:{type:'object',properties:{n:{type:'number'}},required:['n'],additionalProperties:false}})))
 const observed=[],actor={id:h.session.sessionId,piSession:h.session},fences=[]
 const binding=bindBusinessTurnYield({session:h.session,actor,onToolResult:(owner,event)=>{assert.equal(owner,actor);assert.ok(Object.isFrozen(event));observed.push(event);return event.isError},fence:cause=>fences.push(cause)})
 t.after(()=>binding.close())
 await h.run([{id:'invalid',name:'typed',args:{n:'wrong'}}])
 assert.equal(effects,0);assert.equal(h.requests.length,1)
 assert.deepEqual(observed,[{toolCallId:'invalid',toolName:'typed',isError:true}])
 assert.equal(h.session.messages.find(message=>message.role==='toolResult').isError,true)
 await h.run([{id:'valid',name:'typed',args:{n:1}}])
 assert.equal(effects,1);assert.equal(h.requests.length,3)
 assert.deepEqual(observed[1],{toolCallId:'valid',toolName:'typed',isError:false})
 assert.deepEqual(fences,[])
})
test('business yield binding refuses facade sessions and mismatched native identity',async t=>{
 assert.throws(()=>bindBusinessTurnYield({session:{agent:{}},actor:{},onToolResult:()=>true,fence(){}}),/Exact official/)
 const h=await officialToolsFixture(t,()=>{})
 assert.throws(()=>bindBusinessTurnYield({session:h.session,actor:{id:'foreign',piSession:h.session},onToolResult:()=>true,fence(){}}),/Exact official/)
})
