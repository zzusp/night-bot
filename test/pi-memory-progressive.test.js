import test from 'node:test'
import assert from 'node:assert/strict'
import Memory from '../src/memory/service.js'
import {apply} from '../src/memory/tools.js'
import {reflectionInput} from '../src/memory/reflection-input.js'

const fixture=()=>{
 const memory=Object.create(Memory.prototype),scope={kind:'bot',id:'test'}
 memory.scope=async()=>scope;memory.binding=async()=>({actorId:'alice'});memory.recallSources=new WeakMap();memory.contexts=new WeakMap();memory.provenance=()=>null
 const calls=[],actor={};memory.recordUsage=async(...args)=>calls.push(['usage',...args])
 const entry={id:'one',key:'style',subject:{kind:'context'},context:{subject:{kind:'context'},evidence:[{quote:'SOURCE_ONLY'}],background:{quote:'SOURCE_ONLY',messageId:'original'}},origins:[{taskId:'original'}],originSource:{messageId:'original'},text:'BODY_ONLY'}
 memory.store={index:async(_scope,args)=>{calls.push(['index',args]);return {revision:1,entries:[{id:entry.id,key:entry.key,title:'Reports',path:'categories/preferences/entries/style.md',summary:'When writing reports, use concise text.',subject:entry.subject}]}},read:async(_scope,args)=>{calls.push(['read',args]);return {revision:1,entries:[entry]}}}
 const tools=new Map();apply({memory,tools:{register:tool=>tools.set(tool.name,tool)}})
 return {memory,calls,actor,tools}
}
test('public recall loads root, topic descriptors, exact entry, then explicitly saved sources',async()=>{
 const {tools,actor,calls}=fixture(),read=tools.get('memory_read')
 const root=await read.execute({},{agent:actor});assert.equal(root.stage,'root-index');assert.equal(calls.length,1);assert.match(root.markdown,/\[Reports\]\(categories\/preferences\/entries\/style.md\)/);assert.doesNotMatch(root.markdown,/scopeToken|revision|BODY_ONLY/);assert.equal(read.output.render({},root)[0].text,root.markdown)
 const index=await read.execute({topic:'preferences'},{agent:actor});assert.equal(index.stage,'filtered-index');assert.equal(index.entries[0].applicability.status,'context-dependent');assert.doesNotMatch(JSON.stringify(index),/BODY_ONLY|SOURCE_ONLY/);assert.equal(calls.length,2)
 const detail=await read.execute({topic:'preferences',key:'style'},{agent:actor});assert.equal(detail.entries[0].text,'BODY_ONLY');assert.doesNotMatch(JSON.stringify(detail),/SOURCE_ONLY|origins|originSource/);assert.equal(calls[2][1].includeSources,false)
 const sources=await read.execute({topic:'preferences',key:'style',includeSources:true},{agent:actor});assert.match(JSON.stringify(sources),/SOURCE_ONLY/);assert.equal(sources.includeSources,true)
})
test('reflection preserves completion evidence and limits with original event ID and excludes changed task context',()=>{
 const event={id:'completion',result:{summary:'Done',evidence:['Verified test'],limitations:['No live delivery']},requirementRevision:1,controlRevision:1,contextRevision:0,runSequence:1}
 const task={taskId:'task',request:'Original request',objective:'Bounded objective',requirementRevision:1,controlRevision:1,contextRevision:0,runSequence:1}
 const input=reflectionInput(task,event)
 assert.deepEqual(input.facts[0].evidence,['Verified test']);assert.deepEqual(input.facts[0].limitations,['No live delivery']);assert.equal(input.facts[0].id,event.id);assert.equal(input.facts[0].request,task.request)
 const changed=reflectionInput({...task,requirementRevision:2,request:'Later request'},event);assert.equal(changed.facts[0].request,undefined);assert.equal(changed.coverage.taskContext,'unavailable-version-mismatch')
 const legacy=reflectionInput({...task,completion:{commandId:'later',result:{summary:'Wrong result'}}},{id:'old',commandId:'old'})
 assert.equal(legacy.facts[0].summary,'completed')
})
test('reflection marks truncation and rejects source secrets beyond the displayed prefix',()=>{
 const input=reflectionInput({taskId:'t'},{id:'e',result:{summary:'x'.repeat(2500),evidence:Array(10).fill('Observed'),limitations:['Bounded']}})
 assert.ok(input.coverage.truncatedFields.includes('completion.summary'));assert.equal(input.coverage.omittedCounts['completion.evidence'],2)
 assert.throws(()=>reflectionInput({taskId:'t'},{id:'e',result:{summary:'x'.repeat(2500)+' password: hidden'}}),{code:'MEMORY_SECRET_REFUSED'})
})

test('index descriptor applicability is reprojected for the current actor without opening a body',async()=>{
 const {memory,actor}=fixture()
 let subjects=[{actor:'alice-hash',messageId:'alice-source'}]
 memory.bindRecallSources(actor,async()=>subjects)
 const result={entries:[{key:'preference',subject:{kind:'actor',actor:'alice-hash'}}]}
 const own=await memory.recallResult(actor,result);assert.equal(own.entries[0].applicability.status,'matching-subject');assert.deepEqual(own.entries[0].applicability.sourceMessageIds,['alice-source'])
 subjects=[{actor:'bob-hash',messageId:'bob-source'}]
 const other=await memory.recallResult(actor,own);assert.equal(other.entries[0].applicability.status,'reference-only');assert.deepEqual(other.entries[0].applicability.sourceMessageIds,[])
})


test('public explicit literal-index search maps to descriptor lookup, not body scanning',async()=>{
 const {memory,actor,tools}=fixture();let options
 memory.store.search=async(_scope,args)=>{options=args;return {revision:1,mode:'literal-index',entries:[]}}
 const result=await tools.get('memory_search').execute({query:'test',mode:'literal-index'},{agent:actor})
 assert.equal(result.mode,'literal-index');assert.equal(options.mode,'index')
})

test('public progressive recall opens only the requested Markdown layers',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {MarkdownMemoryStore}=await import('../src/memory/store.js'),{memoryScope}=await import('../src/memory/scope.js'),{buildMemoryContext}=await import('../src/memory/format.js')
 const root=await mkdtemp(join(tmpdir(),'progressive-recall-')),reads=[],store=new MarkdownMemoryStore(root,{onRead:name=>reads.push(name)}),scope=memoryScope({actorId:'alice'})
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const context=buildMemoryContext({scenario:'When writing reports',boundaries:['Only the requesting actor'],background:{source:'message',quote:'SOURCE_ONLY'}},{actor:scope.actor,message:{id:'original',content:'SOURCE_ONLY'}})
 await store.remember(scope,{topic:'preferences',key:'reports',text:'Concise reports',context,source:{sessionId:'s',messageId:'original'}})
 await store.remember(scope,{topic:'facts',key:'unrelated',text:'Unrelated fact',source:{sessionId:'s',messageId:'other'}})
 const {memory,actor,tools}=fixture();memory.scope=async()=>scope;memory.store=store
 const read=tools.get('memory_read');reads.length=0
 await read.execute({},{agent:actor});assert.ok(reads.includes('index.md'));assert.ok(!reads.some(name=>name.startsWith('categories/')||name.startsWith('sources/')||name==='candidates.md'))
 reads.length=0;await read.execute({topic:'preferences'},{agent:actor});assert.deepEqual(reads.filter(name=>name.startsWith('categories/')),[]);assert.ok(!reads.some(name=>name.startsWith('sources/')))
 reads.length=0;const detail=await read.execute({topic:'preferences',key:'reports'},{agent:actor});assert.equal(detail.entries[0].text,'Concise reports');assert.deepEqual(reads.filter(name=>name.includes('/entries/')),['categories/preferences/entries/reports.md']);assert.ok(!reads.some(name=>name.startsWith('sources/')));assert.doesNotMatch(JSON.stringify(detail),/SOURCE_ONLY/)
 reads.length=0;const source=await read.execute({topic:'preferences',key:'reports',includeSources:true},{agent:actor});assert.equal(source.entries[0].context.background.quote,'SOURCE_ONLY');assert.equal(reads.filter(name=>name.startsWith('sources/')).length,1)
})

test('matching completed context includes effective requirements and latest instruction, not supplement history',()=>{
 const task={taskId:'t',requirementRevision:2,controlRevision:1,contextRevision:3,runSequence:1,request:'Current brief',requirements:['Current requirement'],currentInput:{text:'Latest scoped change'},supplements:[{text:'Obsolete scope'}]}
 const event={id:'done',requirementRevision:2,controlRevision:1,contextRevision:3,runSequence:1,result:{summary:'Done'}}
 const input=reflectionInput(task,event)
 assert.deepEqual(input.facts[0].requirements,['Current requirement']);assert.equal(input.facts[0].latestInstruction,'Latest scoped change');assert.doesNotMatch(JSON.stringify(input),/Obsolete scope/)
 const stale=reflectionInput({...task,requirementRevision:3},event);assert.equal(stale.facts[0].latestInstruction,undefined);assert.equal(stale.facts[0].requirements,undefined)
})
