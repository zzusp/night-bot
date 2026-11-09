import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import NativeApproval,{bindApprovalAudit} from '../src/native-approval.js'
import {definition,officialToolsFixture as fixture} from './fixtures/pi-official-tools.js'

async function approvalFixture(t,setup=()=>{}){
 let live=true,open=true,policy,service,effects=0,prompts=0
 const entries=[],flushes=[]
 const h=await fixture(t,async context=>{
  const {ctx,owner,businessAudit,manager}=context
  Object.assign(businessAudit,{isLive:()=>live,isTurnOpen:()=>open,approvalPolicy:()=>policy,
   append(type,data){assert.ok(['approval/policy','approval/asked','approval/decided'].includes(type));entries.push({type,data});if(type==='approval/policy')policy=data.policy;manager.appendCustomEntry('night-approval',{type,data})},
   async flush(){flushes.push(entries.length)},
  })
  service=new NativeApproval(ctx,{policy:'ask'})
  ctx.tools.register(definition('sensitive',async()=>{effects++;return{approved:true}}))
  ctx.on('tools/pre-execute',(exec,next)=>exec.name==='sensitive'?{kind:'ask',reason:'one exact action'}:next())
  ctx.on('approval/request',(req,next)=>{prompts++;assert.ok(flushes.at(-1)>=entries.length);return next()})
  await setup({...context,service,entries,flushes})
  const unbind=bindApprovalAudit(owner,businessAudit);t.after(unbind)
 })
 return{...h,service,entries,flushes,effects:()=>effects,prompts:()=>prompts,setLive:value=>{live=value},setOpen:value=>{open=value}}
}

test('official SDK uses real NativeApproval business receipts and actor provenance without a Session facade',async t=>{
 const h=await approvalFixture(t,({ctx})=>{ctx.on('approval/request',req=>req.callId==='deny'?'rejected':'allowed-once')})
 assert.equal(h.owner.session,undefined);assert.equal(h.ctx.get('sessions'),undefined);assert.equal(h.ctx.get('piAuthority'),undefined)
 assert.match(h.service.officialText({actor:h.owner}),/Approval policy: ask/)
 await h.run([{name:'sensitive',id:'grant'}]);assert.equal(h.effects(),1)
 await h.run([{name:'sensitive',id:'deny'}]);assert.equal(h.effects(),1)
 assert.deepEqual(h.entries.filter(entry=>entry.type==='approval/decided').map(entry=>entry.data.outcome),['allowed-once','rejected'])
 assert.equal(h.results.find(result=>result.toolCallId==='deny').isError,true)
 assert.deepEqual(h.results.find(result=>result.toolCallId==='grant').result.structuredContent,{approved:true})
 const before=h.entries.length
 await assert.rejects(h.service.request({agent:{id:h.owner.id,ctx:h.ctx},businessAudit:h.businessAudit,toolName:'sensitive',callId:'foreign'}),/no bound business audit/)
 await assert.rejects(h.service.request({agent:h.owner,businessAudit:{...h.businessAudit},toolName:'sensitive'}),/Foreign approval/)
 assert.equal(h.entries.length,before)
 h.service.setPolicy(h.owner,'never');assert.match(h.service.officialText({actor:h.owner}),/disabled/)
 await h.run([{name:'sensitive',id:'never'}]);assert.equal(h.effects(),1);assert.equal(h.prompts(),2)
 assert.equal(h.owner.session,undefined)
})

test('official approval cancellation drains its decision, while late answers cannot grant',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const h=await approvalFixture(t,({ctx})=>ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'}))
 const running=h.run([{name:'sensitive',id:'cancelled-approval'}]);await entered.promise
 await h.session.abort();await running;assert.equal(h.effects(),0)
 assert.equal(h.entries.at(-1).data.outcome,'cancelled')
 release.resolve();await delay(1);assert.equal(h.effects(),0)
 assert.equal(h.entries.filter(entry=>entry.type==='approval/decided').length,1)
})

test('official approval flush failures and policy revocation never admit effects',async t=>{
 for(const failAt of [1,2])await t.test('flush '+failAt,async t=>{
  let calls=0
  const h=await approvalFixture(t,({ctx,businessAudit})=>{ctx.on('approval/request',()=> 'allowed-once');businessAudit.flush=async()=>{if(++calls===failAt)throw new Error('approval receipt uncertain')}})
  await h.run([{name:'sensitive',id:'uncertain'}]);assert.equal(h.effects(),0);assert.equal(h.results.find(result=>result.toolCallId==='uncertain').isError,true)
 })
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const h=await approvalFixture(t,({ctx})=>ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'}))
 const running=h.run([{name:'sensitive',id:'revoked'}]);await entered.promise;h.service.setPolicy(h.owner,'never');release.resolve();await running
 assert.equal(h.effects(),0);assert.equal(h.entries.at(-1).data.outcome,'rejected')
 h.setOpen(false);await assert.rejects(h.service.request({agent:h.owner,toolName:'sensitive'}),/outside an open turn/)
 h.setOpen(true);h.setLive(false);await assert.rejects(h.service.request({agent:h.owner,toolName:'sensitive'}),/not live/)
})
