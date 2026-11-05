import test from 'node:test'
import assert from 'node:assert/strict'
import {resolvePiRetryPolicy} from '../src/pi-provider-retry.js'
import {resolveRetryPolicy} from '../packages/capability-compat/llm/index.js'
for(const config of [undefined,{mode:'normal'},{mode:'normal',maxRetries:0,retryableCodes:['CUSTOM'],backoff:{initialDelayMs:10,maxDelayMs:40,jitterRatio:0}},{mode:'always',backoff:{maxDelayMs:50000}}])test('native retry policy preserves existing bounded/unbounded policy: '+JSON.stringify(config),()=>{assert.deepEqual(resolvePiRetryPolicy(config),resolveRetryPolicy(config,'fixture'));assert.ok(Object.isFrozen(resolvePiRetryPolicy(config)))})
for(const config of [{mode:'x'},{mode:'normal',maxRetries:-1},{mode:'normal',retryableCodes:[]},{mode:'normal',retryableCodes:['A','A']},{mode:'normal',backoff:{initialDelayMs:100,maxDelayMs:1}},{mode:'always',backoff:{jitterRatio:2}},{mode:'normal',unknown:1}])test('native retry policy refuses invalid configuration '+JSON.stringify(config),()=>assert.throws(()=>resolvePiRetryPolicy(config),e=>e.code==='INVALID_CONFIG'))
