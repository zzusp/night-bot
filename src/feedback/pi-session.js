import {investigationBudget,diagnosticCompactionSettings,diagnosticOutputTokens} from './investigation-budget.js'
import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager} from '@earendil-works/pi-coding-agent'
import {join} from 'node:path'
import {redactFeedback} from './redaction.js'
import {diagnosticSections,diagnosticPrompt,diagnosticToolParameters,diagnosticQueryFailure} from './diagnostic-contract.js'
/** A separate official Pi session. Capability restriction is enforced by the
 * tool allowlist, not by asking a full-access shell agent to behave read-only. */
export async function diagnoseWithPi({resolved,paths,title,description,evidence,signal,secrets=[]}){
 const cwd=paths.installRoot,agentDir=join(paths.runtime,'feedback'),settingsManager=SettingsManager.inMemory({packages:[],compaction:diagnosticCompactionSettings(resolved.model),retry:{enabled:false}})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'feedback-private-context',factory:pi=>{pi.on('before_agent_start',event=>{event.systemPromptOptions.cwd='[安装目录]'})}}],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:diagnosticPrompt,appendSystemPrompt:[]})
 await resourceLoader.reload();signal.throwIfAborted()
 let calls=0,bytes=0,budgetExceeded=false,summarizing=false;const observations=[]
 const tool={name:'diagnosis_evidence',label:'调查现场证据',description:'先 discover 定位消息、业务任务、原生定时的匿名候选，再 message/trace/task/schedule/journal 按关联逐层调查，使用 continuations 续查。code_search/code_read 核对受控产品代码，logs 读取脱敏日志片段，evidence 按 E 编号重读；所有列表支持各自 offset 续读。runtime/channels/errors 为补充证据。',parameters:diagnosticToolParameters(),async execute(_id,args){
  signal.throwIfAborted()
  if(!diagnosticSections.includes(args.section))throw new Error('FEEDBACK_TOOL_SECTION_INVALID')
  if(++calls>investigationBudget.calls){budgetExceeded=true;const text=JSON.stringify({coverage:'call-budget-exhausted',investigationComplete:false,meaning:'调查调用预算已用尽。必须声明调查未完成并列出尚缺证据，不得声称完整排查。'});if(!observations.some(x=>x.section==='budget'))observations.push({ref:'E'+(observations.length+1),section:'budget',text});return {content:[{type:'text',text}],details:{}}}
  if(bytes>=investigationBudget.evidenceCharacters){budgetExceeded=true;return {content:[{type:'text',text:'{"coverage":"budget-exhausted","meaning":"调查未完成：证据预算已用尽，不代表链路完整；请基于已取得证据给出结论与尚缺证据。"}'}],details:{}}}
  if(args.section==='evidence'){const previous=observations.find(item=>item.ref===args.alias);if(!previous)throw new Error('FEEDBACK_ALIAS_INVALID');return {content:[{type:'text',text:JSON.stringify({evidenceRef:previous.ref,evidence:previous.text})}],details:{}}}
  let data
  try{data=await evidence(args.section,signal,args)}catch(error){signal.throwIfAborted();data=diagnosticQueryFailure(error)}
  signal.throwIfAborted()
  let text=redactFeedback(JSON.stringify(data),secrets)
  if(text.length>investigationBudget.pageCharacters||bytes+text.length>investigationBudget.evidenceCharacters)text=JSON.stringify({coverage:'output-too-large',meaning:'该证据页超过预算，未返回；请缩小查询或读取其他关联证据。'})
  bytes+=text.length;const ref='E'+(observations.length+1);observations.push({ref,section:args.section,text})
  return {content:[{type:'text',text:JSON.stringify({evidenceRef:ref,evidence:text})}],details:{}}
 }}
 const {session}=await createAgentSession({cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager,resourceLoader,sessionManager:SessionManager.inMemory(cwd),noTools:'builtin',tools:[tool.name],customTools:[tool]})
 let lastAssistant
 const unsubscribe=session.subscribe(event=>{if(event.type==='message_end'&&event.message?.role==='assistant')lastAssistant=event.message})
 const abort=()=>{void session.abort()};signal.addEventListener('abort',abort,{once:true})
 const stream=session.agent.streamFunction
 session.agent.streamFunction=(model,context,options)=>{if(budgetExceeded&&!summarizing)throw new Error('FEEDBACK_INVESTIGATION_BUDGET');return stream(model,context,{...options,...resolved.requestOptions,maxTokens:Math.min(diagnosticOutputTokens(model),resolved.requestOptions?.maxTokens??16384,options?.maxTokens??16384),signal:AbortSignal.any([signal,...(options?.signal?[options.signal]:[])])})}
 try{
  signal.throwIfAborted();try{await session.prompt(`问题标题：${redactFeedback(title,secrets)}\n问题描述：${redactFeedback(description,secrets)}`)}catch(error){if(!budgetExceeded)throw error}signal.throwIfAborted()
  if(budgetExceeded){summarizing=true;session.setActiveToolsByName([]);try{await session.prompt('调查预算已用尽。停止调查，仅根据已有证据给出部分诊断：已确认事实、已缩小的原因范围、仍缺证据。引用有效 E 编号，不声称完整排查。')}catch{signal.throwIfAborted()}}
  const message=lastAssistant??session.messages.filter(message=>message.role==='assistant').at(-1)
  if(!budgetExceeded&&(!message||message.stopReason==='error'||message.stopReason==='aborted'))throw new Error('FEEDBACK_MODEL_FAILED')
  const analysis=message?.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n')??''
  const text=budgetExceeded?'调查未完成：达到证据调查预算。\n\n'+(analysis||'未能生成部分诊断，请重新缩小问题范围。'):analysis
  if(!text.trim()||!observations.length)throw new Error('FEEDBACK_MODEL_EMPTY')
  return formatDiagnosticReport(text,observations,secrets)
 }finally{unsubscribe();signal.removeEventListener('abort',abort);await session.dispose()}
}

/** Published draft contains cited evidence excerpts, not the entire model context. */
export function formatDiagnosticReport(text,observations,secrets=[]){
 const cited=new Set(text.match(/\bE\d+\b/g)??[]),ordered=observations.filter(row=>cited.has(row.ref))
 const parts=[];let size=0
 for(const item of ordered){const excerpt=redactFeedback(item.text,secrets).slice(0,2500),part='### '+item.ref+' · '+item.section+'\n```text\n'+excerpt+'\n```'+(excerpt.length<item.text.length?'\n[证据节选]':'');if(size+part.length>investigationBudget.appendixCharacters)continue;parts.push(part);size+=part.length}
 const body=text.length>22000?text.slice(0,22000)+'\n[分析正文已截断，请编辑核对。]':text
 const coverage=parts.length<observations.length?'\n\n[仅附精选证据，共调查 '+observations.length+' 项；未附项不代表未调查。]':''
 return redactFeedback(body+'\n\n## 已采集证据\n'+parts.join('\n')+coverage,secrets).slice(0,investigationBudget.reportCharacters)
}
