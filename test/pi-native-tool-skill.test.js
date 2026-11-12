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

test('official skill mapping overlaps bounded independent authorization reads and preserves catalog order',async()=>{
 const skills=Array.from({length:9},(_,index)=>({...summary,name:'skill-'+index})),pending=[],started=[]
 let active=0,peak=0
 const mapped=native.officialSkillResources({complete:true,skills},{resolveFilePath:skill=>{started.push(skill.name);active++;peak=Math.max(peak,active);return new Promise(resolve=>pending.push(()=>{active--;resolve('/authorized/'+skill.name+'/SKILL.md')}))}})
 assert.equal(started.length,4)
 while(pending.length){const wave=pending.splice(0);for(const finish of wave.reverse())finish();await new Promise(resolve=>setImmediate(resolve))}
 const resources=await mapped
 assert.equal(peak,4);assert.equal(active,0)
 assert.deepEqual(resources.map(item=>item.name),skills.map(item=>item.name))
 for(const maxConcurrency of [0,-1,9,1.5,NaN])await assert.rejects(native.officialSkillResources({complete:true,skills:[]},{maxConcurrency}),/concurrency/)
})

test('failed parallel skill mapping drains outstanding reads and never schedules or publishes partial resources',async()=>{
 const failure=Object.assign(new Error('revoked'),{code:'PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED'}),skills=Array.from({length:7},(_,index)=>({...summary,name:'skill-'+index})),pending=[]
 let settled=false,started=0
 const mapped=native.officialSkillResources({complete:true,skills},{resolveFilePath:skill=>{started++;return new Promise((resolve,reject)=>pending.push({resolve:()=>resolve('/authorized/'+skill.name+'/SKILL.md'),reject}))}})
 const checked=assert.rejects(mapped,error=>error===failure).then(()=>{settled=true})
 pending[0].reject(failure);await new Promise(resolve=>setImmediate(resolve))
 assert.equal(started,4);assert.equal(settled,false,'caller cannot retry while scoped reads from the rejected snapshot are running')
 for(const read of pending.slice(1))read.resolve()
 await checked
 assert.equal(settled,true);assert.equal(started,4)
})
