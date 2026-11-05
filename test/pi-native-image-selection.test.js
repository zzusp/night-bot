import test from 'node:test'
import assert from 'node:assert/strict'
import {imageSelectionProjection as projection} from '../src/runtime/session-image-selection.js'

const message = () => ({role:'user',content:[{type:'text',text:'private'},{type:'image',url:'attachment:private-a'},{type:'image',url:'attachment:private-b'}]})
const context = value => ({nodes:[3],events:[{seq:3,type:'user/message',data:value}],baseSeq:3,messages:new Map()})
const decision = (imageIndexes=[1]) => ({data:{targets:[{seq:3,imageIndexes}]}})
test('image audit selection is detached, immutable and restricted to selected occurrences',()=>{
 const source=message(), projected=projection.project(decision(),context(source)).get(3)
 assert.equal(projected.content[1].offloaded,undefined)
 assert.equal(projected.content[2].offloaded,true)
 assert.equal(source.content[2].offloaded,undefined)
 assert.equal(Object.isFrozen(source.content[0]),false)
 source.content[0].text='changed'
 assert.equal(projected.content[0].text,'private')
 assert.throws(()=>{projected.content[2].url='other'},TypeError)
 assert.equal(projected.content[2].url,'attachment:private-b')
})
test('image audit selection refuses invalid or stale evidence atomically',()=>{
 const source=message(), ctx=context(source)
 for(const indexes of [[-0],[-1],[2],[1,0],[0,0],[]]) assert.throws(()=>projection.project(decision(indexes),ctx),/image\/offload/)
 assert.throws(()=>projection.project({data:{targets:[{seq:3,imageIndexes:[0]},{seq:3,imageIndexes:[1]}]}},ctx),/duplicate/)
 assert.throws(()=>projection.project(decision(),{...ctx,nodes:[]}),/current surface/)
 assert.throws(()=>projection.project(decision(),{...ctx,events:[{seq:3,type:'assistant/message',data:{message:source}}]}),/user\/message or tool\/result/)
 const applied=projection.project(decision(),ctx)
 assert.throws(()=>projection.project(decision(),{...ctx,messages:applied}),/already offloaded/)
 assert.equal(source.content[1].offloaded,undefined)
 assert.equal(source.content[2].offloaded,undefined)
})
test('image audit selection supports tool result attachment scope without resolving files',()=>{
 const source=message(), ctx={...context(source),events:[{seq:3,type:'tool/result',data:{message:source}}]}
 assert.equal(projection.project(decision([0]),ctx).get(3).content[1].url,'attachment:private-a')
})
