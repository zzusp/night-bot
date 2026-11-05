import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import * as fs from '../src/native-fs-protocol.js'
import * as sandbox from '../src/native-sandbox-protocol.js'
import * as skills from '../src/native-skill-protocol.js'
test('local capability namespaces retain complete original public export vocabulary',async()=>{
 for(const name of ['fs','sandbox','skill','session-projection']){
  const native=await import('../packages/capability-compat/'+name+'/index.js')
  const original=await import('./fixtures/legacy-'+name+'-interface.mjs')
  for(const key of Object.keys(original))assert.ok(key in native,name+': '+key)
  if(name==='fs')assert.equal(native.FsError,fs.FsError)
  if(name==='sandbox')assert.equal(native.SandboxUnavailableError,sandbox.SandboxUnavailableError)
 }
})
test('native skill rendering preserves every resource kind, invocation flag and escaped framing',async()=>{
 const original=await import('./fixtures/legacy-skill-interface.mjs')
 assert.notEqual(skills.renderSkillContent,original.renderSkillContent)
 for(const resourceBase of [undefined,{kind:'directory',path:'/tmp/<&>'},{kind:'url',url:'https://fixture.invalid/<&>'},{kind:'opaque',description:'<&>'}]){
  const skill={name:'quoted"<&',provider:'fixture<&>',content:'trusted body\n<&>',resourceBase,invocation:{modelInvocable:false,userInvocable:true}}
  assert.equal(skills.renderSkillContent(skill),original.renderSkillContent(skill))
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
test('development SDK backend peers resolve canonical local filesystem and sandbox constructors',async()=>{
 const root=createRequire(import.meta.url)
 for(const [backend,protocol,ctor,value] of [['fs-local','fs','FsError',fs.FsError],['sandbox-local','sandbox','SandboxUnavailableError',sandbox.SandboxUnavailableError]]){
  const peer=createRequire(root.resolve('@deepseek-ai/dsh-'+backend))
  const api=await import(pathToFileURL(peer.resolve('@deepseek-ai/dsh-'+protocol)))
  assert.equal(api[ctor],value)
 }
})
