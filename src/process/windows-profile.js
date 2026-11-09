import {randomUUID} from 'node:crypto'
import {dirname,isAbsolute,join,resolve} from 'node:path'
import {createLazyRequire,parseWindowsLaunchPolicy,parseWindowsResourceOwnership,parseWindowsResourceProof,windowsScopeRoots} from './contracts.js'
import {createPseudoConsole,closeHandleChecked,closeFailedLpacJobProcessHandles,inspectFailedLpacJobProcess,inspectLpacJobProcess,decodePtr,isJobEmpty,isNullPtr,pollProcessExit,throwLastError,Win32Error} from './win32.js'
import {loadWindowsAppContainerBindings,ownedSecurityDescriptor,sameOwnedSecurityDescriptor,scopedLabelFacts,freezeOwnedPackageWriteStages,scopedFileInheritanceInputs,mergeScopedFileInheritance,scopedFileLabelInheritanceInputs,mergeScopedFileLabelInheritance,freezeScopedFileLabelStages,planScopedFileLabels,planScopedFileLabelRelease,freezeScopedFileAccessStages,freezeScopedFileReleaseStages,createAclMutationLock,withPrivateResourceSecurity,privateResourceInitializationNeeded} from './windows-acl.js'
import {readdirSync} from 'node:fs'
import {Socket} from 'node:net'

// Profile 是原 Windows Job runner 的资源，不另建进程 owner 或业务终态。
const requireKoffi=createLazyRequire('koffi',import.meta.url)
const READ64=0x20119,OPEN_LINK=8,HKEY_USERS=0xffffffff80000003n
const localAppDataId=Buffer.from('8527b3f1ba6fcf4f9d557b8e7f157091','hex')
const decoder=new TextDecoder('utf-16le',{fatal:true,ignoreBOM:true})
const equalName=(a,b)=>a.toUpperCase()===b.toUpperCase()
const finalPath=value=>value.startsWith('\\\\?\\')?value.slice(4):value
const address=pointer=>typeof pointer==='bigint'?pointer:requireKoffi().address(pointer)
const fail=(message,options)=>Object.assign(new Error(message,options),{code:'WINDOWS_PROFILE_OWNERSHIP_UNVERIFIED'})
const hresult=(api,value)=>{if(value!==0){const error=fail(api+' failed');error.api=api;error.hresult=value>>>0;throw error}}
const lstatus=(api,value)=>{if(value!==0){const error=fail(api+' failed');error.api=api;error.lstatus=value;throw error}}
const noHandle=value=>isNullPtr(value)||value===-1n||value===0xffffffffffffffffn

class OwnedAppContainerProfile {
 #api
 #handles=[]
 #allocations=[]
 #name='nightbot-'+randomUUID().replaceAll('-','')
 #sid
 #sidText
 #hostSid
 #hostAuthentication
 #sealed=false
 #sealMutationUncertain=false
 #sealReceipt
 #localAppData
 #root
 #ac
 #parents=[]
 #captured
 #created=false
 #creationAttempted=false
 #identityRestored=true
 #scopeCount
 #policy
 #temporary
 #terminal
 #scopeRoots
 #scopeRootHandles=[]
 #scopeEffects=0
 #scopeInstallRoot
 #scopePlan
 #scopeState
 #scopeAffected=new Set()
 #scopeLock
 #scopeIo
 #scopeReleaseAttempted=false
 #recordResource
 #signal
 #ownedCommitted=false
 #proofPending=false
 #preparationStage
 #sealPlan
 #launchAttempted=false
 #launch
 #deleteAttempted=false
 #cleanupAttempted=false
 #state='new'
 constructor(api,policy,recordResource,signal){
  this.#api=api;this.#policy=policy;this.#recordResource=recordResource;this.#signal=signal
  if(policy.mode==='read-only')this.#temporary={path:join(policy.tempRoot,this.#name),creationAttempted:false,created:false,cleanupAttempted:false,absent:false}
  this.#scopeCount=windowsScopeRoots(policy).length+(this.#temporary?1:0)
 }
 get packageSid(){if(this.#state!=='owned'||!this.#sid)throw fail('Profile SID is not ready');return this.#sid}
 get name(){return this.#name}
 get receipt(){return{kind:'owned-appcontainer-profile',name:this.#name,sid:this.#sidText??null,state:this.#state,created:this.#created,creationAttempted:this.#creationAttempted,threadRestored:this.#identityRestored,launchAttempted:this.#launchAttempted,cleanupAttempted:this.#cleanupAttempted,deleteAttempted:this.#deleteAttempted,sealed:this.#sealed,sealState:this.#sealReceipt?.state??'not-started',sealEffects:this.#sealReceipt?.effects.map(({kind,name,attempted,status,immediateVerified})=>({kind,name,attempted,status,immediateVerified}))??[],retainedHandles:this.terminalOwnership.retainedHandles+this.#handles.length+this.#scopeRootHandles.length+(this.#scopeLock?.ownership.retainedHandles??0),retainedAllocations:this.#allocations.length}}
 describeOwnership({status,scopeEffects,nativeHandles,nativeAllocations,preparationPending,childSettled,jobEmpty,nativeHandlesClosed,scopeReleased}){
  return parseWindowsResourceOwnership({kind:'windows-lpac',version:1,status,profileName:this.#name,profileSid:this.#sidText??null,scopeCount:this.#scopeCount,scopeEffects:this.#scopeEffects,retainedHandles:this.terminalOwnership.retainedHandles+this.#handles.length+this.#scopeRootHandles.length+(this.#scopeLock?.ownership.retainedHandles??0)+nativeHandles,retainedAllocations:this.#allocations.length+nativeAllocations,preparationPending:preparationPending||this.terminalOwnership.pending||this.#preparationStage!==undefined,threadRestored:this.#identityRestored,childSettled,jobEmpty,nativeHandlesClosed:nativeHandlesClosed&&this.terminalOwnership.released&&this.#handles.length===0&&this.#scopeRootHandles.length===0&&(this.#scopeLock?.ownership.retainedHandles??0)===0,scopeReleased,profileAbsent:this.#state==='registration-and-folder-absent'||!this.#creationAttempted&&this.#handles.length===0&&this.#allocations.length===0})
 }
 get scopeRoots(){
  if(this.#scopeRoots===undefined)throw fail('Exact scope roots have not been qualified')
  return this.#scopeRoots.map(root=>({path:root.path,fileId:root.id.toString('hex'),access:root.access}))
 }
 prepareScopeRoots(){
  const policy=this.#policy
  try{
   if(this.#state!=='owned'||this.#scopeRoots!==undefined||this.#scopeRootHandles.length||this.#ownedCommitted||this.#launchAttempted)throw fail('Exact scope preparation cannot be repeated')
   this.#signal.throwIfAborted()
   const roots=windowsScopeRoots({...policy,privateRoots:[...policy.privateRoots,this.#root]})
   if(this.#temporary)roots.push({path:this.#temporary.path,access:'write'})
   this.#scopeInstallRoot=policy.installRoot
   const system=this.#api.systemDirectory
   if(typeof system!=='string'||!isAbsolute(system))throw fail('Native system dependency boundary is unavailable')
   const reserved=[dirname(system),process.execPath],inside=(root,path)=>equalName(root,path)||path.toUpperCase().startsWith(root.toUpperCase()+String.fromCharCode(92))
   if(roots.some(root=>reserved.some(path=>inside(path,root.path)||inside(root.path,path))))throw fail('Business scope must not mutate system or Host Node dependency ACLs')
   if(roots.length!==this.#scopeCount)throw fail('Exact scope roots differ from the original committed count')
   this.#scopeRoots=this.#observe(()=>{
    let temporaryObject
    if(this.#temporary){
     if(this.#hostIdentity()!==this.#hostSid)throw fail('Internal temporary creation Host identity changed')
     const temporary=this.#temporary,chain=[]
     for(let at=policy.tempRoot;;at=dirname(at)){chain.unshift(at);if(dirname(at)===at)break}
     temporary.parents=chain.map(path=>{const object=this.#folder(path);return {...object,descriptor:this.#security(object.handle,1)}})
     for(let i=1;i<temporary.parents.length;i++)if(!temporary.parents[i].id.subarray(0,8).equals(temporary.parents[i-1].id.subarray(0,8)))throw fail('Internal temporary ancestor volume drift')
     this.#absentFolder(temporary.path)
     // 原planned ACK已提交；新根以私有protected DACL创建，不继承共享父的LPAC读ACE。
     const expected=this.#createPrivateTemporaryRoot(temporary)
     temporaryObject=this.#folder(temporary.path)
     const parent=temporary.parents.at(-1)
     if(!temporaryObject.id.subarray(0,8).equals(parent.id.subarray(0,8))||!equalName(temporaryObject.native,join(parent.native,this.#name))||readdirSync(temporary.path).length)throw fail('Internal temporary root is not a fresh exact child')
     temporary.original={...temporaryObject,descriptor:this.#initializePrivateTemporaryRoot(temporary,temporaryObject,expected)}
     delete temporary.original.handle
     for(const before of temporary.parents)delete before.handle
    }
    const identities=new Set()
    return roots.map(root=>{
     const object=temporaryObject&&equalName(root.path,temporaryObject.path)?temporaryObject:this.#file(root.path),id=object.id.toString('hex')
     if(identities.has(id))throw fail('Different approved scope paths alias one native object')
     identities.add(id)
     const at=this.#handles.findIndex(item=>item.handle===object.handle)
     if(at<0)throw fail('Exact scope root handle is not owned')
     // 根句柄不共享DELETE，保持到同Job排空及范围撤销，不能在ACK等待中被换走。
     this.#scopeRootHandles.push(this.#handles.splice(at,1)[0])
     return {...object,access:root.access}
    })
   })
   return this.scopeRoots
  }catch(error){throw this.#profileFailure(error)}
 }
 #createPrivateTemporaryRoot(temporary){
  return this.#withPrivateSecurity('temporary-root',(attributes,expected)=>{
   temporary.creationAttempted=true
   if(this.#api.createDirectoryW(temporary.path,attributes)===0)throwLastError(this.#api,'CreateDirectoryW','owned private internal temporary root')
   temporary.created=true
   return expected
  })
 }
 #initializePrivateTemporaryRoot(temporary,object,expected){
  if(!temporary.created||temporary.initializationAttempted||temporary.original)throw fail('Private temporary initialization requires this newly created unpublished root')
  const created=this.#security(object.handle,1),actual=ownedSecurityDescriptor(created)
  temporary.createdDescriptor=Buffer.from(created)
  temporary.initializationNeeded=privateResourceInitializationNeeded(created,expected)
  temporary.initializationAttempted=false
  temporary.initializationVerified=false
  let baseline=created
  if(temporary.initializationNeeded){
   // 仅初始化本次空私有根；原创建SD保留，绝不转换业务树或预补其基线控制位。
   const write=this.#file(temporary.path,true)
   this.#sameFolder(write,object)
   if(!write.directory||readdirSync(temporary.path).length||!this.#security(write.handle,1).equals(created))throw fail('Private temporary root changed before initialization')
   this.#signal.throwIfAborted()
   temporary.initializationAttempted=true
   temporary.initializationStatus=this.#api.setSecurityInfo(write.handle,1,4,null,null,actual.dacl,null)
   lstatus('SetSecurityInfo',temporary.initializationStatus)
   baseline=this.#security(write.handle,1)
   const initialized=ownedSecurityDescriptor(baseline)
   if(initialized.control!==(actual.control|0x400)||baseline.length!==created.length||!baseline.subarray(0,2).equals(created.subarray(0,2))||!baseline.subarray(4).equals(created.subarray(4)))throw fail('Private temporary initialization changed more than its native DACL inheritance state')
   const after=this.#folder(temporary.path)
   this.#sameFolder(after,object)
   if(readdirSync(temporary.path).length)throw fail('Private temporary root was published during initialization')
  }
  temporary.initializationVerified=true
  temporary.initializedDescriptor=Buffer.from(baseline)
  return baseline
 }
 #withPrivateSecurity(kind,operation){
  const host=this.#openHostToken(8),group=this.#tokenSid(this.#tokenBlob(host,5))
  return withPrivateResourceSecurity({api:this.#api,hostSid:this.#hostSid,groupSid:group,kind,
   ownAllocation:(pointer,allocationKind)=>this.#allocation(pointer,allocationKind),
   releaseAllocation:pointer=>this.#releaseAllocation(pointer)
  },operation)
 }
 get terminalOwnership(){
  const t=this.#terminal
  if(!t)return{retainedHandles:0,pending:false,released:true}
  return{retainedHandles:t.pipes.filter(p=>p.handle!==null).length+t.clients.filter(c=>!c.closed).length+(t.console&&t.console.state!=='close-returned'?1:0)+(t.unknownConsole?1:0),pending:t.preparing||t.resizing!==undefined||t.closePending===true,released:t.released}
 }
 #createTerminalPipes(terminal){
  this.#observe(()=>{
   if(this.#hostIdentity()!==this.#hostSid)throw fail('ConPTY Host identity changed')
   this.#withPrivateSecurity('pipe',(attributes,expected)=>{
    for(const direction of ['input','output']){
     const path=String.fromCharCode(92,92)+'.'+String.fromCharCode(92)+'pipe'+String.fromCharCode(92)+this.#name+'-conpty-'+randomUUID()+'-'+direction
     // 同步服务端、单实例/FIRST_INSTANCE、拒绝远程、不继承；Node端异步运输。
     const handle=this.#api.createNamedPipeW(path,(direction==='input'?1:2)|0x80000,8,1,65536,65536,0,attributes)
     if(noHandle(handle))throwLastError(this.#api,'CreateNamedPipeW','owned ConPTY channel')
     const pipe={path,handle,closeAttempted:false,direction,connected:false};terminal.pipes.push(pipe)
     const actual=ownedSecurityDescriptor(this.#security(handle,1))
     if(!(actual.control&0x1000)||!actual.owner.equals(expected.owner)||!actual.group.equals(expected.group)||!actual.dacl.equals(expected.dacl))throw fail('ConPTY channel did not retain its exact private initial DACL')
    }
   })
  })
 }
 #connectTerminalPipe(t,pipe){
  return new Promise((resolve,reject)=>{
   const socket=new Socket({allowHalfOpen:false}),closed=Promise.withResolvers()
   const client={socket,closed:false,closedResult:closed.promise,connected:false,pipe}
   t.clients.push(client)
   socket.on('error',error=>{reject(error);t.failed(error)})
   socket.once('close',hadError=>{
    client.closed=true;closed.resolve()
    if(!t.closing){const error=fail('ConPTY client closed before mandatory drain');reject(error);t.failed(error)}
    else if(hadError&&!t.failure)t.failed(fail('ConPTY client closed with an unobserved transport error'))
   })
   if(pipe.direction==='output'){
    t.outputClient=client;t.eof=Promise.withResolvers();t.eof.promise.catch(()=>{})
    socket.on('data',chunk=>{if(!t.output.write(chunk)&&!t.closing)socket.pause()})
    t.resumeOutput=()=>socket.resume();t.output.on('drain',t.resumeOutput)
    socket.once('end',()=>{
     t.outputEof=true;t.eof.resolve()
     if(!t.closing)t.failed(fail('ConPTY output EOF preceded console drain'))
    })
   }else t.inputClient=client
   socket.connect(pipe.path,()=>{
    try{
     this.#signal.throwIfAborted()
     if(socket.destroyed||client.closed)throw fail('ConPTY client connection was lost')
     // 同进程client已连接且未让出事件循环；还须原server Connect结果与实际PID。
     const status=this.#api.connectNamedPipe(pipe.handle,null),error=status?0:this.#api.getLastError()
     if(status===0&&error!==535)throw new Win32Error('ConnectNamedPipe',error,'owned ConPTY channel')
     const pid=Buffer.alloc(4)
     if(this.#api.getNamedPipeClientProcessId(pipe.handle,pid)===0)throwLastError(this.#api,'GetNamedPipeClientProcessId')
     if(pid.readUInt32LE()!==process.pid)throw fail('ConPTY server is not paired with this runner client')
     client.connected=pipe.connected=true;resolve()
    }catch(error){reject(error);t.failed(error)}
   })
  })
 }
 async resizeTerminal(cols,rows){
  const t=this.#terminal
  if(!t||t.preparing||t.closing||t.failure||t.resizing!==undefined||t.console?.state!=='open')throw fail('ConPTY resize requires its original idle live console')
  t.resizing=t.console.resizeAsync(cols,rows)
  try{await t.resizing}catch(error){t.failure??=error;throw error}finally{t.resizing=undefined}
 }
 async createTerminal({cols,rows,input,output,onFailure}){
  if(this.#terminal||this.#state!=='owned'||!this.#ownedCommitted||this.#launchAttempted||this.#proofPending)throw fail('ConPTY requires the original committed idle Profile')
  if(![cols,rows].every(value=>Number.isInteger(value)&&value>0&&value<=32767))throw fail('ConPTY dimensions must be positive signed SHORT integers')
  const t={pipes:[],clients:[],preparing:true,closing:false,released:false,cleanupAttempted:false,input,output}
  this.#terminal=t
  t.failed=error=>{if(t.failure)return;t.failure=error;onFailure(error)}
  try{
   this.#signal.throwIfAborted();this.#createTerminalPipes(t)
   const connections=t.pipes.map(pipe=>this.#connectTerminalPipe(t,pipe))
   const aborted=()=>{for(const client of t.clients)if(!client.closed)client.socket.destroy(this.#signal.reason)}
   this.#signal.addEventListener('abort',aborted,{once:true})
   try{
    if(this.#signal.aborted)aborted()
    const results=await Promise.allSettled(connections)
    const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason)
    if(errors.length)throw new AggregateError(errors,'ConPTY channel connection failed')
   }finally{this.#signal.removeEventListener('abort',aborted)}
   this.#signal.throwIfAborted()
   t.console=await createPseudoConsole(this.#api,{input:t.pipes[0].handle,output:t.pipes[1].handle,cols,rows,asynchronous:true})
   if(t.failure)throw t.failure
   this.#signal.throwIfAborted()
   input.on('error',t.failed);output.on('error',t.failed);t.carriersBound=true
   input.pipe(t.inputClient.socket)
   return t.console.handle
  }catch(error){
   if(error.pseudoConsoleOwnership)t.unknownConsole=error.pseudoConsoleOwnership
   throw this.#profileFailure(error)
  }finally{t.preparing=false}
 }
 async closeTerminalAfterDrain({frame,failure}={}){
  const t=this.#terminal
  if(!t)return
  if(t.cleanupAttempted||t.preparing)throw fail('ConPTY cleanup cannot repeat or precede complete preparation join')
  if(this.#launchAttempted){
   const native=frame?inspectLpacJobProcess(this.#api,frame):inspectFailedLpacJobProcess(this.#api,failure)
   if(native.childCreated&&(noHandle(native.process)||noHandle(native.job)||pollProcessExit(this.#api,native.process)===undefined||!isJobEmpty(this.#api,native.job)))throw fail('ConPTY cleanup requires independently settled child and original Job0')
  }
  t.cleanupAttempted=true;t.closing=true;t.closePending=true
  try{
  const errors=[]
  if(t.inputClient){
   t.input.unpipe(t.inputClient.socket)
   const socket=t.inputClient.socket
   if(!socket.destroyed&&!socket.writableFinished){
    await new Promise(resolve=>{
     const done=()=>{socket.off('finish',done);socket.off('close',done);resolve()}
     socket.once('finish',done);socket.once('close',done)
     if(!socket.writableEnded)socket.end()
    })
   }
  }
  // resize调用者持有原失败；这里仅join，不让失败跳过必须执行的Native close。
  if(t.resizing)await t.resizing.then(()=>{},()=>{})
  // Job0、void Close返回、输出EOF、两client close分别观察；close期间reader持续排空。
  t.outputClient?.socket.resume()
  if(t.console)try{await t.console.close()}catch(error){errors.push(error)}
  if(t.unknownConsole)errors.push(fail('ConPTY creation retained an unknown HPCON'))
  for(const pipe of [...t.pipes].reverse()){
   if(pipe.handle===null)continue
   if(pipe.closeAttempted){errors.push(fail('ConPTY server close remains unknown'));continue}
   pipe.closeAttempted=true
   try{closeHandleChecked(this.#api,pipe.handle,'owned ConPTY server');pipe.handle=null}catch(error){errors.push(error)}
  }
  // HPCON状态未知时保留reader，不以destroy制造EOF或冒认回收完成。
  if(t.console?.state==='close-returned'){
   if(t.outputClient.closed&&!t.outputEof)errors.push(fail('ConPTY output closed without EOF'))
   else if(!t.outputEof)try{await Promise.race([t.eof.promise,t.outputClient.closedResult.then(()=>{if(!t.outputEof)throw fail('ConPTY output closed without EOF')})])}catch(error){errors.push(error)}
  }
  for(const client of t.clients){
   if(client===t.outputClient&&(t.unknownConsole||t.console&&(!t.outputEof||t.console.state!=='close-returned')))continue
   if(!client.closed)client.socket.destroy()
   await client.closedResult
  }
  if(t.outputClient?.closed&&t.resumeOutput)t.output.off('drain',t.resumeOutput)
  if(t.carriersBound){t.input.off('error',t.failed);t.output.off('error',t.failed)}
  if(this.terminalOwnership.retainedHandles!==0)errors.push(fail('ConPTY resources remain owned after mandatory drain'))
  if(errors.length)throw this.#profileFailure(new AggregateError(errors,'ConPTY mandatory drain retains unresolved resources or transport failure'))
  t.released=true
  }finally{t.closePending=false}
 }
 launchEnvironment(env){
  if(this.#state!=='owned'||!this.#ownedCommitted||this.#scopeRoots===undefined)throw fail('Launch environment requires committed exact roots')
  const policy=this.#policy,home=policy.taskRoot===null?policy.workspaceRoot:join(policy.taskRoot,'work')
  const temp=this.#temporary?.path??(policy.taskRoot===null?policy.workspaceRoot:join(policy.taskRoot,'tmp'))
  const inside=(root,path)=>equalName(root,path)||path.toUpperCase().startsWith(root.toUpperCase()+String.fromCharCode(92))
  if(!this.#scopeRoots.some(root=>root.directory&&inside(root.path,home))||!this.#scopeRoots.some(root=>root.directory&&root.access==='write'&&inside(root.path,temp)))throw fail('Windows HOME and temporary paths require their actual approved directory roots')
  const result=Object.fromEntries(Object.entries(env).filter(([key])=>!/^(?:HOME|USERPROFILE|TEMP|TMP|TMPDIR|LOCALAPPDATA)$/i.test(key)))
  return {...result,HOME:home,USERPROFILE:home,TEMP:temp,TMP:temp,TMPDIR:temp,LOCALAPPDATA:this.#localAppData}
 }
 #closeScopeRoots(){
  if(this.#scopeEffects!==0||(this.#scopeLock?.ownership.retainedHandles??0)!==0)throw fail('Scope effects and mutation lock must be released before closing their identity anchors')
  const errors=[]
  for(const item of [...this.#scopeRootHandles].reverse()){
   if(item.attempted){errors.push(fail('Exact scope root handle closure remains unknown'));continue}
   item.attempted=true
   try{closeHandleChecked(this.#api,item.handle,'exact scope root identity');if(item.handle===this.#scopeIo?.handle)this.#scopeIo=undefined;this.#scopeRootHandles.splice(this.#scopeRootHandles.indexOf(item),1)}catch(error){errors.push(error)}
  }
  if(errors.length)throw new AggregateError(errors,'Exact scope root identities remain owned')
 }
 #own(handle,kind){if(noHandle(handle))throw fail('Native operation returned an invalid owned handle');this.#handles.push({handle,kind,attempted:false});return handle}
 #allocation(pointer,kind){if(isNullPtr(pointer))throw fail('Native operation returned a null allocation');if(this.#allocations.some(item=>address(item.pointer)===address(pointer)))throw fail('Aliased native SID allocation');const item={pointer,kind,attempted:false};this.#allocations.push(item);return pointer}
 #releaseAllocation(pointer){
  const item=this.#allocations.find(entry=>address(entry.pointer)===address(pointer))
  if(!item||item.attempted)throw fail('Native allocation release is not repeatable')
  item.attempted=true
  if(item.kind==='private-security'){
   const slot=Buffer.alloc(8);slot.writeBigUInt64LE(address(pointer));
   if(this.#api.destroyPrivateObjectSecurity(slot)===0)throwLastError(this.#api,'DestroyPrivateObjectSecurity')
  }else{
   const result=item.kind==='sid'?this.#api.freeSid(pointer):this.#api.localFree(pointer)
   if(!isNullPtr(result))throw fail('Native allocation release failed; ownership retained')
  }
  this.#allocations.splice(this.#allocations.indexOf(item),1)
  if(this.#sid!==undefined&&address(this.#sid)===address(pointer))this.#sid=undefined
 }
 #releaseAllocations(){const errors=[];for(const item of [...this.#allocations])try{this.#releaseAllocation(item.pointer)}catch(error){errors.push(error)}if(errors.length)throw new AggregateError(errors,'Profile allocations remain owned')}
 #closeFileHandle(handle){
  const item=this.#handles.find(item=>item.kind==='handle'&&item.handle===handle)
  if(!item||item.attempted)throw fail('Native file handle closure is not repeatable')
  item.attempted=true;closeHandleChecked(this.#api,item.handle,'owned internal temporary object')
  this.#handles.splice(this.#handles.indexOf(item),1)
 }
 #closeHandles(){
  const errors=[]
  for(const item of [...this.#handles].reverse()){
   if(item.attempted){errors.push(fail('Native handle ownership remains unknown'));continue}
   item.attempted=true
   try{if(item.kind==='key')lstatus('RegCloseKey',this.#api.regCloseKey(item.handle));else closeHandleChecked(this.#api,item.handle,'Profile identity observation');this.#handles.splice(this.#handles.indexOf(item),1)}catch(error){errors.push(error)}
  }
  if(errors.length)throw new AggregateError(errors,'Profile observation handles remain owned')
 }
 #observe(operation){
  if(this.#handles.length)throw fail('Previous Profile observations are not closed')
  let value,error
  try{value=operation()}catch(cause){error=cause}
  try{this.#closeHandles()}catch(cause){error=error?new AggregateError([error,cause],'Profile observation and close failed'):cause}
  if(error)throw error
  return value
 }
 #sidString(sid){
  if(this.#api.isValidSid(sid)===0)throw fail('Native SID is invalid')
  const slot=Buffer.alloc(8)
  if(this.#api.convertSidToStringSidW(sid,slot)===0)throwLastError(this.#api,'ConvertSidToStringSidW')
  const memory=this.#allocation(decodePtr(slot),'local')
  let text
  try{text=requireKoffi().decode.string16(memory);if(typeof text!=='string'||!/^S-1-(?:[0-9]+-)*[0-9]+$/.test(text))throw fail('Invalid SID text')}finally{this.#releaseAllocation(memory)}
  return text
 }
 #derive(name){const slot=Buffer.alloc(8);const status=this.#api.deriveAppContainerSidFromAppContainerName(name,slot);const pointer=decodePtr(slot);if(!isNullPtr(pointer))this.#allocation(pointer,'sid');hresult('DeriveAppContainerSidFromAppContainerName',status);if(isNullPtr(pointer))throw fail('Derived package SID is null');return pointer}
 #tokenBlob(token,kind){
  const size=Buffer.alloc(4),sized=this.#api.getTokenInformation(token,kind,null,0,size),error=sized?0:this.#api.getLastError(),capacity=size.readUInt32LE()
  if(sized||error!==122||capacity===0)throw fail('Invalid native token field sizing result')
  const bytes=Buffer.alloc(capacity)
  if(this.#api.getTokenInformation(token,kind,bytes,capacity,size)===0)throwLastError(this.#api,'GetTokenInformation')
  const actual=size.readUInt32LE()
  if(actual===0||actual>capacity)throw fail('Token field exceeds its native allocation')
  return bytes.subarray(0,actual)
 }
 #tokenSid(bytes,slot=0){
  if(slot+8>bytes.length)throw fail('Token SID pointer field is truncated')
  const sid=decodePtr(bytes.subarray(slot,slot+8)),base=requireKoffi().address(bytes),at=address(sid)
  if(at<base||at>base+BigInt(bytes.length-8))throw fail('Token SID header is outside its native field')
  const offset=Number(at-base),count=bytes[offset+1]
  if(bytes[offset]!==1||count>15||offset+8+4*count>bytes.length)throw fail('Token SID body is outside its native field')
  return this.#sidString(sid)
 }
 #tokenInt(token,kind){const bytes=this.#tokenBlob(token,kind);if(bytes.length!==4)throw fail('Native token integer is not a DWORD');return bytes.readUInt32LE()}
 #tokenGroups(token,kind){
  const bytes=this.#tokenBlob(token,kind)
  if(bytes.length<4)throw fail('Native token groups header is truncated')
  const count=bytes.readUInt32LE()
  if(count&&8+16*count>bytes.length)throw fail('Native token group count exceeds its field')
  return Array.from({length:count},(_,index)=>{const offset=8+16*index;return{sid:this.#tokenSid(bytes,offset),attributes:bytes.readUInt32LE(offset+8)}})
 }
 #tokenFacts(token){
  const statistics=this.#tokenBlob(token,10),privileges=this.#tokenBlob(token,3),type=this.#tokenInt(token,8)
  if(statistics.length<16||privileges.length<4||4+12*privileges.readUInt32LE()>privileges.length)throw fail('Native token statistics/privileges field is truncated')
  const user=this.#tokenBlob(token,1),integrity=this.#tokenBlob(token,25),app=this.#tokenBlob(token,31)
  if(user.length<16||integrity.length<16||app.length<8)throw fail('Native token SID field is truncated')
  return{
   user:this.#tokenSid(user),authenticationId:statistics.readBigUInt64LE(8).toString(16),type,
   level:type===2?this.#tokenInt(token,9):null,isAppContainer:this.#tokenInt(token,29),
   appContainerSid:isNullPtr(decodePtr(app))?null:this.#tokenSid(app),
   integrity:this.#tokenSid(integrity),capabilities:this.#tokenGroups(token,30),groups:this.#tokenGroups(token,2),restrictedSids:this.#tokenGroups(token,11),
   privileges:Array.from({length:privileges.readUInt32LE()},(_,index)=>{const offset=4+12*index;return{luid:privileges.readBigUInt64LE(offset).toString(16),attributes:privileges.readUInt32LE(offset+8)}}),
  }
 }
 #verifyLpacFacts(facts,type,level){
  if(facts.user!==this.#hostSid||facts.authenticationId!==this.#hostAuthentication||facts.type!==type||facts.level!==level||facts.isAppContainer!==1||facts.appContainerSid!==this.#sidText||facts.integrity!=='S-1-16-4096'||facts.capabilities.length!==0)throw fail('Native LPAC token qualification failed')
 }
 #openHostToken(access){
  const handle=this.#api.openProcess(0x1000,0,process.pid)
  if(noHandle(handle))throwLastError(this.#api,'OpenProcess','current Host identity')
  this.#own(handle,'handle')
  if(this.#api.getProcessId(handle)!==process.pid)throw fail('Host process handle identity changed')
  return this.#openToken(handle,access)
 }
 #openToken(processHandle,access){const slot=Buffer.alloc(8);if(this.#api.openProcessToken(processHandle,access,slot)===0)throwLastError(this.#api,'OpenProcessToken');return this.#own(decodePtr(slot),'handle')}
 #duplicateToken(token,level){const slot=Buffer.alloc(8);if(this.#api.duplicateTokenEx(token,level===2?12:8,null,level,2,slot)===0)throwLastError(this.#api,'DuplicateTokenEx');return this.#own(decodePtr(slot),'handle')}
 #identityFailure(){this.#identityRestored=false;this.#state='unknown-retained';this.#api.exitProcess(0x4e424c50);throw fail('Native identity fail-stop unexpectedly returned')}
 #withLpacIdentity(token,expected,operation){
  const tid=this.#api.getCurrentThreadId()
  this.#hostIdentity()
  this.#identityRestored=false
  try{
   if(this.#api.impersonateLoggedOnUser(token)===0)throwLastError(this.#api,'ImpersonateLoggedOnUser')
   if(this.#api.getCurrentThreadId()!==tid)throw fail('LPAC native thread changed')
   const slot=Buffer.alloc(8)
   if(this.#api.openThreadToken(this.#api.getCurrentThread(),8,1,slot)===0)throwLastError(this.#api,'OpenThreadToken')
   const actual=this.#tokenFacts(this.#own(decodePtr(slot),'handle'))
   this.#verifyLpacFacts(actual,2,2)
   if(JSON.stringify(actual)!==JSON.stringify(expected))throw fail('Effective LPAC token differs from the owned copy')
   return operation()
  }finally{
   if(this.#api.getCurrentThreadId()!==tid||this.#api.revertToSelf()===0)this.#identityFailure()
   const after=Buffer.alloc(8),present=this.#api.openThreadToken(this.#api.getCurrentThread(),8,1,after),error=present?0:this.#api.getLastError()
   if(present||error!==1008||this.#api.getCurrentThreadId()!==tid)this.#identityFailure()
   this.#hostIdentity()
  }
 }
 #hostIdentity(){
  this.#identityRestored=false
  const slot=Buffer.alloc(8)
  if(this.#api.openThreadToken(this.#api.getCurrentThread(),8,1,slot)!==0){this.#own(decodePtr(slot),'handle');throw fail('Profile lifecycle requires no thread impersonation')}
  const threadError=this.#api.getLastError();if(threadError!==1008)throw new Win32Error('OpenThreadToken',threadError,'Expected ERROR_NO_TOKEN')
  const token=this.#openHostToken(8),user=this.#tokenBlob(token,1),statistics=this.#tokenBlob(token,10)
  if(user.length<16||statistics.length<16)throw fail('Host token identity fields are truncated')
  const authenticationId=statistics.readBigUInt64LE(8).toString(16)
  if(this.#hostAuthentication===undefined)this.#hostAuthentication=authenticationId
  else if(this.#hostAuthentication!==authenticationId)throw fail('Host token authentication changed')
  const sid=this.#tokenSid(user)
  this.#identityRestored=true
  return sid
 }
 #key(parent,name,access=READ64){const slot=Buffer.alloc(8);lstatus('RegOpenKeyExW',this.#api.regOpenKeyExW(parent,name,OPEN_LINK,access,slot));return this.#own(decodePtr(slot),'key')}
 #nativeName(key){
  const size=Buffer.alloc(4),first=this.#api.ntQueryKey(key,3,null,0,size)>>>0,length=size.readUInt32LE()
  if(![0xc0000023,0x80000005].includes(first)||length<4)throw fail('Invalid native registry-name sizing result')
  const bytes=Buffer.alloc(length),status=this.#api.ntQueryKey(key,3,bytes,bytes.length,size)>>>0
  if(status!==0||size.readUInt32LE()>bytes.length)throw fail('Native registry-name observation failed')
  const count=bytes.readUInt32LE();if(count===0||count%2||count>bytes.length-4)throw fail('Invalid native registry-name bytes')
  const value=decoder.decode(bytes.subarray(4,4+count));if(value.includes('\0'))throw fail('Native registry name contains NUL');return value
 }
 #value(key,name,absent=false){
  const type=Buffer.alloc(4),size=Buffer.alloc(4),first=this.#api.regQueryValueExW(key,name,null,type,null,size)
  if(absent){if(first!==2)throw fail('Registry no-link predicate requires exact ERROR_FILE_NOT_FOUND');return}
  lstatus('RegQueryValueExW size',first)
  const length=size.readUInt32LE(),originalType=type.readUInt32LE();if(length===0||length>65536)throw fail('Invalid bounded registry value length')
  const bytes=Buffer.alloc(length)
  lstatus('RegQueryValueExW read',this.#api.regQueryValueExW(key,name,null,type,bytes,size))
  if(size.readUInt32LE()!==length||type.readUInt32LE()!==originalType)throw fail('Registry value changed during observation')
  return{type:originalType,bytes}
 }
 #boundKey(parent,part,expected){const key=this.#key(parent,part);if(!equalName(this.#nativeName(key),expected))throw fail('Fixed native registry chain mismatch');this.#value(key,'SymbolicLinkValue',true);return key}
 #mappings(){
  const slot=Buffer.alloc(8);lstatus('RegOpenCurrentUser',this.#api.regOpenCurrentUser(READ64,slot))
  const current=this.#own(decodePtr(slot),'key'),root='\\REGISTRY\\USER\\'+this.#hostSid
  if(!equalName(this.#nativeName(current),root))throw fail('Host registry root identity mismatch')
  this.#value(current,'SymbolicLinkValue',true)
  const software=this.#boundKey(current,'Software',root+'\\Software'),classes=this.#key(software,'Classes'),sourceName=root+'\\Software\\Classes',targetName=root+'_Classes'
  if(!equalName(this.#nativeName(classes),sourceName))throw fail('Classes source native identity mismatch')
  const before=this.#value(classes,'SymbolicLinkValue')
  if(before.type!==6||before.bytes.length%2||!equalName(decoder.decode(before.bytes),targetName)||decoder.decode(before.bytes).includes('\0'))throw fail('Classes source is not the fixed counted REG_LINK')
  let key=this.#boundKey(HKEY_USERS,this.#hostSid+'_Classes',targetName),native=targetName
  for(const part of ['Local Settings','Software','Microsoft','Windows','CurrentVersion','AppContainer','Mappings']){native+='\\'+part;key=this.#boundKey(key,part,native)}
  const after=this.#value(classes,'SymbolicLinkValue')
  if(after.type!==before.type||!after.bytes.equals(before.bytes)||!equalName(this.#nativeName(classes),sourceName))throw fail('Classes link changed during bound observation')
  return{key,native,link:Buffer.from(before.bytes)}
 }
 #leafAbsent(parent){
  const slot=Buffer.alloc(8),status=this.#api.regOpenKeyExW(parent,this.#sidText,OPEN_LINK,READ64,slot)
  if(status===0){this.#own(decodePtr(slot),'key');throw fail('Package mapping leaf exists')}
  if(status!==2)throw fail('Package mapping absence requires exact ERROR_FILE_NOT_FOUND')
 }
 #mapping(parent,native){
  const key=this.#boundKey(parent,this.#sidText,native+'\\'+this.#sidText),value=this.#value(key,'Moniker')
  if(value.type!==1||value.bytes.length<4||value.bytes.length>130||value.bytes.length%2)throw fail('Invalid owned Moniker encoding')
  const text=decoder.decode(value.bytes)
  if(!text.endsWith('\0')||text.indexOf('\0')!==text.length-1)throw fail('Owned Moniker needs one terminal NUL')
  const moniker=text.slice(0,-1)
  if(!/^[-_. A-Za-z0-9]{1,64}$/.test(moniker))throw fail('Invalid owned API Moniker')
  if(this.#captured&&!this.#captured.moniker.equals(value.bytes))throw fail('Owned Moniker raw bytes changed')
  const original=this.#derive(this.#name)
  let captured,error
  try{
   captured=this.#derive(moniker)
   if(this.#sidString(original)!==this.#sidText||this.#sidString(captured)!==this.#sidText||this.#api.equalSid(original,this.#sid)===0||this.#api.equalSid(captured,this.#sid)===0)throw fail('Official Moniker derivations do not match the created SID')
  }catch(cause){error=cause}
  const failures=[]
  for(const pointer of [captured,original])if(pointer!==undefined)try{this.#releaseAllocation(pointer)}catch(cause){failures.push(cause)}
  if(failures.length)throw new AggregateError([...(error?[error]:[]),...failures],'Official SID binding or allocation release failed')
  if(error)throw error
  return Buffer.from(value.bytes)
 }
 #file(path,writeDacl=false,writeLabel=false,deleting=false){
  const handle=this.#api.createFileW(path,0x20080|(writeDacl?0x40000:0)|(writeLabel?0x80000:0)|(deleting?0x10000:0),3,null,3,0x02200000,null)
  if(noHandle(handle))throwLastError(this.#api,'CreateFileW','Profile object identity')
  this.#own(handle,'handle')
  const id=Buffer.alloc(24),tag=Buffer.alloc(8),standard=Buffer.alloc(24),name=Buffer.alloc(32768*2)
  for(const [kind,bytes]of [[18,id],[9,tag],[1,standard]])if(this.#api.getFileInformationByHandleEx(handle,kind,bytes,bytes.length)===0)throwLastError(this.#api,'GetFileInformationByHandleEx')
  const directory=standard[21]===1
  if(tag.readUInt32LE()&0x400||tag.readUInt32LE(4)!==0||standard[20]!==0||standard[21]>1||Boolean(tag.readUInt32LE()&16)!==directory||!directory&&standard.readUInt32LE(16)!==1)throw fail('Profile object is reparse, delete-pending, multilink or ambiguous')
  const length=this.#api.getFinalPathNameByHandleW(handle,name,name.length/2,0)
  if(!length)throwLastError(this.#api,'GetFinalPathNameByHandleW')
  if(length>=name.length/2)throw fail('Profile native path exceeds its buffer')
  const native=decoder.decode(name.subarray(0,length*2))
  if(!equalName(resolve(finalPath(native)),resolve(path)))throw fail('Profile object native path changed')
  return{path,handle,directory,id:Buffer.from(id),native}
 }
 #folder(path){const object=this.#file(path);if(!object.directory)throw fail('Profile directory became a file');return object}
 #security(handle,kind){
  const slots=Array.from({length:5},()=>Buffer.alloc(8))
  const status=this.#api.getSecurityInfo(handle,kind,0x17,...slots),memory=decodePtr(slots[4])
  if(!isNullPtr(memory))this.#allocation(memory,'local')
  try{
   lstatus('GetSecurityInfo',status)
   if(isNullPtr(memory))throw fail('Owned security descriptor is null')
   const length=this.#api.getSecurityDescriptorLength(memory)
   if(length<20)throw fail('Native owned security descriptor is truncated')
   const bytes=Buffer.from(requireKoffi().decode(memory,'uint8',length));ownedSecurityDescriptor(bytes);return bytes
  }finally{if(!isNullPtr(memory))this.#releaseAllocation(memory)}
 }
 #members(key){
  const count=Buffer.alloc(4),maximum=Buffer.alloc(4),stamp=Buffer.alloc(8)
  lstatus('RegQueryInfoKeyW',this.#api.regQueryInfoKeyW(key,null,null,null,count,maximum,null,null,null,null,null,stamp))
  const names=[]
  for(let index=0;;index++){
   const text=Buffer.alloc((maximum.readUInt32LE()+1)*2),length=Buffer.alloc(4);length.writeUInt32LE(text.length/2)
   const status=this.#api.regEnumKeyExW(key,index,text,length,null,null,null,null)
   if(status===259)break
   lstatus('RegEnumKeyExW',status)
   const size=length.readUInt32LE();if(size===0||size>=text.length/2)throw fail('Invalid native registry member length')
   const name=decoder.decode(text.subarray(0,size*2))
   if(name.includes('\\')||name.includes('\0')||name==='.'||name==='..')throw fail('Invalid native registry member component')
   names.push(name)
  }
  if(names.length!==count.readUInt32LE())throw fail('Native registry membership changed while enumerating')
  return{members:names.sort(),stamp:stamp.toString('hex')}
 }
 #registryPath(native,writeRoot=false){
  const parts=native.split('\\')
  if(parts.length<5||parts[0]!==''||!equalName(parts[1],'REGISTRY')||!equalName(parts[2],'USER')||!equalName(parts[3],this.#hostSid+'_Classes')||!equalName(parts.at(-1),this.#name))throw fail('API data store is outside this fresh owned Profile')
  let key=HKEY_USERS,name='\\REGISTRY\\USER';const ancestors=[]
  for(let index=3;index<parts.length;index++){
   name+='\\'+parts[index]
   key=this.#key(key,parts[index],READ64|(writeRoot&&index===parts.length-1?0x40000:0))
   if(!equalName(this.#nativeName(key),name))throw fail('API data store native-parent identity changed')
   this.#value(key,'SymbolicLinkValue',true)
   if(index<parts.length-1)ancestors.push({name,handle:key,descriptor:this.#security(key,4)})
  }
  return{name,key,ancestors}
 }
 #fileTree(){
  const queue=[{path:this.#root,parent:null}],objects=[],identities=new Set()
  for(let index=0;index<queue.length;index++){
   const item=queue[index],object=this.#file(item.path),identity=object.id.toString('hex')
   if(identities.has(identity))throw fail('Owned Profile contains duplicate file identities');identities.add(identity)
   if(item.parent!==null){
    const parent=objects.find(value=>equalName(value.name,item.parent))
    if(!parent?.directory||!object.id.subarray(0,8).equals(parent.id.subarray(0,8))||!equalName(object.native,join(parent.native,item.path.slice(item.path.lastIndexOf('\\')+1))))throw fail('Owned file does not bind its held immediate parent')
   }
   const members=object.directory?readdirSync(item.path).sort():null
   if(members)for(const name of members){if(!name||name.includes('\\')||name.includes('/')||name==='.'||name==='..')throw fail('Invalid owned file member');queue.push({path:join(item.path,name),parent:item.path})}
   objects.push({...object,name:item.path,parent:item.parent,kind:1,members,descriptor:this.#security(object.handle,1)})
  }
  return objects
 }
 #scopeFileTree(scopeRoots=this.#scopeRoots){
  const inside=(root,path)=>equalName(root,path)||path.toUpperCase().startsWith(root.toUpperCase()+String.fromCharCode(92))
  const roots=[...scopeRoots].sort((a,b)=>a.path.length-b.path.length),queue=[],objects=[],identities=new Set()
  for(const root of roots)if(!queue.some(item=>inside(item.path,root.path)))queue.push({path:root.path,parent:null})
  for(let index=0;index<queue.length;index++){
   if(this.#preparationStage!=='scope-release')this.#signal.throwIfAborted()
   const item=queue[index],object=this.#file(item.path),identity=object.id.toString('hex')
   if(identities.has(identity))throw fail('Exact scope forest contains aliased native identities');identities.add(identity)
   if(item.parent!==null){
    const parent=objects.find(value=>equalName(value.name,item.parent))
    if(!parent?.directory||!object.id.subarray(0,8).equals(parent.id.subarray(0,8))||!equalName(object.native,join(parent.native,item.path.slice(item.path.lastIndexOf(String.fromCharCode(92))+1))))throw fail('Exact scope file lost its held immediate parent')
   }
   const effective=roots.filter(root=>inside(root.path,item.path))
   if(!effective.length)throw fail('Exact scope file has no committed root')
   const members=object.directory?readdirSync(item.path).sort():null
   if(members)for(const name of members){if(!name||name.includes(String.fromCharCode(92))||name.includes('/')||name==='.'||name==='..')throw fail('Invalid exact scope member');queue.push({path:join(item.path,name),parent:item.path})}
   objects.push({...object,name:item.path,parent:item.parent,kind:1,members,access:effective.some(root=>root.access==='write')?'write':'read',descriptor:this.#security(object.handle,1)})
  }
  for(const root of roots){const current=objects.find(object=>equalName(root.path,object.path));if(!current||current.directory!==root.directory)throw fail('Exact scope root disappeared from the frozen forest');this.#sameFolder(current,root)}
  return objects
 }
 #scopeAncestors(){
  const captured=new Map(),inside=(root,path)=>equalName(root,path)||path.toUpperCase().startsWith(root.toUpperCase()+String.fromCharCode(92))
  for(const root of this.#scopeRoots)for(let path=dirname(root.path);;path=dirname(path)){
   if(!this.#scopeRoots.some(scope=>inside(scope.path,path))&&!captured.has(path.toUpperCase())){
    const object=this.#folder(path);captured.set(path.toUpperCase(),{...object,kind:1,role:'scope-ancestor',name:path,parent:null,descriptor:this.#security(object.handle,1)})
   }
   if(dirname(path)===path)break
  }
  return [...captured.values()]
 }
 #verifyScopeAncestors(ancestors,lpac){
  for(const before of ancestors){
   const current=this.#folder(before.path);this.#sameFolder(current,before)
   if(!sameOwnedSecurityDescriptor(this.#security(current.handle,1),before.descriptor))throw fail('Exact scope shared ancestor security changed')
   if(this.#accessBits(before.descriptor,lpac,[2,4,0x10,0x40,0x100,0x10000,0x40000,0x80000],1).some(value=>value.allowed||value.granted))throw fail('LPAC can mutate an unapproved scope ancestor')
  }
 }
 #qualifyScopeDacl(target,actual,expected,host,lpac,final,site){
  if(!sameOwnedSecurityDescriptor(actual,expected))throw fail('Exact scope descriptor differs from its frozen stage')
  for(const mask of [0x20000,0x40000]){
   const access=this.#access(actual,host,mask,1)
   // 仅保留本次已计算的私有拒绝上下文；普通错误出口不投影 cause。
   if(!access.allowed||(access.granted&mask)!==mask)throw fail('Exact scope Host maintenance access was lost',{cause:{
    kind:'scope-host-maintenance',site,preparationStage:this.#preparationStage,
    target:{name:target.name,fileId:target.id.toString('hex'),kind:target.kind,directory:target.directory,access:target.access},
    mask,allowed:access.allowed,granted:access.granted,
    descriptors:{actual:actual.toString('hex'),expected:expected.toString('hex'),...target.original===undefined?{}:{original:target.original.toString('hex')},...target.candidate===undefined?{}:{candidate:target.candidate.toString('hex')}}
   }})
  }
  const masks=[1,2,4,8,0x10,0x20,0x40,0x80,0x100,0x10000,0x20000,0x40000,0x80000,0x100000]
  if(JSON.stringify(this.#accessBits(actual,lpac,masks,1))!==JSON.stringify(this.#accessBits(expected,lpac,masks,1)))throw fail('Exact scope native access differs from the frozen descriptor')
  if(final){
   const required=target.access==='write'?0x1301bf:0x1200a9,access=this.#access(actual,lpac,required,1)
   if(!access.allowed||(access.granted&required)!==required)throw fail('Exact scope candidate does not provide the approved DACL access')
   const denied=target.access==='write'?[0x40000,0x80000]:[2,4,0x10,0x40,0x100,0x10000,0x40000,0x80000]
   if(this.#accessBits(actual,lpac,denied,1).some(value=>value.allowed||value.granted))throw fail('Exact scope candidate grants unapproved LPAC DACL access')
  }
 }
 #verifyScopeDacls(plan,expected,host,lpac,final=false,site){
  const fresh=this.#scopeFileTree(),byName=new Map(fresh.map(object=>[plan.key(object),object]))
  if(fresh.length!==plan.targets.length||byName.size!==plan.targets.length)throw fail('Exact scope membership changed across its frozen stage')
  for(const target of plan.targets){
   const observed=byName.get(plan.key(target))
   if(!observed||observed.directory!==target.directory||observed.parent!==target.parent||observed.access!==target.access||JSON.stringify(observed.members)!==JSON.stringify(target.members))throw fail('Exact scope member kind, parent or children changed')
   this.#sameFolder(observed,target)
   this.#qualifyScopeDacl(target,observed.descriptor,expected.get(plan.key(target)),host,lpac,final,site)
  }
 }
 #keyTree(root){
  const queue=[{handle:root.key,name:root.name,parent:null}],objects=[]
  for(let index=0;index<queue.length;index++){
   const item=queue[index]
   if(!equalName(this.#nativeName(item.handle),item.name))throw fail('Owned registry native name changed')
   this.#value(item.handle,'SymbolicLinkValue',true)
   const children=this.#members(item.handle)
   objects.push({...item,...children,kind:4,directory:false,descriptor:this.#security(item.handle,4)})
   for(const name of children.members){const expected=item.name+'\\'+name,handle=this.#key(item.handle,name);if(!equalName(this.#nativeName(handle),expected))throw fail('Owned registry child native name changed');queue.push({handle,name:expected,parent:item.name})}
  }
  return objects
 }
 #genericMapping(kind){
  const values=kind===1?[0x120089,0x120116,0x1200a0,0x1f01ff]:[0x20019,0x20006,0x20019,0xf003f],bytes=Buffer.alloc(16)
  values.forEach((value,index)=>bytes.writeUInt32LE(value,index*4));return bytes
 }
 #inheritFileDacl(parent,child,directory){return this.#inheritFileSecurity(parent,child,directory,false)}
 #inheritFileLabel(parent,child,directory){return this.#inheritFileSecurity(parent,child,directory,true)}
 #inheritFileSecurity(parent,child,directory,label){
  if(ownedSecurityDescriptor(child).control&(label?0x2000:0x1000))return Buffer.from(child)
  const input=(label?scopedFileLabelInheritanceInputs:scopedFileInheritanceInputs)(parent,child),slot=Buffer.alloc(8)
  // 0x19/0x1a只控制内存DACL/SACL继承；实际写入仍由原Host令牌核权限。
  let failure,result
  try{if(this.#api.createPrivateObjectSecurityEx(input.parent,input.creator,slot,null,directory?1:0,label?0x1a:0x19,null,this.#genericMapping(1))===0)throw new Win32Error('CreatePrivateObjectSecurityEx',this.#api.getLastError(),'Exact scope inheritance calculation')}catch(error){failure=error}
  const memory=decodePtr(slot)
  if(!isNullPtr(memory))this.#allocation(memory,'private-security')
  try{
   if(failure)throw failure
   if(isNullPtr(memory))throw fail('Native inheritance returned no owned descriptor')
   const length=this.#api.getSecurityDescriptorLength(memory)
   if(length<20)throw fail('Native inheritance returned a truncated descriptor')
   result=(label?mergeScopedFileLabelInheritance:mergeScopedFileInheritance)(child,Buffer.from(requireKoffi().decode(memory,'uint8',length)))
  }catch(error){failure=error}
  if(!isNullPtr(memory))try{this.#releaseAllocation(memory)}catch(cleanup){failure=failure?new AggregateError([failure,cleanup],'Native scope calculation retains its descriptor allocation'):cleanup}
  if(failure)throw failure
  return result
 }
 #mapMask(mask,kind){const value=Buffer.alloc(4);value.writeUInt32LE(mask);this.#api.mapGenericMask(value,this.#genericMapping(kind));return value.readUInt32LE()}
 #access(descriptor,token,mask,kind,mapping=this.#genericMapping(kind)){
  const size=Buffer.alloc(4),granted=Buffer.alloc(4),allowed=Buffer.alloc(4)
  let ok=this.#api.accessCheck(descriptor,token,mask,mapping,null,size,granted,allowed),error=ok?0:this.#api.getLastError()
  if(!ok){
   if(error!==122||size.readUInt32LE()===0)throw new Win32Error('AccessCheck',error,'Owned descriptor privilege sizing')
   const privileges=Buffer.alloc(size.readUInt32LE())
   ok=this.#api.accessCheck(descriptor,token,mask,mapping,privileges,size,granted,allowed)
   if(!ok)throwLastError(this.#api,'AccessCheck')
   if(size.readUInt32LE()>privileges.length)throw fail('AccessCheck privilege result exceeds its allocation')
  }
  return{allowed:allowed.readUInt32LE()!==0,granted:granted.readUInt32LE()}
 }
 #qualifyLpacToken(token){
  // 已验的内存 SD 区分 LPAC 与普通 AppContainer；不依赖本机拒绝的 class 46 查询。
  const slot=Buffer.alloc(8),length=Buffer.alloc(4)
  if(this.#api.convertStringSecurityDescriptorToSecurityDescriptorW('O:SYG:SYD:(A;;0x3;;;WD)(A;;0x1;;;S-1-15-2-1)(A;;0x2;;;S-1-15-2-2)',1,slot,length)===0)throwLastError(this.#api,'ConvertStringSecurityDescriptorToSecurityDescriptorW')
  const memory=this.#allocation(decodePtr(slot),'local')
  try{const access=this.#access(memory,token,0x02000000,1,Buffer.alloc(16));if(!access.allowed||access.granted!==2)throw fail('Native LPAC access-check qualification failed')}finally{this.#releaseAllocation(memory)}
 }
 #accessBits(descriptor,token,masks,kind){return masks.map(mask=>this.#access(descriptor,token,mask,kind))}
 #qualifyDescriptor(target,actual,expected,host,lpac,requireDenied){
  if(!sameOwnedSecurityDescriptor(actual,expected,requireDenied&&target.ownerRightsAdded))throw fail('Owned security descriptor differs from its frozen stage')
  const kind=target.kind,writes=kind===1?[2,4,0x10,0x40,0x100,0x10000,0x40000,0x80000]:[2,4,0x20,0x10000,0x40000,0x80000],reads=kind===1?[1,8,0x20,0x80,0x20000,0x100000]:[1,8,0x10,0x20000]
  for(const mask of [0x20000,0x40000,0x10000]){const access=this.#access(actual,host,mask,kind);if(!access.allowed||(access.granted&mask)!==mask)throw fail('Owned Profile Host maintenance access was lost')}
  const actualWrites=this.#accessBits(actual,lpac,writes,kind),expectedWrites=this.#accessBits(expected,lpac,writes,kind)
  if(JSON.stringify(actualWrites)!==JSON.stringify(expectedWrites)||requireDenied&&actualWrites.some(value=>value.allowed||value.granted!==0))throw fail('Owned LPAC write rights differ from the frozen stage')
  for(const token of [host,lpac])if(JSON.stringify(this.#accessBits(target.original,token,reads,kind))!==JSON.stringify(this.#accessBits(actual,token,reads,kind)))throw fail('Owned Profile read/execute access changed')
 }
 #sameFolder(observed,expected){if(!observed.id.equals(expected.id)||!equalName(observed.native,expected.native))throw fail('Profile directory FileID/native-name drift')}
 #sharedGuards(shared,lpac){
  for(const before of shared.files){
   const current=this.#folder(before.path);this.#sameFolder(current,before)
   if(!this.#security(current.handle,1).equals(before.descriptor))throw fail('Shared Profile ancestor security changed')
   if(this.#accessBits(before.descriptor,lpac,[2,4,0x10,0x40,0x100,0x10000,0x40000,0x80000],1).some(value=>value.allowed||value.granted))throw fail('LPAC can mutate a shared Profile file ancestor')
  }
  const current=this.#registryPath(shared.root)
  if(current.ancestors.length!==shared.keys.length)throw fail('Shared registry ancestor count changed')
  for(let index=0;index<shared.keys.length;index++){
   const before=shared.keys[index],after=current.ancestors[index]
   if(!equalName(before.name,after.name)||!before.descriptor.equals(after.descriptor))throw fail('Shared Profile registry ancestor security changed')
   if(this.#accessBits(before.descriptor,lpac,[2,4,0x20,0x10000,0x40000,0x80000],4).some(value=>value.allowed||value.granted))throw fail('LPAC can mutate a shared Profile registry ancestor')
  }
 }
 #verifyTree(plan,expected,completed,shared,host,lpac){
  const fresh=[...this.#fileTree(),...this.#keyTree(this.#registryPath(shared.root))],byName=new Map(fresh.map(object=>[plan.key(object),object]))
  if(byName.size!==plan.targets.length||fresh.length!==plan.targets.length)throw fail('Owned Profile tree membership changed')
  for(const target of plan.targets){
   const observed=byName.get(plan.key(target)),descriptor=expected.get(plan.key(target)),denied=completed.has(plan.key(target))
   if(!observed||observed.directory!==target.directory||JSON.stringify(observed.members)!==JSON.stringify(target.members))throw fail('Owned Profile member kind/names changed')
   if(target.kind===1)this.#sameFolder(observed,target)
   else{if(!equalName(this.#nativeName(target.handle),target.name))throw fail('Held owned registry identity changed');this.#value(target.handle,'SymbolicLinkValue',true)}
   const held=this.#security(target.handle,target.kind)
   this.#qualifyDescriptor(target,held,descriptor,host,lpac,denied)
   this.#qualifyDescriptor(target,observed.descriptor,descriptor,host,lpac,denied)
   if(!sameOwnedSecurityDescriptor(held,observed.descriptor,denied&&target.ownerRightsAdded))throw fail('Held and fresh Profile security differ')
  }
  this.#sharedGuards(shared,lpac)
 }
 #writeHandle(target,root){
  if(target.kind===1){const object=this.#file(target.path,true);this.#sameFolder(object,target);if(object.directory!==target.directory)throw fail('Owned write handle kind changed');return object.handle}
  let opened=this.#registryPath(root,equalName(target.name,root)),key=opened.key,name=opened.name
  if(!equalName(target.name,root)){
   if(!target.name.toUpperCase().startsWith(root.toUpperCase()+'\\'))throw fail('Owned registry write target is outside the bound API root')
   const parts=target.name.slice(root.length+1).split('\\')
   for(let index=0;index<parts.length;index++){name+='\\'+parts[index];key=this.#key(key,parts[index],READ64|(index===parts.length-1?0x40000:0));if(!equalName(this.#nativeName(key),name))throw fail('Owned write registry identity changed');this.#value(key,'SymbolicLinkValue',true)}
  }
  return key
 }
 #verifyNativeWriteDenial(token,facts,plan){
  this.#withLpacIdentity(token,facts,()=>{
   for(const target of plan.targets){
    const masks=target.kind===1?[2,4,0x10,0x40,0x100,0x10000,0x40000,0x80000]:[2,4,0x20,0x10000,0x40000,0x80000]
    for(const mask of masks){
     if(target.kind===1){
      const handle=this.#api.createFileW(target.path,mask,3,null,3,0x02200000,null),error=noHandle(handle)?this.#api.getLastError():0
      if(!noHandle(handle)){this.#own(handle,'handle');throw fail('Actual LPAC file write-access open unexpectedly succeeded')}
      if(error!==5)throw new Win32Error('CreateFileW',error,'Owned LPAC write denial is not verified')
     }else{
      const slot=Buffer.alloc(8),status=this.#api.regOpenKeyExW(HKEY_USERS,target.name.slice('\\REGISTRY\\USER\\'.length),OPEN_LINK,mask,slot)
      const handle=decodePtr(slot);if(!noHandle(handle))this.#own(handle,'key')
      if(status!==5)throw fail('Actual LPAC registry write-access denial is not verified')
     }
    }
   }
  })
 }
 #profileFailure(error){
  this.#state='unknown-retained';if(this.#sealReceipt)this.#sealReceipt.state='unknown-retained'
  error.profileOwnership=this.receipt
  if(!Object.hasOwn(error,'profileResource'))Object.defineProperty(error,'profileResource',{value:this})
  return error
 }
 #privateProof(phase,roots,objects,registryRoot){
  return parseWindowsResourceProof({kind:'windows-lpac-private-proof',version:1,profileName:this.#name,profileSid:this.#sidText,scopeCount:this.#scopeCount,phase,profile:{moniker:this.#captured.moniker.toString('hex'),classesLink:this.#captured.link.toString('hex'),registryRoot},roots,objects:objects.map(object=>({
   kind:object.kind,role:object.role,name:object.name,fileId:object.kind===1?object.id.toString('hex'):null,directory:object.directory,parent:object.parent,
   original:object.original.toString('hex'),candidate:object.candidate.toString('hex'),
   addedAces:object.addedAces?object.addedAces.map(ace=>ace.toString('hex')):object.ownerRightsAdded?[ownedSecurityDescriptor(object.candidate).dacl.subarray(-20).toString('hex')]:[],label:object.label??null
  }))})
 }
 async #commitProof(proof,ownership){
  if(this.#proofPending)throw fail('Profile proof commit is already pending')
  if(this.#preparationStage!=='scope-release')this.#signal.throwIfAborted()
  const descriptor=this.describeOwnership({...ownership,status:'unknown-retained',preparationPending:true})
  this.#proofPending=true
  try{
   const entryId=await this.#recordResource.withProof(descriptor,proof)
   if(typeof entryId!=='string'||!entryId||entryId.includes(String.fromCharCode(0)))throw fail('Profile proof has no committed entry identity')
   if(this.#preparationStage!=='scope-release')this.#signal.throwIfAborted()
   return entryId
  }finally{this.#proofPending=false}
 }
 async commitOwnedProof(ownership){
  if(this.#state!=='owned'||this.#ownedCommitted||this.#launchAttempted||this.#proofPending||this.#preparationStage!==undefined)throw fail('Profile ownership proof cannot be repeated')
  this.#preparationStage='ownership'
  try{
   this.revalidate()
   const proof=this.#observe(()=>{
    const objects=[this.#folder(this.#root),this.#folder(this.#ac)].map(object=>({...object,kind:1,role:'profile',name:object.path,parent:equalName(object.path,this.#root)?null:this.#root,original:this.#security(object.handle,1)}))
    this.#sameFolder(objects[0],this.#captured.root);this.#sameFolder(objects[1],this.#captured.ac);this.#sameFolder(this.#folder(this.#apiFolder()),this.#captured.ac)
    for(const before of this.#parents){const current=this.#folder(before.path);this.#sameFolder(current,before);objects.push({...current,kind:1,role:'profile-ancestor',name:current.path,parent:null,original:this.#security(current.handle,1)})}
    return this.#privateProof('profile-owned',this.scopeRoots,objects.map(object=>({...object,candidate:object.original})),null)
   })
   await this.#commitProof(proof,ownership)
   this.revalidate();this.#ownedCommitted=true
  }catch(error){throw this.#profileFailure(error)}finally{this.#preparationStage=undefined}
 }
 #withSealContext(launch,operation){
  if(!this.#launch||this.#launch.process!==launch.process||this.#launch.job!==launch.job||this.#launch.pid!==launch.pid)throw fail('Profile seal does not bind the original suspended launch')
  return this.#observe(()=>{
    if(this.#api.getProcessId(launch.process)!==launch.pid)throw fail('Suspended native process identity differs')
    const inJob=Buffer.alloc(4)
    if(this.#api.isProcessInJob(launch.process,launch.job,inJob)===0)throwLastError(this.#api,'IsProcessInJob')
    if(inJob.readUInt32LE()!==1||pollProcessExit(this.#api,launch.process)!==undefined)throw fail('Profile preparation requires the original live Job target')
    if(this.#hostIdentity()!==this.#hostSid)throw fail('Profile Host identity changed before seal')
    const source=this.#openToken(launch.process,10),primaryFacts=this.#tokenFacts(source)
    this.#verifyLpacFacts(primaryFacts,1,null)
    const lpac=this.#duplicateToken(source,1),io=this.#duplicateToken(source,2),lpacFacts=this.#tokenFacts(lpac),ioFacts=this.#tokenFacts(io)
    this.#verifyLpacFacts(lpacFacts,2,1);this.#verifyLpacFacts(ioFacts,2,2);this.#qualifyLpacToken(lpac)
    for(const facts of [lpacFacts,ioFacts])if(JSON.stringify({...facts,type:1,level:null})!==JSON.stringify(primaryFacts))throw fail('LPAC copied token facts differ from the original primary token')
    const host=this.#duplicateToken(this.#openHostToken(10),1),hostFacts=this.#tokenFacts(host)
    if(hostFacts.user!==this.#hostSid||hostFacts.authenticationId!==this.#hostAuthentication||hostFacts.type!==2||hostFacts.level!==1||hostFacts.isAppContainer!==0||hostFacts.appContainerSid!==null)throw fail('Host access-check token qualification failed')
    const apiRoot=this.#withLpacIdentity(io,ioFacts,()=>{
     const slot=Buffer.alloc(8),status=this.#api.getAppContainerRegistryLocation(0x20019,slot),handle=decodePtr(slot)
     if(!noHandle(handle))this.#own(handle,'key')
     hresult('GetAppContainerRegistryLocation',status)
     if(noHandle(handle))throw fail('LPAC API data-store root is null')
     const name=this.#nativeName(handle);this.#value(handle,'SymbolicLinkValue',true);return{key:handle,name}
    })
    const root=this.#registryPath(apiRoot.name)
    if(!this.#security(apiRoot.key,4).equals(this.#security(root.key,4)))throw fail('API and independently reopened data-store descriptors differ')
   return operation({host,lpac,io,ioFacts,root})
  })
 }
 #freezeSeal(launch,roots){
  if(this.#sealed||this.#sealReceipt||this.#state!=='owned'||!this.#ownedCommitted||this.#proofPending)throw fail('Profile seal is not repeatable')
  this.#signal.throwIfAborted();this.revalidate();if(this.#launch===undefined)this.bindSuspended(launch)
  this.#sealReceipt={state:'qualifying',effects:[],frozenPlan:null}
  return this.#withSealContext(launch,({host,lpac,root})=>{
   const files=this.#fileTree(),keys=this.#keyTree(root),objects=[...files,...keys],shared={root:root.name,keys:root.ancestors,files:this.#parents.map(before=>{const current=this.#folder(before.path);this.#sameFolder(current,before);return{...current,descriptor:this.#security(current.handle,1)}})}
   this.#sameFolder(files[0],this.#captured.root)
   const ac=files.find(object=>equalName(object.path,this.#ac));if(!ac?.directory)throw fail('Owned AC directory disappeared');this.#sameFolder(ac,this.#captured.ac);this.#sameFolder(this.#folder(this.#apiFolder()),ac)
   const plan=freezeOwnedPackageWriteStages(objects,Buffer.from(requireKoffi().decode(this.#sid,'uint8',this.#api.getLengthSid(this.#sid))),(mask,kind)=>this.#mapMask(mask,kind))
   for(const target of plan.targets)this.#qualifyDescriptor(target,target.candidate,target.candidate,host,lpac,true)
   this.#verifyTree(plan,plan.stages[0].before,new Set(),shared,host,lpac)
   const proofObjects=[...plan.targets.map(target=>({...target,role:'profile'})),...shared.files.map(object=>({...object,kind:1,role:'profile-ancestor',name:object.path,parent:null,original:object.descriptor,candidate:object.descriptor})),...shared.keys.map(object=>({...object,kind:4,role:'profile-ancestor',directory:false,parent:null,original:object.descriptor,candidate:object.descriptor}))]
   const proof=this.#privateProof('profile-seal-frozen',roots,proofObjects,root.name)
   // 跨耐久等待只保留原基线和身份，关闭的观察句柄不得再用。
   for(const object of [...plan.targets,...shared.files,...shared.keys])delete object.handle
   this.#sealPlan={plan,shared};this.#sealReceipt.frozenPlan=plan;this.#sealReceipt.state='frozen'
   return proof
  })
 }
 #rebindSeal(plan,root){
  const objects=[...this.#fileTree(),...this.#keyTree(root)],byName=new Map(objects.map(object=>[plan.key(object),object]))
  if(objects.length!==plan.targets.length||byName.size!==plan.targets.length)throw fail('Frozen Profile membership changed across commit')
  const targets=plan.targets.map(target=>{
   const current=byName.get(plan.key(target))
   if(!current||current.directory!==target.directory||current.parent!==target.parent||JSON.stringify(current.members)!==JSON.stringify(target.members))throw fail('Frozen Profile member changed across commit')
   if(target.kind===1)this.#sameFolder(current,target)
   return {...target,handle:current.handle}
  }),bound=new Map(targets.map(target=>[plan.key(target),target]))
  return {...plan,targets,stages:plan.stages.map(stage=>({...stage,target:bound.get(plan.key(stage.target))}))}
 }
 #applyFrozenSeal(launch){
  if(this.#sealReceipt?.state!=='committed'||!this.#sealPlan||this.#proofPending)throw fail('Profile seal requires its committed frozen plan')
  this.#signal.throwIfAborted();this.revalidate();this.#sealReceipt.state='applying'
  this.#withSealContext(launch,({host,lpac,io,ioFacts,root})=>{
   const {shared}=this.#sealPlan
   if(!equalName(root.name,shared.root))throw fail('Frozen Profile registry root changed across commit')
   const plan=this.#rebindSeal(this.#sealPlan.plan,root)
   this.#verifyTree(plan,plan.stages[0].before,new Set(),shared,host,lpac)
    for(const stage of plan.stages){
     this.#signal.throwIfAborted()
     const target=stage.target,handle=this.#writeHandle(target,root.name),before=this.#security(handle,target.kind)
     this.#qualifyDescriptor(target,before,stage.before.get(plan.key(target)),host,lpac,false)
     const effect={kind:target.kind,name:target.name,attempted:false,status:null,immediateVerified:false};this.#sealReceipt.effects.push(effect)
     let failure
     try{
      effect.attempted=true
      effect.status=this.#api.setSecurityInfo(handle,target.kind,4,null,null,ownedSecurityDescriptor(target.candidate).dacl,null)
      lstatus('SetSecurityInfo',effect.status)
      this.#qualifyDescriptor(target,this.#security(handle,target.kind),target.candidate,host,lpac,true);effect.immediateVerified=true
     }catch(error){failure=error}
     // 失败也观测整树部分效果；不会回滚、自动重试或继续写后续对象。
     try{this.#verifyTree(plan,stage.after,stage.completed,shared,host,lpac)}catch(error){failure=failure?new AggregateError([failure,error],'Owned apply and frozen tree verification failed'):error}
     if(failure)throw failure
    }
   const final=plan.stages.at(-1);this.#verifyTree(plan,final.after,final.completed,shared,host,lpac)
   this.#verifyNativeWriteDenial(io,ioFacts,plan)
  })
  this.revalidate();this.#sealed=true;this.#sealReceipt.state='sealed'
  return{profileOwned:true,profileSealed:true,nativeTokenQualified:true,observationHandlesClosed:true}
 }
 #verifyNativeScopeAccess(io,ioFacts,targets){
  this.#withLpacIdentity(io,ioFacts,()=>{
   for(const target of targets)for(const mask of target.access==='write'?[0x120089,0x120116]:[0x120089]){
    const handle=this.#api.createFileW(target.name,mask,3,null,3,0x02200000,null)
    if(noHandle(handle))throwLastError(this.#api,'CreateFileW','Actual LPAC approved scope access')
    this.#own(handle,'handle')
    const id=Buffer.alloc(24)
    if(this.#api.getFileInformationByHandleEx(handle,18,id,id.length)===0)throwLastError(this.#api,'GetFileInformationByHandleEx')
    if(!id.equals(target.id))throw fail('Actual LPAC scope access opened a different FileID')
   }
  })
 }
 #applyScopeStages(plan,ancestors,host,lpac){
for(const stage of plan.stages){
   if(this.#preparationStage!=='scope-release')this.#signal.throwIfAborted();this.#scopeLock.assertHeld()
   this.#verifyScopeDacls(plan,stage.before,host,lpac,false,'apply.stage-before');this.#verifyScopeAncestors(ancestors,lpac)
   const target=stage.target,label=stage.component==='label',write=this.#file(target.path,!label,label),expected=stage.after.get(plan.key(target))
   this.#sameFolder(write,target)
   if(!sameOwnedSecurityDescriptor(this.#security(write.handle,1),stage.before.get(plan.key(target))))throw fail('Exact scope write handle differs from the committed stage')
   // 首次可能改变整条继承子树；失败也保留这些对象的归属，不能按return-zero假称无效果。
   for(const [key,after]of stage.after)if(!sameOwnedSecurityDescriptor(after,stage.before.get(key)))this.#scopeAffected.add(key)
   this.#scopeEffects=this.#scopeAffected.size
   let error
   try{
    const security=ownedSecurityDescriptor(expected),status=this.#api.setSecurityInfo(write.handle,1,label?0x10:4,null,null,label?null:security.dacl,label?security.sacl:null)
    lstatus('SetSecurityInfo',status)
   }catch(failure){error=failure}
   try{this.#verifyScopeDacls(plan,stage.after,host,lpac,false,'apply.stage-after');this.#verifyScopeAncestors(ancestors,lpac)}catch(observation){error=error?new AggregateError([error,observation],'Scope apply and full frozen-stage observation failed'):observation}
   if(error)throw error
  }
 }
 async prepareSuspendedScopes(launch,{ownership}){
  if(!this.#sealed||this.#state!=='owned'||this.#scopeState!==undefined||this.#proofPending||this.#preparationStage!==undefined)throw fail('Scope preparation requires the sealed original suspended launch and cannot repeat')
  this.#preparationStage='scope'
  let failure,result
  try{
   this.#signal.throwIfAborted();this.revalidate();this.#scopeState='qualifying'
   this.#scopeLock=createAclMutationLock(this.#api,this.#scopeInstallRoot)
   await this.#scopeLock.acquire(this.#signal)
   this.#scopeLock.assertHeld()
   const captured=this.#withSealContext(launch,({lpac,io,ioFacts})=>{
    const at=this.#handles.findIndex(item=>item.handle===io)
    if(this.#scopeIo!==undefined||at<0)throw fail('Scope cleanup token must retain the original qualified native handle once')
    this.#scopeRootHandles.push(this.#handles.splice(at,1)[0]);this.#scopeIo={handle:io,facts:ioFacts}
    const objects=this.#scopeFileTree(),ancestors=this.#scopeAncestors()
    this.#verifyScopeAncestors(ancestors,lpac)
    for(const object of [...objects,...ancestors])delete object.handle
    return {objects,ancestors}
   })
   // 同安装锁仍在；关闭同步身份窗口后才读原Job的完整来源闭包，包括祖先FileID。
   const entries=await this.#recordResource.readScopeProofs([...new Set([...captured.objects,...captured.ancestors].map(object=>object.id.toString('hex')))])
   this.#signal.throwIfAborted();this.#scopeLock.assertHeld();this.revalidate()
   const proof=this.#withSealContext(launch,({host,lpac})=>{
    const {objects,ancestors}=captured,key=object=>object.name.toUpperCase()
    this.#verifyScopeDacls({targets:objects,key},new Map(objects.map(object=>[key(object),object.descriptor])),host,lpac,false,'prepare.original');this.#verifyScopeAncestors(ancestors,lpac)
    const labels=freezeScopedFileLabelStages(planScopedFileLabels(objects,entries,this.#name),(parent,child,directory)=>this.#inheritFileLabel(parent,child,directory))
    const sid=Buffer.from(requireKoffi().decode(this.#sid,'uint8',this.#api.getLengthSid(this.#sid)))
    const dacls=freezeScopedFileAccessStages(labels.targets.map(target=>({...target,descriptor:target.candidate})),sid,(parent,child,directory)=>this.#inheritFileDacl(parent,child,directory),this.#hostSid)
    const originals=new Map(objects.map(object=>[key(object),object.descriptor]))
    const plan={key,targets:dacls.targets.map(target=>({...target,original:originals.get(key(target))})),stages:[...labels.stages,...dacls.stages.map(stage=>({...stage,component:'dacl'}))]}
    for(const target of plan.targets){
     this.#qualifyScopeDacl(target,target.candidate,target.candidate,host,lpac,true,'prepare.candidate')
     if(target.labelChanged){const access=this.#access(target.original,host,0x80000,1);if(!access.allowed||(access.granted&0x80000)!==0x80000)throw fail('Scope label preparation requires actual Host WRITE_OWNER')}
    }
    this.#verifyScopeDacls(plan,plan.stages[0].before,host,lpac,false,'prepare.first-stage')
    const proof=this.#privateProof('scope-frozen',this.scopeRoots,[...plan.targets.map(target=>({...target,role:'scope'})),...ancestors.map(object=>({...object,original:object.descriptor,candidate:object.descriptor}))],null)
    for(const object of [...plan.targets,...ancestors])delete object.handle
    this.#scopePlan={plan,ancestors};this.#scopeState='frozen'
    return proof
   })
   await this.#commitProof(proof,{...ownership,scopeReleased:false})
   this.#scopeState='committed';this.#scopeLock.assertHeld();this.#signal.throwIfAborted();this.revalidate()
   this.#withSealContext(launch,({host,lpac,io,ioFacts})=>{
    const {plan,ancestors}=this.#scopePlan
    this.#verifyScopeDacls(plan,plan.stages[0].before,host,lpac,false,'prepare.committed-before-apply');this.#verifyScopeAncestors(ancestors,lpac)
    this.#scopeState='applying'
    this.#applyScopeStages(plan,ancestors,host,lpac)
    this.#verifyScopeDacls(plan,plan.stages.at(-1).after,host,lpac,true,'prepare.final-before-io')
    this.#verifyNativeScopeAccess(io,ioFacts,plan.targets)
    this.#verifyNativeWriteDenial(io,ioFacts,{targets:[...ancestors,...plan.targets.filter(target=>target.access==='read')]})
    this.#verifyScopeDacls(plan,plan.stages.at(-1).after,host,lpac,true,'prepare.final-after-io');this.#verifyScopeAncestors(ancestors,lpac)
   })
   this.#scopeState='prepared'
   await this.#recordResource(this.describeOwnership({...ownership,status:'unknown-retained',preparationPending:true,scopeReleased:false}))
   // mandatory回收/原runner接线未闭；即使本组件IO资格通过也不能据此Resume。
   result={scopeDaclsPrepared:true,scopeLabelsPrepared:true,scopeIoQualified:true,scopeReady:false}
  }catch(error){failure=error;this.#scopeState='unknown-retained'}
  if(this.#scopeLock?.ownership.retainedHandles&&!this.#scopeLock.ownership.releaseAttempted)try{this.#scopeLock.release()}catch(cleanup){failure=failure?new AggregateError([failure,cleanup],'Scope preparation retains its mutation lock'):cleanup}
  this.#preparationStage=undefined
  if(failure)throw this.#profileFailure(failure)
  return result
 }
 #assertScopeDrained(frame){
  const native=inspectLpacJobProcess(this.#api,frame);
  if(!this.#launch||native.process!==this.#launch.process||native.job!==this.#launch.job||native.pid!==this.#launch.pid||!native.jobConfigured||!native.assigned||!native.childCreated||!native.preparationReleased||native.pendingPreparation!==undefined||native.processCloseAttempted||native.jobCloseAttempted)throw fail('Scope release requires the original joined native launch');
  if(this.#api.getProcessId(native.process)!==native.pid||pollProcessExit(this.#api,native.process)===undefined||!isJobEmpty(this.#api,native.job))throw fail('Scope release requires the settled original target and empty Job');
 }
 #withScopeReleaseContext(frame,operation){
  this.#assertScopeDrained(frame)
  return this.#observe(()=>{
   if(this.#hostIdentity()!==this.#hostSid||!this.#scopeIo)throw fail('Scope release requires its original Host and retained native IO token')
   const io=this.#scopeIo.handle,facts=this.#tokenFacts(io)
   this.#verifyLpacFacts(facts,2,2)
   if(JSON.stringify(facts)!==JSON.stringify(this.#scopeIo.facts))throw fail('Scope release token differs from the original qualified copy')
   this.#qualifyLpacToken(io)
   const host=this.#duplicateToken(this.#openHostToken(10),1),hostFacts=this.#tokenFacts(host)
   if(hostFacts.user!==this.#hostSid||hostFacts.authenticationId!==this.#hostAuthentication||hostFacts.type!==2||hostFacts.level!==1||hostFacts.isAppContainer!==0||hostFacts.appContainerSid!==null)throw fail('Scope release Host access-check token is unqualified')
   return operation({host,lpac:io})
  })
 }
 async releaseScopesAfterNativeDrain(frame,{ownership}){
  if(this.#scopeReleaseAttempted||this.#scopeState==='released'||this.#proofPending||this.#preparationStage!==undefined)throw fail('Scope release requires joined preparation and cannot repeat')
  this.#assertScopeDrained(frame)
  this.#scopeReleaseAttempted=true;this.#preparationStage='scope-release'
  const drained={...ownership,childSettled:true,jobEmpty:true,scopeReleased:false}
  let failure,result
  try{
   if(this.#scopeLock?.ownership.retainedHandles)throw fail('The previous scope mutation lock still has unknown ownership')
   this.revalidate()
   if(!this.#scopePlan){
    if(this.#scopeEffects!==0)throw fail('Scope effects have no original frozen ownership')
    await this.#recordResource(this.describeOwnership({...drained,status:'unknown-retained',preparationPending:true,scopeReleased:true}))
    this.#scopeState='released';result={scopeReleased:true}
   }else{
    this.#scopeLock=createAclMutationLock(this.#api,this.#scopeInstallRoot)
    // 业务取消不撤销原Job的mandatory回收；清理不复用已abort的业务signal。
    await this.#scopeLock.acquire(new AbortController().signal)
    this.#scopeLock.assertHeld()
    const captured=this.#withScopeReleaseContext(frame,({lpac})=>{
     const objects=this.#scopeFileTree(),ancestors=this.#scopeAncestors()
     this.#verifyScopeAncestors(ancestors,lpac)
     for(const object of [...objects,...ancestors])delete object.handle
     return {objects,ancestors}
    })
    const entries=await this.#recordResource.readScopeProofs([...new Set([...captured.objects,...captured.ancestors].map(object=>object.id.toString('hex')))])
    this.#scopeLock.assertHeld();this.revalidate()
    let release
    const proof=this.#withScopeReleaseContext(frame,({host,lpac})=>{
     const {objects,ancestors}=captured,key=object=>object.name.toUpperCase()
     this.#verifyScopeDacls({targets:objects,key},new Map(objects.map(object=>[key(object),object.descriptor])),host,lpac,false,'release.original');this.#verifyScopeAncestors(ancestors,lpac)
     const dacls=freezeScopedFileReleaseStages(objects,entries,this.#name,(parent,child,directory)=>this.#inheritFileDacl(parent,child,directory),this.#hostSid)
     const untouched=new Set(this.#scopePlan.plan.targets.filter(target=>!this.#scopeAffected.has(key(target))).map(target=>target.id.toString('hex')))
     const labels=freezeScopedFileLabelStages(planScopedFileLabelRelease(dacls.targets.map(target=>({...target,descriptor:target.candidate})),entries,this.#name,untouched),(parent,child,directory)=>this.#inheritFileLabel(parent,child,directory))
     const originals=new Map(objects.map(object=>[key(object),object.descriptor]))
     const plan={key,targets:labels.targets.map(target=>({...target,original:originals.get(key(target)),addedAces:[],label:null})),stages:[...dacls.stages,...labels.stages]}
     for(const target of plan.targets){
      this.#qualifyScopeDacl(target,target.candidate,target.candidate,host,lpac,false,'release.candidate')
      if(target.labelChanged){const access=this.#access(target.original,host,0x80000,1);if(!access.allowed||(access.granted&0x80000)!==0x80000)throw fail('Scope label release requires actual Host WRITE_OWNER')}
     }
     for(const object of [...plan.targets,...ancestors])delete object.handle
     release={plan,ancestors}
     return this.#privateProof('scope-released',this.scopeRoots,[...plan.targets.map(target=>({...target,role:'scope'})),...ancestors.map(object=>({...object,original:object.descriptor,candidate:object.descriptor}))],null)
    })
    // 此proof冻结回收意图；公开scopeReleased仍false，ACK后才能产生Native副作用。
    await this.#commitProof(proof,drained)
    this.#scopeLock.assertHeld();this.revalidate()
    this.#withScopeReleaseContext(frame,({host,lpac})=>{
     const {plan,ancestors}=release,before=new Map(plan.targets.map(target=>[plan.key(target),target.original]))
     this.#verifyScopeDacls(plan,before,host,lpac,false,'release.committed-before-apply');this.#verifyScopeAncestors(ancestors,lpac)
     this.#applyScopeStages(plan,ancestors,host,lpac)
     this.#verifyScopeDacls(plan,new Map(plan.targets.map(target=>[plan.key(target),target.candidate])),host,lpac,false,'release.final');this.#verifyScopeAncestors(ancestors,lpac)
    })
    this.#scopeEffects=0
    if(this.#temporary)this.#temporary.releasedTree=release.plan.targets.filter(target=>equalName(target.path,this.#temporary.path)||target.path.toUpperCase().startsWith(this.#temporary.path.toUpperCase()+String.fromCharCode(92)))
    await this.#recordResource(this.describeOwnership({...drained,status:'unknown-retained',preparationPending:true,scopeReleased:true}))
    this.#scopeAffected.clear();this.#scopeState='released';result={scopeReleased:true}
   }
  }catch(error){failure=error;this.#scopeState='unknown-retained'}
  if(this.#scopeLock?.ownership.retainedHandles&&!this.#scopeLock.ownership.releaseAttempted)try{this.#scopeLock.release()}catch(cleanup){failure=failure?new AggregateError([failure,cleanup],'Scope release retains its mutation lock'):cleanup}
  this.#preparationStage=undefined
  if(failure){this.#scopeState='unknown-retained';throw this.#profileFailure(failure)}
  return result
 }
 assertReadyToResume(frame){
  if(this.#state!=='owned'||!this.#sealed||this.#scopeState!=='prepared'||this.#proofPending||this.#preparationStage!==undefined||!this.#scopePlan||!this.#sealPlan||(this.#scopeLock?.ownership.retainedHandles??0)!==0)throw fail('Resume requires joined and fully prepared original Profile ownership')
  this.#signal.throwIfAborted();this.revalidate()
  const native=inspectLpacJobProcess(this.#api,frame)
  if(this.#terminal&&(this.#terminal.failure||this.#terminal.closing||this.#terminal.preparing||this.#terminal.resizing!==undefined||this.#terminal.console?.state!=='open'||isNullPtr(native.pseudoConsole)||address(native.pseudoConsole)!==address(this.#terminal.console.handle)))throw fail('ConPTY does not bind the original ready suspended frame')
  if(!this.#launch||native.process!==this.#launch.process||native.job!==this.#launch.job||native.pid!==this.#launch.pid||!native.jobConfigured||!native.assigned||!native.childCreated||!native.preparationReleased||native.pendingPreparation!==undefined||native.resumeAttempted||native.initialThreadCloseAttempted||native.processCloseAttempted||native.jobCloseAttempted)throw fail('Resume does not bind the original idle suspended frame')
  this.#withSealContext(frame,({host,lpac,io,ioFacts,root})=>{
   const {shared}=this.#sealPlan
   if(!equalName(root.name,shared.root))throw fail('Profile registry identity changed before Resume')
   const seal=this.#rebindSeal(this.#sealPlan.plan,root),final=seal.stages.at(-1)
   this.#verifyTree(seal,final.after,final.completed,shared,host,lpac)
   this.#verifyNativeWriteDenial(io,ioFacts,seal)
   const {plan,ancestors}=this.#scopePlan,expected=new Map(plan.targets.map(target=>[plan.key(target),target.candidate]))
   this.#verifyScopeDacls(plan,expected,host,lpac,true,'resume.before-io');this.#verifyScopeAncestors(ancestors,lpac)
   this.#verifyNativeScopeAccess(io,ioFacts,plan.targets)
   this.#verifyNativeWriteDenial(io,ioFacts,{targets:[...ancestors,...plan.targets.filter(target=>target.access==='read')]})
   this.#verifyScopeDacls(plan,expected,host,lpac,true,'resume.after-io');this.#verifyScopeAncestors(ancestors,lpac)
  })
  this.#signal.throwIfAborted()
 }
 async sealSuspendedLaunch(launch,{ownership}){
  if(this.#state!=='owned'||this.#sealed||this.#sealReceipt!==undefined||this.#proofPending||this.#preparationStage!==undefined)throw fail('Profile seal requires the original idle preparation and cannot repeat')
  this.#preparationStage='seal'
  try{
   const proof=this.#freezeSeal(launch,this.scopeRoots)
   this.#sealReceipt.entryId=await this.#commitProof(proof,ownership)
   this.#sealReceipt.state='committed'
   return this.#applyFrozenSeal(launch)
  }catch(error){
   // seal未完整终验却已尝试Native写入，scope回收成功不能替它解除未知。
   if(this.#sealReceipt?.effects.some(effect=>effect.attempted))this.#sealMutationUncertain=true
   throw this.#profileFailure(error)
  }finally{this.#preparationStage=undefined}
 }
 #absentFolder(path){const attributes=this.#api.getFileAttributesW(path),error=attributes===0xffffffff?this.#api.getLastError():0;if(attributes!==0xffffffff||![2,3].includes(error))throw fail('Profile directory absence is unverified')}
 #apiFolder(){
  const slot=Buffer.alloc(8);hresult('GetAppContainerFolderPath',this.#api.getAppContainerFolderPath(this.#sidText,slot));const pointer=decodePtr(slot)
  if(isNullPtr(pointer))throw fail('API Profile folder is null')
  try{const path=requireKoffi().decode.string16(pointer);if(typeof path!=='string'||!isAbsolute(path)||!equalName(resolve(path),this.#ac))throw fail('API Profile folder is not the owned AC directory');return path}finally{this.#api.coTaskMemFree(pointer)}
 }
 create(){
  try{
   this.#observe(()=>{
    this.#hostSid=this.#hostIdentity()
    const slot=Buffer.alloc(8),folderStatus=this.#api.getKnownFolderPath(localAppDataId,0,null,slot),memory=decodePtr(slot)
    let local
    try{hresult('SHGetKnownFolderPath',folderStatus);if(isNullPtr(memory))throw fail('Native LocalAppData is null');local=requireKoffi().decode.string16(memory);if(typeof local!=='string'||!isAbsolute(local))throw fail('Invalid native LocalAppData')}finally{if(!isNullPtr(memory))this.#api.coTaskMemFree(memory)}
    this.#localAppData=local
    const packages=join(local,'Packages');this.#root=join(packages,this.#name);this.#ac=join(this.#root,'AC')
    const chain=[];for(let at=packages;;at=dirname(at)){chain.unshift(at);if(dirname(at)===at)break}
    this.#parents=chain.map(path=>this.#folder(path))
    for(let i=1;i<this.#parents.length;i++)if(!this.#parents[i].id.subarray(0,8).equals(this.#parents[i-1].id.subarray(0,8)))throw fail('Profile ancestor volume drift')
    this.#absentFolder(this.#root)
    const derived=this.#derive(this.#name);this.#sidText=this.#sidString(derived)
    if(!/^S-1-15-2(?:-[0-9]+)+$/.test(this.#sidText))throw fail('Derived SID is not an AppContainer package')
    const before=this.#mappings();this.#leafAbsent(before.key)
    const result=Buffer.alloc(8);this.#state='create-attempted';this.#creationAttempted=true
    const status=this.#api.createAppContainerProfile(this.#name,this.#name,'Night Bot isolated process',null,0,result),created=decodePtr(result)
    this.#created=status===0
    if(!isNullPtr(created))this.#allocation(created,'sid')
    hresult('CreateAppContainerProfile',status)
    if(isNullPtr(created)||this.#api.equalSid(derived,created)===0||this.#sidString(created)!==this.#sidText)throw fail('Created package SID does not match official derivation')
    this.#sid=created
    const after=this.#mappings();if(!after.link.equals(before.link))throw fail('Classes source changed across Profile creation')
    const moniker=this.#mapping(after.key,after.native),root=this.#folder(this.#root),ac=this.#folder(this.#ac),api=this.#folder(this.#apiFolder())
    this.#sameFolder(api,ac)
    for(const parent of this.#parents)this.#sameFolder(this.#folder(parent.path),parent)
    this.#captured={moniker,link:Buffer.from(after.link),root,ac}
    this.#releaseAllocation(derived)
   })
   this.#state='owned';return this
  }catch(error){
   this.#state=this.#created?'unknown-retained':'create-unconfirmed'
   try{this.#releaseAllocations()}catch(cleanup){error=new AggregateError([error,cleanup],'Profile preparation retains native ownership')}
   error.profileOwnership=this.receipt
   Object.defineProperty(error,'profileResource',{value:this})
   throw error
  }
 }
 revalidate(){
  if(!['owned','unknown-retained'].includes(this.#state)||!this.#created||!this.#captured||!this.#sid||this.#deleteAttempted)throw fail('Profile is not a captured active resource')
  return this.#observe(()=>{
   if(this.#hostIdentity()!==this.#hostSid)throw fail('Profile Host identity changed')
   const mapping=this.#mappings();if(!mapping.link.equals(this.#captured.link))throw fail('Profile Classes source changed')
   this.#mapping(mapping.key,mapping.native)
   for(const parent of this.#parents)this.#sameFolder(this.#folder(parent.path),parent)
   this.#sameFolder(this.#folder(this.#root),this.#captured.root);this.#sameFolder(this.#folder(this.#ac),this.#captured.ac);this.#sameFolder(this.#folder(this.#apiFolder()),this.#captured.ac)
   for(const root of this.#scopeRoots??[]){const current=this.#file(root.path);this.#sameFolder(current,root);if(current.directory!==root.directory)throw fail('Exact scope root kind changed')}
  })
 }
 markLaunchAttempted(){if(this.#state!=='owned'||this.#scopeRoots===undefined||!this.#ownedCommitted||this.#proofPending||this.#preparationStage!==undefined||this.#launchAttempted)throw fail('Profile launch requires committed ownership and cannot be repeated');this.#launchAttempted=true}
 bindSuspended(frame){
  const native=inspectLpacJobProcess(this.#api,frame),{process,job,pid}=native,t=this.#terminal
  if(!this.#launchAttempted||this.#launch||noHandle(process)||noHandle(job)||!Number.isInteger(pid)||pid<=0)throw fail('Invalid suspended Profile launch ownership')
  if(t&&(t.failure||t.preparing||t.closing||t.console?.state!=='open'||t.clients.length!==2||t.clients.some(c=>!c.connected||c.closed)||t.pipes.some(p=>!p.connected||p.closeAttempted||p.handle===null)||isNullPtr(native.pseudoConsole)||address(native.pseudoConsole)!==address(t.console.handle)))throw fail('ConPTY frame is not bound to its original connected resources')
  if(!t&&!isNullPtr(native.pseudoConsole))throw fail('Suspended frame contains an unowned ConPTY')
  this.#launch={process,job,pid}
 }
 #removeTemporaryRoot(){
  const temporary=this.#temporary
  if(!temporary?.creationAttempted)return
  if(!temporary.created||!temporary.original||temporary.cleanupAttempted||this.#scopeEffects!==0||this.#scopeRootHandles.length)throw fail('Internal temporary cleanup requires known creation and released scope identity anchors')
  temporary.cleanupAttempted=true;this.#preparationStage='scope-release'
  try{
   this.#observe(()=>{
    if(this.#hostIdentity()!==this.#hostSid)throw fail('Internal temporary cleanup Host identity changed')
    for(const before of temporary.parents){
     const observed=this.#folder(before.path);this.#sameFolder(observed,before)
     if(!sameOwnedSecurityDescriptor(this.#security(observed.handle,1),before.descriptor))throw fail('Internal temporary ancestor security changed')
    }
    const expected=temporary.releasedTree??[{...temporary.original,members:[]}]
    const objects=this.#scopeFileTree([{...temporary.original,access:'write'}])
    if(objects.length!==expected.length)throw fail('Internal temporary membership changed after its committed release')
    for(const object of objects){
     const before=expected.find(before=>equalName(before.path,object.path))
     if(!before||before.directory!==object.directory||JSON.stringify(before.members)!==JSON.stringify(object.members))throw fail('Internal temporary object differs from its committed release')
     this.#sameFolder(object,before)
     if(!sameOwnedSecurityDescriptor(object.descriptor,before.candidate??before.descriptor))throw fail('Internal temporary object security changed after release')
    }
    // 父锚一直保留；逐个由同FileID的DELETE句柄删除，不递归跟随路径或链接。
    for(const object of [...objects].reverse()){
     this.#closeFileHandle(object.handle)
     const deleting=this.#file(object.path,false,false,true);this.#sameFolder(deleting,object)
     if(deleting.directory!==object.directory||!sameOwnedSecurityDescriptor(this.#security(deleting.handle,1),object.descriptor)||deleting.directory&&readdirSync(deleting.path).length)throw fail('Internal temporary deletion target changed')
     const flags=Buffer.alloc(4);flags.writeUInt32LE(0x11)
     // FileDispositionInfoEx：DELETE|IGNORE_READONLY，不启用POSIX提前摘名语义。
     if(this.#api.setFileInformationByHandle(deleting.handle,21,flags,flags.length)===0)throwLastError(this.#api,'SetFileInformationByHandle','owned internal temporary deletion')
     this.#closeFileHandle(deleting.handle);this.#absentFolder(deleting.path)
    }
    this.#absentFolder(temporary.path)
   })
   temporary.absent=true
  }finally{this.#preparationStage=undefined}
 }
 #delete(closeLaunchHandles){
  if(!this.terminalOwnership.released)throw fail('Profile deletion requires complete ConPTY drain and resource closure')
  if(this.#sealMutationUncertain||!this.#identityRestored)throw fail('Profile deletion requires resolved seal effects and restored thread identity')
  if(this.#proofPending||this.#preparationStage!==undefined)throw fail('Profile cleanup requires joined proof and complete preparation')
  if(this.#scopeState!==undefined&&this.#scopeState!=='released')throw fail('Profile deletion requires the committed release of its scope and label claims')
  if(this.#cleanupAttempted)throw fail('Profile cleanup is not repeatable')
  this.#cleanupAttempted=true
  try{
   this.revalidate()
   this.#closeScopeRoots()
   this.#releaseAllocations()
   if(this.#handles.length||this.#allocations.length)throw fail('Profile native resources are still retained')
   if(closeLaunchHandles){const result=closeLaunchHandles();if(result&&typeof result.then==='function')throw fail('Profile cleanup must close native handles synchronously')}
   this.#removeTemporaryRoot()
   this.#deleteAttempted=true;this.#state='delete-attempted';hresult('DeleteAppContainerProfile',this.#api.deleteAppContainerProfile(this.#name))
   this.#observe(()=>{
    if(this.#hostIdentity()!==this.#hostSid)throw fail('Post-delete Host identity changed')
    const after=this.#mappings();if(!after.link.equals(this.#captured.link))throw fail('Post-delete Classes source changed')
    this.#leafAbsent(after.key);this.#absentFolder(this.#root);this.#absentFolder(this.#ac)
    for(const parent of this.#parents)this.#sameFolder(this.#folder(parent.path),parent)
   })
   this.#state='registration-and-folder-absent'
  }catch(error){this.#state='unknown-retained';error.profileOwnership=this.receipt;Object.defineProperty(error,'profileResource',{value:this});throw error}
 }
 deleteUnlaunched(){
  if(this.#launchAttempted)throw fail('A launch-attempted Profile requires native drain')
  if(!this.#creationAttempted){
   if(this.#cleanupAttempted||this.#proofPending||this.#preparationStage!==undefined||this.#created||!this.#identityRestored||this.#handles.length||this.#allocations.length||this.#scopeRootHandles.length||this.#scopeEffects!==0||(this.#scopeLock?.ownership.retainedHandles??0)!==0)throw fail('Never-created Profile cleanup requires joined zero-resource ownership')
   // 首次planned等待中取消，从未调用Create；不对这个名字调用SDK Delete。
   this.#cleanupAttempted=true;this.#state='never-created';return
  }
  this.#delete()
 }
 deleteAfterFailedLaunch(failure){
  try{
   if(!this.#launchAttempted||this.#launch||this.#proofPending||!this.#sid)throw fail('Failed launch cleanup does not match pending Profile ownership')
   const native=inspectFailedLpacJobProcess(this.#api,failure)
   if(address(native.packageSid)!==address(this.#sid)||!native.preparationReleased||native.pendingPreparation!==undefined)throw fail('Failed launch preparation or Profile SID is not independently bound')
   if(native.childCreated){
    if(noHandle(native.process)||noHandle(native.job)||!Number.isInteger(native.pid)||native.pid<=0||this.#api.getProcessId(native.process)!==native.pid||pollProcessExit(this.#api,native.process)===undefined||!isJobEmpty(this.#api,native.job))throw fail('Failed launch requires its independently settled child and empty Job')
   }else if(native.process!==null||native.initialThread!==null)throw fail('Failed launch child absence contradicts retained handles')
   this.#delete(()=>closeFailedLpacJobProcessHandles(this.#api,failure))
  }catch(error){throw this.#profileFailure(error)}
 }
 deleteAfterNativeDrain({process,job,closeLaunchHandles}){
  if(!this.#launch||process!==this.#launch.process||job!==this.#launch.job||typeof closeLaunchHandles!=='function')throw fail('Profile cleanup must bind the original native launch')
  if(pollProcessExit(this.#api,process)===undefined||!isJobEmpty(this.#api,job))throw fail('Profile cleanup requires settled target and empty original Job')
  this.#delete(closeLaunchHandles)
 }
}

export async function createOwnedAppContainerProfile({recordResource,policy,signal}){
 if(typeof recordResource!=='function'||typeof recordResource.withProof!=='function'||typeof recordResource.readScopeProofs!=='function')throw fail('Owned Profiles require the original durable Job proof ports')
 signal.throwIfAborted()
 if(process.platform!=='win32'||process.arch!=='x64')throw fail('Owned AppContainer Profiles require Windows x64')
 const checked=parseWindowsLaunchPolicy(policy)
 const resource=new OwnedAppContainerProfile(loadWindowsAppContainerBindings(),checked,recordResource,signal)
 try{
  // 首个持久身份必须早于 Create；记录回调 resolve 代表原 Job 已 append+commit。
  await recordResource(resource.describeOwnership({status:'planned',scopeEffects:0,nativeHandles:0,nativeAllocations:0,preparationPending:false,childSettled:true,jobEmpty:true,nativeHandlesClosed:true,scopeReleased:true}))
  signal.throwIfAborted()
  return resource.create()
 }catch(error){
  error.profileOwnership=resource.receipt
  Object.defineProperty(error,'profileResource',{value:resource});throw error
 }
}
