import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
import NativeShell from '../src/native-shell-env.js'
import {scrubbedParentEnv} from '../src/process/contracts.js'
function fixture(t,Impl=NativeShell,options={}){const {environment}=options;const ctx=new Context();if(environment)ctx.provide('launchEnvironment',environment);new Impl(ctx);t.after(()=>ctx.fiber.dispose());return{ctx,registry:ctx.shellEnv}}
const contribution=(name,key,value)=>({name,variables:{[key]:{description:name+' fact'}},resolve:()=>({[key]:value})})
async function contract(t,Impl){const h=fixture(t,Impl),order=[],execution={agent:{session:{header:{id:'literal-session'}}}};h.ctx.provide('profileContext',{name:'fixture-profile',dir:'/fixture/profile'});const a=contribution('alpha','NIGHT_BOT_ALPHA','one'),z=contribution('zulu','NIGHT_BOT_ZULU','two');a.resolve=function(actual){assert.equal(actual,execution);assert.equal(this,a);order.push('alpha');return{NIGHT_BOT_ALPHA:'one'}};z.resolve=()=>{order.push('zulu');return{NIGHT_BOT_ZULU:'two'}};const release=h.registry.register(z);h.registry.register(a);const list=h.registry.list();assert.deepEqual(order,[]);const values=h.registry.collect(execution);assert.ok(Object.isFrozen(values));release();return{list,values,after:h.registry.collect(execution),order}}
test('trusted facts retain deterministic metadata and session identity without a home/profile ABI',async t=>{const result=await contract(t,NativeShell);assert.deepEqual(result.values,{NIGHT_BOT_ALPHA:'one',NIGHT_BOT_SESSION_ID:'literal-session',NIGHT_BOT_SHELL:'1',NIGHT_BOT_ZULU:'two'});assert.deepEqual(result.order,['alpha','zulu','alpha']);assert.deepEqual(result.list.map(row=>row.key),['NIGHT_BOT_ALPHA','NIGHT_BOT_ZULU']);assert.equal(result.after.NIGHT_BOT_ZULU,undefined)})
test('invalid or overlapping declarations fail atomically without reserving earlier keys',t=>{const h=fixture(t);for(const key of ['HOME','NIGHT_BOT_','NIGHT_BOT_lower','NIGHT_BOT_0BAD','NIGHT_BOT_SHELL','NIGHT_BOT_SESSION_ID','DSH_HOME'])assert.throws(()=>h.registry.register(contribution('invalid',key,'bad')));h.registry.register(contribution('owner','NIGHT_BOT_OWNED','yes'));assert.throws(()=>h.registry.register(contribution('owner','NIGHT_BOT_OTHER','bad')),/Duplicate/);assert.throws(()=>h.registry.register({name:'conflict',variables:{NIGHT_BOT_FREE:{description:'first'},NIGHT_BOT_OWNED:{description:'second'}},resolve:()=>({})}),/owned/);h.registry.register(contribution('free','NIGHT_BOT_FREE','good'));assert.equal(h.registry.collect({}).NIGHT_BOT_FREE,'good')})
test('mutable declarations cannot gain reserved authority or leak their original name/key registration',t=>{const h=fixture(t),provider=contribution('original','NIGHT_BOT_EXTRA','safe'),release=h.registry.register(provider);provider.name='changed';provider.variables.NIGHT_BOT_SESSION_ID={description:'spoof'};provider.resolve=()=>({NIGHT_BOT_SESSION_ID:'spoofed'});assert.throws(()=>h.registry.collect({agent:{session:{header:{id:'actual'}}}}),/Undeclared/);assert.equal(h.registry.list()[0].contributor,'original');release();assert.deepEqual(h.registry.list(),[]);h.registry.register(contribution('original','NIGHT_BOT_EXTRA','new'));assert.equal(h.registry.collect({}).NIGHT_BOT_EXTRA,'new')})
test('resolver failures and undeclared/non-string/async output cannot publish a partial environment',t=>{const h=fixture(t),provider=contribution('fixture','NIGHT_BOT_VALUE','ok');h.registry.register(provider);for(const resolve of [()=>{throw new Error('fixture resolver')},()=>({NIGHT_BOT_OTHER:'bad'}),()=>({NIGHT_BOT_VALUE:1}),()=>Promise.resolve({NIGHT_BOT_VALUE:'late'}),()=>Promise.reject(new Error('fixture async resolver'))]){provider.resolve=resolve;assert.throws(()=>h.registry.collect({}))}provider.resolve=()=>({NIGHT_BOT_VALUE:'next'});assert.equal(h.registry.collect({}).NIGHT_BOT_VALUE,'next')})
test('contributor lifetimes are scoped and no profile or ambient home is consulted',async t=>{
 const h=fixture(t),owner={},scope=createScope(h.ctx,owner)
 h.ctx.provide('profileContext',{get name(){throw new Error('old profile ABI must not run')}})
 scope.ctx.shellEnv.register(contribution('scoped','NIGHT_BOT_SCOPED','value'))
 const request={agent:{session:{header:{id:'scope-session'}}}}
 assert.equal(scope.ctx.shellEnv.collect(request).NIGHT_BOT_SESSION_ID,'scope-session')
 assert.equal(h.registry.collect(request).NIGHT_BOT_SCOPED,'value')
 assert.equal(process.env.NIGHT_BOT_SCOPED,undefined)
 await scope.dispose();assert.equal(h.registry.collect(request).NIGHT_BOT_SCOPED,undefined)
})
test('launch-home metadata is ignored and listing never executes a resolver',t=>{
 const env=createLaunchEnvironmentSnapshot([{source:'process',values:{DSH_HOME:'/snapshot/home',DSH_PROFILE:'foreign'}}]),h=fixture(t,NativeShell,{environment:env})
 assert.deepEqual(h.registry.collect({}),{NIGHT_BOT_SHELL:'1'})
 let calls=0
 h.registry.register({name:'metadata',variables:{NIGHT_BOT_META:{description:'metadata only'}},resolve:()=>{calls++;return{NIGHT_BOT_META:'value'}}})
 const listed=h.registry.list();listed[0].description='mutated'
 assert.equal(calls,0);assert.equal(h.registry.list()[0].description,'metadata only')
})

test('ordinary managed children cannot inherit ambient application or retired execution namespaces',t=>{
 const keys=['NIGHT_BOT_SESSION_ID','NIGHT_BOT_EXTRA','DSH_SESSION_ID','DSH_EXTRA'],saved=new Map(keys.map(key=>[key,process.env[key]]))
 t.after(()=>{for(const [key,value] of saved)if(value===undefined)delete process.env[key];else process.env[key]=value})
 for(const key of keys)process.env[key]='ambient-spoof'
 const env=scrubbedParentEnv()
 for(const key of keys)assert.equal(env[key],undefined)
})
