import test from 'node:test'
import assert from 'node:assert/strict'
import Channels from '../src/channels/service.js'
const fixture=()=>Object.assign(Object.create(Channels.prototype),{observers:new Map(),transports:new Map(),contexts:new Map(),targetHolds:new Map(),activeTargets:new Map(),plugins:new Map()})
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('late observer registration recovers before ingress and unknown remains unchanged',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({}),gate=Promise.withResolvers(),events=[]
 await hub.recover()
 const remove=channels.registerOperationObserver('a',{createObserver:()=>({recover:()=>gate.promise,beforeIngress:()=>events.push('ingress'),notificationChanged:n=>events.push(n.state),close:()=>events.push('close')})})
 const ingress=hub.beforeIngress('room');await tick();assert.deepEqual(events,[])
 gate.resolve();await ingress
 const notification={state:'unknown',sendAttempt:1};await hub.notificationChanged(notification)
 assert.deepEqual(notification,{state:'unknown',sendAttempt:1});assert.deepEqual(events,['ingress','unknown'])
 await remove();await hub.close();assert.deepEqual(events,['ingress','unknown','close'])
})

test('retired generation owns its started operations until finish and cannot be replaced for late observation',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({}),events=[]
 const factory=tag=>({createObserver:()=>({start:id=>events.push(tag+':start:'+id),observe:op=>events.push(tag+':observe:'+op.id),finish:id=>events.push(tag+':finish:'+id),close:()=>events.push(tag+':close')})})
 const remove=channels.registerOperationObserver('a',factory('old'));await hub.start('op')
 let removed=false;const drain=remove().then(()=>{removed=true});await tick();assert.equal(removed,false)
 channels.registerOperationObserver('a',factory('new'));await hub.recover()
 await hub.observe({id:'op'});await hub.finish('op');await drain
 await hub.observe({id:'op'});await hub.start('next');await hub.finish('next');await hub.close()
 assert.deepEqual(events,['old:start:op','old:observe:op','old:finish:op','old:close','new:start:next','new:finish:next','new:close'])
})

test('observer removal waits in-flight calls and asynchronous close; failures propagate',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({}),work=Promise.withResolvers(),stop=Promise.withResolvers()
 const remove=channels.registerOperationObserver('a',{createObserver:()=>({beforeIngress:()=>work.promise,close:()=>stop.promise})})
 const call=hub.beforeIngress('room');await tick()
 let done=false;const drain=remove().then(()=>{done=true});work.resolve();await call;await tick();assert.equal(done,false)
 stop.resolve();await drain;await hub.close()
 const other=fixture(),otherHub=other.createOperationObserver({}),error=new Error('recover failed')
 const removeFailed=other.registerOperationObserver('bad',{createObserver:()=>({recover:()=>Promise.reject(error),close:()=>{}})})
 await assert.rejects(otherHub.recover(),error);await assert.rejects(removeFailed(),/observer drain failed/);await assert.rejects(otherHub.close(),/observers close failed/)
})

test('lifecycle hold blocks new ingress and sends, tracks readback, and leaves unknown unchanged',async()=>{
 const channels=fixture(),read=Promise.withResolvers();let sent=0
 channels.contexts.set('room',{type:'chat-room',channelId:'a',conversationId:'remote',participants:{}})
 channels.transports.set('a',{send:()=>{sent++},readback:()=>read.promise})
 const notification={id:'n',state:'unknown',payload:{conversationId:'room',text:'hello'}}
 const hold=channels.holdLifecycle('a')
 assert.equal(channels.canDeliver(notification),false)
 assert.throws(()=>channels.assertInputTarget({channelId:'a'}),{code:'CHANNEL_RECONFIGURING'})
 await assert.rejects(channels.transportCall('send',notification),{code:'CHANNEL_RECONFIGURING',knownNotSent:true})
 const call=channels.transportCall('readback',notification);let done=false;const drain=hold.drain().then(()=>{done=true})
 await tick();assert.equal(done,false);read.resolve({messageId:'m'});await call;await drain
 assert.equal(sent,0);assert.equal(notification.state,'unknown');hold.release();assert.equal(channels.canDeliver(notification),true)
})

test('transport drain preserves rejection instead of claiming successful disposal',async()=>{
 const channels=fixture(),work=Promise.withResolvers(),call=channels.trackChannelCall('a',()=>work.promise)
 const hold=channels.holdLifecycle('a'),drain=hold.drain();work.reject(new Error('real drain failure'))
 await assert.rejects(call,/real drain failure/);await assert.rejects(drain,/transport drain failed/);hold.release()
})

test('asynchronous observer close rejection is retained by remove and aggregate close',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({}),error=new Error('close failed');let closes=0
 const remove=channels.registerOperationObserver('a',{createObserver:()=>({async close(){closes++;throw error}})})
 await hub.recover();const removal=remove();assert.equal(remove(),removal)
 await assert.rejects(removal,e=>e.errors.includes(error))
 const closing=hub.close();assert.equal(hub.close(),closing)
 await assert.rejects(closing,/observers close failed/);assert.equal(closes,1)
})

test('sealReads blocks new readback and resources while draining the original query',async()=>{
 const channels=fixture(),response=Promise.withResolvers();let calls=0
 channels.contexts.set('room',{type:'chat-room',channelId:'a',conversationId:'remote',participants:{}})
 channels.transports.set('a',{readback:()=>{calls++;return response.promise},readResource:()=>{calls++;return response.promise}})
 const notification={id:'n',state:'unknown',payload:{conversationId:'room',text:'hello'}},hold=channels.holdLifecycle('a')
 const original=channels.transportCall('readback',notification);await tick();assert.equal(calls,1)
 hold.sealReads()
 await assert.rejects(channels.transportCall('readback',notification),{code:'CHANNEL_RECONFIGURING',knownNotSent:true})
 await assert.rejects(channels.readResource('readResource','room','message',{}),{code:'CHANNEL_RECONFIGURING',knownNotSent:true})
 let drained=false;const draining=hold.drain().then(()=>{drained=true});await tick();assert.equal(drained,false)
 response.resolve({messageId:'original'});await original;await draining
 assert.equal(calls,1);hold.release()
 await channels.readResource('readResource','room','message',{});assert.equal(calls,2)
})

test('unawaited start synchronously pins operation generation before replacement',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({}),ready=Promise.withResolvers(),events=[]
 const remove=channels.registerOperationObserver('a',{createObserver:()=>({recover:()=>ready.promise,start:()=>events.push('old:start'),observe:()=>events.push('old:observe'),finish:()=>events.push('old:finish')})})
 const starting=hub.start('op'),removing=remove()
 channels.registerOperationObserver('a',{createObserver:()=>({observe:()=>events.push('new:observe')})})
 const observing=hub.observe({id:'op'});ready.resolve();await starting;await observing;await hub.finish('op');await removing;await hub.close()
 assert.deepEqual(events,['old:start','old:observe','old:finish'])
})

test('completed and unowned operation observations never fall back to a replacement generation',async()=>{
 const channels=fixture(),hub=channels.createOperationObserver({});let observed=0,closed=0
 for(let generation=0;generation<100;generation++){
  const remove=channels.registerOperationObserver('a',{createObserver:()=>({observe:()=>{observed++},close:()=>{closed++}})})
  await hub.start('op-'+generation);await hub.observe({id:'op-'+generation});await hub.finish('op-'+generation)
  await hub.observe({id:'op-'+generation});await hub.observe({id:'never-started'})
  if(generation)await hub.observe({id:'op-'+(generation-1)})
  await remove()
 }
 await hub.close();assert.equal(observed,100);assert.equal(closed,100)
})
