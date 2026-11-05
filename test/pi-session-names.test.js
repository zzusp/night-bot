import test from 'node:test'
import assert from 'node:assert/strict'
import {namesFixture} from './fixtures/pi-session-names-fixture.js'
import {sessionNameAuditKinds} from '../src/pi-session-names.js'
test('automatic naming defaults off and public SDK names without receipts stay pinned',async t=>{
 const f=await namesFixture(t);f.handle.session.setSessionName('Official manual');await f.handle.actor.receipts.commit();await f.bind()
 assert.deepEqual(await f.names.settled(f.handle.actor),{skipped:true});assert.equal(f.requests.length,0);assert.equal((await f.names.get(f.handle.actor)).pinned,true)
})
test('unapproved labels, secret-shaped labels and oversized labels dispatch no auxiliary request',async t=>{
 for(const value of [{id:'x',text:'token=private'}, {id:'x',text:'x'.repeat(513)}, {id:'x',text:'ok',messages:[]}]){
  const f=await namesFixture(t);await f.bind({automatic:true,readPublicSubject:async()=>value});await assert.rejects(f.names.refresh(f.handle.actor),{code:'PI_SESSION_NAME_SUBJECT_REJECTED'});assert.equal(f.requests.length,0)
 }
})
test('late auxiliary output cannot overwrite a newer manual pin and close joins actual inference',async t=>{
 const f=await namesFixture(t),response=Promise.withResolvers(),started=Promise.withResolvers();await f.bind({automatic:true})
 f.respond=()=>{started.resolve();return response.promise}
 const generating=f.names.refresh(f.handle.actor);const rejected=assert.rejects(generating);await started.promise
 await f.names.set(f.handle.actor,'Manual wins');let closed=false;const closing=f.names.closeActor(f.handle.actor).then(()=>{closed=true})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false)
 response.resolve('Late generated name');await rejected;await closing
 assert.equal((await f.backend.readNative('names')).sessionName.name,'Manual wins')
})
test('commit failure keeps last committed descriptor and fences further naming',async t=>{
 const f=await namesFixture(t);await f.bind();await f.names.set(f.handle.actor,'Durable old')
 const actor=f.handle.actor,checkedFile=f.backend.checkedFile.bind(f.backend),poison=Object.assign(Error('flush failed'),{code:'TEST_NAME_COMMIT_FAILED'})
 f.backend.checkedFile=async()=>{throw poison}
 await assert.rejects(f.names.set(actor,'Dirty in memory'),error=>error===poison)
 assert.equal(actor.piSession.sessionName,'Dirty in memory');assert.equal((await f.names.get(actor)).name,'Durable old');f.backend.checkedFile=checkedFile;assert.equal((await f.backend.readNative('names')).sessionName.name,'Durable old')
 assert.throws(()=>f.names.set(actor,'Forbidden retry'),error=>error===poison);await assert.rejects(f.names.closeActor(actor),error=>error===poison)
 // Restore fixture commit only for teardown; the naming service stays fenced.
 f.backend.checkedFile=checkedFile
})
test('name receipt validator rejects extra data and malformed pin metadata',()=>{
 const valid={version:1,nameEntryId:'entry',mode:'manual',pinned:true}
 assert.equal(sessionNameAuditKinds['session-name/set'](valid),true)
 assert.equal(sessionNameAuditKinds['session-name/set']({...valid,name:'no duplicate body'}),false)
 assert.equal(sessionNameAuditKinds['session-name/set']({...valid,pinned:'true'}),false)
})
test('manual SDK name changed after binding remains pinned against automatic naming',async t=>{
 const f=await namesFixture(t);await f.bind({automatic:true});f.handle.session.setSessionName('Manual official change');await f.handle.actor.receipts.commit()
 assert.deepEqual(await f.names.settled(f.handle.actor),{skipped:true});assert.equal(f.requests.length,0);assert.equal((await f.names.get(f.handle.actor)).name,'Manual official change')
})
test('explicit request abort rejects late output without publishing a name',async t=>{
 const f=await namesFixture(t),started=Promise.withResolvers(),response=Promise.withResolvers(),controller=new AbortController();await f.bind()
 f.respond=()=>{started.resolve();return response.promise}
 const job=f.names.refresh(f.handle.actor,{signal:controller.signal}),rejected=assert.rejects(job);await started.promise;controller.abort();response.resolve('Must not publish');await rejected
 assert.equal((await f.backend.readNative('names')).sessionName.name,undefined);assert.equal((await f.backend.readNative('names')).audit.filter(r=>r.domain==='session-name').length,0)
})
test('generated secrets, control characters and over-budget names never become official name entries',async t=>{
 for(const value of ['token=private','unsafe\nname','x'.repeat(513)]){
  const f=await namesFixture(t);await f.bind();f.respond=()=>value
  await assert.rejects(f.names.refresh(f.handle.actor),{code:'PI_SESSION_NAME_INVALID'})
  assert.equal(f.handle.session.sessionName,undefined);assert.equal((await f.backend.readNative('names')).sessionName.nameEntryId,undefined)
 }
})
test('a facade carrying an actual SDK reference cannot acquire naming authority',async t=>{
 const f=await namesFixture(t)
 await assert.rejects(f.names.bind({...f.handle.actor}),{code:'PI_SESSION_NAME_ACTOR_REQUIRED'})
 assert.equal(f.handle.session.sessionName,undefined)
})
test('drain waits for the complete settled operation including a gated committed-name read',{timeout:10000},async t=>{
 const f=await namesFixture(t);await f.bind({automatic:true})
 const read=f.names.readCommitted,entered=Promise.withResolvers(),release=Promise.withResolvers()
 f.names.readCommitted=async actor=>{entered.resolve();await release.promise;return read(actor)}
 const naming=f.names.settled(f.handle.actor);await entered.promise
 let drained=false;const draining=f.names.drain(f.handle.actor).then(()=>{drained=true})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);assert.equal(f.requests.length,0)
 release.resolve();await naming;await draining
 assert.equal(f.requests.length,1);assert.equal((await f.names.get(f.handle.actor)).name,'Approved name')
})
test('close joins a gated settled read and refuses all late auxiliary dispatch',{timeout:10000},async t=>{
 const f=await namesFixture(t);await f.bind({automatic:true})
 const read=f.names.readCommitted,entered=Promise.withResolvers(),release=Promise.withResolvers()
 f.names.readCommitted=async actor=>{entered.resolve();await release.promise;return read(actor)}
 const naming=f.names.settled(f.handle.actor),rejected=assert.rejects(naming,{code:'PI_SESSION_NAME_CLOSED'});await entered.promise
 let closed=false;const closing=f.names.closeActor(f.handle.actor).then(()=>{closed=true})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);assert.equal(f.requests.length,0)
 release.resolve();await rejected;await closing
 assert.equal(f.requests.length,0);assert.equal((await f.backend.readNative('names')).sessionName.nameEntryId,undefined)
})
