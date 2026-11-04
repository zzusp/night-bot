import {Service,symbols} from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import {AsyncLocalStorage} from 'node:async_hooks'
import {randomUUID} from 'node:crypto'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {scopeTarget} from '@deepseek-ai/dsh-scope'
export const APPROVAL_POLICIES=Object.freeze(['ask','never'])
const outcomes=new Set(['allowed-once','rejected','cancelled','unavailable'])
const neverText='Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
const askText='Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'
export function setApprovalPolicy(session,policy){if(!APPROVAL_POLICIES.includes(policy))throw new TypeError('approval policy must be one of "ask" or "never"');session.append('approval/policy',{policy})}
function openTurn(session){for(let seq=session.seq-1;seq>=0;seq--){const type=session.eventAt(seq)?.type;if(type==='turn/start')return true;if(type==='turn/end')return false}return false}
function raceAnswer(answer,signal){if(signal.aborted)return Promise.resolve('cancelled');return new Promise(resolve=>{const done=value=>{signal.removeEventListener('abort',abort);resolve(value)},abort=()=>done('cancelled');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();answer.then(done)})}
/** Application-owned one-action approval. Same-process request identities remain
 * borrowed; only a normalized, durably paired decision may become a grant. */
export default class NativeApproval extends Service {
 static inject=['sessions','piAuthority']
 static Config=schema.object({policy:schema.union([...APPROVAL_POLICIES]).default('ask')})
 constructor(ctx,config={}){if(!APPROVAL_POLICIES.includes(config.policy??'ask'))throw new TypeError('Invalid approval policy');super(ctx,'approval');this.host=ctx;this.config={...config,policy:config.policy??'ask'};this.sessions=ctx.sessions[symbols.original]??ctx.sessions;this.authority=ctx.piAuthority;this.closed=false;this.active=new Set();this.calls=new AsyncLocalStorage();this.lifetime=new AbortController();ctx.effect(()=>()=>this.close(),'native approval cancel/drain');ctx.inject(['systemPrompt'],child=>child.systemPrompt.context({name:'approval:policy',order:child.systemPrompt.getContextOrder('APPROVAL_POLICY'),text:context=>context.agent?this.effectivePolicy(context.agent.session)==='never'?neverText:askText:''}))}
 overrideOf(session){for(let seq=session.seq-1;seq>=0;seq--){const event=session.eventAt(seq);if(event?.type==='approval/policy')return event.data.policy}}
 effectivePolicy(session){return this.overrideOf(session)??this.config.policy}
 setPolicy(agent,policy){if(this.closed)throw new Error('Approval service disposed');const previous=this.effectivePolicy(agent.session);if(previous===policy)return;setApprovalPolicy(agent.session,policy);agent.inject(createUserMessage({source:{kind:'user-approval'},content:[{type:'text',text:`The approval policy changed from "${previous}" to "${policy}" (changed by the user).`}]}))}
 async flush(session){const through=session.seq;if(!await this.sessions.flush(session))throw new Error('NIGHT_BOT_APPROVAL_JOURNAL_UNAVAILABLE');const proof=this.authority.describe(session.id);if(proof?.engine!=='pi-session-manager'||!Number.isSafeInteger(proof.events)||proof.events<through)throw new Error('NIGHT_BOT_APPROVAL_JOURNAL_UNAVAILABLE')}
 async request(req){
  if(this.closed)throw new Error('Approval service disposed')
  const session=req.agent.session;if(!openTurn(session))throw new Error('approval.request() outside an open turn')
  if(this.sessions.get(session.id)!==session)throw new Error('Approval session is not live')
  const record={req,session,agent:req.agent};this.active.add(record)
  record.done=this.calls.run(record,()=>this.perform(record)).finally(()=>this.active.delete(record));return record.done
 }
 async perform({req,session,agent}){
  const signal=req.signal?AbortSignal.any([req.signal,this.lifetime.signal]):this.lifetime.signal,id=randomUUID()
  session.append('approval/asked',{id,toolName:req.toolName,...req.callId===undefined?{}:{callId:req.callId},...req.reason===undefined?{}:{reason:req.reason}})
  await this.flush(session)
  let outcome=await this.decide(req,session,signal,agent)
  // The final decision append is the admission point. A policy revoked while
  // waiting cannot grant; an admitted decision's write must then drain.
  if(signal.aborted)outcome='cancelled'
  else if(outcome==='allowed-once'&&this.effectivePolicy(session)==='never')outcome='rejected'
  session.append('approval/decided',{id,outcome});await this.flush(session);return outcome
 }
 async decide(req,session,signal=req.signal??this.lifetime.signal,agent=req.agent){
  if(this.closed||signal.aborted)return'cancelled';if(this.effectivePolicy(session)==='never')return'rejected'
  const answer=Promise.resolve().then(()=>{if(signal.aborted)return'cancelled';return this.host.waterfall(scopeTarget(agent,agent),'approval/request',req,()=>Promise.resolve('unavailable'))}).then(value=>outcomes.has(value)?value:'unavailable',()=> 'unavailable')
  return raceAnswer(answer,signal)
 }
 async close(){this.closed=true;this.lifetime.abort(new Error('Approval service disposed'));const own=this.calls.getStore();await Promise.allSettled([...this.active].filter(r=>r!==own).map(r=>r.done))}
}
