import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFeedbackService} from '../src/feedback/service.js'
import {redactFeedback} from '../src/feedback/redaction.js'
import {feedbackErrorCodes} from '../src/feedback/evidence.js'
const input={title:'页面异常',description:'重现步骤',consent:true,model:'test/model',revision:'default'}
function fixture(overrides={}){
 let collected=0,sent=0,body
 const service=createFeedbackService({model:()=>({provider:'test',model:'model'}),resolveModel:async()=>({}),getToken:async()=>'secret',getSecrets:async()=>['PRIVATE_SECRET'],diagnose:async()=>{collected++;return '分析 PRIVATE_SECRET'},fetchImpl:async(_url,options)=>{sent++;body=JSON.parse(options.body);return {ok:true,json:async()=>({html_url:'https://github.com/zzusp/night-bot/issues/123'})}},...overrides})
 return {service,get collected(){return collected},get sent(){return sent},get body(){return body}}
}
async function ready(f){const r=f.service.collect('owner',input);for(let i=0;i<50;i++){const view=f.service.read('owner',r.id);if(view.state!=='collecting')return view;await new Promise(r=>setTimeout(r,2))}assert.fail('not ready')}
test('no consent means no model, evidence, or issue; metadata is inert',async()=>{
 const f=fixture();assert.equal(f.service.metadata().target,'zzusp/night-bot')
 assert.throws(()=>f.service.collect('owner',{...input,consent:false}),{code:'FEEDBACK_CONSENT_REQUIRED'})
 assert.throws(()=>f.service.collect('owner',{...input,model:'changed'}),{code:'FEEDBACK_MODEL_CHANGED'})
 assert.equal(f.collected,0);assert.equal(f.sent,0)
 const r=await ready(f);assert.equal(r.state,'ready');assert.ok(!r.body.includes('PRIVATE_SECRET'))
 await assert.rejects(f.service.submit('owner',r.id,{title:r.title,body:r.body}),{code:'FEEDBACK_PUBLISH_CONSENT_REQUIRED'});assert.equal(f.sent,0)
})
test('preview binding, browser ownership, exactly-once successful create',async()=>{
 const f=fixture(),r=await ready(f)
 assert.throws(()=>f.service.read('other',r.id),{code:'FEEDBACK_NOT_FOUND'})
 await assert.rejects(f.service.submit('owner',r.id,{confirm:true,title:r.title,body:'changed'}),{code:'FEEDBACK_PREVIEW_CHANGED'})
 const result=await f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body})
 assert.equal(result.url,'https://github.com/zzusp/night-bot/issues/123');assert.deepEqual(f.body,{title:r.title,body:r.body})
 await f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body});assert.equal(f.sent,1)
})
test('unknown external outcome is never replayed',async()=>{
 let calls=0;const f=fixture({fetchImpl:async()=>{calls++;throw Error('sensitive upstream response')}}),r=await ready(f)
 const args={confirm:true,title:r.title,body:r.body}
 await assert.rejects(f.service.submit('owner',r.id,args),{code:'FEEDBACK_SUBMISSION_UNKNOWN'})
 await assert.rejects(f.service.submit('owner',r.id,args),{code:'FEEDBACK_NOT_READY'})
 assert.equal(calls,1);assert.equal(f.service.read('owner',r.id).state,'unknown')
})
test('cancellation aborts collection and removes previews; expiry and capacity are bounded',async()=>{
 let signal,started=Promise.withResolvers()
 const f=fixture({diagnose:async args=>{signal=args.signal;started.resolve();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));signal.throwIfAborted()}})
 const r=f.service.collect('owner',input);await started.promise
 await f.service.cancel('owner',r.id);assert.equal(signal.aborted,true);assert.throws(()=>f.service.read('owner',r.id),{code:'FEEDBACK_NOT_FOUND'});assert.equal(f.sent,0)
 let now=0;const g=fixture({now:()=>now}),r2=await ready(g);now=31*60*1000;assert.throws(()=>g.service.read('owner',r2.id),{code:'FEEDBACK_NOT_FOUND'})
})
test('fresh secret redaction invalidates an approved preview before publishing',async()=>{
 let secrets=[];const f=fixture({getSecrets:async()=>secrets,diagnose:async()=>'future-secret'}),r=await ready(f);secrets=['future-secret']
 await assert.rejects(f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body}),{code:'FEEDBACK_PREVIEW_CHANGED'})
 assert.equal(f.sent,0);assert.ok(!f.service.read('owner',r.id).body.includes('future-secret'))
})
test('known secrets, URLs, identifiers and private paths are scrubbed',()=>{
 const text=redactFeedback('secretvalue alice@example.com 13800138000 /home/alice/x C:\\Users\\Alice\\a https://example.com/?foo=private\nAuthorization: abc\nghp_abcdefghijklmnopqrst',['secretvalue'])
 for(const secret of ['secretvalue','alice@example.com','13800138000','/home/alice','C:\\Users','example.com','abcdefghijklmnopqrst','abc'])assert.ok(!text.includes(secret))
})
test('bounded log evidence exposes only allowlisted code counts, not paths or lines',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'logs'))
 await writeFile(join(root,'logs','a.log'),'secretvalue person@example.com SQLITE_BUSY CUSTOM_SECRET_CODE\n')

 const result=await feedbackErrorCodes(join(root,'logs'));assert.deepEqual(result.counts,{SQLITE_BUSY:1});assert.equal(result.files,1);assert.ok(!JSON.stringify(result).includes('secret'))
})
test('symbolic log files cannot introduce external error evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-link-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'logs'))
 await writeFile(join(root,'private.log'),'ETIMEDOUT')
 try{await symlink(join(root,'private.log'),join(root,'logs','link.log'))}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('当前 Windows 账号无文件 symlink 权限；此边界另在 Linux 实跑');return}throw error}
 const result=await feedbackErrorCodes(join(root,'logs'));assert.deepEqual(result.counts,{});assert.equal(result.files,0)
})
test('edited preview is sanitized and old confirmation payload cannot publish',async()=>{
 const f=fixture(),r=await ready(f)
 const next=await f.service.edit('owner',r.id,{title:'新标题',body:'用户补充 PRIVATE_SECRET'})
 assert.ok(!next.body.includes('PRIVATE_SECRET'))
 await assert.rejects(f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body}),{code:'FEEDBACK_PREVIEW_CHANGED'})
 await f.service.submit('owner',r.id,{confirm:true,title:next.title,body:next.body})
 assert.deepEqual(f.body,{title:next.title,body:next.body})
})
test('endpoint generation changes invalidate consent before and during resolve',async()=>{
 let revision='one';const f=fixture({modelConsent:()=>({revision,endpoint:'https://model.example'}),resolveModel:async()=>{revision='two';return{}}})
 assert.throws(()=>f.service.collect('owner',input),{code:'FEEDBACK_MODEL_CHANGED'})
 const r=f.service.collect('owner',{...input,revision:'one'});await new Promise(r=>setTimeout(r,5))
 assert.equal(f.service.read('owner',r.id).state,'failed');assert.equal(f.collected,0);await f.service.close()
})
test('close drains submission and forbids dispatch after credentials resolve',async()=>{
 const token=Promise.withResolvers(),entered=Promise.withResolvers();let sends=0
 const f=fixture({getToken:()=>{entered.resolve();return token.promise},fetchImpl:async()=>{sends++;throw Error()}}),r=await ready(f)
 const submitting=f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body});await entered.promise
 const closed=f.service.close();token.resolve('fake-token');await assert.rejects(submitting);await closed
 assert.equal(sends,0);assert.throws(()=>f.service.read('owner',r.id),{code:'FEEDBACK_CLOSED'})
 await assert.rejects(f.service.submit('owner',r.id,{confirm:true}),{code:'FEEDBACK_CLOSED'})
})
test('editing and publishing cannot race past an unchanged preview',async()=>{
 const wait=Promise.withResolvers();let delay=false
 const f=fixture({getSecrets:async()=>{if(delay)await wait.promise;return[]}}),r=await ready(f);delay=true
 const editing=f.service.edit('owner',r.id,{title:'新标题',body:'新内容'})
 await assert.rejects(f.service.submit('owner',r.id,{confirm:true,title:r.title,body:r.body}),{code:'FEEDBACK_NOT_READY'})
 wait.resolve();await editing;assert.equal(f.sent,0)
})
test('manual feedback never reads evidence or credentials, starts Pi or requires a model',async()=>{
 const unexpected=()=>{assert.fail('manual path accessed diagnostic dependency')};let tokenReads=0
 const f=fixture({model:unexpected,modelConsent:unexpected,resolveModel:unexpected,getSecrets:unexpected,evidence:unexpected,diagnose:unexpected,getToken:async()=>{tokenReads++;return 'fake-submit-token'}})
 assert.equal(f.service.metadata().model,null)
 const r=f.service.draft('owner',{title:'页面问题',description:'复现步骤 alice@example.com'})
 assert.equal(r.state,'ready');assert.ok(!r.body.includes('alice@example.com'));assert.ok(!r.body.includes('Pi 诊断'));assert.equal(tokenReads,0);assert.equal(f.sent,0)
 assert.throws(()=>f.service.read('other',r.id),{code:'FEEDBACK_NOT_FOUND'})
 await assert.rejects(f.service.submit('owner',r.id,{title:r.title,body:r.body}),{code:'FEEDBACK_PUBLISH_CONSENT_REQUIRED'});assert.equal(tokenReads,0)
 const edited=await f.service.edit('owner',r.id,{title:'修改标题',body:'修改正文'});assert.equal(tokenReads,0)
 await f.service.submit('owner',r.id,{title:edited.title,body:edited.body,confirm:true})
 assert.equal(tokenReads,1);assert.equal(f.sent,1);assert.deepEqual(f.body,{title:edited.title,body:edited.body});await f.service.close()
})
test('manual draft cancellation, validation and capacity remain bounded',async()=>{
 const f=fixture();assert.throws(()=>f.service.draft('owner',{title:'',description:'x'}),{code:'FEEDBACK_INPUT_INVALID'})
 const r=f.service.draft('owner',input);await f.service.cancel('owner',r.id);assert.throws(()=>f.service.read('owner',r.id),{code:'FEEDBACK_NOT_FOUND'})
 for(let i=0;i<16;i++)f.service.draft('owner',input)
 assert.throws(()=>f.service.draft('owner',input),{code:'FEEDBACK_LIMIT'});await f.service.close();assert.throws(()=>f.service.draft('owner',input),{code:'FEEDBACK_CLOSED'})
})


test('registered feedback secrets are redacted before the output length limit cuts through them',()=>{
 const secret='opaque-private-value-for-feedback-check'
 const text=redactFeedback('x'.repeat(47993)+secret+' tail',[secret])
 assert.equal(text.length,48000)
 assert.ok(!text.includes(secret.slice(0,7)))
 assert.ok(text.includes('[已脱敏]'))
})
test('scoped evidence factory starts only after consent and isolates report capabilities',async()=>{
 let factories=0,diagnoses=0
 const f=fixture({createEvidence:({title,description,secrets})=>{assert.equal(title,input.title);factories++;assert.equal(description,input.description);assert.ok(secrets.includes('PRIVATE_SECRET'));const local=factories;return async()=>({local})},diagnose:async({evidence})=>{diagnoses++;return JSON.stringify(await evidence('discover'))}})
 f.service.metadata();f.service.draft('owner',{title:'manual',description:'manual'})
 assert.equal(factories,0)
 assert.throws(()=>f.service.collect('owner',{...input,consent:false}),{code:'FEEDBACK_CONSENT_REQUIRED'})
 assert.equal(factories,0)
 const first=await ready(f),second=await ready(f)
 assert.match(first.body,/"local":1/);assert.match(second.body,/"local":2/)
 assert.equal(diagnoses,2);assert.equal(f.sent,0)
 await f.service.close()
})
