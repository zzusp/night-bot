/** Application text templates: compile literal/reference operations, then expand
 * once against own properties of one assembly. No recursive evaluation or code. */
function failure(code,owner,variable){
 const where=`${owner.kind} "${owner.name}"`,error=new Error(`${code} in prompt ${where}${variable===undefined?'':`: ${variable}`}`)
 Object.defineProperties(error,{code:{value:code,enumerable:true},contribution:{value:Object.freeze({...owner}),enumerable:true}})
 return error
}
export function compileTemplate(text,owner={kind:'section',name:'unnamed'}){
 owner=Object.freeze({kind:owner.kind,name:owner.name})
 if(typeof text!=='string')throw failure('NIGHT_PROMPT_TEMPLATE_INVALID',owner)
 const program=[];let position=0
 while(position<text.length){
  const opening=text.indexOf('{{',position)
  if(opening<0){program.push({literal:text.slice(position)});break}
  const closing=text.indexOf('}}',opening+2)
  if(closing<0){program.push({literal:text.slice(position)});break}
  const variable=text.slice(opening+2,closing)
  if(!/^[a-z][a-z0-9_]*$/.test(variable))throw failure('NIGHT_PROMPT_TEMPLATE_INVALID',owner)
  program.push({literal:text.slice(position,opening)},{variable});position=closing+2
 }
 const render=variables=>program.map(operation=>{
  if(operation.literal!==undefined)return operation.literal
  const key=operation.variable
  if(!Object.hasOwn(variables,key))throw failure('NIGHT_PROMPT_VARIABLE_UNKNOWN',owner,key)
  const value=variables[key]
  if(value===undefined)throw failure('NIGHT_PROMPT_VARIABLE_UNSET',owner,key)
  if(typeof value!=='string')throw failure('NIGHT_PROMPT_VARIABLE_INVALID',owner,key)
  return value
 }).join('')
 return Object.freeze(render)
}
function contribution(input,variables,kind){
 const owner={kind,name:input.name}
 if(typeof input.text!=='string')throw failure('NIGHT_PROMPT_TEMPLATE_INVALID',owner)
 return input.interpolate===false?input.text:compileTemplate(input.text,owner)(variables)
}
export function renderPrompt(assembly){
 const paragraphs=[]
 for(const section of assembly.sections){const text=contribution(section,assembly.variables,'section');if(text.length)paragraphs.push(text)}
 return paragraphs.join('\n\n')
}
export function renderContextSections(assembly){
 const sections=[]
 for(const context of assembly.contexts){const text=contribution(context,assembly.variables,'context');if(text.length)sections.push({name:context.name,text})}
 return sections
}
export function joinContextSections(sections){
 const body=sections.map(section=>section.text).join('\n\n')
 // Retained Night context framing keeps existing snapshot identities stable.
 return body.length?`Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${body}`:''
}
