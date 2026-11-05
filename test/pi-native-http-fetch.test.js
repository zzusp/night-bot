import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {HttpFetchProvider,httpPolicy,httpTransport} from '../src/native-http-fetch.js'
const limits={maxResponseBytes:100,maxBodyChars:100,timeoutMs:1000,maxRedirects:3,userAgent:'fixture-agent'}
const addresses=[{address:'93.184.216.34',family:4}]
function fixture(responses,options={}){const calls=[],closed=[],resolved=[];const provider=new HttpFetchProvider({...limits,...options},async(host,signal)=>{resolved.push(host);return httpPolicy.resolvePublicAddresses(host,signal,async()=>addresses)}, {async request(url,pinned,headers,signal){calls.push({url:url.href,pinned,headers,signal});const response=typeof responses==='function'?await responses(url,signal):responses.shift();return{response,close:async()=>{closed.push(url.href)}}},async requestVia(){throw new Error('unexpected proxy route')}},()=>({proxied:false}));return{provider,calls,closed,resolved}}
test('HTTP fetch contract decodes declared text, preserves status and enforces character limits',async()=>{
 const latin=fixture([new Response(new Uint8Array([99,97,102,233]),{status:404,headers:{'content-type':'text/plain; charset=windows-1252'}})])
 assert.deepEqual(await latin.provider.fetch({url:'https://fixture.example/'}),{url:'https://fixture.example/',statusCode:404,body:{kind:'text',content:'café'},truncated:false})
 const html=fixture([new Response('<h1>hello</h1>',{headers:{'content-type':'application/xhtml+xml'}})],{maxBodyChars:4})
 assert.deepEqual((await html.provider.fetch({url:'https://fixture.example/'})).body,{kind:'html',content:'<h1>'})
 const unsupported=fixture([new Response('text',{headers:{'content-type':'text/plain; charset=not-an-encoding'}})])
 await assert.rejects(unsupported.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_UNSUPPORTED_CONTENT_TYPE')
 assert.equal(unsupported.closed.length,1)
})
test('public address policy rejects private/mixed answers, malformed families and discovered NAT64 private destinations',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','0.0.0.0','100.64.0.1','192.168.1.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert.equal(httpPolicy.isPublicIpAddress(ip),false,ip);for(const ip of ['1.1.1.1','93.184.216.34','2606:4700:4700::1111'])assert.equal(httpPolicy.isPublicIpAddress(ip),true,ip);const signal=new AbortController().signal;for(const answers of [[],[{address:'1.1.1.1',family:6}],[...addresses,{address:'127.0.0.1',family:4}]])await assert.rejects(httpPolicy.resolvePublicAddresses('fixture.example',signal,async()=>answers));const names=[];await assert.rejects(httpPolicy.resolvePublicAddresses('nat64.example',signal,async host=>{names.push(host);return host==='ipv4only.arpa'?[{address:'2001:4860:64::c000:aa',family:6},{address:'2001:4860:64::c000:ab',family:6}]:[{address:'2001:4860:64::7f00:1',family:6}]}),e=>e.code==='WEB_BLOCKED_URL');assert.deepEqual(names,['nat64.example','ipv4only.arpa'])})
test('pinned lookup serves only the validated address snapshot without re-resolving a hostname',()=>{const lookup=httpPolicy.createPinnedLookup([...addresses,{address:'2606:4700:4700::1111',family:6}]);lookup('attacker-changed.example',{family:4},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4)});lookup('fixture.example',{all:true,family:6},(error,result)=>{assert.equal(error,null);assert.deepEqual(result,[{address:'2606:4700:4700::1111',family:6}])});httpPolicy.createPinnedLookup(addresses)('fixture.example',{family:6},error=>assert.equal(error.code,'ENOTFOUND'))})
test('HTTP URL restrictions and redirect policy run before another network request',async()=>{for(const url of ['file:///tmp/fixture','ftp://fixture.example/','https://user:password@fixture.example/','not a url','https://fixture.example/'+ 'x'.repeat(2050),'http://127.0.0.1/','http://[::1]/']){const f=fixture([]);await assert.rejects(f.provider.fetch({url}));assert.equal(f.calls.length,0,url)}const redirect=new Response('unused',{status:302,headers:{location:'http://fixture.example/next','content-type':'text/plain'}}),f=fixture([redirect]);await assert.rejects(f.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_REDIRECT_BLOCKED');assert.equal(f.calls.length,1);assert.equal(f.closed.length,1);assert.equal(redirect.bodyUsed,true)})
test('each same-origin redirect is resolved and pinned separately and closes its response resources',async()=>{const f=fixture([new Response('redirect',{status:302,headers:{location:'/next','content-type':'text/plain'}}),new Response('result',{headers:{'content-type':'text/plain'}})]),result=await f.provider.fetch({url:'https://fixture.example/'});assert.equal(result.url,'https://fixture.example/next');assert.equal(result.body.content,'result');assert.deepEqual(f.resolved,['fixture.example','fixture.example']);assert.equal(f.closed.length,2);for(const call of f.calls){assert.deepEqual(call.pinned,addresses);assert.equal(call.headers['user-agent'],'fixture-agent');assert.equal(call.headers.authorization,undefined);assert.equal(call.headers.cookie,undefined)}})
test('declared limits reject early, streaming limits truncate and unsupported bodies release their transport',async()=>{const declared=fixture([new Response('abcdef',{headers:{'content-type':'text/plain','content-length':'1000'}})]);await assert.rejects(declared.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_FETCH_TOO_LARGE');assert.equal(declared.closed.length,1);const streamed=fixture([new Response('abcdefghij',{headers:{'content-type':'text/plain'}})],{maxResponseBytes:5});const result=await streamed.provider.fetch({url:'https://fixture.example/'});assert.equal(result.body.content,'abcde');assert.equal(result.truncated,true);const unsupported=fixture([new Response('binary',{headers:{'content-type':'application/pdf'}})]);await assert.rejects(unsupported.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_UNSUPPORTED_CONTENT_TYPE');assert.equal(unsupported.closed.length,1)})
test('body timeout and caller cancellation keep separate codes and both close the request',async()=>{for(const own of [true,false]){const entered=Promise.withResolvers(),control=new AbortController(),f=fixture(async(_url,signal)=>{const stream=new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});entered.resolve()}});return new Response(stream,{headers:{'content-type':'text/plain'}})},{timeoutMs:own?20:1000});const work=f.provider.fetch({url:'https://fixture.example/'},control.signal),rejected=assert.rejects(work,e=>e.code===(own?'WEB_FETCH_TIMEOUT':'WEB_ABORTED'));await entered.promise;if(!own)control.abort(new Error('caller cancel'));await rejected;assert.equal(f.closed.length,1)}})
test('proxy routing delegates public DNS to its installed dispatcher but private literals cannot use it',async()=>{let routed=0,resolved=0;const dispatcher={},provider=new HttpFetchProvider(limits,async(host,signal)=>{resolved++;return httpPolicy.resolvePublicAddresses(host,signal,async()=>addresses)},{async request(){throw new Error('unexpected direct request')},async requestVia(value,url){assert.equal(value,dispatcher);routed++;return{response:new Response('proxied',{headers:{'content-type':'text/plain'}}),close:async()=>{}}}},()=>({proxied:true,dispatcher}));assert.equal((await provider.fetch({url:'https://fixture.example/'})).body.content,'proxied');assert.equal(resolved,0);await assert.rejects(provider.fetch({url:'http://127.0.0.1/'}),e=>e.code==='WEB_BLOCKED_URL');assert.equal(routed,1)})

test('the real connector uses its fixed lookup for an otherwise unresolved origin without weakening public URL policy',{timeout:5000},async t=>{
 const seen=[],server=createServer((request,response)=>{seen.push({host:request.headers.host,path:request.url});response.writeHead(200,{'content-type':'text/plain'});response.end('pinned fixture')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=new URL(`http://pin.fixture.invalid:${server.address().port}/pinned`);let exchange;try{exchange=await httpTransport.requestPinned(url,[{address:'127.0.0.1',family:4}],{'user-agent':'fixture-agent'},new AbortController().signal);assert.equal(await exchange.response.text(),'pinned fixture')}finally{await exchange?.close()}assert.deepEqual(seen,[{host:url.host,path:'/pinned'}]);await assert.rejects(httpPolicy.resolvePublicAddresses('127.0.0.1',new AbortController().signal),e=>e.code==='WEB_BLOCKED_URL')
})

test('a late resolver answer cannot dispatch HTTP after caller cancellation',{timeout:1000},async()=>{const entered=Promise.withResolvers(),release=Promise.withResolvers(),cancel=new AbortController();let calls=0;const provider=new HttpFetchProvider(limits,async()=>{entered.resolve();await release.promise;return addresses},{async request(){calls++;throw new Error('must never dispatch')}},()=>({proxied:false}));const work=provider.fetch({url:'https://fixture.example/'},cancel.signal),rejected=assert.rejects(work,e=>e.code==='WEB_ABORTED');await entered.promise;cancel.abort(new Error('caller stopped'));release.resolve();await rejected;assert.equal(calls,0)})

test('owned HTTP body reader cancels streams that do not listen to the request signal',{timeout:1000},async()=>{
 for(const own of [true,false]){
  const entered=Promise.withResolvers(),control=new AbortController();let cancelled=0
  const body=new ReadableStream({pull(){entered.resolve()},cancel(){cancelled++}},{highWaterMark:0})
  const response=new Response(body,{headers:{'content-type':'text/plain'}})
  const f=fixture([response],{timeoutMs:own?20:500})
  const work=f.provider.fetch({url:'https://fixture.example/'},control.signal)
  const rejected=assert.rejects(work,e=>e.code===(own?'WEB_FETCH_TIMEOUT':'WEB_ABORTED'))
  await entered.promise
  if(!own)control.abort(new Error('caller cancellation'))
  await rejected
  assert.equal(cancelled,1)
  assert.equal(body.locked,false)
  assert.equal(f.closed.length,1)
 }
})

test('every redirect failure releases its body before closing and cannot dispatch another hop',async()=>{
 for(const [headers,code] of [
  [{},'WEB_PROVIDER_ERROR'],
  [{location:'http://[bad'},'WEB_PROVIDER_ERROR'],
  [{location:'https://other.example/'},'WEB_REDIRECT_BLOCKED'],
  [{location:'https://name:secret@fixture.example/'},'WEB_BLOCKED_URL']
 ]){
  const events=[],response=new Response(new ReadableStream({cancel(){events.push('cancel')}}),{status:302,headers})
  const f=fixture([response]);const request=f.provider.network.request
  f.provider.network.request=async(...args)=>{const exchange=await request(...args);return{response:exchange.response,close:async()=>{events.push('close');await exchange.close()}}}
  await assert.rejects(f.provider.fetch({url:'https://fixture.example/'}),e=>e.code===code)
  assert.deepEqual(events,['cancel','close'])
  assert.equal(f.calls.length,1)
 }
 const f=fixture([new Response('redirect',{status:302,headers:{location:'/next'}})],{maxRedirects:0})
 await assert.rejects(f.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_REDIRECT_BLOCKED')
 assert.equal(f.closed.length,1)
})

test('failed body cancellation and dispatcher close preserve the original rejection',async()=>{
 let closes=0
 const response=new Response(new ReadableStream({cancel(){throw new Error('cancel failed')}}),{headers:{'content-type':'application/pdf'}})
 const f=fixture([])
 f.provider.requestOnce=async()=>({response,close:async()=>{closes++;throw new Error('close failed')}})
 await assert.rejects(f.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_UNSUPPORTED_CONTENT_TYPE')
 assert.equal(closes,1)
})

test('bounded reader owns retained chunk bytes and unlocks a faulting stream',async()=>{
 const chunk=new Uint8Array([65,66]);let pulls=0
 const body=new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(chunk);else{chunk.fill(90);controller.close()}}},{highWaterMark:0})
 const f=fixture([new Response(body,{headers:{'content-type':'text/plain'}})])
 assert.equal((await f.provider.fetch({url:'https://fixture.example/'})).body.content,'AB')
 assert.equal(body.locked,false)
 const broken=new ReadableStream({pull(controller){controller.error(new Error('connection dropped'))}})
 const fault=fixture([new Response(broken,{headers:{'content-type':'text/plain'}})])
 await assert.rejects(fault.provider.fetch({url:'https://fixture.example/'}),e=>e.code==='WEB_PROVIDER_ERROR')
 assert.equal(broken.locked,false)
 assert.equal(fault.closed.length,1)
})

test('HTTP cancellation drains body cleanup and transport closure before settling',{timeout:1000},async()=>{
 const entered=Promise.withResolvers(),cancelStarted=Promise.withResolvers(),bodyReleased=Promise.withResolvers(),closeStarted=Promise.withResolvers(),transportReleased=Promise.withResolvers(),abort=new AbortController()
 const body=new ReadableStream({pull(){entered.resolve()},cancel(){cancelStarted.resolve();return bodyReleased.promise}},{highWaterMark:0})
 const f=fixture([new Response(body,{headers:{'content-type':'text/plain'}})])
 const request=f.provider.network.request
 f.provider.network.request=async(...args)=>{const exchange=await request(...args);return{response:exchange.response,close:async()=>{closeStarted.resolve();await transportReleased.promise;await exchange.close()}}}
 let settled=false
 const work=f.provider.fetch({url:'https://fixture.example/'},abort.signal).finally(()=>{settled=true})
 const rejected=assert.rejects(work,e=>e.code==='WEB_ABORTED')
 await entered.promise;abort.abort(new Error('stop'));await cancelStarted.promise
 assert.equal(settled,false);assert.equal(f.closed.length,0)
 bodyReleased.resolve();await closeStarted.promise
 assert.equal(settled,false)
 transportReleased.resolve();await rejected
 assert.equal(f.closed.length,1);assert.equal(body.locked,false)
})
