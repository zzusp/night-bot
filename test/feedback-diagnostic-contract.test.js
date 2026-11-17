import test from 'node:test'
import assert from 'node:assert/strict'
import {diagnosticPrompt,diagnosticToolDescription,diagnosticSections,diagnosticToolParameters} from '../src/feedback/diagnostic-contract.js'
test('diagnostic capability allows iterative correlation without arbitrary paths or commands',()=>{
 assert.deepEqual(diagnosticSections,['runtime','channels','errors','discover','message','trace','task','schedule','journal','code_search','code_read','logs','evidence'])
 const p=diagnosticToolParameters();assert.equal(p.additionalProperties,false)
 assert.deepEqual(Object.keys(p.properties),['section','alias','query','target','offset','characterOffset','cursor'])
 assert.ok(diagnosticPrompt.length<500,'system prompt remains concise');assert.match(diagnosticPrompt,/反证/)
 assert.match(diagnosticPrompt,/确认提交/);assert.match(diagnosticPrompt,/不授予权限/)
 assert.doesNotMatch(diagnosticPrompt,/discover|continuations|Router|TTFT|逐段核对/,'no fixed investigation route or tool manual in system prompt')
 assert.match(diagnosticToolDescription,/E 编号重读/);assert.match(diagnosticToolDescription,/limitations/);assert.match(diagnosticToolDescription,/query-failed/)
 assert.match(p.properties.query.description,/原文片段/);assert.match(p.properties.offset.description,/保持原 query/)
})
