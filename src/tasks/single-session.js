import {unresolvedJobReceipts,isJobOutcomeUncertain} from '../runtime/job-ledger.js'
import {createHash} from 'node:crypto'
import {appendPluginRecord} from '../native-session-protocol.js'
import {createUserMessage} from '../native-message-protocol.js'
import {inspectSession} from '../../packages/dingtalk-core/session-persistence.js'
const fail=code=>Object.assign(new Error(code),{code})
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const observational=new Set(['read','read_image','glob','grep','skill','web_search','web_fetch','memory_read','memory_search','memory_status','memory_candidates','job_output','job_list','task_result'])
const instructions='You are the sole execution session for this task. Directly use the available tools to complete the current authorized objective. There is no task coordinator, delegation or child execution session. Do not create another agent. Write process files and artifacts in work/ under this task workspace; tmp/ is temporary. materials/, outputs/, sessions/, reviews/ and task metadata are Host-owned, not writable. Report work/ artifact paths; the Host freezes selected delivery files into outputs/. Current user requirements and permissions prevail over memory and learned skills. Read current evidence, avoid unnecessary detours and never replay an already attempted effect. Unknown effects require reconciliation; do not claim success. Submit task_result with verified summary/evidence/limitations; use wait with a specific question when required information or authority is missing. Task completion does not depend on notification delivery or the separate tool-free retrospective. Do not send channel messages yourself.'
/** One task, one durable Pi session. No execution driver or subagent factory. */
export function createSingleTaskSessions({ctx,isCurrent,getWorkspaceDir,withPersistenceWriter=(_binding,action)=>action()}){
  const active=new Map();let closed=false
  async function run({binding,input,provider,model,reasoningEffort,agentPreset='night-bot',onSessionBound,submit}){
    if(closed||active.has(binding.taskId))throw fail('TASK_SESSION_BUSY')
    const entry={abort:new AbortController(),done:Promise.withResolvers(),submitted:false};active.set(binding.taskId,entry)
    const current=()=>!closed&&!entry.abort.signal.aborted&&isCurrent(binding)
    try{
      const cwd=await getWorkspaceDir({binding});let stored
      try{stored=await inspectSession(ctx.sessionPersistence,binding.sessionId)}catch(error){if(error.name!=='SessionPersistenceNotFoundError')throw error}
      if(binding.sessionBound&&!stored)throw fail('TASK_SESSION_MISSING')
      if(stored&&(stored.meta.cwd!==cwd||stored.events.find(e=>e.type==='plugin:night/task-identity')?.data.taskId!==binding.taskId))throw fail('TASK_SESSION_IDENTITY_MISMATCH')
      const intents=new Map()
      for(const event of stored?.events??[]){if(event.type==='plugin:night/task-effect-intent')intents.set(event.data.key,{...event.data,settled:false});if(event.type==='plugin:night/task-effect-result'&&intents.has(event.data.key))intents.get(event.data.key).settled=true}
      if(unresolvedJobReceipts(stored?.events??[],binding.sessionId).length)return {status:'no_submission',reason:'TASK_JOB_UNCERTAIN_NO_REPLAY'}
      if([...intents.values()].some(value=>!value.settled))return {status:'no_submission',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY'}
      const setup=async(agentCtx,agent)=>{
        await ctx.agentPresets.mount(agentCtx,'night-bot-task')
        const denied=agentCtx.tools.schemas(agent).map(tool=>tool.name).filter(name=>/^(?:subagent|task_delegate|task_execution|agent_create|schedule_create|schedule_update)/.test(name))
        if(denied.length)agentCtx.tools.restrict({deny:denied})
        agentCtx.systemPrompt.section({name:'task:single-execution',order:0,text:instructions})
        agentCtx.on('agent/pre-step',async(_event,next)=>entry.submitted||!await current()?{kind:'reject'}:next())
        agentCtx.on('tools/pre-execute',async(_exec,next)=>!await current()?{kind:'deny',reason:'TASK_SESSION_STALE'}:next())
        agentCtx.on('tools/execute',async(exec,next)=>{
          if(observational.has(exec.name))return next()
          const key=fingerprint({requirementRevision:binding.requirementRevision,contextRevision:binding.contextRevision??0,controlRevision:binding.controlRevision,name:exec.name,args:exec.arguments})
          if(intents.has(key))return {isError:true,content:[{type:'text',text:'TASK_EFFECT_ALREADY_ATTEMPTED: inspect original evidence; do not replay.'}],error:{message:'TASK_EFFECT_ALREADY_ATTEMPTED'}}
          appendPluginRecord(agent.session,'plugin:night/task-effect-intent',{key,name:exec.name,callId:exec.callId});await ctx.sessions.flush(agent.session);intents.set(key,{settled:false})
          const result=await next()
          // An aborted/unknown tool result cannot establish absence of effects.
          if(exec.signal.aborted||isJobOutcomeUncertain(result)||['ABORTED','TOOL_OUTCOME_UNKNOWN'].includes(result.error?.info?.code))throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          appendPluginRecord(agent.session,'plugin:night/task-effect-result',{key,isError:result.isError===true});await ctx.sessions.flush(agent.session);intents.get(key).settled=true
          return result
        })
        agentCtx.tools.register({name:'task_result',description:'Commit this single task execution result, or wait for a specific missing input. This concludes the turn.',parameters:{type:'object',required:['decision'],properties:{decision:{type:'object',properties:{action:{type:'string',enum:['complete','wait','blocked']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}},artifacts:{type:'array',items:{type:'string'}},deliveryFiles:{type:'array',items:{type:'object',properties:{path:{type:'string'},caption:{type:'string'}},required:['path'],additionalProperties:false}},question:{type:'string'},audience:{type:'string',enum:['topic','operator','requester']}},required:['action','summary','evidence','limitations'],additionalProperties:false}}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute({decision},exec){
          if(!await current())throw fail('TASK_SESSION_STALE')
          if((input.dialogue||input.humanReview)&&decision.action!=='wait')throw fail('TASK_DIALOGUE_REPLY_ONLY')
          if(decision.action==='blocked'&&!decision.question?.trim())throw fail('TASK_QUESTION_REQUIRED')
          if(decision.action==='complete'&&([...intents.values()].some(value=>!value.settled)||ctx.jobs.list(agent.session.id).some(job=>['running','stopping'].includes(job.status))))throw fail('TASK_NOT_QUIESCENT')
          const result=await submit(decision,binding);entry.submitted=true;exec.concludeTurn();return {received:true,...result}
        }})
      }
      const options={agentOptions:{provider,model,...reasoningEffort?{reasoningEffort}:{}},setup,signal:entry.abort.signal}
      entry.handle=await withPersistenceWriter(binding,()=>stored?ctx.agents.resume({...options,resumeSessionId:binding.sessionId}):ctx.agents.create({...options,sessionId:binding.sessionId,meta:{cwd,agentPreset:'night-bot-task'},seed:[{type:'plugin:night/task-identity',seq:0,time:Date.now(),ignorable:true,data:{taskId:binding.taskId}}]}))
      await ctx.sessions.flush(entry.handle.agent.session);await onSessionBound(binding)
      if(!await current())return {status:'stale'}
      entry.handle.agent.followup(createUserMessage({source:{kind:'task-input',taskSession:binding},content:[{type:'text',text:JSON.stringify({task:input.task,sources:input.sources,materials:input.materials,dialogue:input.dialogue,humanReview:input.humanReview,blockers:input.blockers})}]}))
      await entry.handle.agent.whenIdle()
      if(!entry.submitted&&await current())throw Object.assign(fail('TASK_SESSION_NO_SUBMISSION'),{phase:'decision'})
      return {status:entry.submitted?'submitted':'cancelled'}
    }finally{
      try{if(entry.handle){await entry.handle.agent.whenIdle();await ctx.sessions.flush(entry.handle.agent.session);await entry.handle.dispose()}}catch(cause){throw Object.assign(fail('TASK_SESSION_DRAIN_FAILED'),{taskSessionDrained:false,cause})}finally{active.delete(binding.taskId);entry.done.resolve()}
    }
  }
  async function cancel(taskId){const entry=active.get(taskId);if(!entry)return;entry.abort.abort();entry.handle?.agent.cancel({kind:'user'});await entry.done.promise}
  return {run,cancel,async close(){closed=true;await Promise.all([...active.keys()].map(cancel))}}
}
export const disabledExecutionSessions=()=>({run:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},cancel:async()=>{},feedback:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},close:async()=>{}})
