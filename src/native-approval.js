import {Service,symbols} from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import {AsyncLocalStorage} from 'node:async_hooks'
import {randomUUID} from 'node:crypto'
import { createUserMessage } from './native-message-protocol.js';
import {scopeTarget} from './native-scope.js'
export const APPROVAL_POLICIES=Object.freeze(['ask','never'])
const outcomes=new Set(['allowed-once','rejected','cancelled','unavailable'])
const approvalAudits=new WeakMap()
const auditTypes=new Set(['approval/policy','approval/asked','approval/decided'])
/** Bind an authenticated actor identity to approval-only durable business facts.
 * An equal id or a request-supplied port is never ownership evidence. */
export function bindApprovalAudit(actor,port){
 if(!actor||!['object','function'].includes(typeof actor)||!port)throw new TypeError('Approval audit needs an actor and business port')
 const prior=approvalAudits.get(actor)
 if(prior){if(prior.source!==port)throw new Error('Approval actor audit already bound');return()=>{}}
 const methods={}
 for(const key of ['isLive','isTurnOpen','approvalPolicy','append','flush']){const callback=port[key];if(typeof callback!=='function')throw new TypeError('Approval audit needs '+key);methods[key]=(...args)=>Reflect.apply(callback,port,args)}
 const append=methods.append
 methods.append=(type,data)=>{if(!auditTypes.has(type))throw new Error('Unsupported approval business fact');return append(type,data)}
 const bound=Object.freeze({source:port,...methods});approvalAudits.set(actor,bound)
 return()=>{if(approvalAudits.get(actor)===bound)approvalAudits.delete(actor)}
}

const neverText='Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
const askText='Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'
export function setApprovalPolicy(session,policy){if(!APPROVAL_POLICIES.includes(policy))throw new TypeError('approval policy must be one of "ask" or "never"');session.append('approval/policy',{policy})}
function openTurn(session){for(let seq=session.seq-1;seq>=0;seq--){const type=session.eventAt(seq)?.type;if(type==='turn/start')return true;if(type==='turn/end')return false}return false}
function raceAnswer(answer,signal){if(signal.aborted)return Promise.resolve('cancelled');return new Promise(resolve=>{const done=value=>{signal.removeEventListener('abort',abort);resolve(value)},abort=()=>done('cancelled');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();answer.then(done)})}
/** Application-owned one-action approval. Same-process request identities remain
 * borrowed; only a normalized, durably paired decision may become a grant. */
export default class NativeApproval extends Service {
 static Config=schema.object({policy:schema.union([...APPROVAL_POLICIES]).default('ask')})
 constructor(ctx,config={}){if(!APPROVAL_POLICIES.includes(config.policy??'ask'))throw new TypeError('Invalid approval policy');super(ctx,'approval');this.host=ctx;this.config={...config,policy:config.policy??'ask'};this.sessions=ctx.get('sessions');this.sessions=this.sessions?.[symbols.original]??this.sessions;this.authority=ctx.get('piAuthority');this.closed=false;this.active=new Set();this.calls=new AsyncLocalStorage();this.lifetime=new AbortController();ctx.effect(()=>()=>this.close(),'native approval cancel/drain');ctx.inject(['systemPrompt'],child=>child.systemPrompt.context({name:'approval:policy',order:child.systemPrompt.getContextOrder('APPROVAL_POLICY'),officialText:({actor})=>this.officialText({actor}),text:context=>context.agent?this.officialText({actor:context.agent}):''}))}
 overrideOf(session){if(!session)return;for(let seq=session.seq-1;seq>=0;seq--){const event=session.eventAt(seq);if(event?.type==='approval/policy')return event.data.policy}}
 effectivePolicy(session){return this.overrideOf(session)??this.config.policy}
 policyForActor(actor){const audit=approvalAudits.get(actor);if(audit){const policy=audit.approvalPolicy()??this.config.policy;if(!APPROVAL_POLICIES.includes(policy))throw new Error('Invalid business approval policy');return policy}if(actor?.session)return this.effectivePolicy(actor.session);throw new Error('Approval actor has no bound business audit')}
 officialText({actor}){return this.policyForActor(actor)==='never'?neverText:askText}
 setPolicy(agent,policy){if(this.closed)throw new Error('Approval service disposed');if(!APPROVAL_POLICIES.includes(policy))throw new TypeError('Invalid approval policy');const previous=this.policyForActor(agent);if(previous===policy)return;const audit=approvalAudits.get(agent);if(audit){audit.append('approval/policy',{policy});return}setApprovalPolicy(agent.session,policy);agent.inject(createUserMessage({source:{kind:'user-approval'},content:[{type:'text',text:`The approval policy changed from "${previous}" to "${policy}" (changed by the user).`}]}))}
 async flush(session,audit){if(audit){await audit.flush();return}const sessions=this.sessions??this.host.get('sessions'),authority=this.authority??this.host.get('piAuthority');const through=session.seq;if(!sessions||!await sessions.flush(session))throw new Error('NIGHT_BOT_APPROVAL_JOURNAL_UNAVAILABLE');const proof=authority?.describe(session.id);if(proof?.engine!=='pi-session-manager'||!Number.isSafeInteger(proof.events)||proof.events<through)throw new Error('NIGHT_BOT_APPROVAL_JOURNAL_UNAVAILABLE')}
 async request(req){
  if(this.closed)throw new Error('Approval service disposed')
  const audit=approvalAudits.get(req.agent),session=audit?undefined:req.agent?.session
  if(audit){
   if(req.businessAudit!==undefined&&req.businessAudit!==audit.source)throw new Error('Foreign approval business audit')
   if(!audit.isTurnOpen())throw new Error('approval.request() outside an open turn')
   if(!audit.isLive())throw new Error('Approval actor is not live')
  }else{
   if(req.businessAudit||!session)throw new Error('Approval actor has no bound business audit')
   if(!openTurn(session))throw new Error('approval.request() outside an open turn')
   const sessions=this.sessions??this.host.get('sessions')
   if(sessions?.get(session.id)!==session)throw new Error('Approval session is not live')
  }
  const record={req,session,audit,agent:req.agent};this.active.add(record)
  record.done=this.calls.run(record,()=>this.perform(record)).finally(()=>this.active.delete(record));return record.done
 }
 async perform({req,session,audit,agent}){
  const signal=req.signal?AbortSignal.any([req.signal,this.lifetime.signal]):this.lifetime.signal,id=randomUUID()
  const append=(type,data)=>audit?audit.append(type,data):session.append(type,data)
  append('approval/asked',{id,toolName:req.toolName,...req.callId===undefined?{}:{callId:req.callId},...req.reason===undefined?{}:{reason:req.reason}})
  await this.flush(session,audit)
  let outcome=await this.decide(req,session,signal,agent)
  // The final decision append is the admission point. A policy revoked while
  // waiting cannot grant; an admitted decision's write must then drain.
  if(signal.aborted)outcome='cancelled'
  else if(audit&&(!audit.isLive()||!audit.isTurnOpen()))outcome='cancelled'
  else if(outcome==='allowed-once'&&this.policyForActor(agent)==='never')outcome='rejected'
  append('approval/decided',{id,outcome});await this.flush(session,audit);return outcome
 }
 async decide(req,session,signal=req.signal??this.lifetime.signal,agent=req.agent){
  if(this.closed||signal.aborted)return'cancelled';const audit=approvalAudits.get(agent);if(audit&&(!audit.isLive()||!audit.isTurnOpen()))return'cancelled';if(this.policyForActor(agent)==='never')return'rejected'
  const answer=Promise.resolve().then(()=>{if(signal.aborted)return'cancelled';return this.host.waterfall(scopeTarget(agent,agent),'approval/request',req,()=>Promise.resolve('unavailable'))}).then(value=>outcomes.has(value)?value:'unavailable',()=> 'unavailable')
  return raceAnswer(answer,signal)
 }
 async close(){this.closed=true;this.lifetime.abort(new Error('Approval service disposed'));const own=this.calls.getStore();await Promise.allSettled([...this.active].filter(r=>r!==own).map(r=>r.done))}
}
