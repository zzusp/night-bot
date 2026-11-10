import test from 'node:test'
import assert from 'node:assert/strict'
import {validDingtalkCreated,channelApplicationText} from '../src/channel-response.ts'
const saved='a'.repeat(64),running='b'.repeat(64)
const result=(restartRequired,liveApplied)=>({ok:true,changed:true,restartRequired,liveApplied,channel:{channelId:'new-channel',type:'dingtalk-dws',enabled:true,savedVersion:saved,runningVersion:restartRequired?running:saved,restartRequired,liveApplied}})
test('create accepts factual live, pending and inactive acknowledgments',()=>{
 for(const flags of [[false,true],[true,false],[false,false]])assert.equal(validDingtalkCreated(result(...flags),'new-channel'),true)
 assert.match(channelApplicationText(result(false,true)),/已应用到运行态/)
 assert.match(channelApplicationText(result(true,false)),/待重启/)
 assert.match(channelApplicationText(result(false,false)),/尚未激活/)
})
test('incomplete, contradictory and mismatched create acknowledgments stay unknown',()=>{
 const valid=result(false,true)
 for(const invalid of [{...valid,channel:null},{...valid,liveApplied:undefined},{...valid,restartRequired:true},{...valid,channel:{...valid.channel,runningVersion:running}},{...valid,channel:{...valid.channel,savedVersion:'bad'}},{...valid,channel:{...valid.channel,channelId:'other'}},{...valid,channel:{...valid.channel,enabled:false}}])assert.equal(validDingtalkCreated(invalid,'new-channel'),false)
 assert.equal(validDingtalkCreated(undefined,'new-channel'),false)
})

test('valid channel IDs retain identity in action URLs, including dot-only IDs',async()=>{
 const {channelPath}=await import('../src/channel-url.ts')
 for(const id of ['团队渠道','team.chat','team/chat','team chat','.','..'])for(const detail of [false,true]){
  const url=new URL(channelPath(id,detail),'http://fixture.test')
  assert.equal(url.searchParams.has('channelId')?url.searchParams.get('channelId'):decodeURIComponent(url.pathname.split('/').at(-1)),id)
 }
})
