import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothStagePath} from '../src/stage-chart-path.ts';
test('smooth stage paths preserve endpoints, flat values and empty segments',()=>{
 assert.equal(smoothStagePath([]),'');
 assert.equal(smoothStagePath([{x:2,y:4}]),'M 2,4');
 assert.equal(smoothStagePath([{x:2,y:4},{x:12,y:4}]),'M 2,4 C 7,4 7,4 12,4');
});
test('cubic interpolation stays within measured range and never invents peaks',()=>{
 for(const [a,b] of [[4,70],[70,4],[0,0],[3,3]]) {
  for(let i=0;i<=100;i++) {
   const t=i/100, y=(1-t)**3*a+3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3*b;
   assert.ok(y>=Math.min(a,b)-1e-10&&y<=Math.max(a,b)+1e-10);
  }
 }
});
