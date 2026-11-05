import {convertToLlm,resizeImage,formatDimensionNote} from '@earendil-works/pi-coding-agent'
import {piRequestContext,piRequestSource,piRequestEvent} from './pi-request-context.js'
import {piToolCatalog} from './pi-tool-catalog.js'
import {LlmError} from '../native-llm-errors.js'
import {fileHandleText,offloadedImageText,requestImageHandleText,textOnlyImageText} from '../native-message-protocol.js'
import {piRequestImageDimensions} from '../pi-provider-image.js'
const fail=(message,code='INVALID_REQUEST',details)=>{throw new LlmError(message,code,details)}
const original=event=>event?.type==='user/message'?event.data:event?.data?.message
const rawContent=entry=>entry?.type==='message'?entry.message.content:entry?.type==='custom_message'?entry.content:undefined
/** Night-specific custom message interpreter at Pi's documented convertToLlm
 * extension boundary. Ordinary messages, summaries and branch history are never
 * reconstructed here: the official converter owns them.
 */
function nightCustom(message,event){
 if(message.role!=='custom'||!['night.system','night.developer'].includes(message.customType))return undefined
 const role=message.customType.slice(6)
 if(event?.type!==role+'/message'||original(event)?.role!==role)fail('Night custom instruction lacks journal provenance','PI_CUSTOM_PROVENANCE_REQUIRED')
 const content=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content
 if(role==='system'){if(!Array.isArray(content)||content.some(part=>part.type!=='text'))fail('Night system instructions require text','UNSUPPORTED_CONTENT');return {role:'system',content,timestamp:message.timestamp}}
 const prior=original(event).content
 return {id:original(event).id,role:'developer',content:content.map((part,index)=>{
  if(part.type!=='text')fail('Night developer instructions require text')
  if(['tool-addition','tool-removal'].includes(prior[index]?.type))try{const value=JSON.parse(part.text);if(value.type===prior[index].type)return value}catch{}
  return part
 }),timestamp:message.timestamp}
}
/** Apply only Night attachment access/budgets to native blocks. No filesystem
 * read is inferred from provider-controlled message fields: source entries are
 * obtained through the request-local official projection association.
 */
export async function nativePiProviderContext(request,{profile,model,ctx,toolUpdate}={}){
 piRequestContext(request)
 const messages=[],customs=[],interpretations=new WeakMap(),versions=new Map(),imageBytes=[],attachments=ctx.get('attachments')
 let totalImageBytes=0
 function access(ref,kind){let host;try{host=attachments?.[kind+'HostPath']?.(ref)}catch{return}const path=host===undefined?undefined:ctx.get('fs')?.processPathFromHostPath(host);return path===undefined?undefined:path}
 for(const message of request.messages){
  const event=piRequestEvent(request,message),entry=piRequestSource(request,message),source=original(event)
  const custom=nightCustom(message,event)
  if(custom){customs.push(custom);interpretations.set(message,custom);messages.push(message);continue}
  if(Array.isArray(message.content)&&message.content.some(block=>block.type==='image')&&!['user','toolResult','custom'].includes(message.role))fail('Unsupported native image role '+message.role,'UNSUPPORTED_CONTENT')
  if(!['user','toolResult','custom'].includes(message.role)||!Array.isArray(message.content)){messages.push(message);continue}
  const raw=rawContent(entry),sourceBlocks=source?.content??[],used=new Set()
  const content=[];let changed=false
  for(const block of message.content){
   // Match the projected block to its persisted native block. Policy-inserted
   // text and context edits cannot acquire an unrelated attachment identity.
   const index=Array.isArray(raw)?raw.findIndex((part,index)=>!used.has(index)&&JSON.stringify(part)===JSON.stringify(block)):-1
   if(index>=0)used.add(index)
   const ref=index<0?undefined:sourceBlocks[index]
   if(block.type==='text'&&ref?.type==='file'&&block.text===JSON.stringify(ref)){
    content.push({type:'text',text:fileHandleText(ref.attachment,access(ref.attachment,'file'))});changed=true;continue
   }
   if(block.type==='text'&&ref?.type==='image'&&ref.offloaded&&block.text===JSON.stringify(ref)){
    const path=access(ref.attachment,'image');content.push({type:'text',text:offloadedImageText(ref.attachment,path?{readonlyPath:path}:undefined)});changed=true;continue
   }
   if(block.type!=='image'){content.push(block);continue}
   if(ref?.type==='image'&&ref.offloaded){const path=access(ref.attachment,'image');content.push({type:'text',text:offloadedImageText(ref.attachment,path?{readonlyPath:path}:undefined)});changed=true;continue}
   const attachment=ref?.type==='image'?ref.attachment:undefined
   if(!model.input.includes('image')){
    if(attachment){content.push({type:'text',text:textOnlyImageText(attachment)});changed=true}else content.push(block)
    continue
   }
   if(attachment){
    if(!attachments)fail('Durable attachment provider is required','UNSUPPORTED_CONTENT')
    const key=attachment.attachmentId
    if(!versions.has(key))versions.set(key,await attachments.readImageRequest(attachment,{...piRequestImageDimensions(attachment.width,attachment.height,profile.requestImagePixelBudget),maxBytes:profile.requestImageMaxBytes},request.signal))
    const version=versions.get(key),path=access(attachment,'image')
    const bytes=Math.ceil(version.bytes/3)*4;totalImageBytes+=bytes;imageBytes.push(bytes)
    content.push({type:'text',text:requestImageHandleText(attachment,version,path?{readonlyPath:path}:undefined)},{type:'image',data:Buffer.from(version.data).toString('base64'),mimeType:version.mediaType});changed=true
   }else{
    if(typeof block.data!=='string')fail('Invalid native image data','UNSUPPORTED_CONTENT')
    const edge=Math.max(1,Math.floor(Math.sqrt(profile.requestImagePixelBudget)))
    const version=await resizeImage(Buffer.from(block.data,'base64'),block.mimeType,{maxWidth:edge,maxHeight:edge,maxBytes:profile.requestImageMaxBytes})
    if(!version)fail('Native image cannot fit the request image limits','UNSUPPORTED_CONTENT')
    const bytes=Buffer.byteLength(version.data);totalImageBytes+=bytes;imageBytes.push(bytes)
    const note=formatDimensionNote(version);if(note)content.push({type:'text',text:note})
    content.push({type:'image',data:version.data,mimeType:version.mimeType});changed=true
   }
  }
  messages.push(changed?{...message,content}:message)
 }
 if(totalImageBytes>(profile.maxRequestImageBytes??Infinity)){let count=0;while(totalImageBytes>profile.maxRequestImageBytes&&count<imageBytes.length)totalImageBytes-=imageBytes[count++];fail('Request image budget exceeded','IMAGE_OFFLOAD_REQUIRED',{offloadImages:count})}
 const tools=request.tools??[]
 const known=new Set([...tools,...(request.toolHistory?.tools??[]),...(request.toolHistory?.updates.flatMap(update=>update.additions)??[])].map(tool=>tool.name))
 for(const message of customs)if(message.role==='developer')for(const block of message.content)if(block.type==='tool-addition'&&!known.has(block.toolName))fail('Undeclared tool change '+block.toolName)
 const catalog=piToolCatalog(customs.filter(message=>message.role==='developer'),tools,toolUpdate,request.toolHistory)
 const interpreted=messages.flatMap(message=>{
  const custom=interpretations.get(message)
  if(!custom)return [message]
  if(custom.role==='system')return [custom]
  const updates=catalog.updates.get(custom.id)
  if(!updates)return []
  const content=custom.content.filter(part=>part.type==='text')
  return updates.length?updates.map((delta,index)=>({...delta,content:index===0?content:[]})):content.length?[{role:'system',content,timestamp:custom.timestamp}]:[]
 })
 const native=convertToLlm(interpreted)
 const hasNativeCatalog=request.messages.some(message=>message.role==='system'&&(message.toolsAdded||message.toolsRemoved))
 let initial=hasNativeCatalog?[]:catalog.tools
 if(model.api==='anthropic-messages'&&toolUpdate==='in-history'&&!initial.length&&native.some(message=>message.role==='system'&&message.toolsAdded?.length))initial=[{name:'DeferredToolPlaceholder',description:'Reserved placeholder for deferred loading. Never call this tool.',parameters:{type:'object',properties:{}}}]
 return {messages:native,...request.system?{systemPrompt:request.system}:{},...initial.length?{tools:initial}:{}}
}
