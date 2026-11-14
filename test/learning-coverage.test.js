import test from 'node:test';
import assert from 'node:assert/strict';
import {learningCoverage} from '../src/memory/learning-coverage.js';
const lesson = {key:'skill',memoryKey:'memory',applied:true,memoryWrite:'committed',skill:{steps:['check']}};
const review = {taskId:'t',status:'done',lessons:[lesson]};
const changes = ['memory','skill'].map(kind=>({taskId:'t',reviewId:'r',kind,name:kind,status:'applied'}));
test('complete current task evidence and genuine empty are distinguishable from unavailable history',()=>{
 assert.deepEqual(learningCoverage('t',{r:review},{skill:{active:true,supports:[{taskId:'t',memoryKey:'memory'}]}},changes),{memory:true,skill:true});
 assert.deepEqual(learningCoverage('t',{}, {}, []),{memory:true,skill:true});
 assert.deepEqual(learningCoverage('t',{r:{taskId:'other',status:'failed'}},{},[]),{memory:true,skill:true});
 assert.deepEqual(learningCoverage('t',{r:{taskId:'t',status:'done'}},{},[]),{memory:false,skill:false});
});
test('overwritten receipts, forgotten history, failed effects and capped supports never yield false totals',()=>{
 assert.equal(learningCoverage('t',{r:review},{},[]).memory,false);
 assert.equal(learningCoverage('t',{r:review},{},changes.filter(x=>x.kind==='memory')).skill,false);
 for(const extra of [{forgotten:true},{status:'failed'},{lessons:[{...lesson,memoryWrite:'uncertain'}]}])assert.deepEqual(learningCoverage('t',{r:{...review,...extra}},{},changes),{memory:false,skill:false});
 assert.equal(learningCoverage('t',{}, {skill:{supports:Array.from({length:40},()=>({taskId:'other'}))}},[]).skill,false);
});
test('explicit inactive candidate with retained task support is excluded rather than guessed applied',()=>{
 assert.deepEqual(learningCoverage('t',{r:review},{skill:{active:false,supports:[{taskId:'t',memoryKey:'memory'}]}},changes.filter(x=>x.kind==='memory')),{memory:true,skill:true});
});

test('later updates by the same task retain one proven entry despite older review versions being replaced',()=>{
 const reviews={r:review,updated:{...review}};
 assert.deepEqual(learningCoverage('t',reviews,{skill:{active:true,supports:[{taskId:'t',memoryKey:'memory'}]}},changes.map(row=>({...row,reviewId:'updated'}))),{memory:true,skill:true});
});

test('legacy destination-only receipts that were replaced are unknown, never a fabricated empty total',()=>{
 assert.deepEqual(learningCoverage('t',{old:{taskId:'t',status:'done',lessons:[],destinations:[{memory:{topic:'experience',key:'old'},skill:{key:'old-skill'}}]}},{},[]),{memory:false,skill:false});
});
