import {SAFE_TOOL_PARALLELISM_POLICY} from '../runtime/parallel-read.js'
import {investigationBudget,diagnosticCompactionSettings,diagnosticOutputTokens,diagnosticMaxAttempts} from './investigation-budget.js'
import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager} from '@earendil-works/pi-coding-agent'
import {join} from 'node:path'
import {redactFeedback} from './redaction.js'
import {diagnosticSections,diagnosticPrompt,diagnosticToolDescription,diagnosticToolParameters,diagnosticQueryFailure} from './diagnostic-contract.js'
/** A separate official Pi session. Capability restriction is enforced by the
 * tool allowlist, not by asking a full-access shell agent to behave read-only. */
export async function diagnoseWithPi({resolved,paths,title,description,evidence,signal,secrets=[],reportCharacters=investigationBudget.reportCharacters}){
 const cwd=paths.installRoot,agentDir=join(paths.runtime,'feedback'),settingsManager=SettingsManager.inMemory({packages:[],compaction:diagnosticCompactionSettings(resolved.model),retry:{enabled:true,maxRetries:diagnosticMaxAttempts-1,baseDelayMs:500}})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'feedback-private-context',factory:pi=>{pi.on('before_agent_start',event=>{event.systemPromptOptions.cwd='[安装目录]'})}}],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:diagnosticPrompt+'\n'+SAFE_TOOL_PARALLELISM_POLICY,appendSystemPrompt:[]})
 await resourceLoader.reload();signal.throwIfAborted()
 let calls=0,bytes=0,budgetExceeded=false,summarizing=false;const observations=[]
 const tool={name:'diagnosis_evidence',label:'调查现场证据',description:diagnosticToolDescription,parameters:diagnosticToolParameters(),async execute(_id,args){
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
 const prepare=session.agent.prepareRequest
 session.agent.prepareRequest=async(request,requestSignal)=>{if(budgetExceeded&&!summarizing)throw new Error('FEEDBACK_INVESTIGATION_BUDGET');return prepare?.(request,requestSignal)}
 const stream=session.agent.streamFunction
 session.agent.streamFunction=(model,context,options)=>{
  // Pi summaries may pre-resolve auth for an unmarked wrapper. Never feed that
  // credential back as an API-key override: ModelRuntime owns auth resolution.
  const {apiKey,headers,env,...request}=options??{}
  // Pi retries in the same session; do not multiply attempts with transport retries.
  return stream(model,context,{...request,...resolved.requestOptions,maxRetries:0,maxTokens:Math.min(diagnosticOutputTokens(model),resolved.requestOptions?.maxTokens??16384,options?.maxTokens??16384),signal:AbortSignal.any([signal,...(options?.signal?[options.signal]:[])])})
 }
 try{
  signal.throwIfAborted();try{await session.prompt(`问题标题：${redactFeedback(title,secrets)}\n问题描述：${redactFeedback(description,secrets)}`)}catch(error){if(!budgetExceeded)throw error}signal.throwIfAborted()
  if(budgetExceeded){summarizing=true;lastAssistant=undefined;session.setActiveToolsByName([]);try{await session.prompt('调查预算已用尽。停止调查，仅根据已有证据给出部分诊断：已确认事实、已缩小的原因范围、仍缺证据。引用有效 E 编号，不声称完整排查。')}catch{signal.throwIfAborted();lastAssistant=undefined}}
  signal.throwIfAborted()
  const message=lastAssistant??(!summarizing?session.messages.filter(message=>message.role==='assistant').at(-1):undefined)
  let analysis='',failure
  if(message?.stopReason==='stop'||message?.stopReason==='length'){
   analysis=message.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n').trim()??''
   if(!analysis||!observations.length)failure='FEEDBACK_MODEL_EMPTY'
  }else if(message?.stopReason==='aborted')failure='FEEDBACK_MODEL_ABORTED'
  else if(message?.stopReason==='error'&&message.errorMessage==='Request timed out.')failure='FEEDBACK_MODEL_TIMEOUT'
  else failure='FEEDBACK_MODEL_FAILED'
  if(!observations.length)throw new Error(failure)
  const status=[
   budgetExceeded?'调查未完成：达到证据调查预算。':'',
   failure&&!budgetExceeded?`调查未完成：模型未给出有效分析（${failure}）。`:'',
   message?.stopReason==='length'?'诊断报告不完整：模型输出达到 token 上限，内容已中断，不能视为完整分析。':'',
  ].filter(Boolean).join('\n')
  return formatDiagnosticReport(analysis,observations,secrets,{maxCharacters:reportCharacters,status})
 }finally{unsubscribe();signal.removeEventListener('abort',abort);await session.dispose()}
}

/** Keep Markdown fences balanced when an explicitly marked prose limit applies. */
export function limitDiagnosticText(text,maxCharacters,label='分析正文'){
 if(text.length<=maxCharacters)return text
 const note='\n\n['+label+'达到长度限制，已截断；后续内容未包含，请缩小范围后重新调查。]'
 const end=Math.max(0,maxCharacters-note.length-16);let body=text.slice(0,end)
 const fences=body.match(/^\s*(`{3,}|~{3,})[^\n]*$/gm)??[]
 if(fences.length%2)body+='\n'+fences.at(-1).trim().match(/^(`+|~+)/)[0]+'\n'
 return (body+note).slice(0,maxCharacters)
}

/** Cited evidence is attached whole, or explicitly listed as unavailable. */
export function formatDiagnosticReport(text,observations,secrets=[],{maxCharacters=investigationBudget.reportCharacters,status=''}={}){
 maxCharacters=Math.min(maxCharacters,investigationBudget.reportCharacters)
 const clean=value=>redactFeedback(value,secrets,{maxLength:Infinity})
 const body=limitDiagnosticText(clean(text),Math.min(22000,Math.floor(maxCharacters/2)))
 const cited=new Set(body.match(/\bE\d+\b/g)??[]),refs=new Set(observations.map(row=>row.ref)),selected=observations.filter(row=>cited.has(row.ref))
 const missing=[...cited].filter(ref=>!refs.has(ref)),parts=[]
 const missingNote='\n\n## 未附证据\n[以下引用未采集或完整内容超过附录预算，本草稿无法核对；请缩小证据页后重新调查，勿当作完整证据链。]\n'
 const unverified='分析未附可核对的证据引用，不能据此判断根因。'
 const noAnalysis='未能生成部分诊断；已采集证据保留如下，尚不能判断根因。'
 const footer=count=>`\n\n[共采集 ${observations.length} 项证据，附上 ${count} 项。${selected.length?'优先保留正文引用项。':'附录仅供人工核对，与分析结论未建立引用关系。'}]`
 const heading='\n\n## 已采集证据\n',empty='（未能附上完整证据页。）'
 const overhead=status.length+unverified.length+noAnalysis.length+heading.length+empty.length+footer(observations.length).length+missingNote.length+[...cited].join('、').length+6
 const appendixBudget=Math.max(0,Math.min(investigationBudget.appendixCharacters,maxCharacters-body.length-overhead))
 let size=0
 for(const item of selected.length?selected:observations){
  const value=clean(item.text),fence='~'.repeat(Math.max(3,...[...value.matchAll(/~+/g)].map(match=>match[0].length+1)))
  const part='### '+item.ref+' · '+item.section+'\n'+fence+'text\n'+value+'\n'+fence
  if(size+part.length+1>appendixBudget){if(cited.has(item.ref))missing.push(item.ref);continue}
  parts.push(part);size+=part.length+1
 }
 return [status,body&&(!selected.length||!parts.length)?unverified:'',body||noAnalysis].filter(Boolean).join('\n\n')+heading+(parts.join('\n')||empty)+(missing.length?missingNote+missing.join('、'):'')+footer(parts.length)
}
