import test from 'node:test'
import assert from 'node:assert/strict'
import {messageProcessPosition, overlapArea} from '../src/message-process-position.ts'
const viewport={left:8,top:72,right:1432,bottom:948}
const anchor={left:674,top:133,right:1059,bottom:184}
const box=p=>({left:p.left,top:p.top,right:p.left+p.width,bottom:p.top+p.maxHeight})
test('side selection avoids adjacent assistant messages rather than always floating left',()=>{
 const neighboring={left:355,top:280,right:700,bottom:465}
 const rail={left:1150,top:64,right:1430,bottom:948}
 const p=messageProcessPosition(anchor,viewport,346,[neighboring],[rail])
 assert.notEqual(p.side,'left')
 assert.equal(overlapArea(box(p),anchor),0);assert.equal(overlapArea(box(p),neighboring),0)
 assert.ok(p.arrowOffset>=18&&p.arrowOffset<=p.maxHeight-18)
})
test('side placement follows anchor movement and clamps to reading viewport',()=>{
 const p=messageProcessPosition({...anchor,top:121,bottom:172},viewport,346)
 assert.equal(p.top,121)
 const low=messageProcessPosition({...anchor,top:900,bottom:940},viewport,346)
 assert.ok(low.top+low.maxHeight<=viewport.bottom)
 assert.equal(overlapArea(box(low),{...anchor,top:900,bottom:940}),0)
})
test('narrow viewport uses a bounded below-message surface with no selected-text overlap',()=>{
 const narrow={left:8,top:62,right:382,bottom:940},source={left:35,top:113,right:358,bottom:188}
 const p=messageProcessPosition(source,narrow,346)
 assert.equal(p.side,'bottom');assert.equal(p.top,198)
 assert.ok(p.left>=8&&p.left+p.width<=382);assert.equal(overlapArea(box(p),source),0)
})
test('near-bottom narrow message flips above and shrinks before covering source',()=>{
 const source={left:35,top:360,right:358,bottom:410},safe={left:8,top:62,right:382,bottom:450}
 const p=messageProcessPosition(source,safe,440)
 assert.equal(p.side,'top');assert.equal(p.maxHeight,288)
 assert.equal(overlapArea(box(p),source),0);assert.ok(p.top>=safe.top)
})
test('long source and very short visual viewport keep close control and edges reachable',()=>{
 const safe={left:8,top:62,right:312,bottom:220},source={left:10,top:62,right:310,bottom:220}
 const p=messageProcessPosition(source,safe,440)
 assert.ok(p.top>=safe.top&&p.top+p.maxHeight<=safe.bottom)
 assert.ok(p.left>=safe.left&&p.left+p.width<=safe.right)
})
