import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,symlink,unlink,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {taskDirectories} from '../packages/dingtalk-core/session-workspaces.js'
import {preflightNativeFileMutation} from '../src/native-tool-fs.js'
import {FsError} from '../src/native-fs-protocol.js'

async function fixture(t,decide,{beforeBody,custom}={}){
 const f=await memoryHost(t,decide),dirs=await taskDirectories(f.host.ctx.runtimePaths.workspaces,'preflight-task')
 let actor
 const handle=await f.host.ctx.agents.create({sessionId:'preflight-actor',meta:{cwd:dirs.root,agentPreset:'night-bot'},authorizeInput:packet=>packet.source.kind==='preflight-test',auditKinds:{'fixture/effect-intent':value=>typeof value.callId==='string','fixture/effect-result':value=>typeof value.callId==='string'},setup:async ctx=>{
  await ctx.get('agentPresets').mount(ctx,'night-bot')
  await custom?.(ctx,dirs)
  ctx.on('tools/execute',async(exec,next)=>{
   await preflightNativeFileMutation(exec,ctx.get('tools').get(exec.name,exec.agent))
   actor.receipts.append({version:1,domain:'fixture',kind:'effect-intent',payload:{callId:exec.callId}});await actor.receipts.commit()
   await beforeBody?.(exec,dirs)
   const result=await next()
   if(!result.isError){actor.receipts.append({version:1,domain:'fixture',kind:'effect-result',payload:{callId:exec.callId}});await actor.receipts.commit()}
   return result
  })
 }})
 actor=handle.actor
 t.after(()=>handle.dispose())
 return {...f,dirs,handle,actor,run:async()=>{await handle.enqueue({id:'preflight-input',source:{kind:'preflight-test'},content:'Exercise the controlled filesystem preflight'});await handle.deliver('preflight-input');await handle.whenIdle()}}
}
test('Host-owned archive paths are refused before intent and a later legal write still executes',async t=>{
 let step=0
 const f=await fixture(t,()=>++step===1?{tool:'write',args:{file_path:'outputs/forged.txt',content:'forged'}}:step===2?{tool:'write',args:{file_path:'work/proof.txt',content:'legal'}}:{text:'done'})
 await f.run()
 await assert.rejects(stat(join(f.dirs.outputs,'forged.txt')),{code:'ENOENT'});assert.equal(await readFile(join(f.dirs.work,'proof.txt'),'utf8'),'legal')
 const receipts=(await f.actor.receipts.read()).filter(receipt=>receipt.domain==='fixture')
 assert.equal(receipts.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(receipts.filter(receipt=>receipt.kind==='effect-result').length,1)
 assert.ok(f.handle.session.messages.some(message=>message.role==='toolResult'&&message.isError))
})
test('only exact native definitions preflight canonical paths, including symlink aliases',async t=>{
 const f=await fixture(t,()=>({text:'unused'})),definition=f.actor.ctx.get('tools').get('write',f.actor)
 await symlink(f.dirs.outputs,join(f.dirs.work,'output-alias'),'dir')
 const check=async(file_path,def=definition)=>f.host.ctx.agents.withInitiator(f.actor,()=>preflightNativeFileMutation({name:'write',agent:f.actor,arguments:{file_path},signal:new AbortController().signal},def))
 for(const path of ['outputs/forged.txt','materials/forged.txt','sessions/forged.txt','task.json','work/output-alias/forged.txt'])await assert.rejects(check(path),error=>error.code==='FS_SANDBOX_DENIED')
 await check('work/allowed.txt');await assert.rejects(stat(join(f.dirs.work,'allowed.txt')),{code:'ENOENT'})
 await check('outputs/forged.txt',{...definition})
 assert.equal((await f.actor.receipts.read()).filter(receipt=>receipt.domain==='fixture').length,0,'preflight itself never writes a receipt or performs an effect')
})
test('a symlink replacement after preflight is checked again during mutation and retains intent',async t=>{
 let first=true
 const f=await fixture(t,()=>first?(first=false,{tool:'write',args:{file_path:'work/alias/late.txt',content:'must not escape'}}):{text:'denial observed'},{beforeBody:async(_exec,dirs)=>{await unlink(join(dirs.work,'alias'));await symlink(dirs.outputs,join(dirs.work,'alias'),'dir')}})
 await mkdir(join(f.dirs.work,'allowed'));await symlink(join(f.dirs.work,'allowed'),join(f.dirs.work,'alias'),'dir')
 await f.run();await assert.rejects(stat(join(f.dirs.outputs,'late.txt')),{code:'ENOENT'})
 const receipts=(await f.actor.receipts.read()).filter(receipt=>receipt.domain==='fixture')
 assert.equal(receipts.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(receipts.filter(receipt=>receipt.kind==='effect-result').length,0)
 assert.equal(f.handle.session.messages.find(message=>message.role==='toolResult').isError,true)
})
test('a body error using a sandbox error code after an actual write remains unresolved',async t=>{
 let first=true
 const f=await fixture(t,()=>first?(first=false,{tool:'misleading_failure',args:{}}):{text:'held for reconciliation'},{custom:async(ctx,dirs)=>{
  ctx.get('tools').register({name:'misleading_failure',description:'Controlled late failure',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},async execute(){await writeFile(join(dirs.work,'actual-effect.txt'),'written-before-error');throw new FsError('late provider failure','FS_SANDBOX_DENIED')}})
 }})
 await f.run();assert.equal(await readFile(join(f.dirs.work,'actual-effect.txt'),'utf8'),'written-before-error')
 const receipts=(await f.actor.receipts.read()).filter(receipt=>receipt.domain==='fixture')
 assert.equal(receipts.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(receipts.filter(receipt=>receipt.kind==='effect-result').length,0)
})
test('provider rechecks task ownership on a canonical target refreshed after a link replacement',async t=>{
 const f=await fixture(t,()=>({text:'unused'})),fs=f.actor.ctx.get('fs')
 await mkdir(join(f.dirs.work,'provider-allowed'));await symlink(join(f.dirs.work,'provider-allowed'),join(f.dirs.work,'provider-alias'),'dir')
 await f.host.ctx.agents.withInitiator(f.actor,async()=>{
  const target=await fs.resolve('work/provider-alias/refreshed.txt',{cwd:f.dirs.root})
  await unlink(join(f.dirs.work,'provider-alias'));await symlink(f.dirs.outputs,join(f.dirs.work,'provider-alias'),'dir')
  await assert.rejects(fs.writeText(target,'must not write Host-owned output',undefined,new AbortController().signal,f.actor.ctx.get('sandboxPolicy').resolve({actor:f.actor})),error=>error.code==='FS_SANDBOX_DENIED')
 })
 await assert.rejects(stat(join(f.dirs.outputs,'refreshed.txt')),{code:'ENOENT'})
})
