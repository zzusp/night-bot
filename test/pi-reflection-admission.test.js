import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {reflectionAdmission,admitReflectionLessons} from '../src/memory/reflection-admission.js'
import {hash} from '../src/memory/format.js'
import {memoryHost,initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {memoryScope} from '../src/memory/scope.js'

const choice=(action,key,expectedRevision=0)=>({action,key,expectedRevision,when:'When a saved output is interrupted',changes:'Read the existing receipt instead of repeating the write',reason:'Verified evidence distinguishes an unknown effect from failure'})
const learned=(input,key='receipt-check')=>({key,summary:'Inspect the saved receipt before retrying an interrupted write',why:'The old effect can already be committed',howToApply:'After an interrupted write, inspect the original receipt before acting',evidenceIds:[input.eventId]})
const plan=()=>({index:{revision:4,entries:[{id:'m',key:'canonical',topic:'experience',revision:2}]},details:{memories:[{id:'m',key:'canonical',topic:'experience',revision:2,writable:true}],skills:[{key:'canonical-skill',origin:'task-reflection',revision:3}]},catalog:{reservedMemoryKeys:[],reservedSkillKeys:[],skills:[{key:'canonical-skill',revision:3}]},skillsHash:'fingerprint'})

test('admission distinguishes independent skip/update/new decisions, requires usefulness and never aliases a target',()=>{
 const admission=plan(),base={...learned({eventId:'e'}),memory:choice('update','canonical',2),skillDecision:{action:'skip',reason:'One conclusion is enough'}};
 const updated=admitReflectionLessons({lessons:[base]},admission)[0];assert.equal(updated.memoryKey,'canonical');assert.equal(updated.skill,undefined);assert.equal(updated.admission.expectedMemoryId,'m');
 const skill={guidance:'Observe the receipt, assess uncertainty, then choose the authorized action',reason:'Bounded evidence',applicability:'Interrupted local writes',evidenceBacked:true};
 const both=admitReflectionLessons({lessons:[{...base,key:'different-new-name',skill,skillDecision:choice('update','canonical-skill',3)}]},admission)[0];assert.equal(both.key,'canonical-skill');assert.equal(both.memoryKey,'canonical');
 assert.deepEqual(admitReflectionLessons({lessons:[{...base,memory:{action:'skip'},skill,skillDecision:choice('new','unused-skill')}]},admission),[],'no fabricated experience merely to support a skill');
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:choice('new','canonical')}]},admission),{code:'REFLECTION_ADMISSION_TARGET_CONFLICT'});
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:choice('update','unread',1)}]},admission),{code:'REFLECTION_ADMISSION_TARGET_FORBIDDEN'});
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:choice('update','canonical',1)}]},admission),{code:'REFLECTION_ADMISSION_TARGET_FORBIDDEN'});
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:{...base.memory,changes:''}}]},admission),{code:'MEMORY_TEXT_INVALID'});
 for(const origin of ['router','installed']){const view=plan();view.details.skills[0].origin=origin;assert.throws(()=>admitReflectionLessons({lessons:[{...base,skill,skillDecision:choice('update','canonical-skill',3)}]},view),{code:'REFLECTION_ADMISSION_TARGET_FORBIDDEN'})}
 const foreign=plan();foreign.details.memories[0].writable=false;assert.throws(()=>admitReflectionLessons({lessons:[base]},foreign),{code:'REFLECTION_ADMISSION_TARGET_FORBIDDEN'});
 assert.equal(admitReflectionLessons({lessons:[{...base,memory:choice('new','new-useful')}]},admission)[0].memoryKey,'new-useful');
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:choice('new','canonical-2')}]},admission),{code:'REFLECTION_ADMISSION_TARGET_CONFLICT'});
 assert.deepEqual(admitReflectionLessons({lessons:[]},admission),[]);
});

test('index selection loads only bounded requested details and fails closed on unknown ids, stale revisions or oversized catalogs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-admission-index-'));t.after(()=>rm(root,{recursive:true,force:true}));let reads=0,stage=0;
 const skillPath=join(root,'skills','existing-rule','SKILL.md'),skillText='---\nname: existing-rule\ndescription: Receipt recovery is already covered\n---\nINSTALLED_RULE_BODY';await mkdir(join(root,'skills','existing-rule'),{recursive:true});await writeFile(skillPath,skillText);
 const entries=[{id:'m',topic:'experience',key:'canonical',revision:1,summary:'Read receipts'},{id:'unrelated',topic:'facts',key:'other',revision:1,summary:'Other topic'}];
 const entry={...entries[0],text:'SELECTED_BODY',source:{messageId:'event'},provenance:{taskId:'task'}};
 const owner={host:{runtimePaths:{skills:join(root,'skills'),installRoot:root},memory:{store:{index:async()=>({revision:4,entries}),read:async()=>{reads++;return {revision:4,entries:[entry]}}}}}};
 const initial={skills:{},reviews:{[hash('event')]:{eventId:'event',taskId:'task',lessons:[{memoryKey:'canonical'}]}}};
 const result=await reflectionAdmission(owner,{},initial,{facts:[]},async(input,prompt)=>{if(prompt){assert.equal(reads,0);assert.ok(!JSON.stringify(input).includes('SELECTED_BODY'));assert.ok(!JSON.stringify(input).includes('INSTALLED_RULE_BODY'));assert.equal(input.catalog.installed[0].description,'Receipt recovery is already covered');stage++;return JSON.stringify({memoryIds:['m'],skillKeys:[],installedIds:[input.catalog.installed[0].id]})}assert.equal(reads,1);assert.equal(input.details.memories[0].writable,true);assert.ok(JSON.stringify(input).includes('SELECTED_BODY'));assert.ok(JSON.stringify(input).includes('INSTALLED_RULE_BODY'));return '{"lessons":[]}'});
 assert.equal(stage,1);assert.equal(result.index.revision,4);assert.equal(await readFile(skillPath,'utf8'),skillText);
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async(input,prompt)=>{assert.ok(prompt);await writeFile(skillPath,skillText+' changed');return JSON.stringify({memoryIds:[],skillKeys:[],installedIds:[input.catalog.installed[0].id]})}),{code:'REFLECTION_ADMISSION_INSTALLED_CHANGED'});await writeFile(skillPath,skillText);
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>JSON.stringify({memoryIds:[],skillKeys:[],installedIds:[],deferred:true})),{code:'REFLECTION_ADMISSION_DEFERRED'});
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>JSON.stringify({memoryIds:['forged'],skillKeys:[],installedIds:[]})),{code:'REFLECTION_ADMISSION_SELECTION_INVALID'});
 owner.host.memory.store.read=async()=>({revision:5,entries:[entry]});await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>JSON.stringify({memoryIds:['m'],skillKeys:[],installedIds:[]})),{code:'MEMORY_SCOPE_CHANGED'});
 owner.host.memory.store.index=async()=>({revision:5,entries:Array.from({length:81},(_,i)=>({id:String(i),topic:'experience',key:'entry-'+i,revision:1}))});
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>{throw Error('catalog must not be sent')}),{code:'REFLECTION_ADMISSION_CATALOG_LIMIT'});
});

async function completed(store,root,id){let seq=0;const command=(kind,args)=>store.command({id:id+'-'+(++seq),kind,args});await command('task.create',{taskId:id,request:'Recover an interrupted local write',ownerActorId:'owner'});await initializeMemoryTaskWorkspace(store,root,id);const binding=(await command('task.claim',{taskId:id})).result.binding;return (await command('task.complete',{binding,summary:'The receipt confirmed the original write; no repeat was needed'})).completionEvent}

test('real Host updates an alias into original memory/Skill identities, preserves provenance/supports and skip leaves active Skill intact',async t=>{
 let f,store,mode='new';t.after(async()=>{await f?.close();await store?.close()});
 f=await memoryHost(t,body=>{if(!JSON.stringify(body.messages).includes('NIGHT_BOT_TASK_REFLECTION'))return;
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),old=input.details.memories.find(m=>m.key==='receipt-check'),prior=input.details.skills.find(s=>s.key==='receipt-method');
  const lesson={...learned(input,mode==='new'?'receipt-check':'alias-proposal'),memory:mode==='skip'?{action:'skip',reason:'Existing coverage is enough'}:choice(old?'update':'new','receipt-check',old?.revision??0),skillDecision:mode==='skip'?{action:'skip'}:choice(prior?'update':'new','receipt-method',prior?.revision??0),skill:{guidance:'Check the original receipt and scope before deciding whether a retry is safe',reason:'Committed task evidence',applicability:'Interrupted writes with retained receipts',evidenceBacked:true}};
  return {text:JSON.stringify({lessons:[lesson]})};
 });
 store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'admission.sqlite'),instanceId:'admission',initialize:true});
 await completed(store,f.host.ctx.runtimePaths.workspaces,'first');const detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach);await f.host.ctx.reflection.whenIdle();
 const scope=memoryScope({actorId:'owner'}),original=(await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries[0];assert.equal(original.revision,1);
 mode='update';await completed(store,f.host.ctx.runtimePaths.workspaces,'second');f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle();
 const rows=(await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries;assert.equal(rows.length,1);assert.equal(rows[0].id,original.id);assert.equal(rows[0].revision,2);assert.equal(rows[0].originSource.messageId,original.source.messageId);assert.ok(rows[0].origins.some(origin=>origin.taskId==='first'));
 const state=await f.host.ctx.reflection.state(scope),skill=state.skills['receipt-method'];assert.equal(skill.revision,2);assert.equal(skill.supports.length,2);assert.ok(skill.active);assert.deepEqual(Object.keys(state.skills),['receipt-method']);
 const creatorCalls=f.requests.filter(body=>JSON.stringify(body).includes('NIGHT_BOT_SKILL_GENERATION')).length;
 mode='skip';await completed(store,f.host.ctx.runtimePaths.workspaces,'third');f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle();
 const after=await f.host.ctx.reflection.state(scope);assert.deepEqual(after.skills,state.skills);assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,rows);assert.equal(Object.values(after.reviews).find(r=>r.taskId==='third').status,'skipped');assert.equal(f.requests.filter(body=>JSON.stringify(body).includes('NIGHT_BOT_SKILL_GENERATION')).length,creatorCalls);
});

test('a concurrent learned catalog revision fences a prepared new plan and retry cannot bypass it',async t=>{
 let f,store;const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(async()=>{release.resolve();await f?.close();await store?.close()});
 f=await memoryHost(t,body=>{if(!JSON.stringify(body.messages).includes('NIGHT_BOT_TASK_REFLECTION'))return;
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content);
  return {text:JSON.stringify({lessons:[{...learned(input,'race-proposal'),memory:choice('new','race-memory'),skillDecision:choice('new','race-method'),skill:{guidance:'Read the original receipt before retrying an uncertain effect',reason:'Supplied evidence',applicability:'Interrupted writes',evidenceBacked:true}}]})};
 });
 store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'race.sqlite'),instanceId:'race',initialize:true});
 const event=await completed(store,f.host.ctx.runtimePaths.workspaces,'race'),owner=f.host.ctx.reflection,scope=memoryScope({actorId:'owner'}),generate=owner.generateSkill.bind(owner);
 owner.generateSkill=async(input,options)=>{if(input.key==='race-method'){entered.resolve();await release.promise}return generate(input,options)};
 const detach=owner.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach);await entered.promise;
 await owner.mutateSkill(scope,{action:'upsert',key:'router-owned',operationId:'concurrent-router',expectedRevision:0,source:{sessionId:'router',messageId:'new-rule',actor:scope.actor,quoteSha256:hash('new-rule')},steps:['Keep existing evidence','Check the required scope'],reason:'Current authorized source',applicability:'Current Router rule'});
 const originalSkills=(await owner.state(scope)).skills;release.resolve();await owner.whenIdle();
 let state=await owner.state(scope);assert.deepEqual(state.skills,originalSkills);assert.equal(state.reviews[hash(event.id)].code,'REFLECTION_REVISION_CONFLICT');assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,[]);
 state.reviews[hash(event.id)].retryAt=0;const {atomicWrite}=await import('../src/runtime/files.js');await atomicWrite(join(owner.directory(scope),'state.json'),JSON.stringify(state));owner.scan();await owner.whenIdle();
 state=await owner.state(scope);assert.ok(['REFLECTION_REVISION_CONFLICT','MEMORY_SCOPE_CHANGED'].includes(state.reviews[hash(event.id)].code));assert.deepEqual(state.skills,originalSkills);assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,[]);
});
