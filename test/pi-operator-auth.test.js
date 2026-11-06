import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {PassThrough} from 'node:stream'
import {runAuthCommand} from '../src/operator-auth.js'
import {createOperatorInteraction} from '../src/operator-terminal.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
const configFor=root=>({stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{apiKeyEnv:'FIXTURE_OPERATOR_KEY',api:'openai-completions',models:[{id:'m',contextWindow:4096,maxTokens:128}]}}})
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-operator-'));t.after(()=>rm(root,{recursive:true,force:true}));return{root,config:configFor(root),env:createLaunchEnvironmentSnapshot([])}}
test('operator credentials expose metadata only and preserve managed reference changes without opening business state',async t=>{
 const {root,config,env}=await fixture(t),options={environmentSnapshot:env,interaction:{prompt:async()=> 'fixture-secret-never-output'}}
 const saved=await runAuthCommand(config,['set-ref','FIXTURE_OPERATOR_KEY'],options);assert.deepEqual(saved,{reference:'FIXTURE_OPERATOR_KEY',configured:true,source:'file',writable:true})
 const listed=await runAuthCommand(config,['list'],options);assert.equal(listed.references[0].configured,true);assert.ok(listed.flows.some(f=>f.key==='llm-pi-ai/openai'));assert.doesNotMatch(JSON.stringify(listed),/fixture-secret-never-output/)
 assert.deepEqual((await readdir(config.stateDir)).sort(),['credentials.json']);await assert.rejects(readdir(config.workspaceDir),e=>e.code==='ENOENT')
 await runAuthCommand(config,['unset-ref','FIXTURE_OPERATOR_KEY'],options);assert.equal((await runAuthCommand(config,['describe-ref','FIXTURE_OPERATOR_KEY'],options)).configured,false)
})
test('operator login invokes actual Pi API-key flow and logout removes its durable record',async t=>{
 const {config,env}=await fixture(t),options={environmentSnapshot:env,interaction:{notify(){},prompt:async()=> 'fixture-pi-api-key'}}
 assert.equal((await runAuthCommand(config,['login','openai','api-key'],options)).status,'authorized')
 const list=await runAuthCommand(config,['list'],options);assert.equal(list.flows.find(f=>f.key==='llm-pi-ai/openai').credential.configured,true);assert.doesNotMatch(JSON.stringify(list),/fixture-pi-api-key/)
 assert.equal((await runAuthCommand(config,['logout','openai'],options)).configured,false)
})
test('operator rejects extra secret argv, invalid references and inherited overwrite before reading input',async t=>{
 const {config}=await fixture(t);let prompts=0;const options={environmentSnapshot:createLaunchEnvironmentSnapshot([{source:'process',values:{FIXTURE_OPERATOR_KEY:'fixture-readonly'}}]),interaction:{prompt:async()=>{prompts++;throw new Error('must not prompt')}}}
 await assert.rejects(runAuthCommand(config,['set-ref','FIXTURE_OPERATOR_KEY','secret-argv'],options),e=>e.code==='NIGHT_BOT_AUTH_COMMAND_INVALID')
 await assert.rejects(runAuthCommand(config,['set-ref','INVALID/REF'],options),e=>e.code==='NIGHT_BOT_AUTH_COMMAND_INVALID')
 await assert.rejects(runAuthCommand(config,['set-ref','FIXTURE_OPERATOR_KEY'],options),e=>e.code==='NIGHT_BOT_AUTH_REFERENCE_READ_ONLY');assert.equal(prompts,0)
})
test('operator input buffers piped answers, preserves official selection ids and rejects EOF without hanging',async()=>{
 const input=new PassThrough(),output=new PassThrough();let printed='';output.on('data',c=>printed+=c);const i=createOperatorInteraction({input,output});input.end('fixture-hidden\n2\n');await new Promise(r=>setImmediate(r))
 assert.equal(await i.prompt({kind:'secret',message:'Key'}),'fixture-hidden');assert.equal(await i.prompt({kind:'select',message:'Account',options:[{id:'one',label:'One'},{id:'two',label:'Two'}]}),'two');await assert.rejects(i.prompt({kind:'text',message:'Missing'}),e=>e.code==='NIGHT_BOT_AUTH_INPUT_CLOSED');assert.doesNotMatch(printed,/fixture-hidden/);i.close()
})
test('operator terminal hides secret keystrokes including early input and restores raw mode',async()=>{
 const input=new PassThrough(),output=new PassThrough(),modes=[];input.isTTY=output.isTTY=true;input.setRawMode=value=>modes.push(value);output.columns=80;let printed='';output.on('data',c=>printed+=c);const i=createOperatorInteraction({input,output});input.write('early-secret\r');await new Promise(r=>setImmediate(r));assert.equal(await i.prompt({kind:'secret',message:'Key'}),'early-secret');assert.doesNotMatch(printed,/early-secret/);i.close();assert.equal(modes.at(-1),false)
})
test('operator prompt cancellation wakes pending input and leaves no credential mutation',async t=>{
 const {config,env}=await fixture(t),input=new PassThrough(),output=new PassThrough(),controller=new AbortController(),i=createOperatorInteraction({input,output})
 const pending=runAuthCommand(config,['set-ref','FIXTURE_OPERATOR_KEY'],{environmentSnapshot:env,interaction:i,signal:controller.signal});setImmediate(()=>controller.abort());await assert.rejects(pending,e=>e.name==='AbortError');i.close();await assert.rejects(readFile(join(config.stateDir,'credentials.json')),e=>e.code==='ENOENT')
})
async function cli(config,args,input=''){
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['bin/night-bot-auth.js',config,...args],{cwd:new URL('..',import.meta.url),env:process.env,stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('operator CLI timeout'))},10000);let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});child.stdin.end(input)})
}
test('standalone auth CLI stores piped secrets, describes/unsets them and never starts resident/DWS',async t=>{
 const {root,config}=await fixture(t),path=join(root,'config.json');await writeFile(path,JSON.stringify(config));const secret='fixture-cli-secret-never-output';let result=await cli(path,['set-ref','FIXTURE_OPERATOR_KEY'],secret+'\n');assert.equal(result.code,0,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,new RegExp(secret));assert.equal(JSON.parse(result.stdout).configured,true);assert.deepEqual(await readdir(config.stateDir),['credentials.json']);result=await cli(path,['describe-ref','FIXTURE_OPERATOR_KEY']);assert.equal(JSON.parse(result.stdout).configured,true);result=await cli(path,['unset-ref','FIXTURE_OPERATOR_KEY']);assert.equal(JSON.parse(result.stdout).configured,false);result=await cli(path,['set-ref','FIXTURE_OPERATOR_KEY']);assert.equal(result.code,1);assert.match(result.stderr,/NIGHT_BOT_AUTH_INPUT_CLOSED/)
})
