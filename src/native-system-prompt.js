import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {AnonymousEntries,NamedEntries,ScopedLayers,scopeTarget} from './native-scope.js'
// Application-owned assembly preserving the MIT dsh-system-prompt ordering,
// interpolation and request-admission contracts. Shared scope helpers remain.
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
export const PERSONA_PREFIX_SECTION='deployment:persona-prefix',PERSONA_SUFFIX_SECTION='deployment:persona-suffix',TOOL_ORDER_REST='<unlisted-tools>'
const variableName=/^[a-z][a-z0-9_]*$/
const lexical=(a,b)=>a<b?-1:a>b?1:0
const resolveContext=(entry,context)=>({name:entry.name,text:typeof entry.text==='function'?entry.text(context):entry.text,...entry.interpolate===undefined?{}:{interpolate:entry.interpolate}})
function layer(scope){const named=kind=>new NamedEntries(name=>new Error(`prompt ${kind} "${name}" is already registered${scope===undefined?'':' in this scope'}`));return{sections:named('section'),contexts:named('context'),variables:named('variable'),runtimeContextSuppressors:new AnonymousEntries(),toolProviders:new AnonymousEntries(),isEmpty(){return this.sections.isEmpty()&&this.contexts.isEmpty()&&this.variables.isEmpty()&&this.runtimeContextSuppressors.isEmpty()&&this.toolProviders.isEmpty()}}}
function sortTools(tools,order,known){if(tools.some(t=>t.name===TOOL_ORDER_REST))throw new Error('Tool provider returned reserved tool name '+TOOL_ORDER_REST);if(!order)return tools.sort((a,b)=>lexical(a.name,b.name));const missing=order.filter(n=>n!==TOOL_ORDER_REST&&!known.has(n));if(missing.length)throw new Error('toolOrder lists unregistered tools '+missing.join(', '));const listed=new Set(order),rest=tools.filter(t=>!listed.has(t.name)).sort((a,b)=>lexical(a.name,b.name));return order.flatMap(n=>n===TOOL_ORDER_REST?rest:tools.filter(t=>t.name===n))}
export default class NativeSystemPrompt extends Service {
 static Config=z.object({includeHarnessIdentity:z.boolean().default(true),includeRuntimeContext:z.boolean().default(true),personaPrefix:z.string().default(''),personaSuffix:z.string().default(''),toolOrder:z.array(z.string()).default(undefined)})
 constructor(ctx,config={}){super(ctx,'systemPrompt');this.host=ctx;this.layers=new ScopedLayers(layer,()=>ctx.emit('system-prompt/change'));const order=config.toolOrder;if(order&&(new Set(order).size!==order.length||!order.includes(TOOL_ORDER_REST)))throw new Error('toolOrder requires unique names and '+TOOL_ORDER_REST);this.toolOrder=order;if(config.includeHarnessIdentity??true)this.section({name:'harness:identity',order:SECTION_ORDERS.HARNESS_IDENTITY,text:'You are an AI agent powered by Pi.'});this.section({name:PERSONA_PREFIX_SECTION,order:SECTION_ORDERS.DEPLOYMENT_PERSONA_PREFIX,text:config.personaPrefix??''});this.section({name:PERSONA_SUFFIX_SECTION,order:SECTION_ORDERS.DEPLOYMENT_PERSONA_SUFFIX,text:config.personaSuffix??''});if(!(config.includeRuntimeContext??true))this.suppressRuntimeContext()}
 section(value){if(!Number.isFinite(value.order))throw new TypeError('Prompt section order must be finite');return this.layers.effect(this.ctx,l=>l.sections.insert(value.name,value),{label:'native prompt section'})}
 context(value){if(!Number.isFinite(value.order))throw new TypeError('Prompt context order must be finite');return this.layers.effect(this.ctx,l=>l.contexts.insert(value.name,value),{label:'native prompt context'})}
 variable(name,provider){if(!variableName.test(name))throw new Error('Invalid prompt variable name');return this.layers.effect(this.ctx,l=>l.variables.insert(name,provider),{label:'native prompt variable'})}
 tools(provider){return this.layers.effect(this.ctx,l=>l.toolProviders.append(provider),{label:'native prompt tools'})}
 suppressRuntimeContext(){return this.layers.effect(this.ctx,l=>l.runtimeContextSuppressors.append(true),{label:'native runtime context suppression'})}
 getSectionOrder(name){return SECTION_ORDERS[name]}
 getContextOrder(name){return CONTEXT_ORDERS[name]}
 suppressed(scope){return !this.layers.global.runtimeContextSuppressors.isEmpty()||this.layers.chainLayers(scope).some(l=>!l.runtimeContextSuppressors.isEmpty())}
 async assemble(context={}){
  const {scope}=context,chain=this.layers.chainLayers(scope),suppressed=this.suppressed(scope),variables={}
  for(const l of [this.layers.global,...chain])for(const [name,provider]of l.variables.entries())variables[name]=provider(context)
  const definitions=[...this.layers.merge(scope,l=>l.sections).values()].sort((a,b)=>a.order-b.order||lexical(a.name,b.name)),contextDefinitions=this.layers.merge(scope,l=>l.contexts),complete=definitions.filter(s=>s.complete===true)
  if(complete.length>1)throw new Error('Multiple complete prompt sections are active')
  const tools=[],known=new Set()
  for(const l of [this.layers.global,...chain])for(const provider of l.toolProviders.values()){const result=provider(context),schemas=result.schemas.map(t=>({name:t.name,description:t.description,parameters:structuredClone(t.parameters),...t.deferLoading===true?{deferLoading:true}:{}}));tools.push(...schemas);for(const name of result.knownNames??schemas.map(t=>t.name))known.add(name)}
  let authoritativeComplete
  const assembly={sections:definitions.map(s=>{const value=resolveContext(s,context);if(s.complete===true)authoritativeComplete={...value};return value}),contexts:[...contextDefinitions.values()].filter(c=>!suppressed||c.required===true).sort((a,b)=>a.order-b.order).map(c=>resolveContext(c,context)),tools:sortTools(tools,this.toolOrder,known),variables}
  const accepted=await this.ctx.waterfall(scopeTarget(this,scope),'system-prompt/assemble',assembly,context,()=>Promise.resolve(assembly))
  if(!authoritativeComplete&&!suppressed)return accepted
  const required=new Set([...contextDefinitions.values()].filter(c=>c.required===true).map(c=>c.name))
  return{...accepted,sections:authoritativeComplete?[authoritativeComplete]:accepted.sections,contexts:suppressed?accepted.contexts.filter(c=>required.has(c.name)):accepted.contexts}
 }
 refreshContext(assembly,context={}){
  const providers=this.layers.merge(context.scope,l=>l.contexts),suppressed=this.suppressed(context.scope),required=new Map([...providers].filter(([,c])=>c.required===true)),contexts=[]
  for(const accepted of assembly.contexts){const provider=providers.get(accepted.name);required.delete(accepted.name);if(suppressed&&provider?.required!==true)continue;contexts.push(provider?resolveContext(provider,context):accepted)}
  for(const provider of required.values()){const at=contexts.findIndex(c=>{const next=providers.get(c.name);return next!==undefined&&next.order>provider.order});contexts.splice(at<0?contexts.length:at,0,resolveContext(provider,context))}
  return{...assembly,contexts}
 }
}
