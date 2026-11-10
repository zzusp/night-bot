import test from 'node:test'
import assert from 'node:assert/strict'
import * as native from '../src/native-tool-skill.js'
const summary={name:'fixture',description:'stable description',provider:'fixture',invocation:{modelInvocable:true,userInvocable:true},content:'TRUSTED_BODY'}
function fixture(){const tools=new Map(),calls=[],agent={id:'skill-unit'};const ctx={get(name){return this[name]},tools:{register:t=>tools.set(t.name,t)},skills:{list:async()=>[summary],get:async(name,lookup)=>{calls.push({name,lookup});return name===summary.name?summary:undefined}},workingDirectory:{ensure:async()=>'/fixture'},on(){assert.fail('no legacy pre-step publisher may register')}};native.apply(ctx);return{tools,calls,agent,ctx}}
test('native skill tool requires an exact catalog name and returns provider-owned content with escaped framing',async()=>{
 const h=fixture(),tool=h.tools.get('skill');assert.equal(tool.parameters.type,'object');assert.deepEqual(tool.parameters.required,['name']);assert.equal(tool.parameters.properties.name.type,'string');assert.deepEqual(tool.output.schema.required,['name','provider','content']);assert.equal(tool.output.schema.additionalProperties,false);assert.deepEqual(tool.output.schema.properties.resourceBase.oneOf.map(branch=>({kind:branch.properties.kind.const,required:branch.required,additionalProperties:branch.additionalProperties})),[{kind:'directory',required:['kind','path'],additionalProperties:false},{kind:'url',required:['kind','url'],additionalProperties:false},{kind:'opaque',required:['kind','description'],additionalProperties:false}])
 const uses=[];h.ctx.memory={prepareSkillUse:(exec,skill)=>uses.push({exec,skill})}
 const value=await tool.execute({name:'fixture'},{agent:h.agent,signal:new AbortController().signal});assert.deepEqual(value,{name:'fixture',provider:'fixture',content:'TRUSTED_BODY'});assert.equal(h.calls.length,1);assert.equal(h.calls[0].lookup.scope,h.agent);assert.equal(uses.length,1);assert.equal(uses[0].exec.agent,h.agent);assert.equal(uses[0].skill,summary)
 const rendered=tool.output.render({},value);assert.equal(rendered.length,1);assert.equal(rendered[0].type,'text');assert.match(rendered[0].text,/^<skill_content name="fixture">/);assert.match(rendered[0].text,/Resources for this skill are managed by provider "fixture"/);assert.match(rendered[0].text,/<skill_instructions>\nTRUSTED_BODY\n<\/skill_instructions>/)
})

test('skill loading preserves current invocation policy and has no historical catalog publisher',async()=>{
 const h=fixture(),tool=h.tools.get('skill');assert.equal(native.catalogHistory,undefined);assert.equal(native.inject.includes('piAuthority'),false)
 assert.equal(native.isNativeSkillLoader(tool),true);assert.equal(native.isNativeSkillLoader({...tool}),false)
 await assert.rejects(tool.execute({name:'bad/name'},{agent:h.agent}),/invalid skill/)
 h.ctx.skills.list=async()=>[{...summary,invocation:{modelInvocable:false,userInvocable:true}}]
 await assert.rejects(tool.execute({name:'fixture'},{agent:h.agent}),/not available for model/);assert.equal(h.calls.length,0)
 h.ctx.skills.list=async()=>[summary];h.ctx.skills.get=async()=>({...summary,invocation:{modelInvocable:false,userInvocable:true}})
 await assert.rejects(tool.execute({name:'fixture'},{agent:h.agent}),/not available for model/)
})

test('official skill resources require complete authorized paths and never carry bodies or shadow history',async()=>{
 const userOnly={...summary,name:'manual-only',invocation:{modelInvocable:false,userInvocable:true}},disabled={...summary,name:'disabled',invocation:{modelInvocable:false,userInvocable:false}}
 const resources=await native.officialSkillResources({complete:true,skills:[summary,userOnly,disabled]},{resolveFilePath:async skill=>'/authorized/'+skill.name+'/SKILL.md'})
 assert.equal(resources.length,2);assert.equal(resources[0].disableModelInvocation,false);assert.equal(resources[1].disableModelInvocation,true)
 assert.deepEqual(resources.map(row=>row.name),['fixture','manual-only']);assert.doesNotMatch(JSON.stringify(resources),/TRUSTED_BODY|night.event|skill-catalog/)
 await assert.rejects(native.officialSkillResources({complete:false,skills:[]}),{code:'PI_OFFICIAL_SKILL_SNAPSHOT_REQUIRED'})
 await assert.rejects(native.officialSkillResources({complete:true,skills:[summary]}),{code:'PI_OFFICIAL_SKILL_FILE_REQUIRED'})
 await assert.rejects(native.officialSkillResources({complete:true,skills:[summary]},{resolveFilePath:async()=> 'relative/SKILL.md'}),{code:'PI_OFFICIAL_SKILL_FILE_REQUIRED'})
 assert.deepEqual(await native.officialSkillResources({complete:true,skills:[]}),[])
})
