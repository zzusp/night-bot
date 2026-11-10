import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {hash} from '../src/memory/format.js'
import {updateConfig} from '../src/config.js'
import {channelIngressView,declareChannelIngress,applyChannelIngress,createChannelIngressConfiguration} from '../src/channels/ingress-control.js'

async function fixture(t,{backfill='history'}={}){
 const root=await mkdtemp(join(tmpdir(),'night-ingress-control-')),file=join(root,'data/config/config.json')
 const row={type:'fixture',channelId:'room',enabled:true,config:{private:'never expose'}}
 await mkdir(join(root,'data/config'),{recursive:true});await writeFile(file,JSON.stringify({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'FIXTURE_KEY',models:[{id:'m'}]}},channelPlugins:[row]}))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const state={value:'receiving',fail:false,calls:0},control={version:1,backfill,available:true,getStatus:()=>({state:state.value,errorCode:null}),async setPaused(paused){
  state.calls++;assert.equal(JSON.parse(await readFile(file,'utf8')).channelPlugins[0].receivePaused,paused,'intent is durable before runtime change')
  if(state.fail)throw Error('private adapter failure');state.value=paused?'paused':'recovering'
 }}
 const plugin={ingressControl:control},channels={plugins:new Map([['room',plugin]])},instances=new Map([['room',{row:structuredClone(row),module:{channelIngressControl:1}}]])
 declareChannelIngress(plugin,{channelIngressControl:1})
 const lifecycle={applyIngress:(transaction,id)=>applyChannelIngress(transaction,id,{ctx:{channels},instances,publish:()=>{}})}
 const port=createChannelIngressConfiguration({file,run:fn=>fn(),getChannels:()=>channels,getLifecycle:()=>lifecycle})
 return {file,row,state,control,channels,instances,port,input:(paused,version=hash(JSON.stringify(row)))=>({paused,confirm:true,expectedVersion:version})}
}

test('generic ingress persists only receiving intent, serializes CAS, and resumes without claiming completion',async t=>{
 const f=await fixture(t),results=await Promise.allSettled([f.port.setIngressPaused('room',f.input(true)),f.port.setIngressPaused('room',f.input(true))])
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'DINGTALK_CHANNEL_VERSION_CONFLICT')
 const paused=results.find(result=>result.status==='fulfilled').value
 assert.equal(paused.liveApplied,true);assert.equal(paused.ingress.state,'paused');assert.equal(paused.channel.enabled,true);assert.deepEqual(paused.channel.config,f.row.config)
 const resumed=await f.port.setIngressPaused('room',f.input(false,paused.version))
 assert.equal(resumed.ingress.state,'recovering');assert.equal(resumed.liveApplied,true);assert.equal(resumed.restartRequired,false)
})

test('apply failure keeps durable intent visible and exact version allows explicit unchanged retry',async t=>{
 const f=await fixture(t);f.state.fail=true
 const failed=await f.port.setIngressPaused('room',f.input(true))
 assert.equal(failed.liveApplied,false);assert.equal(failed.ingress.requestedPaused,true);assert.equal(failed.ingress.state,'error');assert.equal(failed.ingress.errorCode,'CHANNEL_INGRESS_APPLY_FAILED')
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).channelPlugins[0].receivePaused,true)
 f.state.fail=false
 const retry=await f.port.setIngressPaused('room',f.input(true,failed.version))
 assert.equal(retry.changed,false);assert.equal(retry.liveApplied,true);assert.equal(retry.ingress.state,'paused');assert.equal(f.state.calls,2)
})

test('unsupported, unavailable, confirmation and runtime conflicts never persist the requested change',async t=>{
 const f=await fixture(t),before=await readFile(f.file,'utf8')
 await assert.rejects(f.port.setIngressPaused('room',{...f.input(true),confirm:false}),{code:'CHANNEL_INGRESS_CONFIRMATION_REQUIRED'})
 await assert.rejects(f.port.setIngressPaused('room',{...f.input(true),unknown:true}),{code:'CHANNEL_INGRESS_REQUEST_INVALID'})
 f.control.available=false;await assert.rejects(f.port.setIngressPaused('room',f.input(true)),{code:'CHANNEL_INGRESS_UNAVAILABLE'})
 f.control.available=true;f.instances.get('room').module.channelIngressControl=0
 await assert.rejects(f.port.setIngressPaused('room',f.input(true)),{code:'CHANNEL_INGRESS_CONTROL_UNSUPPORTED'})
 f.instances.get('room').module.channelIngressControl=1;f.instances.get('room').row.config.private='changed'
 await assert.rejects(f.port.setIngressPaused('room',f.input(true)),{code:'CHANNEL_RUNTIME_VERSION_CONFLICT'})
 assert.equal(await readFile(f.file,'utf8'),before);assert.equal(f.state.calls,0)
})

test('capabilities and failures have a bounded projection, including honest no-backfill support',async t=>{
 const f=await fixture(t,{backfill:'none'})
 assert.equal((await f.port.getIngress('room')).backfill,'none')
 assert.equal(channelIngressView(f.row,{readMessage(){}}).supported,false)
 f.control.getStatus=()=>({state:'error',errorCode:'private-secret-value'})
 assert.equal((await f.port.getIngress('room')).errorCode,'CHANNEL_INGRESS_APPLY_FAILED')
 assert.equal(JSON.stringify(await f.port.getIngress('room')).includes('private'),false)
 f.control.getStatus=()=>({state:'receiving',errorCode:null})
 assert.equal(channelIngressView(f.row,{ingressControl:f.control}).supported,false,'a lookalike object without an explicit module declaration is unsupported')
 assert.equal(channelIngressView({...f.row,receivePaused:true},f.channels.plugins.get('room')).state,'pausing')
 f.control.getStatus=()=>({state:'unavailable',errorCode:'DINGTALK_AUTH_REQUIRED'})
 assert.equal((await f.port.getIngress('room')).state,'unavailable');assert.equal((await f.port.getIngress('room')).errorCode,'DINGTALK_AUTH_REQUIRED')
 Object.defineProperty(f.control,'available',{get(){throw Error('private failure')}})
 assert.equal((await f.port.getIngress('room')).state,'unavailable');assert.equal((await f.port.getIngress('room')).available,false)
 const bad={get ingressControl(){throw Error('private')}};declareChannelIngress(bad,{channelIngressControl:1})
 assert.equal(channelIngressView(f.row,bad).supported,false)
})

test('check-only never invokes unchanged application; explicit retry does not rewrite config bytes',async t=>{
 const f=await fixture(t),before=await readFile(f.file,'utf8');let calls=0
 const apply=async({commit})=>{calls++;await commit();return {liveApplied:true}}
 await updateConfig(f.file,x=>x,{checkOnly:true,applyUnchanged:true,apply});assert.equal(calls,0)
 const result=await updateConfig(f.file,x=>x,{applyUnchanged:true,apply})
 assert.equal(result.changed,false);assert.equal(result.liveApplied,true);assert.equal(calls,1);assert.equal(await readFile(f.file,'utf8'),before)
})
