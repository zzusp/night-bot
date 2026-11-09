import test from 'node:test'
import assert from 'node:assert/strict'
import {piRequestImageDimensions} from '../src/pi-provider-image.js'
test('native image request geometry obeys landscape/portrait pixel budgets and transpose symmetry',()=>{
 for(const [width,height]of [[1,1],[1,4096],[4096,1],[3840,2160],[2160,3840],[123,456],[456,123],[2048,2048]])for(const budget of [1,2,7,100,999,1048576,4194304]){const actual=piRequestImageDimensions(width,height,budget);assert.deepEqual(actual,{width:piRequestImageDimensions(height,width,budget).height,height:piRequestImageDimensions(height,width,budget).width});assert.ok(Number.isSafeInteger(actual.width)&&actual.width>0&&Number.isSafeInteger(actual.height)&&actual.height>0);assert.ok(actual.width*actual.height<=budget||width*height<=budget);assert.ok(actual.width<=width&&actual.height<=height)}
 assert.deepEqual(piRequestImageDimensions(3840,2160,1048576),{width:1365,height:768})
 assert.deepEqual(piRequestImageDimensions(1,4096,7),{width:1,height:7})
 assert.deepEqual(piRequestImageDimensions(123,456,999),{width:16,height:60})
 for(const invalid of [[0,1,1],[1,-1,100],[1,1,0],[NaN,1,1]])assert.throws(()=>piRequestImageDimensions(...invalid),e=>e.code==='INVALID_REQUEST')
})
