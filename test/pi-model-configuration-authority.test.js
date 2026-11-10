import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {createHost} from '../src/host.js'
import {loadConfig} from '../src/config.js'
import {openNativeDomains} from '../src/native-domain.js'
import {openNativeModelSelection,configuredModelSelection} from '../src/native-state.js'

const run=promisify(execFile),cli=fileURLToPath(new URL('../bin/night-bot-config.js',import.meta.url))
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-model-authority-')),file=join(root,'data/config/config.json');let host
 await mkdir(join(root,'data/config'),{recursive:true})
 const config={installRoot:root,dataDir:'data',model:{provider:'fixture',model:'current',reasoningEffort:'high'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'AUTHORITY_FIXTURE_KEY',models:['current','legacy','cli-next'].map(id=>({id,reasoningEfforts:{off:null,low:'low',high:'high'}}))}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false}
 await writeFile(file,JSON.stringify(config,null,2)+'\n',{mode:0o600})
 const facility=await openNativeDomains({root:join(root,'data/state/storage')}),legacy=await openNativeModelSelection(facility,config.model)
 await legacy.saveSelection({provider:'fixture',model:'legacy',reasoningEffort:'low'});await facility.closeAll()
 const legacyPath=join(root,'data/state/storage/night_model_selection.json'),legacyBytes=await readFile(legacyPath,'utf8')
 t.after(async()=>{try{await host?.close()}finally{await rm(root,{recursive:true,force:true})}})
 return {root,file,config,legacyPath,legacyBytes,get host(){return host},read:async()=>JSON.parse(await readFile(file,'utf8')),
  async boot(){host=await createHost(await loadConfig(file),{environmentOptions:{inherited:{}}});return host},async close(){await host?.close();host=undefined}}
}

test('file-backed Host uses saved config instead of legacy selection and Web/CLI saves survive cold startup',async t=>{
 const f=await fixture(t);await f.boot()
 assert.deepEqual(f.host.ctx.agentDefaultModel.currentSelection(),f.config.model)
 const view=await f.host.ctx.operatorSettings.view()
 await f.host.ctx.operatorSettings.saveModel({model:'web-next',api:'openai-completions',baseURL:'http://127.0.0.1:9/v2',expectedVersion:view.version})
 assert.deepEqual(f.host.ctx.agentDefaultModel.currentSelection(),f.config.model,'Saved-only Web configuration must not hot-switch live selection')
 await f.close();await f.boot();assert.deepEqual(f.host.ctx.agentDefaultModel.currentSelection(),{provider:'web-model',model:'web-next'})
 await f.close()
 await run(process.execPath,[cli,f.file,'model','--provider','fixture','--model','cli-next'])
 await f.boot();assert.deepEqual(f.host.ctx.agentDefaultModel.currentSelection(),{provider:'fixture',model:'cli-next'})
 assert.equal(await readFile(f.legacyPath,'utf8'),f.legacyBytes,'The old native selection is retained byte-for-byte')
})

test('interactive global selections share config writer, clear omitted effort and survive restart without dual-writing legacy state',async t=>{
 const f=await fixture(t);await f.boot()
 const service=f.host.ctx.agentDefaultModel
 await service.saveSelection({provider:'fixture',model:'current'})
 assert.deepEqual(service.currentSelection(),{provider:'fixture',model:'current'});assert.deepEqual((await f.read()).model,service.currentSelection())
 await Promise.all([service.saveSelection({provider:'fixture',model:'legacy',reasoningEffort:'low'}),service.saveSelection({provider:'fixture',model:'cli-next',reasoningEffort:'high'})])
 assert.deepEqual((await f.read()).model,{provider:'fixture',model:'cli-next',reasoningEffort:'high'})
 await f.close();await f.boot();assert.deepEqual(f.host.ctx.agentDefaultModel.currentSelection(),(await f.read()).model)
 assert.equal(await readFile(f.legacyPath,'utf8'),f.legacyBytes)
})

test('configured model facade preserves known failures and fences an uncertain commit',async()=>{
 const initial={provider:'fixture',model:'current',reasoningEffort:'high'};let failure,body
 const service=configuredModelSelection('/fixture/config.json',initial,{save:async(_file,value)=>{body=value;if(failure)throw failure;return {config:{model:{provider:value.provider,model:value.model,...value.reasoningEffort==='model-default'?{}:{reasoningEffort:value.reasoningEffort}}}}}})
 await assert.rejects(service.saveSelection({provider:'',model:'invalid'}));assert.deepEqual(service.currentSelection(),initial)
 failure=Object.assign(Error('invalid'),{code:'NIGHT_BOT_MODEL_NOT_CONFIGURED'});await assert.rejects(service.saveSelection({provider:'fixture',model:'missing'}),failure);assert.deepEqual(service.currentSelection(),initial)
 failure=undefined;await service.saveSelection({provider:'fixture',model:'next'});assert.equal(body.reasoningEffort,'model-default');assert.deepEqual(service.currentSelection(),{provider:'fixture',model:'next'})
 failure=Object.assign(Error('uncertain'),{code:'NIGHT_WRITE_COMMIT_UNCERTAIN',committed:true});await assert.rejects(service.saveSelection({provider:'fixture',model:'uncertain'}),{code:'NIGHT_BOT_MODEL_SELECTION_UNCERTAIN'});assert.throws(()=>service.currentSelection(),{code:'NIGHT_BOT_MODEL_SELECTION_UNCERTAIN'});await assert.rejects(service.saveSelection(initial),{code:'NIGHT_BOT_MODEL_SELECTION_UNCERTAIN'});await service.close()
})

test('configured model close drains already accepted writes but rejects new ones',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),calls=[]
 const service=configuredModelSelection('/fixture/config.json',{provider:'fixture',model:'initial'},{save:async(_file,value)=>{calls.push(value.model);entered.resolve();await release.promise;return {config:{model:{provider:value.provider,model:value.model}}}}})
 const first=service.saveSelection({provider:'fixture',model:'first'}),second=service.saveSelection({provider:'fixture',model:'second'});await entered.promise
 let drained=false;const close=service.close().then(()=>{drained=true});await assert.rejects(service.saveSelection({provider:'fixture',model:'late'}),{code:'NIGHT_BOT_MODEL_SELECTION_CLOSED'});assert.equal(drained,false)
 release.resolve();await Promise.all([first,second,close]);assert.deepEqual(calls,['first','second']);assert.equal(drained,true)
})
