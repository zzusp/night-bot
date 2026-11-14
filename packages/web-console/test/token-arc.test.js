import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/token-arc.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {tokenArc,TOKEN_RING_RADIUS:r}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('rounded caps remain in their actual allocation, with no invented minimum share',()=>{
 for(const [share,offset] of [[25,0],[35,25],[15,60],[25,75],[0.0000001,25],[0.5,40],[99.9,0]]){
  const arc=tokenArc(share,offset),inset=Math.asin(arc.width/2/r);
  assert.ok(Math.abs(arc.startAngle-inset-offset/100*Math.PI*2)<1e-12);
  assert.ok(Math.abs(arc.endAngle+inset-(offset+share)/100*Math.PI*2)<1e-12);
  assert.ok(arc.endAngle>arc.startAngle);assert.ok(arc.width<=10);
  assert.equal(arc.share,share);assert.equal(arc.offset,offset);
 }
 const small=tokenArc(0.0000001,25);assert.equal(small.tiny,true);assert.ok(small.width<0.00001);assert.ok(small.marker);
});
test('single full allocation has no dashed seam or endpoint cap',()=>{
 const full=tokenArc(100,0);assert.equal(full.full,true);assert.equal(full.tiny,false);assert.equal(full.width,10);assert.equal(full.d,undefined);
});
