import test from 'node:test'
import assert from 'node:assert/strict'
import {SettingsManager,shouldCompact} from '@earendil-works/pi-coding-agent'
import {officialRouterCompactionSettings,ROUTER_CONTEXT_TOKENS} from '../src/runtime/pi-official-settings.js'

test('Router uses Pi model overrides for a 256K effective budget with native recent-tail defaults',()=>{
 assert.equal(ROUTER_CONTEXT_TOKENS,262144)
 for(const window of [32768,128000,262144,400000,1000000]){
  const model=Object.freeze({provider:'fixture',id:'model',contextWindow:window})
  const manager=SettingsManager.inMemory({compaction:officialRouterCompactionSettings(model)})
  const settings=manager.getCompactionSettings(model)
  assert.equal(settings.enabled,true)
  const threshold=Math.min(window,262144)-16384
  assert.equal(shouldCompact(threshold,window,settings),false)
  assert.equal(shouldCompact(threshold+1,window,settings),true)
  assert.equal(window-settings.reserveTokens,Math.min(window,262144)-16384)
  assert.ok(settings.keepRecentTokens>0&&settings.keepRecentTokens<window-settings.reserveTokens)
  assert.equal(model.contextWindow,window)
  assert.equal(manager.getCompactionSettings({provider:'other',id:'model',contextWindow:128000}).reserveTokens,16384)
 }
})

test('invalid model windows fail explicitly rather than inventing a window or negative threshold',()=>{
 for(const contextWindow of [undefined,0,16384,NaN,Infinity,256000.5])assert.throws(()=>officialRouterCompactionSettings({provider:'p',id:'m',contextWindow}),{code:'PI_ROUTER_CONTEXT_WINDOW_INVALID'})
})
