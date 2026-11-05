import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {apply} from '../src/native-llm-retry.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
const gate=()=>Promise.withResolvers(),sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function fixture(t,{flush}={}){const ctx=new Context();ctx.logger={warn(){}};new NativeSessions(ctx);new NativeProjections(ctx);ctx.provide('agents',{});let committed=0;ctx.provide('piAuthority',{describe:()=>({engine:'pi-session-manager',events:committed})});ctx.on('session/flush',async session=>{await flush?.(session);committed=session.seq});await ctx.plugin({apply:child=>apply(child,{}, {random:()=>.5})});t.after(()=>ctx.fiber.dispose());const agent={id:'retry-fixture',session:ctx.sessions.create('retry-fixture')};return{ctx,agent,recover:(policy,options={})=>ctx.waterfall('agent/request-error',{agent,turn:1,step:1,provider:options.provider??'fixture',failure:{code:'SERVER',message:'fixture failure',...options.failure},retryPolicy:policy,signal:options.signal??new AbortController().signal},options.next??(()=>Promise.resolve()))}}
const normal={mode:'normal',maxRetries:2,retryableCodes:['SERVER'],initialDelayMs:1,maxDelayMs:5,jitterRatio:0}
test('retry budgets admit exactly two attempts with a stable chain and capped exponential delays',async t=>{
  const h=await fixture(t)
  assert.deepEqual(await h.recover(normal),{kind:'retry'})
  assert.deepEqual(await h.recover(normal),{kind:'retry'})
  assert.equal(await h.recover(normal),undefined)
  const events=h.agent.session.snapshotEvents()
  assert.deepEqual(events.map(event=>event.type),['llm/retry','llm/retry-started','llm/retry','llm/retry-started'])
  const first=events[0].data,second=events[2].data
  assert.match(first.retryId,/^[0-9a-f-]{36}$/)
  assert.equal(second.retryId,first.retryId)
  assert.equal(second.policyKey,first.policyKey)
  assert.deepEqual([first.retry,second.retry],[1,2])
  assert.deepEqual([first.delayMs,second.delayMs],[1,2])
  for(const index of [0,2]){
    const scheduled=events[index].data,started=events[index+1].data
    assert.equal(scheduled.maxRetries,2)
    assert.equal(scheduled.provider,'fixture')
    assert.deepEqual(scheduled.failure,{code:'SERVER',message:'fixture failure'})
    assert.deepEqual(started,{retryId:scheduled.retryId,turn:1,step:1,retry:scheduled.retry})
  }
  h.agent.session.append('step/start',{turn:1,step:2})
  assert.deepEqual(await h.recover(normal),{kind:'retry'})
  const reset=h.agent.session.snapshotEvents().at(-2).data
  assert.equal(reset.retry,1)
  assert.notEqual(reset.retryId,first.retryId)
})
test('retry schedule and started records must both flush before the retry decision',async t=>{const first=gate(),firstRelease=gate(),second=gate(),secondRelease=gate();let count=0;const h=await fixture(t,{flush:async()=>{if(++count===1){first.resolve();await firstRelease.promise}else{second.resolve();await secondRelease.promise}}}),pending=h.recover(normal);await first.promise;await sleep(15);assert.deepEqual(h.agent.session.snapshotEvents().map(e=>e.type),['llm/retry']);firstRelease.resolve();await second.promise;let decided=false;void pending.then(()=>decided=true);await sleep(5);assert.equal(decided,false);secondRelease.resolve();assert.deepEqual(await pending,{kind:'retry'})})
test('failed or non-Pi journal admission cannot schedule another model attempt',async t=>{const h=await fixture(t,{flush:async()=>{throw new Error('fixture durable failure')}});await assert.rejects(h.recover(normal),/durable failure/);assert.equal(h.agent.session.snapshotEvents().filter(e=>e.type==='llm/retry-started').length,0);const other=await fixture(t);other.ctx.piAuthority.describe=()=>undefined;await assert.rejects(other.recover(normal),/JOURNAL_UNAVAILABLE/);assert.equal(other.agent.session.snapshotEvents().filter(e=>e.type==='llm/retry-started').length,0)})
test('cancelled backoff and owner close drain scheduled writes without a started retry',async t=>{const entered=gate(),release=gate(),h=await fixture(t,{flush:async()=>{entered.resolve();await release.promise}}),controller=new AbortController(),pending=h.recover(normal,{signal:controller.signal});await entered.promise;h.ctx.piAuthority.describe=()=>undefined;controller.abort();const closing=h.ctx.fiber.dispose();release.resolve();assert.equal(await pending,undefined);await closing;assert.equal(h.agent.session.snapshotEvents().length,1)})
test('always policy honors downstream retry, contains failures and uses bounded local delay for oversized Retry-After',async t=>{const h=await fixture(t),policy={...normal,mode:'always'};assert.deepEqual(await h.recover(policy,{next:async()=>({kind:'retry'})}),{kind:'retry'});assert.equal(h.agent.session.seq,0);assert.deepEqual(await h.recover(policy,{next:async()=>{throw new Error('fixture downstream')},failure:{providerRetryAfterMs:100}}),{kind:'retry'});assert.equal(h.agent.session.snapshotEvents()[0].data.delayMs,1);assert.equal(await h.recover(normal,{failure:{providerRetryAfterMs:100}}),undefined);assert.equal(h.agent.session.seq,2)})
test('unrelated policies/providers have separate budgets and permanent errors defer downstream',async t=>{const h=await fixture(t),single={...normal,maxRetries:1};await h.recover(single);assert.equal(await h.recover(single),undefined);assert.deepEqual(await h.recover(single,{provider:'other'}),{kind:'retry'});assert.deepEqual(await h.recover({...single,maxDelayMs:4}),{kind:'retry'});assert.equal(await h.recover(single,{failure:{code:'PERMANENT'},next:async()=>({kind:'stop'})}).then(d=>d.kind),'stop')})
test('a downstream recovery handler may close its owner without awaiting its own request',async t=>{const h=await fixture(t);assert.equal(await h.recover({...normal,mode:'always'},{next:async()=>{await h.ctx.fiber.dispose()}}),undefined);assert.equal(h.agent.session.seq,0)})
