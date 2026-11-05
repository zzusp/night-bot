import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import {TOOL_RUNTIME_SCHEDULER} from '../packages/capability-compat/tools/index.js'
import NativeTools from '../src/native-tools.js'
const tool=(name,execute=async args=>args)=>({name,description:name,parameters:{type:'object',additionalProperties:true},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute})
async function fixture(t){const ctx=new Context();ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0});new NativeTools(ctx);t.after(()=>ctx.fiber.dispose());let call=0;return{ctx,run:(name,args={},extra={})=>ctx.tools.execute({callId:'call-'+ ++call,name,arguments:args,signal:new AbortController().signal,...extra})}}
test('native registry restrictions intersect inherited capabilities without hiding scope-owned submission tools',async t=>{
 const h=await fixture(t);h.ctx.tools.register(tool('global'));const parent={},child={},p=createScope(h.ctx,parent),c=createScope(h.ctx,child,{parent});p.ctx.tools.register(tool('inherited'));c.ctx.tools.restrict({allow:['global']});c.ctx.tools.register(tool('submit'));assert.deepEqual(c.ctx.tools.schemas(child).map(t=>t.name),['global','submit']);assert.equal(c.ctx.tools.get('inherited',child),undefined);assert.throws(()=>c.ctx.tools.restrict({allow:['submit']}),/unknown/);await c.dispose();await p.dispose()
})
test('native monotonic guard applies after permissive middleware and prevents hidden/unknown side effects with audit',async t=>{
 const h=await fixture(t);let effects=0;const seen=[];h.ctx.tools.register(tool('write',async()=>{effects++;return{ok:true}}));h.ctx.on('tools/pre-execute',(_exec,_next)=>({kind:'allow'}));h.ctx.tools.guard(exec=>exec.name==='write'?'role_denied':undefined);h.ctx.on('tools/result',(exec,result)=>seen.push({name:exec.name,result}));const denied=await h.run('write');assert.equal(denied.isError,true);assert.equal(denied.error.message,'role_denied');const unknown=await h.run('unknown');assert.equal(unknown.error.info.code,'UNKNOWN_TOOL');assert.equal(effects,0);assert.equal(seen.length,2);assert.ok(Object.isFrozen(seen[0].result))
})
test('native execution drains a started body before recording cancellation and never invokes an already cancelled body',async t=>{
 const h=await fixture(t),entered=Promise.withResolvers(),gate=Promise.withResolvers();let effects=0;h.ctx.tools.register(tool('slow',async()=>{effects++;entered.resolve();await gate.promise;return{finished:true}}));const controller=new AbortController(),pending=h.run('slow',{}, {signal:controller.signal});await entered.promise;controller.abort();let ended=false;pending.then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);gate.resolve();const result=await pending;assert.equal(result.error.info.code,'ABORTED');assert.equal(effects,1);const before=await h.run('slow',{}, {signal:controller.signal});assert.equal(before.error.info.code,'ABORTED_BEFORE_DISPATCH');assert.equal(effects,1)
})
test('native output contract validates body and post-policy values and isolates observers',async t=>{
 const h=await fixture(t);h.ctx.tools.register({...tool('typed'),output:{schema:{type:'object',required:['ok'],properties:{ok:{type:'boolean'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:String(value.ok)}]}});h.ctx.on('tools/result',()=>{throw new Error('observer cannot replace outcome')});assert.equal((await h.run('typed',{ok:true})).isError,false);assert.equal((await h.run('typed',{wrong:true})).error.info.code,'INVALID_TOOL_OUTPUT');h.ctx.on('tools/post-execute',(_exec,_result,_next)=>({kind:'accept',value:{wrong:true}}));assert.equal((await h.run('typed',{ok:true})).error.info.code,'INVALID_TOOL_OUTPUT')
})
test('native staged scheduler preserves deferred contexts, turn completion, projection, post-policy and final content order',async t=>{
 const h=await fixture(t),order=[];h.ctx.tools.register({...tool('complete',async(args,exec)=>{exec.deferContext({source:{kind:'tool'},content:[{type:'text',text:'context'}]});exec.concludeTurn();return args}),projectContent:()=>{order.push('project');return[{type:'text',text:'projected'}]},finalizeContent:()=>{order.push('finalize');return[{type:'text',text:'final'}]}});h.ctx.on('tools/post-execute',(_exec,result,next)=>{order.push('post');assert.equal(result.content[0].text,'projected');return next()});const scheduler=h.ctx.tools[TOOL_RUNTIME_SCHEDULER],prepared=await scheduler.prepare({callId:'staged',name:'complete',arguments:{ok:true},signal:new AbortController().signal}),body=await scheduler.dispatch(prepared.exec),result=await scheduler.finalize(prepared.exec,body.result);assert.equal(result.concludesTurn,true);assert.equal(result.additionalContexts.length,1);assert.equal(result.content[0].text,'final');assert.deepEqual(order,['project','post','finalize'])
})
test('native PTC dispatch preserves capability collapse, ordered parallel commits, audit and structured results',async t=>{
 const h=await fixture(t),calls=[],post=[],entered=Promise.withResolvers(),first=Promise.withResolvers(),second=Promise.withResolvers();let started=0
 for(const name of ['first','second'])h.ctx.tools.register({...tool(name,async()=>{if(++started===2)entered.resolve();await(name==='first'?first.promise:second.promise);return{name}}),isConcurrencySafe:()=>true})
 const session={append:(type,data)=>calls.push({type,data})},agent={session},scope=createScope(h.ctx,agent);h.ctx.provide('workingDirectory',{ensure:async()=>'/tmp'});h.ctx.provide('ptcRuntime',{language:'typescript',resolve:request=>request,run:async request=>{const tools=request.bindings[0].functions;const values=await Promise.all([tools.first({}),tools.second({})]);return{logs:['executed'],value:values}}});scope.ctx.tools.presentAs('ptc');h.ctx.on('tools/post-execute',(exec,_result,next)=>{post.push(exec.name);return next()})
 const denied=await h.run('first',{}, {agent});assert.equal(denied.error.info.code,'UNKNOWN_TOOL');assert.equal(started,0)
 const pending=h.run('run_code',{description:'Execute two safe checks',code:'isolated fake runtime'}, {agent});await entered.promise;second.resolve();await Promise.resolve();assert.deepEqual(post,[]);first.resolve();const result=await pending;assert.equal(result.isError,false,JSON.stringify(result));assert.deepEqual(result.value.result,[{name:'first'},{name:'second'}]);assert.deepEqual(post,['first','second','run_code']);assert.deepEqual(calls.filter(e=>e.type==='tool/ptc-dispatch').map(e=>e.data.name),['first','second']);assert.equal(calls.filter(e=>e.type==='tool/ptc-dispatch-start').length,2);await scope.dispose()
})
test('an early PTC program return drains started effects and rejects queued work without replay',async t=>{
 const h=await fixture(t),gate=Promise.withResolvers(),entered=Promise.withResolvers(),returned=Promise.withResolvers(),outcomes=[];let effects=0,queued=0
 h.ctx.tools.register(tool('slow',async()=>{effects++;entered.resolve();await gate.promise;return{done:true}}));h.ctx.tools.register(tool('queued',async()=>{queued++;return{done:true}}));const session={append:()=>{}},agent={session},scope=createScope(h.ctx,agent);h.ctx.provide('workingDirectory',{ensure:async()=>'/tmp'});h.ctx.provide('ptcRuntime',{language:'typescript',resolve:request=>request,run:async request=>{const tools=request.bindings[0].functions;void tools.slow({});await entered.promise;void tools.queued({});returned.resolve();return{logs:[],value:'program ended'}}});scope.ctx.tools.presentAs('ptc');h.ctx.on('tools/result',(exec,result)=>outcomes.push({name:exec.name,result}));const pending=h.run('run_code',{description:'End while a tool drains',code:'fake'}, {agent});await returned.promise;let ended=false;pending.then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);gate.resolve();const result=await pending;assert.equal(result.isError,false,JSON.stringify(result));assert.equal(effects,1);assert.equal(queued,0);assert.equal(outcomes.find(e=>e.name==='slow').result.error.info.code,'ABORTED');await scope.dispose()
})
test('PTC calls cannot expose capabilities removed by a child restriction and fail closed without a runtime',async t=>{
 const h=await fixture(t);h.ctx.tools.register(tool('allowed'));h.ctx.tools.register(tool('hidden'));const agent={session:{append:()=>{}}},scope=createScope(h.ctx,agent);scope.ctx.tools.restrict({allow:['allowed']});scope.ctx.tools.presentAs('ptc');assert.throws(()=>scope.ctx.tools.wireSchemas(agent),/ptcRuntime/);h.ctx.provide('workingDirectory',{ensure:async()=>'/tmp'});h.ctx.provide('ptcRuntime',{language:'python',resolve:request=>request,run:async request=>{assert.equal(request.bindings[0].functions.hidden,undefined);assert.ok(request.bindings[0].functions.allowed);return{logs:[],value:{literal:'must remain an object'}}}});assert.deepEqual(scope.ctx.tools.wireSchemas(agent).schemas.map(t=>t.name),['run_code']);const result=await h.run('run_code',{description:'Check restricted API',code:'fake'}, {agent});assert.equal(result.isError,false,JSON.stringify(result));assert.ok(result.content[0].text.includes('"literal"'));await scope.dispose()
})
test('disposing one duplicate guard registration never removes another active permission boundary',async t=>{
 const h=await fixture(t);let effects=0;h.ctx.tools.register(tool('write',async()=>{effects++;return{ok:true}}));const guard=()=> 'still_denied',one=h.ctx.tools.guard(guard),two=h.ctx.tools.guard(guard);one();assert.equal((await h.run('write')).error.message,'still_denied');assert.equal(effects,0);two();assert.equal((await h.run('write')).isError,false);assert.equal(effects,1)
})
test('a collapsed direct capability cannot run its content finalizer to hide the denial',async t=>{
 const h=await fixture(t);let finalized=0;h.ctx.tools.register({...tool('write'),finalizeContent:()=>{finalized++;return[{type:'text',text:'forged success'}]}});const agent={},scope=createScope(h.ctx,agent);scope.ctx.tools.presentAs('ptc');const result=await h.run('write',{}, {agent});assert.equal(result.error.info.code,'UNKNOWN_TOOL');assert.equal(finalized,0);assert.ok(!result.content[0].text.includes('forged success'));await scope.dispose()
})
test('invalid admission and post-policy decisions fail closed without forging successful effects',async t=>{
 const h=await fixture(t);let effects=0;h.ctx.tools.register(tool('write',async()=>{effects++;return{ok:true}}));const stop=h.ctx.on('tools/pre-execute',()=>({kind:'invalid'}));assert.equal((await h.run('write')).isError,true);assert.equal(effects,0);stop();h.ctx.on('tools/post-execute',()=>({kind:'invalid'}));assert.equal((await h.run('write')).isError,true);assert.equal(effects,1)
})
test('validated output values retain identity from post-policy to the final immutable audit snapshot',async t=>{
 const h=await fixture(t);h.ctx.tools.register(tool('value'));let post,observed;h.ctx.on('tools/post-execute',(_exec,result,next)=>{post=result.value;return next()});h.ctx.on('tools/result',(_exec,result)=>{observed=result});const result=await h.run('value',{nested:{ok:true}});assert.equal(result.value,post);assert.equal(result,observed);assert.ok(Object.isFrozen(result.value.nested))
})
test('an execution wrapper cannot replace away the original caller cancellation',async t=>{
 const h=await fixture(t),entered=Promise.withResolvers(),gate=Promise.withResolvers(),original=new AbortController(),replacement=new AbortController();let signal
 h.ctx.tools.register(tool('slow',async(_args,exec)=>{signal=exec.signal;entered.resolve();await gate.promise;return{done:true}}));h.ctx.on('tools/execute',(exec,next)=>{exec.signal=replacement.signal;return next()});const pending=h.run('slow',{}, {signal:original.signal});await entered.promise;original.abort({kind:'user'});assert.equal(signal.aborted,true);assert.equal(replacement.signal.aborted,false);gate.resolve();assert.equal((await pending).error.info.code,'ABORTED')
})
test('tool failures with hostile Error getters still settle one auditable error result',async t=>{
 const {HarnessError}=await import('../packages/capability-compat/llm/index.js'),h=await fixture(t);h.ctx.tools.register(tool('bad',async()=>{const error=new HarnessError('original','CODE');Object.defineProperty(error,'code',{get(){throw new Error('getter failed')}});throw error}));const result=await h.run('bad');assert.equal(result.isError,true);assert.equal(result.error.message,'original')
})
test('a journal flush failure prevents tool and wrapper effects before dispatch',async t=>{
 const h=await fixture(t);let body=0,wrapper=0;h.ctx.provide('sessions',{flush:async()=>{throw new Error('journal commit uncertain')}});h.ctx.tools.register(tool('write',async()=>{body++;return{ok:true}}));h.ctx.on('tools/execute',(_exec,next)=>{wrapper++;return next()});const result=await h.run('write',{}, {agent:{session:{}}});assert.equal(result.isError,true);assert.equal(body,0);assert.equal(wrapper,0);assert.ok(result.error.message.includes('journal'))
})
test('cancellation during the durable intent barrier never reaches an execution wrapper',async t=>{
 const h=await fixture(t),entered=Promise.withResolvers(),gate=Promise.withResolvers(),controller=new AbortController();let effects=0;h.ctx.provide('sessions',{flush:async()=>{entered.resolve();await gate.promise}});h.ctx.tools.register(tool('write'));h.ctx.on('tools/execute',(_exec,next)=>{effects++;return next()});const pending=h.run('write',{}, {agent:{session:{}},signal:controller.signal});await entered.promise;controller.abort();gate.resolve();const result=await pending;assert.equal(result.error.info.code,'ABORTED_BEFORE_DISPATCH');assert.equal(effects,0)
})
test('code audit failure aborts admission and still drains all started effects and outstanding audit work',async t=>{
 const h=await fixture(t),entered=Promise.withResolvers(),one=Promise.withResolvers(),two=Promise.withResolvers(),failed=Promise.withResolvers(),auditEntered=Promise.withResolvers(),auditGate=Promise.withResolvers();let effects=0,phase
 h.ctx.provide('sessions',{flush:async()=>{if(phase==='one'){failed.resolve();throw new Error('audit disk failed')}if(phase==='two'){auditEntered.resolve();await auditGate.promise}}})
 for(const [name,gate]of [['one',one],['two',two]])h.ctx.tools.register({...tool(name,async()=>{if(++effects===2)entered.resolve();await gate.promise;return{done:true}}),isConcurrencySafe:()=>true})
 const agent={session:{append:(type,data)=>{if(type==='tool/ptc-dispatch')phase=data.name}}},scope=createScope(h.ctx,agent);h.ctx.provide('workingDirectory',{ensure:async()=>'/tmp'});h.ctx.provide('ptcRuntime',{language:'typescript',resolve:request=>request,run:async request=>({logs:[],value:await Promise.all([request.bindings[0].functions.one({}),request.bindings[0].functions.two({})])})});scope.ctx.tools.presentAs('ptc');const pending=h.run('run_code',{description:'Drain failed audit safely',code:'fake'},{agent});await entered.promise;one.resolve();await failed.promise;two.resolve();await auditEntered.promise;let ended=false;pending.then(()=>{ended=true});await Promise.resolve();assert.equal(ended,false);auditGate.resolve();const result=await pending;assert.equal(result.isError,true);assert.ok(result.error.message.includes('audit'));assert.equal(effects,2);await scope.dispose()
})
test('code result rendering preserves shallow JSON formatting and handles deeply nested JSON with bounded indentation',async t=>{
 const h=await fixture(t);let value={literal:'must not be treated as a renderer marker',items:[1,{ok:true}]};const agent={session:{append:()=>{}}},scope=createScope(h.ctx,agent);h.ctx.provide('workingDirectory',{ensure:async()=>'/tmp'});h.ctx.provide('ptcRuntime',{language:'typescript',resolve:request=>request,run:async()=>({logs:[],value})});scope.ctx.tools.presentAs('ptc');const shallow=await h.run('run_code',{description:'Render structured result',code:'fake'},{agent});assert.equal(shallow.content[0].text,JSON.stringify(value,null,2));value='leaf';for(let i=0;i<10000;i++)value={child:value};const deep=await h.run('run_code',{description:'Render deep structured result',code:'fake'},{agent});assert.equal(deep.isError,false);assert.ok(deep.content[0].text.length<110000);assert.ok(deep.content[0].text.includes('leaf'));await scope.dispose()
})
test('structured error facts are read once before the final audit snapshot',async t=>{
 const {HarnessError}=await import('../packages/capability-compat/llm/index.js'),h=await fixture(t);let reads=0;h.ctx.tools.register(tool('bad',async()=>{const error=new HarnessError('fact','CODE');Object.defineProperty(error,'code',{get(){if(++reads>1)throw new Error('read twice');return'CODE'}});throw error}));const result=await h.run('bad');assert.equal(result.error.info.code,'CODE');assert.equal(reads,1)
})
test('raw tool parameter contracts reject invalid calls before durable and wrapper effects',async t=>{
 const h=await fixture(t);let body=0,wrappers=0,flushes=0
 h.ctx.provide('sessions',{flush:async()=>{flushes++}})
 h.ctx.tools.register({...tool('raw',async()=>{body++;return{ok:true}}),parameters:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}})
 h.ctx.on('tools/execute',(_exec,next)=>{wrappers++;return next()})
 const rejected=await h.run('raw',{count:'not integer'},{agent:{session:{}}})
 assert.equal(rejected.error.info.code,'INVALID_ARGS');assert.equal(body,0);assert.equal(wrappers,0);assert.equal(flushes,0)
 assert.equal((await h.run('raw',{count:2},{agent:{session:{}}})).isError,false)
 assert.equal(body,1);assert.equal(wrappers,1);assert.equal(flushes,1)
 assert.throws(()=>h.ctx.tools.register({...tool('unsupported'),parameters:{type:'object',minimum:1}}),/unsupported JSON schema/)
 assert.throws(()=>h.ctx.tools.register({...tool('nonobject'),parameters:{type:'string'}}),/object-rooted/)
})
test('registered contracts are detached from author mutations and immutable on the Pi wire',async t=>{
 const h=await fixture(t),definition={...tool('stable'),parameters:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}}
 h.ctx.tools.register(definition);assert.equal(h.ctx.tools.get('stable'),definition);definition.parameters.properties.name.type='number';definition.output.schema.type='string'
 const wire=h.ctx.tools.wireSchemas().schemas[0]
 assert.equal(wire.parameters.properties.name.type,'string')
 assert.throws(()=>{wire.parameters.properties.name.type='number'},TypeError)
 assert.equal((await h.run('stable',{name:'captured'})).isError,false)
 assert.equal((await h.run('stable',{name:7})).error.info.code,'INVALID_ARGS')
})
test('middleware cannot replace the admitted tool identity, owner, parent, or argument snapshot',async t=>{
 const h=await fixture(t);let effects=0
 h.ctx.tools.register(tool('allowed',async()=>{effects++;return{ok:true}}));h.ctx.tools.register(tool('other',async()=>{effects++;return{wrong:true}}))
 for(const [key,value]of [['name','other'],['agent',{}],['callId','forged'],['rootCallId','forged'],['parent',{}],['arguments',{forged:true}],['token',Symbol('forged')]]) {
  const stop=h.ctx.on('tools/execute',(exec,next)=>{exec[key]=value;return next()})
  const result=await h.run('allowed');assert.equal(result.isError,true,key);assert.equal(effects,0,key);stop()
 }
 assert.equal((await h.run('allowed')).isError,false);assert.equal(effects,1)
})
test('raw core pagination bounds and task list constraints fail before wrappers and effects',async t=>{
 const h=await fixture(t);let effects=0,wrappers=0
 h.ctx.tools.register({...tool('bounded',async()=>{effects++;return{ok:true}}),parameters:{type:'object',properties:{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000},executionIds:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'string',minLength:1,maxLength:10}}},additionalProperties:false}})
 h.ctx.on('tools/execute',(_exec,next)=>{wrappers++;return next()})
 for(const args of [{offset:-1},{limit:0},{limit:16001},{executionIds:[]},{executionIds:['a','a']},{executionIds:['a','b','c']},{executionIds:['']}]) {
  assert.equal((await h.run('bounded',args)).error.info.code,'INVALID_ARGS',JSON.stringify(args))
  assert.equal(effects,0);assert.equal(wrappers,0)
 }
 assert.equal((await h.run('bounded',{offset:0,limit:16000,executionIds:['a','b']})).isError,false)
 assert.equal(effects,1);assert.equal(wrappers,1)
})
test('static argument rejection preserves correction feedback without entering tool code or effect wrappers',async t=>{
 const h=await fixture(t);let body=0,wrappers=0,flushes=0,observed
 h.ctx.provide('sessions',{flush:async()=>{flushes++}})
 const rejection={status:'invalid-arguments',issues:[{field:'taskIds',code:'task_ids_invalid',message:'Use explicit task ids'}],nextAction:'correct-arguments'}
 h.ctx.tools.register({...tool('domain',async()=>{body++;return{ok:true}}),parameters:{type:'object',properties:{taskIds:{type:'array',minItems:1,items:{type:'string'}}},required:['taskIds'],additionalProperties:false},argumentRejection:rejection})
 rejection.issues[0].code='mutated_after_registration'
 h.ctx.on('tools/execute',(_exec,next)=>{wrappers++;return next()})
 h.ctx.on('tools/result',(_exec,result)=>{observed=result})
 const result=await h.run('domain',{}, {agent:{session:{}}})
 assert.equal(result.isError,false);assert.equal(result.value.status,'invalid-arguments');assert.equal(result.value.issues[0].code,'task_ids_invalid');assert.equal(result,observed)
 assert.equal(body,0);assert.equal(wrappers,0);assert.equal(flushes,0);assert.ok(Object.isFrozen(result.value.issues[0]))
 assert.equal((await h.run('domain',{taskIds:['one']},{agent:{session:{}}})).isError,false)
 assert.equal(body,1);assert.equal(wrappers,1);assert.equal(flushes,1)
 const stop=h.ctx.tools.guard(()=> 'request_scope_denied')
 const denied=await h.run('domain',{});assert.equal(denied.isError,true);assert.equal(denied.error.message,'request_scope_denied');stop()
})
test('argument rejection accepts static typed refusal values and cannot install callbacks or success receipts',async t=>{
 const h=await fixture(t)
 for(const rejection of [()=>({status:'invalid-arguments',issues:[{code:'x'}]}),Promise.resolve({}),{status:'accepted',issues:[{code:'x'}]},{status:'invalid-arguments',issues:[]},{status:'invalid-arguments',issues:[{}]}])assert.throws(()=>h.ctx.tools.register({...tool('bad-template'),argumentRejection:rejection}),TypeError)
 assert.throws(()=>h.ctx.tools.register({...tool('typed-template'),output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},render:()=>[]},argumentRejection:{status:'invalid-arguments',issues:[{code:'invalid'}]}}),/output contract/)
})
test('static rejection still enters post-policy and preserves cancellation without dispatch effects',async t=>{
 const h=await fixture(t),controller=new AbortController();let effects=0,post=0
 h.ctx.tools.register({...tool('correction',async()=>{effects++;return{ok:true}}),parameters:{type:'object',properties:{name:{type:'string'}},required:['name']},argumentRejection:{status:'invalid-arguments',issues:[{code:'name_required'}],nextAction:'correct-arguments'}})
 h.ctx.on('tools/post-execute',(_exec,result,next)=>{post++;assert.equal(result.value.status,'invalid-arguments');controller.abort();return next()})
 const result=await h.run('correction',{}, {signal:controller.signal})
 assert.equal(post,1);assert.equal(effects,0);assert.equal(result.error.info.code,'ABORTED_BEFORE_DISPATCH')
})
