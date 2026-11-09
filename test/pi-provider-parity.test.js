import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as NativeProvider from '../src/native-pi-provider.js'
import {builtinProviders,getBuiltinModels} from '@earendil-works/pi-ai/providers/all'
async function host(plugin,providers,t){const ctx=new Context();await ctx.plugin(plugin,{providers});t.after(()=>ctx.fiber.dispose());return ctx}
test('native provider advertises the pinned Pi SDK catalog and preserves model context and input modalities',async t=>{
 const declarations=Object.fromEntries(builtinProviders().filter(provider=>getBuiltinModels(provider.id).length).map(provider=>[provider.id,{}])),native=await host(NativeProvider,declarations,t)
 let checked=0
 for(const provider of Object.keys(declarations)){
  const models=getBuiltinModels(provider)
  assert.deepEqual(await native.nativeModelRoutes.listModels(provider),models.map(model=>({provider,id:model.id,name:model.name,inputModalities:[...model.input]})))
  for(const model of models){
   const info=await native.nativeModelRoutes.describeModel(provider,model.id)
   assert.equal(info.provider,provider);assert.equal(info.id,model.id)
   assert.deepEqual(info.context,{contextWindow:model.contextWindow})
   assert.deepEqual(info.inputModalities,model.input)
   assert.ok(Number.isSafeInteger(info.context.contextWindow)&&info.context.contextWindow>0)
   if(!model.reasoning)assert.equal(info.reasoning,undefined)
   checked++
  }
 }
 assert.ok(checked>500);t.diagnostic(JSON.stringify({catalogProviders:Object.keys(declarations).length,piModelsValidated:checked,requestsSent:0}))
})
test('declared model controls, reasoning and retry limits are resolved directly without provider I/O',async t=>{
 const providers={fixture:{api:'openai-completions',baseURL:'https://invalid.example/v1',reasoning:'high',retry:{enabled:false,maxRetries:0,provider:{maxRetries:0}},models:[{id:'m',contextWindow:4096,maxTokens:99,reasoningEfforts:{off:null,low:'low',high:'high'},compat:{supportsDeveloperRole:true}}]}},native=await host(NativeProvider,providers,t)
 const selection=await native.nativeModelRoutes.validateSelection({provider:'fixture',model:'m'});assert.deepEqual(selection,{provider:'fixture',model:'m',reasoningEffort:'high'})
 const info=await native.nativeModelRoutes.describeModel('fixture','m');assert.deepEqual(info.context,{contextWindow:4096});assert.deepEqual(info.inputModalities,['text']);assert.equal(info.defaultMaxTokens,99)
 const direct=await native.nativePiProvider.official.resolve({provider:'fixture',model:'m'});assert.equal(direct.retrySettings.enabled,false);assert.equal(direct.retrySettings.provider.maxRetries,0)
 await assert.rejects(native.nativeModelRoutes.validateSelection({provider:'fixture',model:'m',reasoningEffort:'unconfigured'}),error=>error.code==='UNSUPPORTED_REASONING_EFFORT')
})
