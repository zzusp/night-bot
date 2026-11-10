import test from 'node:test'
import assert from 'node:assert/strict'
import {startPreview,FIXTURE_TOKEN} from './preview.mjs'
import {healthScenarios} from './channel-health-scenarios.mjs'
import {channelHealthPresentation} from '../src/channel-health.ts'

for(const scenario of healthScenarios)test(`actual fixture HTTP projects ${scenario.id} health`,async()=>{
  const fixture=await startPreview({port:0,replyDelayMs:0,dingtalkHealth:scenario.health,dingtalkBindingActive:scenario.bindingActive})
  try{
    const login=await fetch(fixture.origin+'/api/login',{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify({token:FIXTURE_TOKEN})})
    assert.equal(login.status,200)
    const cookie=login.headers.get('set-cookie').split(';')[0]
    const response=await fetch(fixture.origin+'/api/channels',{headers:{cookie}})
    assert.equal(response.status,200)
    const item=(await response.json()).items.find(item=>item.channelId==='dingtalk-work')
    assert.equal(channelHealthPresentation(item).kind,scenario.kind)
    assert.equal(channelHealthPresentation(item).label,scenario.label)
    if(scenario.id==='blocked')assert.equal(item.runningErrorCode,'DINGTALK_CHANNEL_SWITCH_BLOCKED')
    if(scenario.id==='missing')assert.equal(Object.hasOwn(item,'runningConnected'),false)
  }finally{await fixture.close()}
})
