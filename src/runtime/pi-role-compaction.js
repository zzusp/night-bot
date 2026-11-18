import {CONTEXT_RETENTION_POLICY} from './context-retention-policy.js'
import {compact,convertToLlm} from '@earendil-works/pi-coding-agent'

const shared=[
 CONTEXT_RETENTION_POLICY,
 '保留Pi默认摘要章节与必要引用。以最新有效修订、取消、完成和更正替代旧结论；旧状态只可明确标注为已被替代。',
 '若本次为split turn，新事实明确指出替代的旧进行中状态，避免前后同时有效。不得从截断的工具结果推断未显示内容。',
 '长期行为指令只保留条目ID/版本引用，不复制成永久规则；当前standingInstructions为有效正文，旧摘要不得恢复已改删规则。',
 '任务与投递状态只是当时观察，不是当前事实或新授权。保留sourceId/version、taskId、notificationId等回查引用，外部系统已有报告不复制全文。',
 '区分模型意图、工具结果、持久收据、任务完成、通知冻结/送达及实际验收；prepared绝不推断为delivered。保留未决问题、向谁承诺什么以及下一步要查什么。',
].join('\n')
export const roleCompactionInstructions=role=>role==='channel-triage'?'NIGHT_ROLE_SUMMARY=triage\n'+shared+'\n分诊只保留对话指代、参与与首答约束、已分诊/承接来源及通知引用、需Router理解的问题。不维护任务执行清单，不保留完整发布或业务流水。':role==='conversation-router'?'NIGHT_ROLE_SUMMARY=router\n'+shared+'\nRouter保留当前用户目标范围、完成条件与任务引用、有效约束和纠正、安排/关联/依赖判断及动作收据、未决问题和承诺、下一步回查入口。区分目标必需步骤与可选复测/长流程验收；保留可选项待确认或已获用户同意的状态、部署后再复测等顺序，以及既往明确要求的来源/版本引用，不把建议写成要求或新增完成门槛。详细进度和最新状态交给账本索引/查询。':role==='task'?'NIGHT_ROLE_SUMMARY=task\n'+shared+'\n任务执行摘要只保留当前目标与验收要求、已验证的决定、关键未决假设与阻塞及其核验入口、必要工作产物路径和未结效果回执。区分已执行与拟执行，不补造完成或回执；原始证据与详细流水回查任务材料、Pi日志和Host账本。':undefined

/** Only the public Pi compactor and authenticated session stream are reused.
 * Extension failure cancels compaction; Pi must not silently run a generic one. */
export function roleCompactionExtension({role,getSession,onError=()=>{}}){
 const instructions=roleCompactionInstructions(role)
 if(!instructions)return
 return {name:'night-role-summary',factory:pi=>pi.on('session_before_compact',async event=>{
  try{
   event.signal.throwIfAborted()
   const session=getSession(),selected=session.model
   const route=selected.api==='pi-virtual'?await session.modelRuntime.resolveModel(selected,convertToLlm(session.messages),{reason:'direct',thinkingLevel:session.thinkingLevel,signal:event.signal}):{model:selected,thinkingLevel:session.thinkingLevel}
   const result=await compact(event.preparation,route.model,undefined,undefined,[instructions,event.customInstructions].filter(Boolean).join('\n'),event.signal,route.thinkingLevel,session.agent.streamFunction,undefined,session.settingsManager.getRetrySettings())
   event.signal.throwIfAborted()
   return {compaction:result}
  }catch(error){onError(error);return {cancel:true}}
 })}
}
