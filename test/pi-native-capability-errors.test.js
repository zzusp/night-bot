import test from 'node:test'
import assert from 'node:assert/strict'
import * as errors from '../src/native-capability-errors.js'
const packages=['authorization','workspace']
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
test('native owners expose shared error constructors without retired service aliases',async()=>{
 for(const pkg of packages){
  const api=await import('../src/native-'+pkg+'.js')
  const original=await import('./fixtures/legacy-'+pkg+'-interface.mjs')
  assert.equal(typeof api.default,'function')
  for(const name of Object.keys(original).filter(n=>n.endsWith('Error'))){
   assert.ok(name in api,pkg+': '+name)
   assert.equal(api[name],errors[name])
  }
 }
})
test('native HTTP and web share canonical error identity',async()=>{
 const api=await import('../src/native-web.js')
 assert.equal(typeof api.default,'function')
 assert.equal(api.WebError,errors.WebError)
 const cause=new Error('fixture cause'),error=new api.WebError('fixture','WEB_ABORTED',{cause})
 assert.equal(error.message,'fixture');assert.equal(error.code,'WEB_ABORTED');assert.equal(error.cause,cause)
 const {HttpFetchProvider}=await import('../src/native-http-fetch.js')
 await assert.rejects(new HttpFetchProvider({maxResponseBytes:1024,timeoutMs:1000,maxRedirects:1}).fetch({url:'file:///fixture'}),errors.WebError)
})

test('canonical session-name validation errors retain native facts and cause without a retired namespace',async()=>{
 const cause=new Error('original validation cause')
 const error=new errors.SessionTitleInvalidError('invalid session name',{cause})
 assert.ok(error instanceof Error)
 assert.equal(error.name,'SessionTitleInvalidError')
 assert.equal(error.message,'invalid session name')
 assert.equal(error.cause,cause)
 assert.deepEqual(Object.keys(error),['name'])
 assert.equal(error.code,undefined)
 await assert.rejects(import('../packages/capability-compat/session-title/index.js'),{code:'ERR_MODULE_NOT_FOUND'})
 await assert.rejects(import('./fixtures/legacy-session-title-interface.mjs'),{code:'ERR_MODULE_NOT_FOUND'})
})
