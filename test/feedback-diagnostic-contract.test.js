import test from 'node:test'
import assert from 'node:assert/strict'
import {diagnosticPrompt,diagnosticSections,diagnosticToolParameters} from '../src/feedback/diagnostic-contract.js'
test('diagnostic capability allows iterative correlation without arbitrary paths or commands',()=>{
 assert.deepEqual(diagnosticSections,['runtime','channels','errors','discover','message','trace','task','journal'])
 const p=diagnosticToolParameters();assert.equal(p.additionalProperties,false)
 assert.deepEqual(Object.keys(p.properties),['section','alias','query','offset'])
 assert.match(diagnosticPrompt,/先调查，再分析/);assert.match(diagnosticPrompt,/反证/)
 assert.match(diagnosticPrompt,/不能编造 TTFT/);assert.match(diagnosticPrompt,/不可直接累加/)
 assert.match(diagnosticPrompt,/另行确认提交/)
})
