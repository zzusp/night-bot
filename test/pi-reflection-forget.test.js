import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import Reflection from '../src/memory/reflection.js'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {atomicWrite} from '../src/runtime/files.js'

test('forget commits authoritative review and skill removal before a failing archive callback',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-forget-')),store=new MarkdownMemoryStore(root)
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const scope=memoryScope({actorId:'actor'}),id=hash('event'),key='task-'+id.slice(0,12)+'-lesson'
 const reflection=Object.create(Reflection.prototype)
 let invalidated=false
 reflection.host={memory:{store},skills:{invalidateCache(){invalidated=true}}}
 reflection.sources=new Set([{onReview:async()=>{throw new Error('archive unavailable')}}])
 const directory=reflection.directory(scope),state={version:1,skills:{lesson:{active:true,memoryKeys:[key]}},reviews:{[id]:{status:'done',eventId:'event',taskId:'task',lessons:[{key:'lesson',observation:'Forgotten observation'}],destinations:[{memory:{key}}]}}}
 await atomicWrite(join(directory,'state.json'),JSON.stringify(state))
 await atomicWrite(join(directory,'skills','lesson','SKILL.md'),'Forgotten derived skill')
 await assert.rejects(reflection.forget(scope,key),/archive unavailable/)
 const restarted=await reflection.state(scope)
 assert.deepEqual(restarted.skills,{})
 assert.deepEqual(restarted.reviews[id].lessons,[])
 assert.deepEqual(restarted.reviews[id].destinations,[])
 assert.equal(restarted.reviews[id].forgotten,true)
 assert.equal(invalidated,true)
 assert.doesNotMatch(await readFile(join(directory,'reviews',id+'.json'),'utf8'),/Forgotten observation/)
})
