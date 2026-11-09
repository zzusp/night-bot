import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {compileTemplate} from './runtime/prompt-template.js'
import {scopeChainOf,scopeOf} from './native-scope.js'
// Night business instruction contributions. Pi owns resource loading, system
// prompt construction and request/context lifecycle. Shared scope identities
// remain attributed separately; this registry stores no messages or history.
// Retained ordering vocabulary: MIT dsh-system-prompt; see licenses/dsh-system-prompt-MIT.txt.
const SECTION_ORDERS = {
	HARNESS_IDENTITY: -1e3,
	DEPLOYMENT_PERSONA_PREFIX: 0,
	PLAN_POLICY: 500,
	TEAM_POLICY: 600,
	PTC_ONLY: 800,
	FILE_REFERENCE: 900,
	TOOL_BASH: 1e3,
	TOOL_PWSH: 1010,
	TOOL_READ: 1100,
	TOOL_WRITE: 1200,
	TOOL_EDIT: 1300,
	TOOL_GLOB: 1400,
	TOOL_GREP: 1500,
	TOOL_JOBS: 1600,
	TOOL_PTY: 1700,
	TOOL_WEB_SEARCH: 2e3,
	TOOL_WEB_FETCH: 2100,
	TOOL_LSP: 2200,
	TOOL_SESSION_QUERY: 2300,
	TOOL_GOAL: 2400,
	TOOL_WORKFLOW: 2600,
	TOOL_RALPH: 2700,
	TOOL_SUBAGENT: 2800,
	TOOL_REPORT: 2900,
	TOOL_COMPUTER_USE: 3e3,
	MCP_SERVERS: 3100,
	TOOLS_SDK: 5e3,
	DELIVERABLE_FILE_REFERENCES: 9e3,
	STRUCTURED_OUTPUT: 9900,
	HARNESS_SOURCE: 1e4,
	WEB_SURFACE: 10100,
	DEPLOYMENT_PERSONA_SUFFIX: 10200
};
const CONTEXT_ORDERS = {
	WORKING_DIRECTORY: 100,
	SANDBOX_POLICY: 110,
	APPROVAL_POLICY: 115,
	SUBAGENT_DELEGATION: 120
};
export const PERSONA_PREFIX_SECTION='deployment:persona-prefix',PERSONA_SUFFIX_SECTION='deployment:persona-suffix'
const variableName=/^[a-z][a-z0-9_]*$/
const lexical=(a,b)=>a<b?-1:a>b?1:0
// A registration is owned by its Cordis effect, rather than by a parallel
// hierarchy of mutable assembly layers. Resolve visibility afresh on every run.
class Contributions {
 constructor(notify){this.records=new Set();this.notify=notify}
 add(ctx,kind,name,value){
  const owner=scopeOf(ctx)
  if(name!==undefined&&[...this.records].some(row=>row.owner===owner&&row.kind===kind&&row.name===name))throw new Error(`prompt ${kind} "${name}" is already registered`)
  const row={owner,kind,name,value}
  return ctx.effect(()=>{this.records.add(row);this.notify();return()=>{this.records.delete(row);this.notify()}},'Night instruction contribution')
 }
 visible(scope,kind){
  const precedence=[undefined,...scopeChainOf(scope).reverse()],rank=new Map(precedence.map((owner,index)=>[owner,index]))
  return [...this.records].filter(row=>row.kind===kind&&rank.has(row.owner)).sort((a,b)=>rank.get(a.owner)-rank.get(b.owner))
 }
 named(scope,kind){return new Map(this.visible(scope,kind).map(row=>[row.name,row.value]))}
 values(scope,kind){return this.visible(scope,kind).map(row=>row.value)}
}
export default class NativeSystemPrompt extends Service {
 static Config=z.object({includeHarnessIdentity:z.boolean().default(true),includeRuntimeContext:z.boolean().default(true),personaPrefix:z.string().default(''),personaSuffix:z.string().default('')})
 constructor(ctx,config={}){super(ctx,'systemPrompt');this.host=ctx;this.contributions=new Contributions(()=>ctx.emit('system-prompt/change'));if(config.toolOrder!==undefined)throw Object.assign(new Error('Tool catalog ordering belongs to the official tool projection'),{code:'NIGHT_PROMPT_TOOL_ORDER_RETIRED'});if(config.includeHarnessIdentity??true)this.section({name:'harness:identity',order:SECTION_ORDERS.HARNESS_IDENTITY,text:'You are an AI agent powered by Pi.'});this.section({name:PERSONA_PREFIX_SECTION,order:SECTION_ORDERS.DEPLOYMENT_PERSONA_PREFIX,text:config.personaPrefix??''});this.section({name:PERSONA_SUFFIX_SECTION,order:SECTION_ORDERS.DEPLOYMENT_PERSONA_SUFFIX,text:config.personaSuffix??''});if(!(config.includeRuntimeContext??true))this.suppressRuntimeContext()}
 section(value){if(!Number.isFinite(value.order))throw new TypeError('Prompt section order must be finite');return this.contributions.add(this.ctx,'section',value.name,Object.freeze({...value}))}
 context(value){if(!Number.isFinite(value.order))throw new TypeError('Prompt context order must be finite');return this.contributions.add(this.ctx,'context',value.name,Object.freeze({...value}))}
 variable(name,provider){if(!variableName.test(name))throw new Error('Invalid prompt variable name');return this.contributions.add(this.ctx,'variable',name,provider)}
 tools(provider){return this.contributions.add(this.ctx,'tools',undefined,provider)}
 suppressRuntimeContext(){return this.contributions.add(this.ctx,'suppression',undefined,true)}
 getSectionOrder(name){return SECTION_ORDERS[name]}
 getContextOrder(name){return CONTEXT_ORDERS[name]}
 suppressed(scope){return this.contributions.values(scope,'suppression').length>0}
 /** Official Pi business contributions only. Dynamic legacy callbacks must opt
  * into the actor contract; evaluating them with a fake Session is forbidden. */
 async officialSections(actor){
  const scope=actor,variables={},context={actor,scope}
  const problem=name=>Object.assign(new Error(`Official prompt adapter required: ${name}`),{code:'PI_OFFICIAL_PROMPT_ADAPTER_REQUIRED',contribution:name})
  for(const [name,provider]of this.contributions.named(scope,'variable')){
   if(typeof provider.official!=='function')throw problem(name)
   variables[name]=await provider.official(context)
  }
  const definitions=[...this.contributions.named(scope,'section').values(),...this.contributions.named(scope,'context').values()].filter(c=>!this.suppressed(scope)||c.required===true||!this.contributions.named(scope,'context').has(c.name)).sort((a,b)=>a.order-b.order||lexical(a.name,b.name))
  if(definitions.some(c=>c.complete))throw problem('complete prompt')
  const sections={}
  for(const entry of definitions){
   const value=entry.officialText?await entry.officialText(context):typeof entry.text==='function'?(()=>{throw problem(entry.name)})():entry.text
   if(typeof value!=='string')throw problem(entry.name)
   const text=entry.interpolate===false?value:compileTemplate(value,{kind:'section',name:entry.name})(variables)
   if(text)sections['night_'+Buffer.from(entry.name).toString('hex')]=text
  }
  return sections
 }
}
