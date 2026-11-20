import test from 'node:test'
import assert from 'node:assert/strict'
import {SettingsManager,shouldCompact} from '@earendil-works/pi-coding-agent'
import {officialRouterCompactionSettings,officialTriageCompactionSettings,officialConversationContextBudget,ROUTER_CONTEXT_TOKENS,TRIAGE_CONTEXT_TOKENS} from '../src/runtime/pi-official-settings.js'

test('Router uses a 472K target with native 80% waterline and output headroom',()=>{
 assert.equal(ROUTER_CONTEXT_TOKENS,472000)
 assert.equal(TRIAGE_CONTEXT_TOKENS,500000)
 for(const window of [32768,128000,262144,400000,1000000]){
  const model=Object.freeze({provider:'fixture',id:'model',contextWindow:window})
  const manager=SettingsManager.inMemory({compaction:officialRouterCompactionSettings(model)})
  const settings=manager.getCompactionSettings(model)
  assert.equal(settings.enabled,true)
  const budget=Math.min(window,472000),threshold=Math.min(Math.floor(budget*0.8),budget-16384)
  assert.equal(SettingsManager.inMemory({compaction:officialTriageCompactionSettings(model)}).getCompactionSettings(model).reserveTokens,window-Math.min(Math.floor(Math.min(window,500000)*0.8),Math.min(window,500000)-16384))
  assert.equal(shouldCompact(threshold,window,settings),false)
  assert.equal(shouldCompact(threshold+1,window,settings),true)
  assert.equal(window-settings.reserveTokens,threshold)
  assert.ok(settings.keepRecentTokens>0&&settings.keepRecentTokens<window-settings.reserveTokens)
  assert.equal(model.contextWindow,window)
  assert.equal(manager.getCompactionSettings({provider:'other',id:'model',contextWindow:128000}).reserveTokens,16384)
 }
})

test('invalid model windows fail explicitly rather than inventing a window or negative threshold',()=>{
 for(const contextWindow of [undefined,0,16384,NaN,Infinity,256000.5])assert.throws(()=>officialRouterCompactionSettings({provider:'p',id:'m',contextWindow}),{code:'PI_ROUTER_CONTEXT_WINDOW_INVALID'})
})


test('background waterline precedes hard fallback with native or actual output headroom',()=>{
 for(const window of [16385,32768,65536,128000,500000,1000000]){
  const policy=officialConversationContextBudget({provider:'p',id:'m',contextWindow:window})
  assert.equal(policy.budgetTokens,Math.min(window,472000))
  assert.ok(policy.backgroundTokens<policy.foregroundTokens)
  assert.ok(policy.foregroundTokens<=policy.budgetTokens-policy.outputHeadroomTokens)
  assert.ok(policy.keepRecentTokens<policy.foregroundTokens)
 }
 const model={provider:'p',id:'m',contextWindow:1000000},policy=officialConversationContextBudget(model)
 assert.equal(policy.backgroundTokens,283200);assert.equal(policy.foregroundTokens,377600);assert.equal(policy.reserveTokens,622400)
 assert.equal(officialConversationContextBudget(model,'ROUTER',{outputReserveTokens:150000}).foregroundTokens,322000)
 for(const outputReserveTokens of [-1,NaN,Infinity,2.5,500000])assert.throws(()=>officialConversationContextBudget(model,'ROUTER',{outputReserveTokens}),{code:'PI_ROUTER_OUTPUT_RESERVE_INVALID'})
})
