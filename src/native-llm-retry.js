import {AsyncLocalStorage} from 'node:async_hooks'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
export const name='night-native-llm-retry',inject=['agents','sessions','sessionProjections','piAuthority']
const policyKey=p=>JSON.stringify(p.mode==='always'?[p.mode,p.initialDelayMs,p.maxDelayMs,p.jitterRatio]:[p.mode,p.maxRetries,[...p.retryableCodes].sort(),p.initialDelayMs,p.maxDelayMs,p.jitterRatio])
const stateKey=(provider,key)=>JSON.stringify([provider,key])
const stateSchema=z.record(z.string(),z.object({retry:z.number().int().nonnegative(),retryId:z.string()}))
const wait=(ms,signal)=>signal.aborted?Promise.resolve(false):new Promise(resolve=>{const finish=value=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);resolve(value)},aborted=()=>finish(false),timer=setTimeout(()=>finish(true),ms);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted()})
/** Application-owned model-request recovery. The MIT legacy retry policy/chain
 * protocol remains interoperable; actual requests run through Pi. A locally scheduled retry is
 * never admitted before both scheduling and started records flush durably. */
export function apply(ctx,config={},internals={}){
 if(Object.keys(config).length)throw new Error('Native LLM retry takes no options; retryPolicy belongs to each provider')
 ctx.sessionProjections.register({key:'llmRetry',stateVersion:1,stateSchema,init:()=>({}),apply:(state,event)=>{if(['step/start','turn/end'].includes(event.type))return{};if(event.type!=='llm/retry')return state;const d=event.data,key=stateKey(d.provider,d.policyKey),old=state[key];return old?.retry===d.retry&&old.retryId===d.retryId?state:{...state,[key]:{retry:d.retry,retryId:d.retryId}}}})
 const lifetime=new AbortController(),active=new Set(),calls=new AsyncLocalStorage(),random=internals.random??Math.random,authority=ctx.piAuthority,sessions=ctx.sessions
 ctx.provide('llmRetry',Object.freeze({owner:name}))
 const warn=()=>{try{ctx.logger.warn('Native LLM retry: always policy ignored a downstream recovery failure')}catch{}}
 async function flush(agent,signal){const through=agent.session.seq,flushed=await sessions.flush(agent.session);if(signal.aborted)return;if(!flushed)throw new Error('NIGHT_BOT_RETRY_JOURNAL_UNAVAILABLE');const proof=authority.describe(agent.session.id);if(proof?.engine!=='pi-session-manager'||!Number.isSafeInteger(proof.events)||proof.events<through)throw new Error('NIGHT_BOT_RETRY_JOURNAL_UNAVAILABLE')}
 async function recover(payload,next){
  const {agent,turn,step,provider,failure,retryPolicy:policy,signal}=payload
  if(!policy)return next()
  const fused=AbortSignal.any([signal,lifetime.signal]);if(fused.aborted)return
  if(policy.mode==='always'){
   let downstream
   try{downstream=await next()}catch{warn()}
   if(fused.aborted)return
   if(downstream?.kind==='retry')return downstream
  }else if(!policy.retryableCodes.includes(failure.code))return next()
  const key=policyKey(policy),previous=ctx.sessionProjections.stateOf(agent.session,'llmRetry')[stateKey(provider,key)],retry=(previous?.retry??0)+1
  if(policy.mode==='normal'&&retry>policy.maxRetries)return next()
  let delayMs=failure.providerRetryAfterMs
  if(!(Number.isFinite(delayMs)&&delayMs>0)||delayMs>policy.maxDelayMs){if(Number.isFinite(delayMs)&&delayMs>policy.maxDelayMs&&policy.mode==='normal')return next();delayMs=Math.min(Math.min(policy.initialDelayMs*2**Math.min(retry-1,1024),policy.maxDelayMs)*(1-policy.jitterRatio+2*policy.jitterRatio*random()),policy.maxDelayMs)}
  if(fused.aborted)return
  const retryId=previous?.retryId??randomUUID()
  agent.session.append('llm/retry',{retryId,turn,step,provider,mode:policy.mode,policyKey:key,retry,...policy.mode==='normal'?{maxRetries:policy.maxRetries}:{},delayMs,failure})
  await flush(agent,fused)
  if(!await wait(delayMs,fused)||fused.aborted)return
  agent.session.append('llm/retry-started',{retryId,turn,step,retry})
  await flush(agent,fused)
  if(!fused.aborted)return{kind:'retry'}
 }
 const off=ctx.on('agent/request-error',(payload,next)=>{
  if(lifetime.signal.aborted)return Promise.resolve()
  const record={};active.add(record)
  const operation=calls.run(record,()=>recover(payload,next));record.done=Promise.resolve(operation).finally(()=>active.delete(record));return record.done
 })
 ctx.effect(()=>async()=>{off();lifetime.abort(new Error('Native LLM retry disposed'));const current=calls.getStore();await Promise.allSettled([...active].filter(r=>r!==current).map(r=>r.done))},'native LLM retry cancel/drain')
}
