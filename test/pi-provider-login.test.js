import test from 'node:test'
import assert from 'node:assert/strict'
import {piLoginMethods,piLoginNotice,piLoginPrompt,registerPiLoginFlows} from '../src/pi-provider-login.js'
const provider={id:'test-provider',name:'Test',auth:{oauth:{name:'OAuth',loginLabel:'Account'},apiKey:{name:'API key',login:()=>{}}}}
test('native sign-in methods preserve OAuth and key support without inventing an OpenAI device id',()=>{
 assert.deepEqual(piLoginMethods(provider),[{id:'oauth',label:'Account'},{id:'api-key',label:'API key'}]);assert.deepEqual(piLoginMethods({...provider,id:'openai'}),[{id:'api-key',label:'API key'}])
})
test('native login forwards device code, URL, secret/select/manual prompts and prompt abort signal',async()=>{
 const registered=[],notifications=[],prompts=[],controller=new AbortController();let login,selected
 const models={setProvider:p=>{selected=p},login:async(id,type,options)=>{login={id,type,signal:options.signal};options.notify({type:'device_code',verificationUri:'https://invalid.example/verify',userCode:'fixture-code'});options.notify({type:'auth_url',url:'https://invalid.example/login'});await options.prompt({type:'secret',message:'Key',signal:controller.signal});await options.prompt({type:'select',message:'Account',options:[{label:'Fixture',value:'fixture'}]});await options.prompt({type:'manual_code',message:'Code',signal:controller.signal})}}
 registerPiLoginFlows({authorization:{registerFlow:f=>registered.push(f)}},{},{providers:[provider],makeModels:()=>models});assert.equal(registered[0].key,'llm-pi-ai/test-provider');await registered[0].run({method:'oauth',signal:controller.signal,notify:n=>notifications.push(n),prompt:async p=>{prompts.push(p);return'fixture'}});assert.equal(selected,provider);assert.equal(login.type,'oauth');assert.equal(login.signal,controller.signal);assert.equal(notifications[0].code,'fixture-code');assert.equal(notifications[1].url,'https://invalid.example/login');assert.deepEqual(prompts.map(p=>p.kind),['secret','select','text']);assert.equal(prompts[0].signal,controller.signal)
})
test('login display conversion does not expose absent fields or lose notices',()=>{
 assert.deepEqual(piLoginNotice({type:'info',message:'Info',links:[{url:'https://invalid.example/first'},{url:'https://invalid.example/second'}]}),{message:'Info',url:'https://invalid.example/first'});assert.deepEqual(piLoginPrompt({type:'secret',message:'Key',placeholder:'prefix'}),{kind:'secret',message:'Key',placeholder:'prefix'})
})
