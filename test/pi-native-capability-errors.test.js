import test from 'node:test'
import assert from 'node:assert/strict'
import * as errors from '../src/native-capability-errors.js'
const packages=['authorization','workspace','session-title']
const samples={WebError:['fixture','WEB_ABORTED',{cause:new Error('cause')}],AuthorizationError:['fixture','ABORTED',{cause:new Error('cause')}],AuthorizationDeclinedError:[],WorkspaceMoveInvalidError:['fixture'],WorkspaceUnknownSessionError:['session','archive'],WorkspaceActiveSessionError:['session',[{kind:'tool'}]],WorkspaceArchivedSessionPinError:['session'],WorkspaceOrderInvalidError:['workspace'],SessionTitleInvalidError:['fixture']}
test('canonical capability errors preserve independent original names, codes, facts and causes',async()=>{
 for(const pkg of packages){
  const original=await import('./fixtures/legacy-'+pkg+'-interface.mjs')
  for(const [name,Old] of Object.entries(original).filter(([name])=>name.endsWith('Error'))){
   const New=errors[name],args=samples[name];assert.notEqual(New,Old)
   const old=new Old(...args),native=new New(...args)
   assert.equal(native.name,old.name);assert.equal(native.message,old.message)
   assert.deepEqual(Object.keys(native),Object.keys(old))
   for(const key of Object.keys(old))assert.deepEqual(native[key],old[key])
   assert.equal(native.cause,old.cause)
   if(name==='AuthorizationDeclinedError')assert.equal(native instanceof errors.AuthorizationError,true)
  }
 }
})
test('historical namespaces expose the native owners, shared constructors and complete public export vocabulary',async()=>{
 for(const pkg of packages){
  const alias=await import('../packages/capability-compat/'+pkg+'/index.js')
  const native=await import('../src/native-'+pkg+'.js')
  const original=await import('./fixtures/legacy-'+pkg+'-interface.mjs')
  assert.equal(alias.default,native.default)
  for(const name of Object.keys(original))assert.ok(name in alias,pkg+': '+name)
  for(const name of Object.keys(original).filter(n=>n.endsWith('Error')))assert.equal(alias[name],errors[name])
 }
})
test('native HTTP and the public web namespace share canonical error identity',async()=>{
 const api=await import('../packages/capability-compat/web/index.js')
 const native=await import('../src/native-web.js')
 assert.equal(api.default,native.default)
 assert.equal(api.WebError,errors.WebError)
 const cause=new Error('fixture cause'),error=new api.WebError('fixture','WEB_ABORTED',{cause})
 assert.equal(error.message,'fixture');assert.equal(error.code,'WEB_ABORTED');assert.equal(error.cause,cause)
 const {HttpFetchProvider}=await import('../src/native-http-fetch.js')
 await assert.rejects(new HttpFetchProvider({maxResponseBytes:1024,timeoutMs:1000,maxRedirects:1}).fetch({url:'file:///fixture'}),errors.WebError)
})
