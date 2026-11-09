import test from 'node:test'
import assert from 'node:assert/strict'
import {PassThrough} from 'node:stream'
import {builtinProviders} from '@earendil-works/pi-ai/providers/all'
import {createOperatorInteraction} from '../src/operator-terminal.js'
import {piLoginPrompt} from '../src/pi-provider-login.js'

test('actual pinned Codex OAuth browser and device options return their official ids before network authorization',async t=>{
 const provider=builtinProviders().find(provider=>provider.id==='openai-codex')
 assert.equal(typeof provider?.auth.oauth.login,'function')
 for(const choice of [1,2])await t.test(choice===1?'browser':'device-code',async t=>{
  const input=new PassThrough(),output=new PassThrough(),terminal=createOperatorInteraction({input,output})
  t.after(()=>terminal.close());input.end(choice+'\n')
  const stop=new Error('Stop after real provider selection; no network authorization')
  let selected,options
  await assert.rejects(provider.auth.oauth.login({notify(){throw new Error('Authorization must not begin')},async prompt(prompt){
   assert.equal(prompt.type,'select');options=prompt.options
   assert.equal(options.length,2)
   assert.ok(options.every(option=>typeof option.id==='string'&&typeof option.label==='string'&&!Object.hasOwn(option,'value')))
   selected=await terminal.prompt(piLoginPrompt(prompt));assert.equal(selected,options[choice-1].id)
   throw stop
  }}),error=>error===stop)
  assert.equal(typeof selected,'string');assert.notEqual(selected,options[2-choice].id)
 })
})

test('operator refuses a selected option without an official id instead of returning undefined',async t=>{
 const input=new PassThrough(),output=new PassThrough(),terminal=createOperatorInteraction({input,output})
 t.after(()=>terminal.close());input.end('1\n')
 await assert.rejects(terminal.prompt({kind:'select',message:'Invalid provider shape',options:[{label:'Missing id',value:'legacy-value'}]}),error=>error.code==='NIGHT_BOT_AUTH_SELECTION_INVALID')
})
