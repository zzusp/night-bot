import test from 'node:test'
import assert from 'node:assert/strict'
import {boundText,textWindow,itemWindow} from '../src/runtime/output-window.js'
const bytes=text=>Buffer.byteLength(text)
function reference(chunks,headBytes,tailBytes) {
 const text=chunks.map(value=>value.toWellFormed()).join(''),total=bytes(text)
 if(total<=headBytes+tailBytes)return{text,truncated:false,omittedBytes:0}
 const scalars=Array.from(text);let head='',tail=''
 for(const scalar of scalars){if(bytes(head+scalar)>headBytes)break;head+=scalar}
 for(const scalar of scalars.reverse()){if(bytes(scalar+tail)>tailBytes)break;tail=scalar+tail}
 return{text:head+tail,truncated:true,omittedBytes:total-bytes(head+tail)}
}
test('output windows retain contiguous whole-scalar edges and exact omitted UTF-8 counts',()=>{
 const input='ab汉😀z'
 assert.deepEqual(boundText(input,{headBytes:4}),{text:'ab',truncated:true,omittedBytes:8})
 assert.deepEqual(boundText(input,{tailBytes:4}),{text:'z',truncated:true,omittedBytes:9})
 assert.deepEqual(boundText(input,{headBytes:3,tailBytes:5}),{text:'ab😀z',truncated:true,omittedBytes:3})
 assert.deepEqual(boundText('😀',{headBytes:1,tailBytes:3}),{text:'😀',truncated:false,omittedBytes:0})
 assert.deepEqual(boundText('',{}),{text:'',truncated:false,omittedBytes:0})
})
test('every stream prefix agrees with independent whole-text edge selection across small budgets',()=>{
 const inputs=[['abc','汉字','😀','\ud800','end'],['a','','😀😀','b'],['\ud83d','\ude00','x'],['汉字😀ab']]
 for(const chunks of inputs)for(let head=0;head<14;head++)for(let tail=0;tail<14;tail++){
  const window=textWindow({headBytes:head,tailBytes:tail}),seen=[]
  for(const chunk of chunks){seen.push(chunk);window.append(chunk);assert.deepEqual(window.snapshot(),reference(seen,head,tail))}
 }
})
test('large discarded middles and subsequent appends keep bounded edges without mutating prior snapshots',()=>{
 const window=textWindow({headBytes:5,tailBytes:8}),chunk='汉'.repeat(1000000)+'😀end';window.append(chunk)
 const first=window.snapshot();assert.equal(first.text,'汉😀end');assert.equal(first.omittedBytes,bytes(chunk)-bytes(first.text))
 window.append('!');assert.equal(window.snapshot().text,'汉😀end!');assert.equal(first.text,'汉😀end');assert.equal(first.omittedBytes,bytes(chunk)-bytes(first.text))
})
test('output admission rejects binary data and invalid limits before changing state',()=>{
 for(const value of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){assert.throws(()=>textWindow({headBytes:value}),TypeError);assert.throws(()=>itemWindow(value),TypeError)}
 assert.throws(()=>textWindow({headBytes:Number.MAX_SAFE_INTEGER,tailBytes:1}),TypeError)
 const window=textWindow({headBytes:3});window.append('abc');assert.throws(()=>window.append(Buffer.from('x')),/text only/);assert.deepEqual(window.snapshot(),{text:'abc',truncated:false,omittedBytes:0})
})
test('item windows keep the first admitted values with exact counts and detached result arrays',()=>{
 const window=itemWindow(2);assert.equal(window.append('one'),true);assert.equal(window.append('two'),true);assert.equal(window.append('three'),false)
 const first=window.snapshot();assert.deepEqual(first,{values:['one','two'],seen:3,dropped:1});first.values.pop();assert.deepEqual(window.snapshot().values,['one','two'])
 const zero=itemWindow(0);assert.equal(zero.append('x'),false);assert.deepEqual(zero.snapshot(),{values:[],seen:1,dropped:1})
})
