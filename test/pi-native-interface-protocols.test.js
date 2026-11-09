import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from '../src/native-fs-protocol.js'
import * as skills from '../src/native-skill-protocol.js'

test('native skill rendering preserves every resource kind, invocation flag and escaped framing',async()=>{
 for(const resourceBase of [undefined,{kind:'directory',path:'/tmp/<&>'},{kind:'url',url:'https://fixture.invalid/<&>'},{kind:'opaque',description:'<&>'}]){
  const skill={name:'quoted"<&',provider:'fixture<&>',content:'trusted body\n<&>',resourceBase,invocation:{modelInvocable:false,userInvocable:true}}
  const rendered=skills.renderSkillContent(skill)
  assert.ok(rendered.startsWith('<skill_content name="quoted&quot;&lt;&amp;">\n<skill_resources>\n'));assert.ok(rendered.endsWith('<skill_instructions>\ntrusted body\n<&>\n</skill_instructions>\n</skill_content>'))
  const expected=resourceBase===undefined?'Resources for this skill are managed by provider "fixture&lt;&amp;&gt;".':resourceBase.kind==='directory'?'Base directory for this skill: /tmp/&lt;&amp;&gt;':resourceBase.kind==='url'?'Base URL for this skill: https://fixture.invalid/&lt;&amp;&gt;':'Resources for this skill: &lt;&amp;&gt;'
  assert.ok(rendered.includes(expected));assert.ok(rendered.includes('Load referenced resources only as needed.'));if(resourceBase?.kind==='directory')assert.ok(rendered.includes('Resolve relative paths mentioned by this skill against the base directory'));if(resourceBase?.kind==='url')assert.ok(rendered.includes('Resolve relative URLs mentioned by this skill against the base URL'))
  assert.equal(skills.isModelInvocable(skill),false);assert.equal(skills.isUserInvocable(skill),true)
 }
 assert.throws(()=>skills.renderSkillContent({name:'fixture',provider:'fixture',content:'body',resourceBase:{kind:'unknown'}}))
})
test('filesystem abstract watch fails closed without operations and opaque ids remain unchanged',async()=>{
 const {Context}=await import('@deepseek-ai/cordis'),ctx=new Context()
 try{
  const base=new fs.FileSystem(ctx),signal=new AbortController().signal
  await assert.rejects(base.watch({},()=>{},signal),fs.FsError)
  const aborted=new AbortController(),reason=new Error('stop');aborted.abort(reason)
  assert.throws(()=>base.watch({},()=>{},aborted.signal),e=>e===reason)
  assert.equal(base.sandboxMode,undefined);assert.equal(base.processPathFromHostPath('/fixture'),undefined)
  assert.equal(fs.FsVersion('opaque'),'opaque');assert.equal(fs.FsTargetKey('opaque'),'opaque')
 }finally{await ctx.fiber.dispose()}
})
