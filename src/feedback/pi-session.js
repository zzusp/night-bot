import {investigationBudget,diagnosticCompactionSettings,diagnosticOutputTokens} from './investigation-budget.js'
import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager} from '@earendil-works/pi-coding-agent'
import {join} from 'node:path'
import {redactFeedback} from './redaction.js'
import {diagnosticSections,diagnosticPrompt,diagnosticToolDescription,diagnosticToolParameters,diagnosticQueryFailure} from './diagnostic-contract.js'
/** A separate official Pi session. Capability restriction is enforced by the
 * tool allowlist, not by asking a full-access shell agent to behave read-only. */
export async function diagnoseWithPi({resolved,paths,title,description,evidence,signal,secrets=[],reportCharacters=investigationBudget.reportCharacters}){
 const cwd=paths.installRoot,agentDir=join(paths.runtime,'feedback'),settingsManager=SettingsManager.inMemory({packages:[],compaction:diagnosticCompactionSettings(resolved.model),retry:{enabled:false}})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'feedback-private-context',factory:pi=>{pi.on('before_agent_start',event=>{event.systemPromptOptions.cwd='[安装目录]'})}}],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:diagnosticPrompt,appendSystemPrompt:[]})
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
  return stream(model,context,{...request,...resolved.requestOptions,maxTokens:Math.min(diagnosticOutputTokens(model),resolved.requestOptions?.maxTokens??16384,options?.maxTokens??16384),signal:AbortSignal.any([signal,...(options?.signal?[options.signal]:[])])})
 }
 try{
  signal.throwIfAborted();try{await session.prompt(`问题标题：${redactFeedback(title,secrets)}\n问题描述：${redactFeedback(description,secrets)}`)}catch(error){if(!budgetExceeded)throw error}signal.throwIfAborted()
  let summaryFailed=false
  if(budgetExceeded){summarizing=true;lastAssistant=undefined;session.setActiveToolsByName([]);try{await session.prompt('调查预算已用尽。停止调查，仅根据已有证据给出部分诊断：已确认事实、已缩小的原因范围、仍缺证据。引用有效 E 编号，不声称完整排查。')}catch{signal.throwIfAborted();summaryFailed=true}}
  const message=lastAssistant??(!summarizing?session.messages.filter(message=>message.role==='assistant').at(-1):undefined)
  const valid=message&&!['error','aborted','toolUse'].includes(message.stopReason)
  if(!budgetExceeded&&!valid)throw new Error('FEEDBACK_MODEL_FAILED')
  const analysis=valid?message.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n')??'':''
  let text=analysis
  if(budgetExceeded){text='调查未完成：达到证据调查预算。\n\n'+(analysis||'未能生成部分诊断；已采集证据保留如下，尚不能判断根因。');if(summaryFailed||!analysis)text+='\n已采集证据：'+observations.map(row=>row.ref).join('、')+'。'}
  if(message?.stopReason==='length')text='[诊断报告不完整：模型输出达到 token 上限，内容已中断，不能视为完整分析。]\n\n'+text
  if(!text.trim()||!observations.length)throw new Error('FEEDBACK_MODEL_EMPTY')
  return formatDiagnosticReport(text,observations,secrets,{maxCharacters:reportCharacters})
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
export function formatDiagnosticReport(text,observations,secrets=[],{maxCharacters=investigationBudget.reportCharacters}={}){
 maxCharacters=Math.min(maxCharacters,investigationBudget.reportCharacters)
 const clean=value=>redactFeedback(value,secrets,{maxLength:Infinity})
 const body=limitDiagnosticText(clean(text),Math.min(22000,Math.floor(maxCharacters/2))),cited=new Set(body.match(/\bE\d+\b/g)??[]),ordered=observations.filter(row=>cited.has(row.ref)),parts=[],omitted=[]
 for(const ref of cited)if(!observations.some(row=>row.ref===ref))omitted.push(ref)
 const coverage='\n\n[共采集 '+observations.length+' 项证据，仅附正文引用项；未引用项不代表未调查。]'
 const missingNote='\n\n## 未附证据\n[以下引用未采集或完整内容超过附录预算，本草稿无法核对；请缩小证据页后重新调查，勿当作完整证据链。]\n'
 const missingReserve=missingNote.length+[...cited].join('、').length
 const appendixBudget=Math.max(0,Math.min(investigationBudget.appendixCharacters,maxCharacters-body.length-coverage.length-missingReserve-100))
 let size=0
 for(const item of ordered){
  const value=clean(item.text),fence='~'.repeat(Math.max(3,...[...value.matchAll(/~+/g)].map(match=>match[0].length+1)))
  const part='### '+item.ref+' · '+item.section+'\n'+fence+'text\n'+value+'\n'+fence
  if(size+part.length>appendixBudget){omitted.push(item.ref);continue}
  parts.push(part);size+=part.length
 }
 const missing=omitted.length?missingNote+omitted.join('、'):''
 return body+'\n\n## 已采集证据\n'+parts.join('\n')+missing+coverage
}
