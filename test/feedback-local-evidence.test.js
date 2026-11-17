import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {mkdtemp,mkdir,writeFile,rm,symlink,appendFile,utimes,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {createLocalEvidence} from '../src/feedback/local-evidence.js'
import {investigationBudget} from '../src/feedback/investigation-budget.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'diagnostic-local-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));await mkdir(join(root,'data/logs'),{recursive:true});return {root,paths:{installRoot:root,logs:join(root,'data/logs')}}}
let moduleId=0
async function mockedReader(t,overrides){const {default:unused,...named}=fs;t.mock.module('node:fs/promises',{namedExports:{...named,...overrides}});return import('../src/feedback/local-evidence.js?test='+ ++moduleId)}
test('source discovery/read is scoped, paginated and secret-scrubbed',async t=>{
 const {root,paths}=await fixture(t);await writeFile(join(root,'src','channel.js'),'const error="CHANNEL_HISTORY_RECOVERY_FAILED";\nconst privateValue="actual-secret";\n'+'// line\n'.repeat(90));await writeFile(join(root,'data','private.js'),'CHANNEL_HISTORY_RECOVERY_FAILED private')
 const collect=createLocalEvidence({paths,secrets:['actual-secret']});const found=await collect('code_search',undefined,{query:'CHANNEL_HISTORY_RECOVERY_FAILED'});assert.equal(found.items.length,1);assert.equal(found.items[0].path,'src/channel.js')
 const first=await collect('code_read',undefined,{alias:found.items[0].alias});assert.equal(first.nextOffset,80);assert.match(first.content,/已脱敏/);assert.doesNotMatch(first.content,/actual-secret/);const second=await collect('code_read',undefined,{alias:found.items[0].alias,offset:80});assert.equal(second.nextOffset,null)
 await assert.rejects(collect('code_read',undefined,{alias:'../../data/private.js'}),{code:'FEEDBACK_ALIAS_INVALID'})
})
test('symlink source and logs are not readable',async t=>{
 const {root,paths}=await fixture(t);await writeFile(join(root,'private.js'),'PRIVATE_MARKER')
 try{await symlink(join(root,'private.js'),join(root,'src','linked.js'));await symlink(join(root,'private.js'),join(paths.logs,'linked.log'))}catch(error){if(error.code==='EPERM'){t.skip('file symlink unavailable; directory-junction race tested separately');return}throw error}
 const collect=createLocalEvidence({paths});assert.equal((await collect('code_search',undefined,{query:'PRIVATE_MARKER'})).items.length,0);assert.equal((await collect('logs')).items.length,0)
})
test('logs expose diagnostic fields, never business prose or identifiers',async t=>{
 const {root,paths}=await fixture(t);await mkdir(join(root,'src/channels'));await writeFile(join(root,'src/channels/router.js'),'// product source');await writeFile(join(paths.logs,'app.log'),JSON.stringify({timestamp:'2026-11-17T08:00:00Z',level:'error',durationMs:3200,message:'error 用户张某 医疗记录 cancer task-123e4567-e89b-12d3-a456-426614174000 SQLITE_BUSY',body:'PRIVATE_BODY',error:{message:'secret',stack:'at callback (src/channels/router.js:12:3)'}})+'\nerror PRIVATE_RAW Alice /home/alice/file ETIMEDOUT')
 const output=await createLocalEvidence({paths})('logs');const json=JSON.stringify(output);assert.match(json,/SQLITE_BUSY|ETIMEDOUT/);assert.match(json,/3200/);assert.match(json,/router.js/);assert.doesNotMatch(json,/张某|cancer|123e4567|PRIVATE|Alice|secret|\/home/)
})
test('code root is independent of data installation root',async t=>{
 const {root,paths}=await fixture(t);await mkdir(join(root,'code/src'),{recursive:true});await writeFile(join(root,'code/src/current.js'),'const CURRENT_CODE = true;')
 const found=await createLocalEvidence({paths,codeRoot:join(root,'code')})('code_search',undefined,{query:'CURRENT_CODE'});assert.equal(found.items[0].path,'src/current.js')
})
test('whole-source redaction protects multiline credentials across page boundaries and preserves line numbers',async t=>{
 const {root,paths}=await fixture(t),privateValue='private-line-a\nprivate-line-b',source='// MARKER\n'+'// padding\n'.repeat(77)+'-----BEGIN PRIVATE KEY-----\n'+'fixture-key-line\n'.repeat(8)+'-----END PRIVATE KEY-----\n'+privateValue+'\n// END_MARKER\n'
 await writeFile(join(root,'src/fixture.js'),source)
 const collect=createLocalEvidence({paths,secrets:[privateValue]}),found=await collect('code_search',undefined,{query:'MARKER'}),alias=found.items[0].alias
 const first=await collect('code_read',undefined,{alias}),second=await collect('code_read',undefined,{alias,offset:80})
 assert.equal(first.totalLines,source.split('\n').length);assert.doesNotMatch(first.content+second.content,/fixture-key-line|private-line/)
 assert.match(second.content,RegExp((source.split('\n').indexOf('// END_MARKER')+1)+': // END_MARKER'))
 assert.equal((await collect('code_search',undefined,{query:'fixture-key-line'})).items.length,0)
})
test('source long-line continuation remains within the tool budget and can reach the last character',async t=>{
 const {root,paths}=await fixture(t),source='const MARKER = '+JSON.stringify('"\\'.repeat(18000)+'END_OF_LONG_LINE')+';'
 await writeFile(join(root,'src/long.js'),source)
 const collect=createLocalEvidence({paths}),found=await collect('code_search',undefined,{query:'MARKER'});let offset=0,characterOffset=0,joined='',pages=0
 for(;;){const page=await collect('code_read',undefined,{alias:found.items[0].alias,offset,characterOffset});assert.ok(JSON.stringify(page).length<=investigationBudget.pageCharacters);joined+=page.content.replace(/^\d+(?::\d+)?: /,'');pages++;if(page.complete)break;assert.ok(page.nextOffset>offset||page.nextCharacterOffset>characterOffset);offset=page.nextOffset;characterOffset=page.nextCharacterOffset}
 assert.ok(pages>2);assert.equal(joined,source)
})
test('search pages reuse a bounded snapshot instead of rereading a changed source tree',async t=>{
 const {root,paths}=await fixture(t),file=join(root,'src/many.js');await writeFile(file,'// MARKER\n'.repeat(100))
 const collect=createLocalEvidence({paths}),first=await collect('code_search',undefined,{query:'MARKER'});assert.equal(first.nextOffset,20);await rm(file)
 const next=await collect('code_search',undefined,{query:'MARKER',offset:20});assert.equal(next.items[0].line,21);assert.equal(next.bytes,first.bytes)
 await writeFile(file,'x\n'.repeat(100000));const large=await collect('code_search',undefined,{query:'x',offset:1000000000});assert.equal(large.items.length,0);assert.equal(large.complete,false);assert.ok(large.limitations.includes('source-scan-or-snapshot-budget-reached'))
})
test('log queries match only public fields and complete stack paths must belong to product source',async t=>{
 const {root,paths}=await fixture(t),publicFile=join(root,'src/private-case.js');await writeFile(publicFile,'// public product file')
 const privateFile=join(root,'data/workspaces/customer with space/src/private-case.js')
 await writeFile(join(paths.logs,'app.log'),JSON.stringify({message:'ETIMEDOUT confidential-case',stack:`Error: fixture\n at customer (${privateFile}:12:3)\n at product (${publicFile}:25:4)\n at url (${pathToFileURL(publicFile)}:26:5)`,durationMs:3200})+'\n'+JSON.stringify({message:'ETIMEDOUT',stack:'at foreign (/opt/night/data/workspaces/client/src/private-case.js:99:1)'}))
 const collect=createLocalEvidence({paths});assert.equal((await collect('logs',undefined,{query:'confidential-case'})).items.length,0)
 const result=await collect('logs',undefined,{query:'ETIMEDOUT'}),rows=result.items.map(row=>JSON.parse(row.content)),frames=rows.flatMap(row=>row.frames)
 assert.deepEqual(frames.map(frame=>frame.line),[25,26]);assert.doesNotMatch(JSON.stringify(result),/customer|confidential|workspaces|client/)
})
test('logs keep an immutable tail across appends and preserve plaintext/epoch timing fields',async t=>{
 const {paths}=await fixture(t),file=join(paths.logs,'app.log'),base=Date.parse('2026-11-17T08:00:00Z')
 await writeFile(file,Array.from({length:30},(_,i)=>JSON.stringify({timestamp:base+i,durationMs:i,message:'ETIMEDOUT '+'x'.repeat(3000)})).join('\n')+'\n')
 const collect=createLocalEvidence({paths}),first=await collect('logs');assert.equal(first.nextOffset,10)
 await appendFile(file,Array.from({length:30},(_,i)=>JSON.stringify({timestamp:base+1000+i,durationMs:1000+i,message:'ETIMEDOUT '+'x'.repeat(3000)})).join('\n')+'\n')
 const second=await collect('logs',undefined,{offset:first.nextOffset});assert.ok(second.items.every(row=>JSON.parse(row.content).durationMs<30));assert.ok(second.items.every(row=>!first.items.some(old=>old.content===row.content)))
 await writeFile(file,'2026-11-17T09:00:00Z error ETIMEDOUT durationMs=3200 elapsedMs=3300\n')
 const fresh=await createLocalEvidence({paths})('logs'),fields=JSON.parse(fresh.items[0].content);assert.equal(fields.timestamp,'2026-11-17T09:00:00.000Z');assert.equal(fields.durationMs,3200);assert.equal(fields.elapsedMs,3300)
 assert.equal(JSON.parse(first.items[0].content).timestamp,new Date(base+9).toISOString())
})
test('newest logs are selected beyond the first 256 directory entries',async t=>{
 const {paths}=await fixture(t)
 await Promise.all(Array.from({length:280},async(_,i)=>{const file=join(paths.logs,'old-'+String(i).padStart(3,'0')+'.log');await writeFile(file,'SQLITE_BUSY\n');await utimes(file,1,1)}))
 await writeFile(join(paths.logs,'zz-current.log'),'2026-11-17T09:00:00Z ETIMEDOUT durationMs=999\n')
 const result=await createLocalEvidence({paths})('logs');assert.ok(result.items.some(row=>JSON.parse(row.content).durationMs===999))
})
test('opened handle rejects a parent junction swapped after realpath without reading private bytes',async t=>{
 const {root}=await fixture(t),privateDir=join(root,'data/private'),target=join(root,'src/file.js');await mkdir(privateDir);await writeFile(target,'PUBLIC');await writeFile(join(privateDir,'file.js'),'PRIVATE')
 let swapped=false,reads=0
 const reader=await mockedReader(t,{lstat:async path=>{if(path===target&&!swapped){swapped=true;await rename(join(root,'src'),join(root,'original-src'));await symlink(privateDir,join(root,'src'),process.platform==='win32'?'junction':'dir')}return fs.lstat(path)},open:async(...args)=>{const fd=await fs.open(...args),read=fd.read.bind(fd);fd.read=(...args)=>{reads++;return read(...args)};return fd}})
 await assert.rejects(reader.readEvidenceFile(root,target,100),{code:'FEEDBACK_EVIDENCE_SCOPE'});assert.equal(swapped,true);assert.equal(reads,0)
})
test('short reads accumulate to a full hash; premature EOF cannot masquerade as complete source',async t=>{
 const {root}=await fixture(t),target=join(root,'src/file.js'),content='short-read-fixture-'.repeat(10);await writeFile(target,content);let premature=false,reads=0
 const reader=await mockedReader(t,{open:async(...args)=>{const fd=await fs.open(...args),read=fd.read.bind(fd);let count=0;fd.read=(buffer,offset,length,position)=>{reads++;if(premature&&count++)return Promise.resolve({bytesRead:0,buffer});return read(buffer,offset,Math.min(length,7),position)};return fd}})
 const result=await reader.readEvidenceFile(root,target,1000);assert.equal(result.text,content);assert.ok(reads>1);assert.equal(result.sha256,createHash('sha256').update(content).digest('hex'))
 premature=true;await assert.rejects(reader.readEvidenceFile(root,target,1000),{code:'FEEDBACK_EVIDENCE_CHANGED'})
})
test('an unreadable subtree and a rotated log preserve other evidence and expose coverage gaps',async t=>{
 const {root,paths}=await fixture(t),blocked=join(root,'src/blocked'),rotating=join(paths.logs,'rotating.log');await mkdir(blocked);await writeFile(join(root,'src/ok.js'),'MARKER');await writeFile(rotating,'SQLITE_BUSY');await writeFile(join(paths.logs,'ok.log'),'ETIMEDOUT');let rotated=false
 const reader=await mockedReader(t,{opendir:async path=>{if(path===blocked)throw Object.assign(new Error('private permission text'),{code:'EACCES'});return fs.opendir(path)},lstat:async path=>{if(path===rotating&&!rotated){rotated=true;await rm(path)}return fs.lstat(path)}})
 const collect=reader.createLocalEvidence({paths}),source=await collect('code_search',undefined,{query:'MARKER'}),logs=await collect('logs')
 assert.equal(source.items.length,1);assert.equal(source.complete,false);assert.ok(source.skipped>0);assert.ok(logs.skipped>0);assert.match(logs.items[0].content,/ETIMEDOUT/);assert.doesNotMatch(JSON.stringify([source,logs]),/private permission/)
})

test('parallel tool pages share one source scan and one immutable log snapshot',async t=>{
 const {root,paths}=await fixture(t),source=join(root,'src/concurrent.js'),log=join(paths.logs,'concurrent.log')
 await writeFile(source,('// PARALLEL_MARKER'+String.fromCharCode(10)).repeat(40));await writeFile(log,Array.from({length:20},(_,durationMs)=>JSON.stringify({message:'ETIMEDOUT',durationMs})).join(String.fromCharCode(10)))
 const started=Promise.withResolvers(),release=Promise.withResolvers(),opens=new Map()
 const reader=await mockedReader(t,{open:async(path,...args)=>{opens.set(path,(opens.get(path)??0)+1);started.resolve();await release.promise;return fs.open(path,...args)}})
 const collect=reader.createLocalEvidence({paths}),pending=Promise.all([
  collect('code_search',undefined,{query:'PARALLEL_MARKER'}),collect('code_search',undefined,{query:'PARALLEL_MARKER',offset:20}),
  collect('logs',undefined,{query:'ETIMEDOUT'}),collect('logs',undefined,{query:'ETIMEDOUT',offset:10})
 ])
 await started.promise;release.resolve();const [first,second,logs,nextLogs]=await pending
 assert.equal(opens.get(source),1);assert.equal(opens.get(log),1)
 assert.equal(first.items[0].line,1);assert.equal(second.items[0].line,21);assert.equal(JSON.parse(logs.items[0].content).durationMs,0);assert.equal(JSON.parse(nextLogs.items[0].content).durationMs,10)
})
