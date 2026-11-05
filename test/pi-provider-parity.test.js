import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm from '../packages/capability-compat/llm/index.js'
import * as OriginalProvider from '@deepseek-ai/dsh-llm-pi-ai'
import * as NativeProvider from '../src/native-pi-provider.js'
import {builtinProviders,getBuiltinModels} from '@earendil-works/pi-ai/providers/all'
async function host(plugin,providers,t){const ctx=new Context();await ctx.plugin(Llm);await ctx.plugin(plugin,{providers});t.after(()=>ctx.fiber.dispose());return ctx}
test('native provider matches original public catalog, model controls and update metadata for every installed chat model',async t=>{
 const declarations=Object.fromEntries(builtinProviders().filter(p=>getBuiltinModels(p.id).length).map(p=>[p.id,{}])),old=await host(OriginalProvider,declarations,t),native=await host(NativeProvider,declarations,t)
 let checked=0
 for(const provider of Object.keys(declarations)){
  assert.deepEqual(await native.llm.listModels(provider),await old.llm.listModels(provider),provider)
  for(const model of getBuiltinModels(provider)){assert.deepEqual(await native.llm.resolveModelInfo(provider,model.id),await old.llm.resolveModelInfo(provider,model.id),provider+'/'+model.id);checked++}
 }
 assert.ok(checked>500);t.diagnostic(JSON.stringify({catalogProviders:Object.keys(declarations).length,modelMetadataCompared:checked,requestsSent:0}))
})
test('declared models, default reasoning and configured output limits match the original prepared-call contract',async t=>{
 const providers={fixture:{api:'openai-completions',baseURL:'https://invalid.example/v1',reasoning:'high',retryPolicy:{mode:'normal',maxRetries:0},models:[{id:'m',maxTokens:99,reasoningEfforts:{off:null,low:'low',high:'high'},compat:{supportsDeveloperRole:true}}]}},old=await host(OriginalProvider,providers,t),native=await host(NativeProvider,providers,t)
 const a=await old.llm.prepareCall({provider:'fixture',model:'m'}),b=await native.llm.prepareCall({provider:'fixture',model:'m'})
 for(const key of ['config','retryPolicy','adapterDefaults','context','inputModalities','systemPromptUpdate','toolUpdate'])assert.deepEqual(b[key],a[key],key)
})
