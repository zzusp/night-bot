import {randomUUID} from 'node:crypto'
import {redactFeedback} from './redaction.js'
import {diagnoseWithPi} from './pi-session.js'
import {createChainEvidence} from './chain-evidence.js'
import {feedbackErrorCodes} from './evidence.js'
import {roleModelSelection,legacyRoleModelSelection} from '../role-models.js'
import {launchEnvironmentOf} from '../native-environment.js'
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status})}
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max
const target='zzusp/night-bot'
/** Ephemeral, browser-session-bound previews; no automatic retry of external
 * creates. A transport failure is unknown, never permission to send again. */
export function createFeedbackService({model,modelConsent=()=>({revision:'default',endpoint:'配置的模型服务'}),resolveModel,getSecrets=async()=>[],evidence,createEvidence,diagnose=diagnoseWithPi,paths,getToken,fetchImpl=fetch,now=Date.now}){
 const reports=new Map(),operations=new Set();let closed=false
 const track=fn=>{const promise=fn();operations.add(promise);promise.finally(()=>operations.delete(promise)).catch(()=>{});return promise}
 const metadata=()=>{try{return {target,model:model().provider+'/'+model().model,...modelConsent()}}catch{return {target,model:null,revision:null,endpoint:null}}}
 const clean=()=>{for(const[id,r]of reports)if(r.expires<=now()){r.controller.abort();clearTimeout(r.timer);reports.delete(id)}}
 const get=(owner,id)=>{if(closed)fail('FEEDBACK_CLOSED',503);clean();const r=reports.get(id);if(!r||r.owner!==owner)fail('FEEDBACK_NOT_FOUND',404);return r}
 const view=r=>({id:r.id,state:r.state,title:r.title,body:r.body??'',target,error:r.error??null,...r.url?{url:r.url}:{}})
 return {
  metadata,
  draft(owner,input,{secrets:additionalSecrets=[]}={}){
   if(closed)fail('FEEDBACK_CLOSED',503)
   if(!validText(input?.title,160)||!validText(input?.description,6000))fail('FEEDBACK_INPUT_INVALID')
   clean();if(reports.size>=16)fail('FEEDBACK_LIMIT',429)
   // Manual feedback never resolves a model, reads local evidence or enumerates credentials.
   const r={id:randomUUID(),owner,manual:true,title:redactFeedback(input.title.trim(),additionalSecrets),body:redactFeedback(input.description.trim(),additionalSecrets),state:'ready',expires:now()+30*60*1000,controller:new AbortController(),additionalSecrets}
   reports.set(r.id,r);r.timer=setTimeout(()=>{r.controller.abort();reports.delete(r.id)},30*60*1000);r.timer.unref?.()
   return view(r)
  },
  collect(owner,input,{secrets:additionalSecrets=[]}={}){
   if(closed)fail('FEEDBACK_CLOSED',503)
   if(input?.consent!==true)fail('FEEDBACK_CONSENT_REQUIRED',403)
   if(!validText(input.title,160)||!validText(input.description,6000))fail('FEEDBACK_INPUT_INVALID')
   const selection=structuredClone(model());if(input.revision!==modelConsent().revision||input.model!==selection.provider+'/'+selection.model)fail('FEEDBACK_MODEL_CHANGED',409)
   clean();if([...reports.values()].some(r=>r.state==='collecting'))fail('FEEDBACK_BUSY',409)
   if(reports.size>=16)fail('FEEDBACK_LIMIT',429)
   const controller=new AbortController(),r={id:randomUUID(),owner,title:'',state:'collecting',expires:now()+30*60*1000,controller,additionalSecrets};reports.set(r.id,r)
   r.timer=setTimeout(()=>{r.controller.abort();reports.delete(r.id)},30*60*1000);r.timer.unref?.()
   r.done=(async()=>{try{
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(300000)]),secrets=[...(r.manual?[]:await getSecrets()),...r.additionalSecrets]
    signal.throwIfAborted();r.title=redactFeedback(input.title.trim(),secrets)
    const description=redactFeedback(input.description.trim(),secrets)
    const resolved=await resolveModel({...selection,signal});signal.throwIfAborted();if(input.revision!==modelConsent().revision)fail('FEEDBACK_MODEL_CHANGED',409)
    const scopedEvidence=createEvidence?createEvidence({title:input.title,description:input.description,secrets}):evidence
    const result=await diagnose({resolved,paths,title:r.title,description,evidence:scopedEvidence,signal,secrets});signal.throwIfAborted()
    r.body=redactFeedback(`## 问题描述\n${description}\n\n## Pi 诊断\n${result}`,secrets);r.state='ready'
   }catch{if(r.state!=='cancelled'){r.state='failed';r.error='FEEDBACK_COLLECTION_FAILED'}}})()
   return view(r)
  },
  read(owner,id){return view(get(owner,id))},
  edit(owner,id,input){return track(async()=>{
   const r=get(owner,id);if(r.state!=='ready')fail('FEEDBACK_NOT_READY',409)
   if(!validText(input?.title,160)||!validText(input?.body,48000))fail('FEEDBACK_INPUT_INVALID')
   r.state='editing'
   try{const secrets=[...(r.manual?[]:await getSecrets()),...r.additionalSecrets];if(r.controller.signal.aborted)fail('FEEDBACK_CANCELLED',409);r.title=redactFeedback(input.title.trim(),secrets);r.body=redactFeedback(input.body.trim(),secrets);return view({...r,state:'ready'})}
   finally{if(r.state==='editing')r.state='ready'}
  })},
  async cancel(owner,id){const r=get(owner,id);if(['submitting','unknown','submitted'].includes(r.state))fail('FEEDBACK_ALREADY_SENT',409);r.state='cancelled';r.controller.abort();await r.done;clearTimeout(r.timer);reports.delete(id);return {ok:true}},
  submit(owner,id,input){return track(async()=>{
   const r=get(owner,id)
   if(input?.confirm!==true)fail('FEEDBACK_PUBLISH_CONSENT_REQUIRED',403)
   if(r.state==='submitted')return {url:r.url}
   if(r.state!=='ready')fail('FEEDBACK_NOT_READY',409)
   if(input.title!==r.title||input.body!==r.body)fail('FEEDBACK_PREVIEW_CHANGED',409)
   // Claim before any await. No concurrent or automatic duplicate issue creates.
   r.state='submitting'
   try{
    const secrets=[...(r.manual?[]:await getSecrets()),...r.additionalSecrets],title=redactFeedback(r.title,secrets),body=redactFeedback(r.body,secrets)
    if(title!==r.title||body!==r.body){r.title=title;r.body=body;r.state='ready';fail('FEEDBACK_PREVIEW_CHANGED',409)}
    const token=await getToken();if(typeof token!=='string'||!token.trim()){r.state='ready';fail('FEEDBACK_GITHUB_TOKEN_REQUIRED',503)}
    if(r.manual){const safeTitle=redactFeedback(r.title,[token]),safeBody=redactFeedback(r.body,[token]);if(safeTitle!==r.title||safeBody!==r.body){r.title=safeTitle;r.body=safeBody;r.state='ready';fail('FEEDBACK_PREVIEW_CHANGED',409)}}
    r.controller.signal.throwIfAborted();if(closed)fail('FEEDBACK_CLOSED',503)
    const response=await fetchImpl(`https://api.github.com/repos/${target}/issues`,{method:'POST',redirect:'error',signal:AbortSignal.any([r.controller.signal,AbortSignal.timeout(20000)]),headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':'2022-11-28'},body:JSON.stringify({title,body})})
    if(!response.ok){if([401,403,404,422].includes(response.status)){r.state='ready';fail('FEEDBACK_GITHUB_REJECTED',502)}fail('FEEDBACK_SUBMISSION_UNKNOWN',502)}
    const result=await response.json()
    if(typeof result.html_url!=='string'||!/^https:\/\/github\.com\/zzusp\/night-bot\/issues\/\d+$/.test(result.html_url))fail('FEEDBACK_SUBMISSION_UNKNOWN',502)
    r.url=result.html_url;r.state='submitted';return {url:r.url}
   }catch(error){if(r.state==='submitting'){r.state='unknown';r.error='FEEDBACK_SUBMISSION_UNKNOWN'}throw Object.assign(new Error(error.code??'FEEDBACK_SUBMISSION_UNKNOWN'),{code:error.code??'FEEDBACK_SUBMISSION_UNKNOWN',status:error.status??502})}
  })},
  async close(){closed=true;for(const r of reports.values()){r.controller.abort();clearTimeout(r.timer)};await Promise.allSettled([...reports.values()].map(r=>r.done).concat([...operations]));reports.clear()},
 }
}

export function hostFeedback(ctx,config,paths){
 const generations=new WeakMap()
 const selection=()=>roleModelSelection(ctx,'task',legacyRoleModelSelection(config,'task'))
 const modelConsent=()=>{const chosen=selection(),profile=ctx.get('nativePiProvider')?.profiles().get(chosen.provider);if(!profile)fail('FEEDBACK_MODEL_UNAVAILABLE',503);if(!generations.has(profile))generations.set(profile,randomUUID());const selected=profile.models.find(m=>m.id===chosen.model);let endpoint='配置的模型服务';try{endpoint=new URL(selected?.baseUrl??profile.baseURL).origin}catch{};return {revision:generations.get(profile)+':'+chosen.provider+':'+chosen.model,endpoint}}
 return createFeedbackService({paths,model:selection,modelConsent,
  resolveModel:selection=>ctx.get('nativePiProvider').official.resolve(selection),
  getSecrets:async()=>[...(await ctx.get('credentials')?.redactionValues?.()??[]),...(launchEnvironmentOf(ctx).redactionValues?.()??[])],
  getToken:()=>ctx.get('credentials')?.resolveCurrent?.('GITHUB_TOKEN')?.value??launchEnvironmentOf(ctx).getFrom('GITHUB_TOKEN',['process'])?.value,
  createEvidence:({title,description,secrets})=>{
   const chain=createChainEvidence({application:ctx.get('application'),getSessionPersistence:()=>ctx.sessionPersistence,getSchedule:()=>ctx.get('schedule'),title,description,secrets})
   return async(section,signal,args)=>{
   signal.throwIfAborted()
   if(section==='runtime')return {node:process.version,platform:process.platform,architecture:process.arch,uptimeSeconds:Math.floor(process.uptime()),rssMiB:Math.ceil(process.memoryUsage().rss/1048576)}
   if(section==='errors')return feedbackErrorCodes(paths.logs,signal)
   if(section==='channels'){
    const channels=ctx.get('channels')
    return {registered:channels?.plugins?.size??0,transports:channels?.transports?.size??0,closed:channels?.closed===true}
   }
   return chain(section,signal,args)
   }
  },
 })
}
