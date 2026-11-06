import {names,environment,fakeEnvironment,proxyFixture} from './fixtures/native-proxy-fixture.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {getGlobalDispatcher} from 'undici'
import * as native from '../src/native-http-proxy.js'
import {HttpFetchProvider} from '../src/native-http-fetch.js'
async function policyContract(impl){return fakeEnvironment({HTTP_PROXY:'http://fixture:password@127.0.0.1:12345',NO_PROXY:'.bypass.example,port.example:8080'},async env=>{const diagnostics=[],release=await impl.installProxyFromEnvironment(env,m=>diagnostics.push(m));try{return{diagnostics,child:impl.proxyEnvironmentForChild(),clear:impl.clearedProxyEnv(),routes:['http://public.example','https://public.example','http://127.0.0.1','http://[::1]','https://sub.bypass.example','http://port.example:8080','http://port.example:8081'].map(value=>{const route=impl.proxyRouteFor(new URL(value));if(route.proxied)assert.equal(typeof route.dispatcher.dispatch,'function');return{proxied:route.proxied,...route.proxied?{proxy:route.proxy}:{}}})}}finally{await release()}})}
test('native proxy policy bypasses local and excluded destinations while preserving authenticated child configuration',async()=>{
 const proxy='http://fixture:password@127.0.0.1:12345',result=await policyContract(native)
 assert.deepEqual(result.diagnostics,[])
 assert.deepEqual(result.routes,[{proxied:true,proxy},{proxied:true,proxy},{proxied:false},{proxied:false},{proxied:false},{proxied:false},{proxied:true,proxy}])
 assert.deepEqual(result.child,{NODE_USE_ENV_PROXY:'1',http_proxy:undefined,HTTP_PROXY:proxy,https_proxy:proxy,HTTPS_PROXY:proxy,no_proxy:'.bypass.example,port.example:8080,localhost,127.0.0.1,::1,[::1]',NO_PROXY:'.bypass.example,port.example:8080,localhost,127.0.0.1,::1,[::1]'})
 assert.deepEqual(result.clear,Object.fromEntries(names.filter(name=>name!=='NODE_USE_ENV_PROXY').map(name=>[name,undefined])))
})
test('native proxy nested direct policy restores exact outer route, dispatcher and launch environment',async()=>fakeEnvironment({ALL_PROXY:'http://127.0.0.1:12345'},async env=>{const before=getGlobalDispatcher(),beforeEnv=new Map(names.map(n=>[n,process.env[n]])),outer=await native.installProxyFromEnvironment(env,()=>{});try{const outerDispatcher=getGlobalDispatcher(),proxy=native.proxyRouteFor(new URL('http://public.example')).proxy,inner=await native.installProxyFromEnvironment(environment({}),()=>{});try{assert.equal(native.proxyRouteFor(new URL('http://public.example')).proxied,false);assert.deepEqual(native.proxyEnvironmentForChild(),{})}finally{await inner()}assert.equal(getGlobalDispatcher(),outerDispatcher);assert.equal(native.proxyRouteFor(new URL('http://public.example')).proxy,proxy)}finally{await outer()}assert.equal(getGlobalDispatcher(),before);assert.ok(names.every(n=>process.env[n]===beforeEnv.get(n)),'proxy environment restoration mismatch');assert.deepEqual(native.proxyEnvironmentForChild(),{})}))
test('native proxy unsupported schemes report safely and preserve original child values without Node proxy flag',async()=>fakeEnvironment({HTTP_PROXY:'socks5://synthetic-secret@127.0.0.1:1080',ALL_PROXY:'http://127.0.0.1:12345'},async env=>{const messages=[],release=await native.installProxyFromEnvironment(env,m=>messages.push(m));try{assert.ok(messages.length>0);assert.ok(messages.every(m=>!m.includes('synthetic-secret')));assert.equal(native.proxyRouteFor(new URL('http://127.0.0.1')).proxied,false);const child=native.proxyEnvironmentForChild();assert.equal(child.HTTP_PROXY,'socks5://synthetic-secret@127.0.0.1:1080');assert.equal(child.NODE_USE_ENV_PROXY,undefined)}finally{await release()}}))
test('native HTTP uses the installed proxy dispatcher without direct DNS and proxy disposal drains an admitted response',{timeout:10000},async t=>{const f=await proxyFixture(t,{hold:true});await fakeEnvironment({HTTP_PROXY:f.proxyURL},async env=>{const releaseProxy=await native.installProxyFromEnvironment(env,()=>{});const closeProxy=releaseProxy;t.after(closeProxy);let resolves=0;const provider=new HttpFetchProvider({maxResponseBytes:1000,maxBodyChars:1000,timeoutMs:5000,maxRedirects:2,userAgent:'fixture'},async()=>{resolves++;throw Error('must not resolve direct DNS')});const request=provider.fetch({url:'http://proxy-fixture.example/body'});await f.entered.promise;let closed=false;const closing=closeProxy().then(()=>{closed=true});await new Promise(r=>setImmediate(r));assert.equal(closed,false);f.release.resolve();assert.equal((await request).body.content,'NATIVE_PROXY_BODY_MARKER');await closing;assert.equal(closed,true);assert.equal(resolves,0);assert.deepEqual(f.seen,[{target:'proxy-fixture.example:80',auth:'Basic '+Buffer.from('fixture:password').toString('base64')}]);await assert.rejects(new HttpFetchProvider({maxResponseBytes:100,maxBodyChars:100,timeoutMs:1000,maxRedirects:1,userAgent:'fixture'}).fetch({url:`http://127.0.0.1:${f.origin.address().port}/`}),e=>e.code==='WEB_BLOCKED_URL')})})

test('repeated proxy release shares the drain and cannot overwrite a later installation',async()=>fakeEnvironment({HTTP_PROXY:'http://127.0.0.1:12345'},async env=>{
 const before=getGlobalDispatcher(),releaseFirst=await native.installProxyFromEnvironment(env,()=>{})
 const first=releaseFirst()
 assert.equal(first,releaseFirst())
 await first
 const releaseSecond=await native.installProxyFromEnvironment(environment({HTTP_PROXY:'http://127.0.0.1:12346'}),()=>{})
 try{
  const second=getGlobalDispatcher(),route=native.proxyRouteFor(new URL('http://public.example/'))
  assert.equal(route.proxy,'http://127.0.0.1:12346')
  assert.equal(releaseFirst(),first)
  await releaseFirst()
  assert.equal(getGlobalDispatcher(),second)
  assert.deepEqual(native.proxyRouteFor(new URL('http://public.example/')),route)
 }finally{await releaseSecond()}
 assert.equal(getGlobalDispatcher(),before)
}))
