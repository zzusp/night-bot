import {AgentSession,createReadTool,createWriteTool,createEditTool} from '@earendil-works/pi-coding-agent'
import {compile} from '@earendil-works/pi-schema'
import {randomUUID} from 'node:crypto'
import {join,extname,basename} from 'node:path'
import {officialWorkingDirectoryOrigin} from './native-working-directory.js'
import {inspectImage} from './native-attachment-codec.js'
import {snapshotJsonValue,deepFreeze} from './native-values.js'
import {FsError} from './native-fs-protocol.js'
import {isLocalFileWriteNotStarted} from './native-fs-local.js'
import {approveEscalation,validateEscalationArgs,ESCALATION_TARGETS} from './native-sandbox-protocol.js'

const fail=(code,message=code)=>new FsError(message,code)
const media={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}
import {PI_FILE_SOURCE_DEFAULTS} from './runtime/pi-file-tool-config.js'
export {PI_FILE_SOURCE_DEFAULTS} from './runtime/pi-file-tool-config.js'
export const PI_FILE_SOURCE_COMPARISON=deepFreeze([
 {previous:'readLimit',current:'windowMaxLines',behavior:'Applies to regular Pi read and independent read_window.'},
 {previous:'readMaxLineLength',current:'windowMaxLineCharacters',behavior:'Long regular output redirects to read_window; explicit partial-line metadata.'},
 {previous:'readMaxBytes',current:'windowMaxBytes',behavior:'Independent window text budget; oversized regular results redirect without fake continuation.'},
 {previous:'readStreamMinSize',current:'maxBufferedBytes',behavior:'Complete-buffer cap; larger text uses read_window. New limits require review before registration.'},
 {previous:'no separately configured streamed scan/file limit',current:'windowMaxFileBytes/windowMaxScanBytes/windowMaxChunks',behavior:'New explicit resource policy; must be reviewed before registration.'},
 {previous:'single literal edit',current:'Pi edits[] + maxEditCount/maxEditBytes/maxWriteBytes',behavior:'Pi owns multi-edit/fuzzy semantics; new work caps require review.'},
 {previous:'attachment limits / route support',current:'existing attachments + actual AgentSession.model + imageBudget.accept',behavior:'Per-image policy retained; aggregate accounting requires a factory-owned port.'},
 {previous:'tool output transport limit',current:'maxTransportBytes + transportBudget.accept',behavior:'Local JSON bound plus required external result accounting; never silently truncates mutation results.'},
])
const windowOutput={type:'object',additionalProperties:false,required:['path','offset','hasMore','scannedBytes','lines'],properties:{path:{type:'string'},offset:{type:'integer'},hasMore:{type:'boolean'},scannedBytes:{type:'integer'},nextOffset:{type:'integer'},lines:{type:'array',items:{type:'object',additionalProperties:false,required:['line','text','truncated'],properties:{line:{type:'integer'},text:{type:'string'},truncated:{type:'boolean'}}}}}}
const windowSchema={type:'object',additionalProperties:false,required:['path'],properties:{path:{type:'string',minLength:1},offset:{type:'integer',minimum:1},limit:{type:'integer',minimum:1}}}
const present=s=>s!==undefined
const byteSize=value=>Buffer.byteLength(JSON.stringify(value))

/** New, unregistered file capabilities. Pi owns ordinary read/image rendering,
 * edit matching/diff and mutation queues. Night owns only capability IO,
 * observations, authorization, bounded resources and a distinct streaming tool.
 * Budget ports must be bound before the Host can switch registrations. */
export function createPiFileTools({ctx,actor,sourceConfig={},services={},imageBudget,transportBudget}){
 const supplied=snapshotJsonValue(sourceConfig)
 if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))throw fail('PI_FILE_CONFIG_INVALID')
 const config={...PI_FILE_SOURCE_DEFAULTS,...supplied}
 for(const [key,value]of Object.entries(config))if(!Object.hasOwn(PI_FILE_SOURCE_DEFAULTS,key)||!Number.isSafeInteger(value)||value<1)throw fail('PI_FILE_CONFIG_INVALID',key)
 if(config.windowMaxBytes<256)throw fail('PI_FILE_CONFIG_INVALID','windowMaxBytes must be at least 256')
 const names=new Set(['fs','workingDirectory','sandboxPolicy','approval','attachments'])
 if(!services||typeof services!=='object'||Array.isArray(services)||Object.keys(services).some(name=>!names.has(name)))throw fail('PI_FILE_SERVICE_CAPABILITIES_INVALID')
 const get=name=>names.has(name)?services[name]??ctx.get(name):ctx.get(name),fs=get('fs'),agents=get('agents'),directory=get('workingDirectory'),sandbox=get('sandboxPolicy'),attachments=get('attachments'),approval=get('approval')
 if(!actor||!fs||!agents||!directory||!sandbox||fs.sandboxMode===undefined)throw fail('PI_FILE_CAPABILITIES_REQUIRED')
 const origin=officialWorkingDirectoryOrigin(actor),tokens=new Map(),validators=new WeakMap(),bridges=new WeakMap(),mutationPolicies=new WeakMap(),mutationExecutions=new WeakMap(),active=new Set(),lifetime=new AbortController();let closed=false,sessionIdentity
 const privateBoundary=typeof fs.boundary==='function'
 const capabilities=Object.freeze({privateBoundary,officialRead:true,officialWrite:true,officialEdit:true,boundedWindow:true,explicitApproval:typeof approval?.request==='function',aggregateImageBudget:typeof imageBudget?.accept==='function',requiresBusinessToolAdmission:true,requiresScopedCloseBinding:true,readyForHost:false,transportBudget:typeof transportBudget?.accept==='function',ready:privateBoundary&&typeof approval?.request==='function'&&typeof imageBudget?.accept==='function'&&typeof transportBudget?.accept==='function',registered:false})
 function authority(){
  if(!(actor.piSession instanceof AgentSession)||actor.piSession.sessionId!==actor.id||sessionIdentity&&actor.piSession!==sessionIdentity||agents.get(actor.id)!==actor||agents.currentInitiator()!==actor||officialWorkingDirectoryOrigin(actor)!==origin)throw fail('PI_FILE_ACTOR_REQUIRED')
  sessionIdentity??=actor.piSession
  return sandbox.resolve({actor})
 }
 function prepare(parameters,input){
  const args=snapshotJsonValue(input)
  if(args===undefined||byteSize(args)>config.maxArgumentBytes)throw fail('PI_FILE_ARGUMENTS_INVALID')
  let validator=validators.get(parameters);if(!validator){validator=compile(parameters,{coerce:false,unresolvedRefs:'throw'});validators.set(parameters,validator)}
  if(!validator.check(args))throw fail('PI_FILE_ARGUMENTS_INVALID',validator.errors(args).map(error=>error.message).join('; '))
  return deepFreeze(args)
 }
 function schema(base,kind){
  const parameters={...base,additionalProperties:false,properties:{...base.properties,path:{...base.properties.path,minLength:1,maxLength:config.maxPathCharacters}}}
  if(kind==='read'||kind==='read_window')for(const key of ['offset','limit'])parameters.properties[key]={...parameters.properties[key],type:'integer',minimum:1,...key==='limit'?{maximum:config.windowMaxLines}:{}}
  if(kind==='read_image')parameters.properties={path:parameters.properties.path}
  if(kind==='edit')parameters.properties.edits={...parameters.properties.edits,minItems:1,maxItems:config.maxEditCount}
  if(kind==='edit'||kind==='write')Object.assign(parameters.properties,{sandbox_permissions:{type:'string',enum:[...ESCALATION_TARGETS]},justification:{type:'string',minLength:1}})
  return deepFreeze(parameters)
 }
 function launch(kind,parameters,callId,input,signal,body){
  const args=prepare(parameters,input)
  if(closed)throw fail('PI_FILE_TOOLS_CLOSED')
  const control=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal
  const operation=agents.withInitiator(actor,async()=>{
   authority();control.throwIfAborted()
   if(typeof transportBudget?.accept!=='function')throw fail('PI_FILE_TRANSPORT_BUDGET_REQUIRED')
   return body(args,control)
  })
  active.add(operation);operation.then(()=>active.delete(operation),()=>active.delete(operation));return operation
 }
 async function acceptResult(kind,callId,result,signal){
  signal.throwIfAborted();authority()
  const captured=snapshotJsonValue(result)
  if(captured===undefined)throw fail('PI_FILE_RESULT_INVALID')
  const bytes=byteSize(captured)
  if(bytes>config.maxTransportBytes)throw fail('PI_FILE_TRANSPORT_LIMIT')
  deepFreeze(captured)
  if(await transportBudget.accept({actor,callId,toolName:kind,result:captured,bytes,signal})!==true)throw fail('PI_FILE_TRANSPORT_LIMIT')
  signal.throwIfAborted();authority();return captured
 }
 async function targetFor(path,signal){const cwd=await directory.ensure(actor,signal),target=await fs.resolve(path,{cwd,signal});return {cwd,target}}
 async function fresh(path,cwd,target,signal){const current=await fs.resolve(path,{cwd,signal});if(current.targetKey!==target.targetKey)throw fail('FS_STALE_VERSION');return current}
 async function statFile(target,exec){const info=await fs.stat(target,exec.signal);if(!info){ctx.emit('fs/observed',target,{kind:'absent'},exec);throw fail('FS_NOT_FOUND')}if(info.type!=='file')throw fail('FS_NOT_REGULAR_FILE');if(typeof info.version!=='string')throw fail('PI_FILE_SNAPSHOT_VERSION_REQUIRED');return info}
 async function sameVersion(path,cwd,target,version,signal){await fresh(path,cwd,target,signal);const info=await fs.stat(target,signal);if(info?.version!==version)throw fail('FS_STALE_VERSION')}
 function observe(target,version,exec){ctx.emit('fs/observed',target,{kind:'present',version},exec)}
 async function mutationPolicy(kind,args,callId,signal){
  const initial=authority();validateEscalationArgs(args.sandbox_permissions,args.justification)
  let granted
  if(args.sandbox_permissions!==undefined)granted=await approveEscalation({requestedMode:args.sandbox_permissions,effectiveMode:initial.mode,justification:args.justification,subject:'operation'},{approver:approval,agent:actor,callId,toolName:kind,signal})
  const target=actor.ctx.get('toolPermissions')?await fs.resolve(args.path,{cwd:directory.get(actor),signal}):undefined
  return()=>{const current=authority();if(granted!==undefined&&(current.mode!==initial.mode||current.workspaceRoot!==initial.workspaceRoot))throw fail('PI_FILE_POLICY_CHANGED');const managed=target&&actor.ctx.get('tools').resolveFileAuthorization({actor,path:String(target.targetKey),writing:true});return managed?{...current,mode:'danger-full-access'}:granted===undefined?current:{...current,mode:granted}}
 }
 async function preparedMutationPolicy(exec,kind,input,args,callId,signal,preflight=false){
  if(!exec)return mutationPolicy(kind,args,callId,signal)
  const registry=actor.ctx.get('tools'),identity=preflight?registry.admissionIdentity(exec):registry.executionIdentity(exec)
  if(!identity&&preflight&&args.sandbox_permissions===undefined)return mutationPolicy(kind,args,callId,signal)
  if(exec.agent!==actor||identity?.owner!==actor.id||identity.name!==kind||identity.callId!==callId||exec.arguments!==input)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
  let record=mutationPolicies.get(exec)
  if(record){if(record.kind!==kind||record.input!==input||record.callId!==callId)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')}
  else{record={kind,input,callId,pending:Promise.resolve().then(()=>mutationPolicy(kind,args,callId,signal))};mutationPolicies.set(exec,record)}
  return record.pending
 }
 function execution(kind,callId,signal,bridge){
  const businessExec=bridges.get(bridge)
  if(businessExec===undefined)return {agent:actor,name:kind,callId,signal}
  const identity=agents.currentInitiator()===actor&&actor.ctx.get('tools').executionIdentity(businessExec)
  if(businessExec.agent!==actor||identity?.owner!==actor.id||identity.name!==kind||identity.callId!==callId)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
  return businessExec
 }
 function ordinary(kind){
  const factory=kind==='write'?createWriteTool:kind==='edit'?createEditTool:createReadTool,base=factory(origin),parameters=schema(base.parameters,kind)
  const description=kind==='read_image'?'Read an authorized image through Pi and the current SDK model, within attachment and aggregate request limits.':base.description+(kind==='read'?' For large text or long lines use read_window; use read_image for image-specific limits.':kind==='edit'?' Read the current file before editing; prior observation and atomic version checks are required.':' Existing files must be read before replacement.')
  return {...base,name:kind,label:kind,description,parameters,prepareArguments:input=>prepare(parameters,input),execute:(callId,input,signal,_onUpdate,_sdkContext,bridge)=>launch(kind,parameters,callId,input,signal,async(args,control)=>{
   const exec=execution(kind,callId,control,bridge),policy=(kind==='write'||kind==='edit')?await preparedMutationPolicy(bridges.get(bridge),kind,input,args,callId,control):undefined
   if(kind==='write'&&Buffer.byteLength(args.content)>config.maxWriteBytes)throw fail('PI_FILE_WRITE_LIMIT')
   if(kind==='read_image'&&typeof imageBudget?.accept!=='function')throw fail('PI_FILE_IMAGE_BUDGET_REQUIRED')
   const {cwd,target}=await targetFor(args.path,control)
   if(!tokens.has(target.targetKey)){if(tokens.size>=config.maxOperationTargets)throw fail('PI_FILE_TARGET_LIMIT');tokens.set(target.targetKey,join(origin,'.pi-file-op-'+randomUUID()))}
   const token=tokens.get(target.targetKey),pending=new Set(),track=fn=>{const promise=Promise.resolve().then(fn);pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise}
   let snapshot,imageRef,imageBytes,outcome,expected,readModel
   const stableBytes=async()=>{
    if(snapshot)return snapshot
    await fresh(args.path,cwd,target,control);const before=await statFile(target,exec)
    const cap=kind==='read_image'?Math.min(attachments?.imageLimits.maxImageBytes??0,attachments?.imageLimits.maxMessageImageBytes??0):kind==='edit'?config.maxEditBytes:config.maxBufferedBytes
    if(!cap)throw fail('PI_FILE_IMAGE_CAPABILITY_REQUIRED')
    if(before.size>cap)throw fail(kind==='read_image'?'IMAGE_TOO_LARGE':kind==='read'&&media[extname(args.path).toLowerCase()]?'PI_FILE_USE_READ_IMAGE':'PI_FILE_USE_READ_WINDOW')
    const bytes=await fs.readBytes(target,control,cap);await sameVersion(args.path,cwd,target,before.version,control)
    let lines=1;if(kind!=='read_image')for(const byte of bytes)if(byte===10&&++lines>config.maxBufferedLines)throw fail('PI_FILE_USE_READ_WINDOW')
    snapshot={bytes,version:before.version};return snapshot
   }
   const text=bytes=>{if(bytes.includes(0))throw fail('FS_NOT_TEXT');try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw fail('FS_INVALID_UTF8')}}
   const access=()=>track(async()=>{authority();await fresh(args.path,cwd,target,control);await statFile(target,exec);if(kind==='edit'){expected=await ctx.waterfall('fs/edit-intent',target,exec,()=>undefined);if(typeof expected?.version!=='string')throw fail('PI_FILE_OBSERVATION_POLICY_REQUIRED')}})
   const readFile=()=>track(async()=>{const value=await stableBytes();if(kind==='edit'&&value.version!==expected.version)throw fail('FS_STALE_VERSION');if(imageBytes)return imageBytes;text(value.bytes);return value.bytes})
   const writeFile=(_opaque,content)=>track(async()=>{
    const current=policy();control.throwIfAborted();await fresh(args.path,cwd,target,control)
    if(Buffer.byteLength(content)>config.maxWriteBytes)throw fail('PI_FILE_WRITE_LIMIT')
    const mutation=mutationExecutions.get(exec);if(mutation)mutation.started=true
    try{outcome=await fs.writeText(target,content,kind==='edit'?{kind:'replaceIfVersion',version:snapshot.version}:expected,control,current)}
    catch(error){if(mutation&&isLocalFileWriteNotStarted(fs,error))mutation.started=false;throw error}
   })
   const detectImageMimeType=()=>track(async()=>{
    const {bytes}=await stableBytes();let metadata
    try{metadata=await inspectImage(bytes)}catch(error){if(error.code==='INVALID_IMAGE'&&kind!=='read_image')return undefined;throw error}
    if(!attachments)throw fail('PI_FILE_IMAGE_CAPABILITY_REQUIRED')
    if(typeof imageBudget?.accept!=='function')throw fail('PI_FILE_IMAGE_BUDGET_REQUIRED')
    readModel=actor.piSession.model;if(!readModel?.input.includes('image'))throw fail('PI_FILE_MODEL_IMAGE_UNSUPPORTED')
    imageRef=await attachments.saveImage({data:bytes,mediaType:media[extname(args.path).toLowerCase()]??metadata.mediaType,name:basename(args.path)})
    imageBytes=Buffer.from((await attachments.readImage(imageRef,control)).data);return imageRef.mediaType
   })
   if(kind==='write'){expected=await ctx.waterfall('fs/write-intent',target,exec,()=>undefined);if(!['createIfAbsent','replaceIfVersion'].includes(expected?.kind))throw fail('PI_FILE_OBSERVATION_POLICY_REQUIRED')}
   const operations=(kind==='read'||kind==='read_image')?{access,readFile,detectImageMimeType}:kind==='edit'?{access,readFile,writeFile}:{mkdir:()=>track(async()=>{authority();control.throwIfAborted()}),writeFile}
   let result
   try{
    // Pi read's abort listener otherwise returns before image processing joins.
    // Keep its native task awaited; capability operations receive control via
    // their invocation closure, and cancellation is checked after native work.
    try{result=await factory(origin,{operations}).execute(callId,{...args,path:token,...kind==='read'?{limit:args.limit??config.windowMaxLines}:{}},(kind==='read'||kind==='read_image')?undefined:control,undefined,{cwd:origin,model:actor.piSession.model})}finally{await Promise.allSettled([...pending])}
    control.throwIfAborted()
    const display=value=>value.split(token).join(args.path),rendered={content:result.content.map(block=>block.type==='text'?{...block,text:display(block.text)}:block)}
    if(present(result.structuredContent))rendered.structuredContent=typeof result.structuredContent==='string'?display(result.structuredContent):result.structuredContent
    if(present(result.details)){rendered.details=Object.fromEntries(Object.entries(result.details).filter(([,value])=>value!==undefined));if(result.details.diff)rendered.details.diff=display(result.details.diff);if(result.details.patch)rendered.details.patch=display(result.details.patch)}
    if(kind==='read'&&!imageRef&&(result.details?.truncation?.firstLineExceedsLimit||rendered.content.some(block=>block.type==='text'&&(Buffer.byteLength(block.text)>config.windowMaxBytes||block.text.split('\n').some(line=>line.length>config.windowMaxLineCharacters)))))throw fail('PI_FILE_USE_READ_WINDOW')
    if(imageRef){
     if(actor.piSession.model!==readModel)throw fail('PI_FILE_MODEL_CHANGED')
     const images=rendered.content.filter(block=>block.type==='image').map(block=>({mimeType:block.mimeType,bytes:Buffer.from(block.data,'base64').byteLength}))
     if(!images.length)throw fail('PI_FILE_IMAGE_RESULT_REQUIRED')
     if(await imageBudget.accept({actor,callId,toolName:kind,attachment:deepFreeze(snapshotJsonValue(imageRef)),images:deepFreeze(images),signal:control})!==true)throw fail('PI_FILE_IMAGE_AGGREGATE_LIMIT')
    }
    const accepted=await acceptResult(kind,callId,rendered,control)
    if(imageRef&&actor.piSession.model!==readModel)throw fail('PI_FILE_MODEL_CHANGED')
    observe(target,outcome?.version??snapshot.version,exec);return accepted
   }catch(cause){if(outcome)throw Object.assign(fail('PI_FILE_EFFECT_COMMITTED_RESULT_FAILED','File mutation committed but result delivery failed: '+cause.message),{cause,committed:true,externalEffectsPossible:true});throw cause}
  })}
 }
 const windowParameters=schema(windowSchema,'read_window')
 const windowTool={name:'read_window',label:'read_window',description:'Read a bounded text window from a large file. Lines are 1-indexed. Truncated lines, scan limits and continuation are explicit; no complete-file claim.',parameters:windowParameters,outputSchema:windowOutput,prepareArguments:input=>prepare(windowParameters,input),execute:(callId,input,signal,_onUpdate,_sdkContext,bridge)=>launch('read_window',windowParameters,callId,input,signal,async(args,control)=>{
  const {cwd,target}=await targetFor(args.path,control),exec=execution('read_window',callId,control,bridge),info=await statFile(target,exec)
  if(info.size>config.windowMaxFileBytes)throw fail('PI_FILE_WINDOW_SIZE_LIMIT')
  const offset=args.offset??1,limit=args.limit??config.windowMaxLines,lines=[];let line=1,scannedBytes=0,chunks=0,bodyBytes=0,preview='',previewUnits=0,previewBytes=0,truncated=false,pendingCR=false,done=false,hasMore=false,nextOffset
  const append=char=>{if(truncated)return;if(previewUnits+char.length<=config.windowMaxLineCharacters&&previewBytes+Buffer.byteLength(char)<=config.windowMaxBytes-192){preview+=char;previewUnits+=char.length;previewBytes+=Buffer.byteLength(char)}else truncated=true}
  const finish=()=>{
   if(line>=offset){const item={line,text:preview,truncated},display=`${line}: ${preview}${truncated?' [line truncated]':''}`,size=Buffer.byteLength(display)+(lines.length?1:0);if(bodyBytes+size>config.windowMaxBytes-128){done=true;hasMore=true;nextOffset=line;return}lines.push(item);bodyBytes+=size;if(lines.length>=limit){done=true;hasMore=true;nextOffset=line+1}}
   line++;preview='';previewUnits=0;previewBytes=0;truncated=false
  }
  await fs.boundary?.(target)
  const stream=await fs.streamText(target,control)
  for await(const chunk of stream){
   control.throwIfAborted();authority()
   if(typeof chunk!=='string'||++chunks>config.windowMaxChunks)throw fail('PI_FILE_WINDOW_SCAN_LIMIT')
   scannedBytes+=Buffer.byteLength(chunk);if(scannedBytes>config.windowMaxScanBytes)throw fail('PI_FILE_WINDOW_SCAN_LIMIT')
   if(chunk.includes('\0'))throw fail('FS_NOT_TEXT')
   for(const char of chunk){
    if(pendingCR){pendingCR=false;if(char==='\n'){finish();if(done)break;continue}if(line>=offset)append('\r')}
    if(char==='\r')pendingCR=true;else if(char==='\n'){finish();if(done)break}else if(line>=offset)append(char)
   }
   if(done)break
  }
  if(!done){if(pendingCR&&line>=offset)append('\r');if(line>=offset){const previous=lines.length;finish();if(lines.length>previous){hasMore=false;nextOffset=undefined}}else throw fail('PI_FILE_WINDOW_OFFSET_OUT_OF_RANGE')}
  await sameVersion(args.path,cwd,target,info.version,control)
  const details={path:args.path,offset,hasMore,scannedBytes,...nextOffset===undefined?{}:{nextOffset},lines},body=lines.map(item=>`${item.line}: ${item.text}${item.truncated?' [line truncated]':''}`).join('\n'),footer=hasMore?`[Partial window; continue with offset=${nextOffset}.]`:'[End of file.]',result={content:[{type:'text',text:body+'\n'+footer}],structuredContent:details}
  if(Buffer.byteLength(result.content[0].text)>config.windowMaxBytes)throw fail('PI_FILE_WINDOW_OUTPUT_LIMIT')
  const accepted=await acceptResult('read_window',callId,result,control);observe(target,info.version,exec);return accepted
 })}
 const tools=[ordinary('read'),ordinary('write'),ordinary('edit'),ordinary('read_image'),windowTool]
 return Object.freeze({tools,async executeRegistered(tool,input,exec){
  const identity=actor.ctx.get('tools').executionIdentity(exec)
  if(!tools.includes(tool)||exec.agent!==actor||identity?.owner!==actor.id||identity.name!==tool.name||identity.callId!==exec.callId||input!==exec.arguments)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
  if(mutationExecutions.has(exec))throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
  const mutation=['write','edit'].includes(tool.name)?{tool,started:false,finished:false}:undefined
  if(mutation)mutationExecutions.set(exec,mutation)
  const bridge={};bridges.set(bridge,exec)
  try{return await tool.execute(exec.callId,input,exec.signal,undefined,undefined,bridge)}finally{if(mutation)mutation.finished=true;bridges.delete(bridge)}
 },isMutationNotStarted(tool,exec){
  const mutation=mutationExecutions.get(exec)
  return !!mutation&&mutation.tool===tool&&mutation.finished===true&&mutation.started===false
 },async preflightMutation(tool,input,signal,exec){
  if(!tools.includes(tool)||!['write','edit'].includes(tool.name))throw fail('PI_FILE_DEFINITION_REQUIRED')
  return launch(tool.name,tool.parameters,'preflight',input,signal,async(args,control)=>{
   const cwd=directory.get(actor)
   if(typeof fs.preflightMutation!=='function')throw fail('PI_FILE_PREFLIGHT_REQUIRED')
   // Task/privacy paths are forbidden regardless of a wider mode. Refuse those
   // before asking for one-time escalation, then resolve again after approval.
   if(typeof fs.preflightPath==='function')await fs.preflightPath(args.path,{cwd,signal:control})
   if(args.sandbox_permissions!==undefined&&!exec)throw fail('PI_FILE_NATIVE_EXECUTION_REQUIRED')
   const policy=await preparedMutationPolicy(exec,tool.name,input,args,exec?.callId??'preflight',control,true)
   await fs.preflightMutation(args.path,{cwd,signal:control,sandboxPolicy:policy()})
   control.throwIfAborted()
  })
 },sourceConfig:Object.freeze(config),sourceConfigComparison:PI_FILE_SOURCE_COMPARISON,capabilities,async close(){closed=true;lifetime.abort(fail('PI_FILE_TOOLS_CLOSED'));await Promise.allSettled([...active])}})
}
