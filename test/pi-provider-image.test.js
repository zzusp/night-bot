import test from 'node:test'
import assert from 'node:assert/strict'
import {piRequestImageDimensions} from '../src/pi-provider-image.js'
import {requestImageDimensions as original} from '@deepseek-ai/dsh-attachment'
test('native image request geometry matches existing landscape/portrait/rounding budgets without an attachment runtime import',()=>{
 for(const [width,height]of [[1,1],[1,4096],[4096,1],[3840,2160],[2160,3840],[123,456],[456,123],[2048,2048]])for(const budget of [1,2,7,100,999,1048576,4194304]){const actual=piRequestImageDimensions(width,height,budget);assert.deepEqual(actual,original(width,height,budget));assert.ok(actual.width*actual.height<=budget||width*height<=budget);assert.ok(actual.width<=width&&actual.height<=height)}
 for(const invalid of [[0,1,1],[1,-1,100],[1,1,0],[NaN,1,1]])assert.throws(()=>piRequestImageDimensions(...invalid),e=>e.code==='INVALID_REQUEST')
})
