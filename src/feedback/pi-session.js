import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager} from '@earendil-works/pi-coding-agent'
import {join} from 'node:path'
import {redactFeedback} from './redaction.js'
import {diagnosticSections,diagnosticPrompt,diagnosticToolParameters,diagnosticQueryFailure} from './diagnostic-contract.js'
/** A separate official Pi session. Capability restriction is enforced by the
 * tool allowlist, not by asking a full-access shell agent to behave read-only. */
export async function diagnoseWithPi({resolved,paths,title,description,evidence,signal,secrets=[]}){
 const cwd=paths.installRoot,agentDir=join(paths.runtime,'feedback'),settingsManager=SettingsManager.inMemory({packages:[],compaction:{enabled:false},retry:{enabled:false}})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'feedback-private-context',factory:pi=>{pi.on('before_agent_start',event=>{event.systemPromptOptions.cwd='[安装目录]'})}}],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:diagnosticPrompt,appendSystemPrompt:[]})
 await resourceLoader.reload();signal.throwIfAborted()
 let calls=0,bytes=0,budgetExceeded=false;const observations=[]
 const tool={name:'diagnosis_evidence',label:'调查现场证据',description:'先 discover 定位消息、业务任务、原生定时的匿名候选，再 message/trace/task/schedule/journal 按关联逐层调查，使用 continuations 续查。仅返回脱敏元数据，trace 支持 offset 分页；runtime/channels/errors 为补充证据。',parameters:diagnosticToolParameters(),async execute(_id,args){
  signal.throwIfAborted()
  if(!diagnosticSections.includes(args.section))throw new Error('FEEDBACK_TOOL_SECTION_INVALID')
  if(++calls>24){budgetExceeded=true;const text=JSON.stringify({coverage:'call-budget-exhausted',investigationComplete:false,meaning:'调查调用预算已用尽。必须声明调查未完成并列出尚缺证据，不得声称完整排查。'});if(!observations.some(x=>x.section==='budget'))observations.push({ref:'E'+(observations.length+1),section:'budget',text});return {content:[{type:'text',text}],details:{}}}
  if(bytes>=30000){budgetExceeded=true;return {content:[{type:'text',text:'{"coverage":"budget-exhausted","meaning":"调查未完成：证据预算已用尽，不代表链路完整；请基于已取得证据给出结论与尚缺证据。"}'}],details:{}}}
  let data
  try{data=await evidence(args.section,signal,args)}catch(error){signal.throwIfAborted();data=diagnosticQueryFailure(error)}
  signal.throwIfAborted()
  let text=redactFeedback(JSON.stringify(data),secrets)
  if(text.length>10000||bytes+text.length>30000)text=JSON.stringify({coverage:'output-too-large',meaning:'该证据页超过预算，未返回；请缩小查询或读取其他关联证据。'})
  bytes+=text.length;const ref='E'+(observations.length+1);observations.push({ref,section:args.section,text})
  return {content:[{type:'text',text:JSON.stringify({evidenceRef:ref,evidence:text})}],details:{}}
 }}
 const {session}=await createAgentSession({cwd,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager,resourceLoader,sessionManager:SessionManager.inMemory(cwd),noTools:'builtin',tools:[tool.name],customTools:[tool]})
 const abort=()=>{void session.abort()};signal.addEventListener('abort',abort,{once:true})
 const stream=session.agent.streamFunction
 session.agent.streamFunction=(model,context,options)=>{if(budgetExceeded)throw new Error('FEEDBACK_INVESTIGATION_BUDGET');return stream(model,context,{...options,...resolved.requestOptions,maxTokens:Math.min(8192,resolved.requestOptions?.maxTokens??8192,options?.maxTokens??8192),signal})}
 try{
  signal.throwIfAborted();try{await session.prompt(`问题标题：${redactFeedback(title,secrets)}\n问题描述：${redactFeedback(description,secrets)}`)}catch(error){if(!budgetExceeded)throw error}signal.throwIfAborted()
  const message=session.messages.filter(message=>message.role==='assistant').at(-1)
  if(!budgetExceeded&&(!message||message.stopReason==='error'||message.stopReason==='aborted'))throw new Error('FEEDBACK_MODEL_FAILED')
  const text=budgetExceeded?'调查未完成：达到证据调查预算，以下仅为已核实证据，尚不能作完整根因判断。':message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n')
  if(!text.trim()||!observations.length)throw new Error('FEEDBACK_MODEL_EMPTY')
  return redactFeedback(text.length>10000?text.slice(0,10000)+'\n[分析正文达到长度限制，已截断；请检查完整证据后编辑。]':text,secrets)+'\n\n## 已采集证据\n'+observations.map(item=>'### '+item.ref+' · '+item.section+'\n```json\n'+item.text+'\n```').join('\n')
 }finally{signal.removeEventListener('abort',abort);await session.dispose()}
}
