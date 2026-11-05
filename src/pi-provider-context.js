import { LlmError } from './native-llm-protocol.js';
import { projectFilesToText, projectImagesForTextModel, projectOffloadedImages, projectToolUpdates, offloadedImageText, requestImageHandleText, requiredImageOffload } from './native-message-protocol.js';
import { piRequestImageDimensions } from './pi-provider-image.js'
import { projectPiMessage } from './pi-session-persistence.js'
const tool=({name,description,parameters})=>({name,description,parameters})
const fail=(message,code='UNSUPPORTED_CONTENT',details)=>{throw new LlmError(message,code,details)}
/** Request projection while the generic Host attachment/history policies remain.
 * Pi supplies authoritative message content. Shared public policy helpers are
 * retained explicitly until the corresponding attachment/LLM seam migration.
 */
export async function piProviderContext(request,{profile,model,ctx,alreadyProjected=false,toolUpdate}={}) {
  let messages=request.messages,tools=request.tools??[]
  const updateMode=toolUpdate??request.toolUpdate
  if(!alreadyProjected){
    messages=projectFilesToText(messages,ref=>{try{const path=ctx.get('attachments')?.fileHostPath(ref);return path===undefined?undefined:ctx.get('fs')?.processPathFromHostPath(path)}catch{return undefined}})
    if(!model.input.includes('image'))messages=projectImagesForTextModel(messages)
    const updated=projectToolUpdates(messages,tools,updateMode,request.toolHistory);messages=updated.messages;tools=updated.tools??[]
  }
  for(const message of messages){
    if(message.role!=='developer'&&message.content.some(b=>['tool-addition','tool-removal'].includes(b.type)))fail('Tool declaration changes require developer role')
    if(!['user','tool'].includes(message.role)&&message.content.some(b=>b.type==='image'))fail('Unsupported image role '+message.role)
    if(message.role==='system'&&message.content.some(b=>b.type!=='text'))fail('System instructions must be text')
  }
  const leading=[request.system],rest=messages.slice();while(rest[0]?.role==='system')leading.push(rest.shift().content.map(b=>b.text).join(''))
  const imageRefs=new Map(),versions=new Map(),attachments=ctx.get('attachments')
  for(const message of rest)for(const block of message.content)if(block.type==='image'&&!block.offloaded)imageRefs.set(block.attachment.attachmentId,block.attachment)
  if(imageRefs.size&&!attachments)fail('Durable attachments are required for image input')
  await Promise.all([...imageRefs].map(async([id,ref])=>{
    const dimensions=piRequestImageDimensions(ref.width,ref.height,profile.requestImagePixelBudget)
    versions.set(id,await attachments.readImageRequest(ref,{...dimensions,maxBytes:profile.requestImageMaxBytes},request.signal))
  }))
  if(imageRefs.size){
    const count=requiredImageOffload(rest,{representation:'base64',maxBytes:profile.maxRequestImageBytes},block=>versions.get(block.attachment.attachmentId).bytes)
    if(count)fail('Request image budget exceeded','IMAGE_OFFLOAD_REQUIRED',{offloadImages:count})
  }
  function imageAccess(ref){const host=attachments?.imageHostPath(ref);const path=host===undefined?undefined:ctx.get('fs')?.processPathFromHostPath(host);return path===undefined?undefined:{readonlyPath:path}}
  const exact=projectOffloadedImages(rest,ref=>offloadedImageText(ref,imageAccess(ref))),native=[],names=new Map()
  function content(blocks){
    const projected=[]
    for(const block of blocks)if(block.type==='text'){if(block.text)projected.push({...block})}
    else if(block.type==='image'){
      const ref=block.attachment,version=versions.get(ref.attachmentId)
      if(!version)fail('Request image version is missing','INVALID_REQUEST')
      projected.push({type:'text',text:requestImageHandleText(ref,version,imageAccess(ref))},{type:'image',data:Buffer.from(version.data).toString('base64'),mimeType:version.mediaType})
    }else if(block.type==='file')fail('File references must be projected by the Host boundary')
    return projected.every(b=>b.type==='text')?projected.map(b=>b.text).join(''):projected
  }
  for(const message of exact){
    if(message.role==='system'){const text=message.content.map(b=>b.text).join('');if(text)native.push({role:'system',content:text,timestamp:0});continue}
    if(message.role==='developer'){
      const text=[],added=[],removed=[]
      for(const block of message.content){
        if(block.type==='text'){if(block.text)text.push({...block})}
        else if(block.type==='tool-addition'){const declared=tools.find(t=>t.name===block.toolName);if(!declared)fail('Undeclared tool change '+block.toolName,'INVALID_REQUEST');added.push(tool(declared))}
        else if(block.type==='tool-removal')removed.push({name:block.toolName})
        else fail('Unsupported developer content '+block.type)
      }
      if(text.length||added.length||removed.length)native.push({role:'system',content:text,timestamp:0,...added.length?{toolsAdded:added}:{},...removed.length?{toolsRemoved:removed}:{}})
      continue
    }
    if(message.role==='assistant'){
      const assistant=await projectPiMessage(message,ctx,request.signal)
      if(message.source?.replayState!==undefined&&assistant.api==='host')ctx.logger?.warn?.('Native Pi provider: invalid or foreign replay metadata; using provider-neutral assistant content')
      for(const block of assistant.content)if(block.type==='toolCall')names.set(block.id,block.name)
      native.push(assistant);continue
    }
    const value=content(message.content)
    native.push(message.role==='tool'?{role:'toolResult',toolCallId:message.toolCallId,toolName:names.get(message.toolCallId)??'unknown',content:typeof value==='string'?[{type:'text',text:value||'(no output)'}]:value,isError:message.isError??false,timestamp:0}:{role:'user',content:value,timestamp:0})
  }
  let active=tools.filter(t=>!t.deferLoading).map(tool)
  if(model.api==='anthropic-messages'&&updateMode==='in-history'&&!active.length&&tools.length&&native.some(m=>m.role==='system'&&m.toolsAdded?.length))active=[{name:'DeferredToolPlaceholder',description:'Reserved placeholder for deferred loading. Never call this tool.',parameters:{type:'object',properties:{}}}]
  const systemPrompt=leading.filter(Boolean).join('\n\n')
  return{...(systemPrompt?{systemPrompt}:{}),messages:native,...active.length?{tools:active}:{}}
}
