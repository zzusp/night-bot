import test from 'node:test'
import assert from 'node:assert/strict'
import * as render from '../src/runtime/prompt-template.js'
const assembly={variables:{name:'{{other}}',other:'second'},sections:[{name:'greeting',text:'hello {{name}}'},{name:'literal',text:'{{missing}}',interpolate:false}],contexts:[{name:'fact',text:'current {{name}}'},{name:'empty',text:''}]}
test('prompt templates attribute missing, unset and malformed references without exposing assembly values',()=>{
 for(const [text,variables,code]of [['{{missing}}',{secret:'NEVER_PRINT_THIS'},'NIGHT_PROMPT_VARIABLE_UNKNOWN'],['{{name}}',{name:undefined},'NIGHT_PROMPT_VARIABLE_UNSET'],['{{name}}',{name:42},'NIGHT_PROMPT_VARIABLE_INVALID'],['{{bad-name}}',{},'NIGHT_PROMPT_TEMPLATE_INVALID'],['{{x {y}}',{},'NIGHT_PROMPT_TEMPLATE_INVALID']]){
  assert.throws(()=>render.renderPrompt({sections:[{name:'owner',text}],variables}),error=>{assert.equal(error.code,code);assert.deepEqual(error.contribution,{kind:'section',name:'owner'});assert.ok(!error.message.includes('NEVER_PRINT_THIS'));return true})
 }
 const inherited=Object.create({name:'inherited'});assert.throws(()=>render.renderPrompt({sections:[{name:'owner',text:'{{name}}'}],variables:inherited}),error=>error.code==='NIGHT_PROMPT_VARIABLE_UNKNOWN')
 assert.deepEqual(render.renderContextSections({...assembly,variables:{name:'中文',other:'ignored'}}),[{name:'fact',text:'current 中文'}]);assert.equal(render.renderPrompt({sections:[],variables:{}}),'')
})
test('native rendering does not recursively interpolate values and preserves literal or empty contributions',()=>{assert.equal(render.renderPrompt(assembly),'hello {{other}}\n\n{{missing}}');assert.deepEqual(render.renderContextSections(assembly),[{name:'fact',text:'current {{other}}'}]);assert.equal(render.joinContextSections([]),'');for(const text of ['{{missing}}','{{bad-name}}'])assert.throws(()=>render.renderPrompt({sections:[{name:'owner',text}],variables:{}}),/owner/);assert.equal(render.renderPrompt({sections:[{name:'lone',text:'literal {{'}],variables:{}}),'literal {{')})

test('compiled templates can be reused with detached assemblies and remain strictly single-pass',()=>{
 const compiled=render.compileTemplate('prefix {{name}} / {{other}}',{kind:'section',name:'compiled'});assert.ok(Object.isFrozen(compiled));assert.equal(compiled({name:'{{other}}',other:'second'}),'prefix {{other}} / second');assert.equal(compiled({name:'next',other:'assembly'}),'prefix next / assembly')
 assert.equal(render.renderPrompt({sections:[{name:'literal',text:'{{bad syntax}}',interpolate:false}],variables:{}}),'{{bad syntax}}');assert.throws(()=>render.renderContextSections({contexts:[{name:'context-owner',text:'{{missing}}'}],variables:{}}),error=>error.contribution.kind==='context'&&error.contribution.name==='context-owner')
 const prose='{{'.repeat(100000);assert.equal(render.compileTemplate(prose)({}),prose)
})
