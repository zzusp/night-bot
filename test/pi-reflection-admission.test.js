import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {reflectionAdmission,admitReflectionLessons,recallReflectionIndex} from '../src/memory/reflection-admission.js'
import {hash} from '../src/memory/format.js'
import {memoryHost,initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {memoryScope} from '../src/memory/scope.js'

const choice=(action,key,expectedRevision=0)=>({action,key,expectedRevision,category:'Interrupted writes with durable receipts',boundaries:'Original authorized effect only; receipt absence is not proof of non-execution',when:'When a saved output is interrupted',changes:'Read the existing receipt instead of repeating the write',reason:'Verified evidence distinguishes an unknown effect from failure'})
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
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:{...base.memory,category:undefined}}]},admission),{code:'REFLECTION_ADMISSION_USE_REQUIRED'});
 assert.throws(()=>admitReflectionLessons({lessons:[{...base,memory:{...base.memory,boundaries:undefined}}]},admission),{code:'REFLECTION_ADMISSION_USE_REQUIRED'});
 assert.deepEqual(admitReflectionLessons({lessons:[]},admission),[]);
});

test('index selection loads only requested details and fails closed on unknown ids, stale revisions or changed installed content',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-admission-index-'));t.after(()=>rm(root,{recursive:true,force:true}));let reads=0,stage=0;
 const skillPath=join(root,'skills','existing-rule','SKILL.md'),skillText='---\nname: existing-rule\ndescription: Receipt recovery is already covered\n---\nINSTALLED_RULE_BODY';await mkdir(join(root,'skills','existing-rule'),{recursive:true});await writeFile(skillPath,skillText);
 const entries=[{id:'m',topic:'experience',key:'canonical',revision:1,summary:'Read receipts'},{id:'unrelated',topic:'facts',key:'other',revision:1,summary:'Other topic'}];
 const entry={...entries[0],text:'SELECTED_BODY',source:{messageId:'event'},provenance:{taskId:'task'}};
 const owner={host:{runtimePaths:{skills:join(root,'skills'),installRoot:root},memory:{store:{index:async()=>({revision:4,entries}),read:async()=>{reads++;return {revision:4,entries:[entry]}}}}}};
 const initial={skills:{},reviews:{[hash('event')]:{eventId:'event',taskId:'task',lessons:[{memoryKey:'canonical'}]}}};
 const result=await reflectionAdmission(owner,{},initial,{facts:[]},async(input,prompt)=>{if(prompt){assert.equal(reads,0);assert.ok(!JSON.stringify(input).includes('SELECTED_BODY'));assert.ok(!JSON.stringify(input).includes('INSTALLED_RULE_BODY'));assert.equal(input.catalog.installed[0].description,'Receipt recovery is already covered');stage++;return JSON.stringify({refs:[input.catalog.memories[0].ref,input.catalog.installed[0].ref]})}assert.equal(reads,1);assert.equal(input.details.memories[0].writable,true);assert.ok(JSON.stringify(input).includes('SELECTED_BODY'));assert.ok(JSON.stringify(input).includes('INSTALLED_RULE_BODY'));return '{"lessons":[]}'});
 assert.equal(stage,1);assert.equal(result.index.revision,4);assert.equal(await readFile(skillPath,'utf8'),skillText);
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async(input,prompt)=>{assert.ok(prompt);await writeFile(skillPath,skillText+' changed');return JSON.stringify({refs:[input.catalog.installed[0].ref]})}),{code:'REFLECTION_ADMISSION_INSTALLED_CHANGED'});await writeFile(skillPath,skillText);
 await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>JSON.stringify({refs:[],deferred:true})),{code:'REFLECTION_ADMISSION_DEFERRED'});
 for(const raw of ['not JSON','{\"refs\":[999]}','{\"refs\":[\"1\"]}','{\"refs\":[1,1]}'])await assert.rejects(reflectionAdmission(owner,{},initial,{},async()=>raw),{code:'REFLECTION_ADMISSION_SELECTION_INVALID'});
 owner.host.memory.store.read=async()=>({revision:5,entries:[entry]});await assert.rejects(reflectionAdmission(owner,{},initial,{},async input=>JSON.stringify({refs:[input.catalog.memories[0].ref]})),{code:'MEMORY_SCOPE_CHANGED'});

});

test('an index reference from another page cannot resolve to the current row',async()=>{
 const catalog={memories:[{id:'first',summary:'a'},{id:'second',summary:'b'}],skills:[],installed:[]};let previousRef,calls=0
 await assert.rejects(recallReflectionIndex(catalog,{},async input=>{
  const [row]=input.catalog.memories;calls++
  if(calls===1){previousRef=row.ref;return JSON.stringify({refs:[row.ref]})}
  return JSON.stringify({refs:[previousRef]})
 },input=>input.catalog.memories.length<=1),{code:'REFLECTION_ADMISSION_SELECTION_INVALID'})
 assert.equal(calls,2)
})

async function completed(store,root,id){let seq=0;const command=(kind,args)=>store.command({id:id+'-'+(++seq),kind,args});await command('task.create',{taskId:id,request:'Recover an interrupted local write',ownerActorId:'owner'});await initializeMemoryTaskWorkspace(store,root,id);const binding=(await command('task.claim',{taskId:id})).result.binding;return (await command('task.complete',{binding,summary:'The receipt confirmed the original write; no repeat was needed'})).completionEvent}

test('real Host updates an alias into original memory/Skill identities, preserves provenance/supports and skip leaves active Skill intact',async t=>{
 let f,store,mode='new';t.after(async()=>{await f?.close();await store?.close()});
 f=await memoryHost(t,body=>{if(!JSON.stringify(body.messages).includes('NIGHT_BOT_TASK_REFLECTION'))return;
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),old=input.details.memories.find(m=>m.key==='receipt-check'),prior=input.details.skills.find(s=>s.key==='receipt-method');
  const lesson={...learned(input,mode==='new'?'receipt-check':'alias-proposal'),memory:['skip','special'].includes(mode)?{action:'skip',reason:mode==='special'?'Only this task name/path and a temporary result; no transferable conclusion':'Existing coverage is enough'}:choice(old?'update':'new','receipt-check',old?.revision??0),skillDecision:['skip','special'].includes(mode)?{action:'skip'}:choice(prior?'update':'new','receipt-method',prior?.revision??0),skill:{guidance:'Check the original receipt and scope before deciding whether a retry is safe',reason:'Committed task evidence',applicability:'Interrupted writes with retained receipts',evidenceBacked:true}};
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
 mode='special';await completed(store,f.host.ctx.runtimePaths.workspaces,'one-off');f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle();assert.equal(Object.values((await f.host.ctx.reflection.state(scope)).reviews).find(r=>r.taskId==='one-off').status,'skipped');assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,rows);assert.deepEqual((await f.host.ctx.reflection.state(scope)).skills,state.skills);
 assert.doesNotMatch(rows[0].text,/first|second|one-off/);assert.equal(Object.values(state.reviews).find(r=>r.taskId==='second').lessons[0].admission.memory.category,'Interrupted writes with durable receipts');
 const policyFor=marker=>f.requests.flatMap(request=>request.messages??[]).find(message=>message.role==='system'&&typeof message.content==='string'&&message.content.includes(marker))?.content??'';
 const memoryPolicy=policyFor('NIGHT_BOT_TASK_REFLECTION'),skillPolicy=policyFor('NIGHT_BOT_SKILL_GENERATION');
 assert.match(memoryPolicy,/同一事实能从权威、稳定来源可靠重查/);
 assert.match(memoryPolicy,/能翻到旧任务不是跳过经验的理由/);
 assert.match(memoryPolicy,/标明日期|按日期|另记日期/);
 assert.match(skillPolicy,/不是使用 Skill 的前置读物/);
 assert.match(skillPolicy,/情况不同怎么选以及如何验证结果/);
});

test('a concurrent learned catalog change fences the old plan and allows fresh admission',async t=>{
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
 state=await owner.state(scope);assert.equal(state.reviews[hash(event.id)].status,'done');assert.equal(state.reviews[hash(event.id)].attempts,2);assert.deepEqual(state.skills['router-owned'],originalSkills['router-owned']);assert.equal(state.skills['race-method'].revision,1);assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries.map(row=>[row.key,row.revision]),[['race-memory',1]]);
});

test('large indexes and long descriptors are fully scanned; late matches update canonical scenarios within request budgets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-admission-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const entries=Array.from({length:190},(_,i)=>({id:'m'+i,topic:'experience',key:'entry-'+i,revision:2,summary:('Unrelated scenario '+i+' ').repeat(28)}));
 entries.push({id:'late',topic:'experience',key:'receipt-scenario',revision:2,summary:'TARGET_RECEIPT: interrupted writes with durable receipts'});
 entries.push({id:'long',topic:'experience',key:'long-scenario',revision:1,summary:'Other information. '.repeat(1800)+'TAIL_MATCH: receipt readback boundary'});
 assert.ok(entries.length>80);assert.ok(Buffer.byteLength(JSON.stringify(entries))>16000);
 const seen=new Map();let pages=0,detailReads=0;
 const owner={host:{runtimePaths:{skills:join(root,'skills'),installRoot:root},memory:{store:{index:async()=>({revision:4,entries}),read:async(_scope,{key})=>{detailReads++;const {summary,...entry}=entries.find(e=>e.key===key);return {revision:4,entries:[{...entry,text:'Existing class of interrupted writes with receipt evidence',source:{messageId:'prior-event'},provenance:{taskId:'prior-task'}}]}}}}}};
 const initial={skills:{},reviews:{[hash('prior-event')]:{eventId:'prior-event',taskId:'prior-task',lessons:entries.map(e=>({memoryKey:e.key}))}}};
 const view=await reflectionAdmission(owner,{},initial,{eventId:'new-event',facts:[{id:'new-event',summary:'Receipt verified a committed effect after interruption'}]},async(input,prompt)=>{
  assert.ok(JSON.stringify(input).length<=18000);
  if(prompt){
   pages++;assert.equal(detailReads,0);
   for(const row of input.catalog.memories)seen.set(row.id,(seen.get(row.id)??'')+row.summary)
   const ids=[...new Set(input.catalog.memories.filter(row=>row.summary.includes('TARGET_RECEIPT')||row.summary.includes('TAIL_MATCH')).map(row=>row.ref))];
   return JSON.stringify({refs:ids});
  }
  assert.equal(input.indexScanComplete,true);assert.equal(input.existing.memories.length,2);assert.equal(input.details.memories.length,2);
  return JSON.stringify({lessons:[{...learned({eventId:'new-event'},'task-specific-alias'),memory:choice('update','receipt-scenario',2),skillDecision:{action:'skip',reason:'One reusable conclusion is sufficient'}}]});
 },{fits:input=>JSON.stringify(input).length<=18000});
 assert.ok(pages>1);assert.equal(seen.size,entries.length);for(const row of entries)assert.equal(seen.get(row.id),row.summary.trim());assert.equal(detailReads,2);
 const [lesson]=admitReflectionLessons(JSON.parse(view.raw),view);assert.equal(lesson.memoryKey,'receipt-scenario');assert.equal(lesson.admission.expectedMemoryId,'late');
 assert.match(lesson.howToApply,/适用类别：Interrupted writes with durable receipts/);assert.match(lesson.howToApply,/触发条件：When a saved output is interrupted/);assert.match(lesson.howToApply,/必要边界：Original authorized effect only/);assert.equal(lesson.admission.memory.when,'When a saved output is interrupted');assert.match(lesson.admission.memory.boundaries,/not proof of non-execution/);
});


test('more than seven relevant details survive selection and adaptive detail merging at different model capacities',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-admission-many-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const entries=Array.from({length:12},(_,i)=>({id:'match-'+i,topic:'experience',key:'scenario-'+i,revision:2,summary:'Related receipt recovery boundary '+i}));
 for(const capacity of [9000,250000]){
  const read=new Set(),seenBodies=new Set(),seenSkills=new Set();let summaries=0,merges=0;
  const owner={host:{runtimePaths:{skills:join(root,'skills'),installRoot:root},memory:{store:{index:async()=>({revision:8,entries}),read:async(_scope,{key})=>{const entry=entries.find(e=>e.key===key);read.add(key);return {revision:8,entries:[{...entry,text:('BODY_'+entry.id+' ').repeat(450),source:{messageId:'old'},provenance:{taskId:'old-task'}}]}}}}}};
  const initial={skills:Object.fromEntries(Array.from({length:10},(_,i)=>['method-'+i,{revision:3,origin:'task-reflection',active:true,applicability:'Receipt recovery related boundary '+i,body:('SKILL_BODY_'+i+' ').repeat(180),supports:[]}])),reviews:{[hash('old')]:{eventId:'old',taskId:'old-task',lessons:entries.map(e=>({memoryKey:e.key}))}}};
  const fits=input=>JSON.stringify(input).length<=capacity;
  const view=await reflectionAdmission(owner,{},initial,{eventId:'new'},async(input,prompt)=>{
   assert.ok(fits(input));
   if(prompt?.includes('NIGHT_BOT_REFLECTION_SELECT'))return JSON.stringify({refs:[...new Set([...input.catalog.memories,...input.catalog.skills].map(e=>e.ref))]});
   if(prompt?.includes('NIGHT_BOT_REFLECTION_DETAILS')){
    summaries++;if(input.parts.some(part=>typeof part==='string'))merges++;for(const entry of entries)if(JSON.stringify(input.parts).includes('BODY_'+entry.id))seenBodies.add(entry.id);for(let i=0;i<10;i++)if(JSON.stringify(input.parts).includes('SKILL_BODY_'+i))seenSkills.add('method-'+i);
    return JSON.stringify({notes:'Preserve receipt boundary; canonical scenario-11 revision 2 and method-9 revision 3, task-reflection writable. Existing original receipt evidence must precede retries. '+ 'Boundary must stay evidence backed. '.repeat(30),uncertain:false});
   }
   assert.equal(read.size,12);
   if(capacity===9000){assert.equal(input.detailsSummarized,true);assert.equal(seenBodies.size,12);assert.equal(seenSkills.size,10)}else {assert.equal(input.details.memories.length,12);assert.equal(input.details.skills.length,10)};
   return JSON.stringify({lessons:[{...learned({eventId:'new'}),memory:choice('update','scenario-11',2),skillDecision:choice('update','method-9',3),skill:{guidance:'Read original receipt evidence before retries; preserve the existing authorization boundary',reason:'Verified effect',applicability:'Interrupted writes with durable receipts',evidenceBacked:true}}]});
  },{fits});
  assert.equal(view.details.memories.length,12);assert.equal(view.details.skills.length,10);const accepted=admitReflectionLessons(JSON.parse(view.raw),view)[0];assert.equal(accepted.memoryKey,'scenario-11');assert.equal(accepted.key,'method-9');assert.equal(summaries>0,capacity===9000);assert.equal(merges>0,capacity===9000);
 }
});

test('uncertain detail reduction fails closed rather than inferring novelty from a partial view',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-admission-uncertain-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const row={id:'m',topic:'experience',key:'receipt',revision:1,summary:'Related'};
 const owner={host:{runtimePaths:{skills:join(root,'skills'),installRoot:root},memory:{store:{index:async()=>({revision:1,entries:[row]}),read:async()=>({revision:1,entries:[{...row,text:'Boundary '.repeat(2000)}]})}}}};
 for(const reduction of [{notes:'Cannot retain required boundary',uncertain:true},{notes:'same '.repeat(800),uncertain:false}])await assert.rejects(reflectionAdmission(owner,{},{skills:{},reviews:{}},{},async(input,prompt)=>prompt.includes('NIGHT_BOT_REFLECTION_SELECT')?JSON.stringify({refs:[input.catalog.memories[0].ref]}):JSON.stringify(reduction),{fits:input=>JSON.stringify(input).length<8000}),{code:'REFLECTION_ADMISSION_DEFERRED'});
});
