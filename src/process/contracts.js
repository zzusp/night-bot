import {AsyncLocalStorage} from 'node:async_hooks'
import {win32 as windowsPath} from 'node:path'
import {Service} from '@deepseek-ai/cordis'
import {createRequire} from 'node:module'
// One application policy owns public HTTP routing and ordinary child proxy overlays.
import {proxyEnvironmentForChild} from '../native-http-proxy.js'
export const MAX_TIMER_DELAY_MS=2147483647
export class SubprocessRuntime extends Service{constructor(ctx){super(ctx,'subprocess')}}
export class SubprocessExecutableNotFoundError extends Error{constructor(message,options){super(message,options);this.name='SubprocessExecutableNotFoundError'}}
export function createLazyRequire(specifier,parent){const require=createRequire(parent);let ready=false,value;return()=>{if(!ready){value=require(specifier);ready=true}return value}}
export function scrubbedParentEnv(){const env={};for(const [key,value]of Object.entries(process.env))if(value!==undefined&&!/KEY|PASSWORD|SECRET|TOKEN/i.test(key)&&!/^(?:DSH_|NIGHT_BOT_)/i.test(key))env[key]=value;for(const [key,value]of Object.entries(proxyEnvironmentForChild()))if(value===undefined)delete env[key];else env[key]=value;return env}

// Host-only metadata stays off public tool DTOs, argv and environment. A copied
// spec must explicitly retain it; serialisation happens only at runner IPC.
const processFileRequests = new WeakMap()
const windowsLaunchPolicies = new WeakMap()
export function bindProcessFileRequest(target, argv, policy) {
 processFileRequests.set(target, Object.freeze({argv:Object.freeze([...argv]),mode:policy.mode,workspaceRoot:policy.workspaceRoot}))
 return target
}
export function processFileRequest(target) {return processFileRequests.get(target)}
export function bindWindowsFileRequest(target, argv, policy) {return bindProcessFileRequest(target,argv,policy)}
export function windowsFileRequest(target) {return processFileRequest(target)}
export function windowsLaunchPolicy(target) {return windowsLaunchPolicies.get(target)}
export function retainProcessPolicy(source, target) {
 const file=processFileRequests.get(source),launch=windowsLaunchPolicies.get(source)
 if(file)processFileRequests.set(target,file)
 if(launch)windowsLaunchPolicies.set(target,launch)
 const recorder=processResourceRecorders.get(source)
 if(recorder)processResourceRecorders.set(target,recorder)
 return target
}
// 策略投影与 spawn 消费读取同一 Host 调用；检查本身不消耗授权。
export function authorizedProcessPolicy(ctx, policy) {
 const actor=ctx.get('agents')?.currentInitiator()
 const grant=ctx.get('tools')?.inspectProcessAuthorization?.({actor})
 if(grant===undefined)return policy
 if(grant.kind==='direct')return {...policy,mode:'danger-full-access'}
 if(grant.kind==='scoped')return {...policy,mode:policy?.mode==='read-only'?'read-only':'workspace-write'}
 throw new Error('Invalid Host process authorization projection')
}
export function preparedProcessSpec(prepared, createSpec) {
 const argv=Array.isArray(prepared)?prepared:prepared.argv
 return retainProcessPolicy(prepared,createSpec(argv))
}

const localWindowsPath=value=>typeof value==='string'&&/^[a-z]:/i.test(value)&&value[2]===windowsPath.sep&&!value.includes(String.fromCharCode(0))&&!/[<>"|?*]/u.test(value)&&!value.slice(2).includes(':')&&!value.slice(3).split(windowsPath.sep).some(part=>/[. ]$/.test(part))&&windowsPath.normalize(value)===value
const windowsInside=(root,path)=>{const rel=windowsPath.relative(root,path);return rel===''||rel!=='..'&&!rel.startsWith('..'+windowsPath.sep)&&!windowsPath.isAbsolute(rel)}
/** Strict runner-boundary decoding. Paths are Host-resolved local paths, not
 * model-provided grants; native identity/SD qualification is still mandatory. */
export function parseWindowsLaunchPolicy(value,cwd) {
 const fields=['kind','version','mode','installRoot','tempRoot','workspaceRoot','taskRoot','readRoots','writeRoots','privateRoots','networkCapabilities']
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||!fields.every(key=>Object.hasOwn(value,key))||value.kind!=='windows-lpac'||value.version!==1||!['read-only','workspace-write'].includes(value.mode))throw new Error('Invalid Windows LPAC policy record')
 if(!localWindowsPath(value.tempRoot)||!localWindowsPath(value.installRoot)||windowsPath.relative(windowsPath.join(value.installRoot,'data','temp'),value.tempRoot)!=='')throw new Error('Windows LPAC requires the trusted standard temporary root')
 if(!localWindowsPath(value.installRoot)||!localWindowsPath(value.workspaceRoot)||!windowsInside(windowsPath.join(value.installRoot,'data','workspaces'),value.workspaceRoot)||value.taskRoot!==null&&value.taskRoot!==value.workspaceRoot)throw new Error('Invalid Windows LPAC workspace boundary')
 const scopeParts=windowsPath.relative(windowsPath.join(value.installRoot,'data','workspaces'),value.workspaceRoot).split(windowsPath.sep).filter(Boolean)
 const taskScope=scopeParts[0]?.toLowerCase()==='tasks'
 if(taskScope?(scopeParts.length!==2||value.taskRoot===null):value.taskRoot!==null)throw new Error('Windows LPAC task scope must match the controlled tasks directory')
 for(const key of ['readRoots','writeRoots','privateRoots'])if(!Array.isArray(value[key])||value[key].some(path=>!localWindowsPath(path))||new Set(value[key].map(path=>path.toLowerCase())).size!==value[key].length)throw new Error('Invalid Windows LPAC path set')
 if(cwd!==undefined&&(!localWindowsPath(cwd)||!windowsInside(value.workspaceRoot,cwd)&&![...value.readRoots,...value.writeRoots].some(root=>windowsInside(root,cwd))||value.privateRoots.some(root=>windowsInside(root,cwd))))throw new Error('Windows LPAC cwd is outside its Host-bound scope or crosses a private boundary')
 if(value.mode==='read-only'&&value.writeRoots.length)throw new Error('Read-only Windows policy cannot grant writes')
 const writable=value.taskRoot===null?[value.workspaceRoot]:['work','tmp'].map(name=>windowsPath.join(value.taskRoot,name))
 for(const path of [...value.readRoots,...value.writeRoots]){
  if(value.privateRoots.some(root=>windowsInside(root,path)||windowsInside(path,root))||windowsInside(value.installRoot,path)&&!windowsInside(value.workspaceRoot,path))throw new Error('Windows LPAC scope crosses private installation or another workspace');
 }
 for(const path of value.writeRoots)if(windowsInside(value.workspaceRoot,path)&&!writable.some(root=>windowsInside(root,path)))throw new Error('Windows LPAC write crosses a Host-owned task boundary')
 if(!Array.isArray(value.networkCapabilities)||value.networkCapabilities.length)throw new Error('Windows LPAC network requires an approved task/effect policy; ambient capabilities are forbidden')
 return Object.freeze({...value,readRoots:Object.freeze([...value.readRoots]),writeRoots:Object.freeze([...value.writeRoots]),privateRoots:Object.freeze([...value.privateRoots]),networkCapabilities:Object.freeze([])})
}
// 只投影已由 Host 绑定的范围；FileID 与实际有效权限仍由同一 runner 核验。
export function windowsScopeRoots(policy){
 const checked=parseWindowsLaunchPolicy(policy),roots=new Map()
 for(const [paths,access]of [[checked.readRoots,'read'],[checked.writeRoots,'write']])for(const path of paths){
  const key=path.toUpperCase(),previous=roots.get(key)
  if(!previous||access==='write')roots.set(key,{path,access})
 }
 return [...roots.values()]
}
export function bindWindowsLaunchPolicy(target, policy) {
 windowsLaunchPolicies.set(target,parseWindowsLaunchPolicy(policy,target.cwd))
 return target
}

/** Host-only resource receipt. It carries no native pointers or business paths. */
export function parseWindowsResourceOwnership(value) {
 const fields=['kind','version','status','profileName','profileSid','scopeCount','scopeEffects','retainedHandles','retainedAllocations','preparationPending','threadRestored','childSettled','jobEmpty','nativeHandlesClosed','scopeReleased','profileAbsent']
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||!fields.every(key=>Object.hasOwn(value,key))||value.kind!=='windows-lpac'||value.version!==1||!['planned','unknown-retained','released'].includes(value.status)||typeof value.profileName!=='string'||!/^nightbot-[a-f0-9]{32}$/.test(value.profileName))throw new Error('Invalid Windows resource ownership receipt')
 if(value.profileSid!==null){
  if(typeof value.profileSid!=='string'||!value.profileSid.startsWith('S-1-15-2-'))throw new Error('Invalid Windows Profile SID')
  const parts=value.profileSid.slice('S-1-15-2-'.length).split('-')
  if(parts.length!==7||parts.some(part=>!/^(?:0|[1-9][0-9]{0,9})$/.test(part)||Number(part)>0xffffffff))throw new Error('Invalid Windows Profile SID')
 }
 for(const key of ['scopeCount','scopeEffects','retainedHandles','retainedAllocations'])if(!Number.isSafeInteger(value[key])||value[key]<0)throw new Error('Invalid Windows resource count')
 for(const key of ['preparationPending','threadRestored','childSettled','jobEmpty','nativeHandlesClosed','scopeReleased','profileAbsent'])if(typeof value[key]!=='boolean')throw new Error('Invalid Windows resource proof flag')
 if(value.nativeHandlesClosed&&value.retainedHandles!==0||value.scopeReleased&&value.scopeEffects!==0)throw new Error('Windows resource proof contradicts retained resources')
 if(value.status==='released'&&(value.preparationPending||value.retainedHandles!==0||value.retainedAllocations!==0||value.scopeEffects!==0||!['threadRestored','childSettled','jobEmpty','nativeHandlesClosed','scopeReleased','profileAbsent'].every(key=>value[key])))throw new Error('Windows resource release is unproven')
 return Object.freeze({...value})
}

// 私有恢复证据仅供原 Job/runner；不进入工具 DTO、普通视图或自动重放。
export function parseWindowsResourceProof(value) {
 const nativeRegistryPrefix=String.fromCharCode(92)+['REGISTRY','USER',''].join(String.fromCharCode(92))
 const exact=(object,keys)=>object!==null&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key))
 const text=value=>typeof value==='string'&&value.length>0&&!value.includes(String.fromCharCode(0))
 const hex=value=>typeof value==='string'&&/^(?:[a-f0-9]{2})+$/.test(value)
 const fileId=value=>typeof value==='string'&&/^[a-f0-9]{48}$/.test(value)
 const sid=value=>typeof value==='string'&&/^S-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}$/.test(value)&&value.slice(9).split('-').every(part=>Number(part)<=0xffffffff)
 const sd=value=>{
  if(!hex(value)||value.length<40)throw new Error('Invalid Windows private security descriptor')
  const bytes=Buffer.from(value,'hex')
  if(bytes[0]!==1||!(bytes.readUInt16LE(2)&0x8000))throw new Error('Private descriptor must be self relative')
  for(const [offset,acl] of [[4,false],[8,false],[12,true],[16,true]]){
   const at=bytes.readUInt32LE(offset)
   if(at===0)continue
   if(at<20||at%4||at+8>bytes.length)throw new Error('Private security component is outside its descriptor')
   const length=acl?bytes.readUInt16LE(at+2):8+4*bytes[at+1]
   if(length<8||at+length>bytes.length||!acl&&(bytes[at]!==1||bytes[at+1]>15))throw new Error('Invalid private security component')
  }
 }
 const acl=value=>{
  if(!hex(value)||value.length<16)throw new Error('Invalid private label ACL')
  const bytes=Buffer.from(value,'hex')
  if(![2,4].includes(bytes[0])||bytes.readUInt16LE(2)!==bytes.length)throw new Error('Invalid private label ACL length')
 }
 const ref=value=>exact(value,['owner','jobId','entryId','fileId'])&&['owner','jobId','entryId'].every(key=>text(value[key]))&&fileId(value.fileId)
 if(!exact(value,['kind','version','profileName','profileSid','scopeCount','phase','profile','roots','objects'])||value.kind!=='windows-lpac-private-proof'||value.version!==1||typeof value.profileName!=='string'||!/^nightbot-[a-f0-9]{32}$/.test(value.profileName)||!sid(value.profileSid)||!Number.isSafeInteger(value.scopeCount)||value.scopeCount<0||!['profile-owned','profile-seal-frozen','scope-frozen','scope-released'].includes(value.phase))throw new Error('Invalid Windows private resource proof')
 if(!exact(value.profile,['moniker','classesLink','registryRoot'])||!hex(value.profile.moniker)||!hex(value.profile.classesLink)||value.profile.registryRoot!==null&&(!text(value.profile.registryRoot)||!value.profile.registryRoot.startsWith(nativeRegistryPrefix)))throw new Error('Invalid private Profile binding')
 if(!Array.isArray(value.roots)||value.roots.length!==value.scopeCount||!Array.isArray(value.objects)||!value.objects.length)throw new Error('Invalid private scope proof set')
 const roots=new Set(),objects=new Set()
 for(const root of value.roots){
  if(!exact(root,['path','fileId','access'])||!localWindowsPath(root.path)||!fileId(root.fileId)||!['read','write'].includes(root.access)||roots.has(root.path.toUpperCase()))throw new Error('Invalid private approved scope root')
  roots.add(root.path.toUpperCase())
 }
 for(const object of value.objects){
  if(!exact(object,['kind','role','name','fileId','directory','parent','original','candidate','addedAces','label'])||![1,4].includes(object.kind)||!['profile','profile-ancestor','scope','scope-ancestor','dependency'].includes(object.role)||typeof object.directory!=='boolean'||object.parent!==null&&!text(object.parent)||!Array.isArray(object.addedAces)||!object.addedAces.every(hex))throw new Error('Invalid private native object proof')
  if(object.kind===1?!localWindowsPath(object.name)||!fileId(object.fileId):!text(object.name)||!object.name.startsWith(nativeRegistryPrefix)||object.fileId!==null||object.directory)throw new Error('Invalid private native object identity')
  const key=object.kind+':'+object.name.toUpperCase()
  if(objects.has(key))throw new Error('Duplicate private native object')
  objects.add(key);sd(object.original);sd(object.candidate)
  if(object.label!==null){
   if(object.kind!==1||!exact(object.label,['before','after','borrowedFrom'])||object.label.borrowedFrom!==null&&!ref(object.label.borrowedFrom))throw new Error('Invalid private shared label reference')
   if(object.label.before!==null)acl(object.label.before)
   acl(object.label.after)
  }
 }
 return structuredClone(value)
}

const processResourceScope=new AsyncLocalStorage()
const processResourceRecorders=new WeakMap()
export function currentProcessResourceRecorder() {return processResourceScope.getStore()}
export function runWithProcessResourceRecorder(recorder, operation) {
 if(recorder!==undefined&&typeof recorder!=='function'||typeof operation!=='function')throw new TypeError('Invalid Host process resource scope')
 return processResourceScope.run(recorder,operation)
}
export function bindProcessResourceRecorder(target, recorder) {
 if(typeof recorder!=='function')throw new TypeError('Process resource recorder must be a Host callback')
 processResourceRecorders.set(target,recorder)
 return target
}
export function processResourceRecorder(target) {return processResourceRecorders.get(target)}
