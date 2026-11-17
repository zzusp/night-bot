import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLocalEvidence} from '../src/feedback/local-evidence.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'diagnostic-local-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));await mkdir(join(root,'data/logs'),{recursive:true});return {root,paths:{installRoot:root,logs:join(root,'data/logs')}}}
test('source discovery/read is scoped, paginated and secret-scrubbed',async t=>{
 const {root,paths}=await fixture(t);await writeFile(join(root,'src','channel.js'),'const error="CHANNEL_HISTORY_RECOVERY_FAILED";\nconst privateValue="actual-secret";\n'+'// line\n'.repeat(90));await writeFile(join(root,'data','private.js'),'CHANNEL_HISTORY_RECOVERY_FAILED private');
 const collect=createLocalEvidence({paths,secrets:['actual-secret']});const found=await collect('code_search',undefined,{query:'CHANNEL_HISTORY_RECOVERY_FAILED'});assert.equal(found.items.length,1);assert.equal(found.items[0].path,'src/channel.js');
 const first=await collect('code_read',undefined,{alias:found.items[0].alias});assert.equal(first.nextOffset,80);assert.match(first.content,/已脱敏/);assert.doesNotMatch(first.content,/actual-secret/);const second=await collect('code_read',undefined,{alias:found.items[0].alias,offset:80});assert.equal(second.nextOffset,null)
 await assert.rejects(collect('code_read',undefined,{alias:'../../data/private.js'}),{code:'FEEDBACK_ALIAS_INVALID'})
})
test('symlink source and logs are not readable',async t=>{
 const {root,paths}=await fixture(t);await writeFile(join(root,'private.js'),'PRIVATE_MARKER');
 try{await symlink(join(root,'private.js'),join(root,'src','linked.js'));await symlink(join(root,'private.js'),join(paths.logs,'linked.log'))}catch(error){if(error.code==='EPERM'){t.skip('symlink unavailable');return}throw error}
 const collect=createLocalEvidence({paths});assert.equal((await collect('code_search',undefined,{query:'PRIVATE_MARKER'})).items.length,0);assert.equal((await collect('logs')).items.length,0)
})
test('logs expose diagnostic fields, never business prose or identifiers',async t=>{
 const {root,paths}=await fixture(t);await writeFile(join(paths.logs,'app.log'),JSON.stringify({timestamp:'2026-11-17T08:00:00Z',level:'error',durationMs:3200,message:'error 用户张某 医疗记录 cancer task-123e4567-e89b-12d3-a456-426614174000 SQLITE_BUSY',body:'PRIVATE_BODY',error:{message:'secret',stack:'at callback (src/channels/router.js:12:3)'}})+'\nerror PRIVATE_RAW Alice /home/alice/file ETIMEDOUT');
 const output=await createLocalEvidence({paths})('logs');const json=JSON.stringify(output);assert.match(json,/SQLITE_BUSY|ETIMEDOUT/);assert.match(json,/3200/);assert.match(json,/router.js/);assert.doesNotMatch(json,/张某|cancer|123e4567|PRIVATE|Alice|secret|\/home/)
})
test('code root is independent of data installation root',async t=>{
 const {root,paths}=await fixture(t);await mkdir(join(root,'code/src'),{recursive:true});await writeFile(join(root,'code/src','current.js'),'const CURRENT_CODE = true;');
 const found=await createLocalEvidence({paths,codeRoot:join(root,'code')})('code_search',undefined,{query:'CURRENT_CODE'});assert.equal(found.items[0].path,'src/current.js')
})
