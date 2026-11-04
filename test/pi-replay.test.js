import test from 'node:test'
import assert from 'node:assert/strict'
import { restorePiReplay } from '../src/pi-replay.js'
const message={role:'assistant',provider:'route',model:'model',api:'host',content:[{type:'thinking',thinking:'reason'},{type:'toolCall',id:'call',name:'read',arguments:{path:'a'}}],stopReason:'toolUse'}
const source={provider:'route',model:'model',replayState:{response:{kind:'pi-ai',version:2,provider:'route',model:'model',api:'anthropic-messages',stopReason:'toolUse',responseId:'resp'},blocks:[{type:'reasoning',thinkingSignature:'signed'},{type:'tool-call',thoughtSignature:'tool-signature',namespace:'ns'}]}}
test('native Pi history retains provider signatures and response identity without mutating source',()=>{
 const result=restorePiReplay(message,source)
 assert.equal(result.api,'anthropic-messages');assert.equal(result.responseId,'resp');assert.equal(result.content[0].thinkingSignature,'signed');assert.equal(result.content[1].thoughtSignature,'tool-signature');assert.equal(result.content[1].namespace,'ns');assert.equal(message.api,'host');assert.equal(message.content[0].thinkingSignature,undefined)
})
for(const change of [s=>s.replayState.response.provider='other',s=>s.replayState.response.version=99,s=>s.replayState.blocks.pop(),s=>s.replayState.blocks[0].thinkingSignature=1,s=>s.replayState.response.responseId={}])test('foreign or malformed replay stays provider-neutral: '+change.toString(),()=>{const altered=structuredClone(source);change(altered);assert.equal(restorePiReplay(message,altered),message)})
