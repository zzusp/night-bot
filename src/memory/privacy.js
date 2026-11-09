import {bindWindowsLaunchPolicy,retainProcessPolicy,processFileRequest,currentProcessResourceRecorder,bindProcessResourceRecorder} from '../process/contracts.js'
import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
import {existsSync,realpathSync} from 'node:fs'
import {dirname,isAbsolute,join,resolve,relative,sep} from 'node:path'
import {inside,packageRoot} from '../runtime/paths.js'
import {spillAccess} from '../runtime/spill-access.js'
import {failure} from '../runtime/files.js'
import {launchEnvironmentOf} from '../native-environment.js'

const origin=(agent,fallback)=>agent?.piSession?officialWorkingDirectoryOrigin(agent):agent?.session.header.cwd??fallback
const canonical=path=>{try{return realpathSync.native(path)}catch{return resolve(path)}}
/** Model processes and generic file tools must not bypass scoped memory by
 * reading the service's raw files. Trusted Host storage uses direct IO. */
export async function createPrivacy(paths){
  if(paths.mode==='portable'&&(typeof paths.temp!=='string'||!paths.temp))throw failure('NIGHT_PROCESS_TEMP_ROOT_UNAVAILABLE')
  const tempRoot=paths.mode==='portable'?canonical(paths.temp):undefined
  const spills=await spillAccess(paths)
  const roots=[paths.state,paths.memory,dirname(paths.credentials),join(paths.attachmentsHome,'attachments'),paths.cache,paths.logs,...tempRoot?[tempRoot]:[]]
  const protectedRoots=[...new Set(roots.map(canonical))].filter((path,index,all)=>!all.some((other,n)=>n!==index&&inside(other,path)))
  const taskRoot=path=>{const parts=relative(paths.workspaces,path).split(sep);return (process.platform==='win32'?parts[0].toLowerCase():parts[0])==='tasks'&&parts[1]?join(paths.workspaces,parts[0],parts[1]):undefined}
  const privateTaskPath=path=>{const root=taskRoot(path);return root&&inside(join(root,'sessions'),path)}
  return {taskRoot,spills,tempRoot,installRoot:paths.mode==='portable'?canonical(paths.installRoot):undefined,workspaces:canonical(paths.workspaces),roots:protectedRoots,denied:(path,agent)=>(privateTaskPath(canonical(path))||protectedRoots.some(root=>inside(root,canonical(path))))&&!spills.allows(canonical(path),agent)}
}
/** Combine the Host file request with installation and task privacy. This only
 * builds authority data: it does not qualify a token or admit native execution. */
export function windowsPrivateProcessSpec(spec,privacy,workspace,authorization){
  const file=processFileRequest(spec),task=privacy.taskRoot(workspace),scope=task??workspace
  const fileRoot=file?.workspaceRoot??workspace,mode=file?.mode??'workspace-write'
  if(!inside(scope,fileRoot)&&!inside(fileRoot,scope)&&!(authorization?.kind==='scoped'&&[...authorization.readRoots,...authorization.writeRoots].some(root=>inside(root,fileRoot))))throw failure('NIGHT_WORK_OUTSIDE_WORKSPACES')
  const intersect=(a,b)=>inside(a,b)?b:inside(b,a)?a:undefined
  const defaultFileRoot=authorization?.kind==='scoped'?workspace:fileRoot
  const defaultWrite=(task?['work','tmp'].map(name=>join(task,name)):[workspace]).map(root=>intersect(root,workspace)).filter(Boolean).map(root=>intersect(root,defaultFileRoot)).filter(Boolean)
  const writeRoots=mode==='read-only'?[]:[...new Set([...defaultWrite,...authorization?.writeRoots??[]])]
  const readRoots=[...new Set([...(task?['materials','work','outputs','tmp'].map(name=>join(task,name)):[workspace]),...authorization?.readRoots??[],...writeRoots])]
  const privateRoots=[...new Set([...privacy.roots,...task?['sessions','reviews'].map(name=>join(task,name)):[]])]
  const prepared=retainProcessPolicy(spec,{...spec,cwd:canonical(spec.cwd),argv:[...file?.argv??spec.argv]})
  return bindWindowsLaunchPolicy(prepared,{kind:'windows-lpac',version:1,mode,installRoot:privacy.installRoot,tempRoot:privacy.tempRoot,workspaceRoot:scope,taskRoot:task??null,readRoots,writeRoots,privateRoots,networkCapabilities:[]})
}

// 单次扩权只能来自真实工具执行上下文；mode 或模型字段不是授权。
function processAuthorization(ctx,privacy,spec,actor,workspace,task){
  const original=processFileRequest(spec)?.argv??spec.argv,cwd=canonical(spec.cwd??process.cwd())
  const grant=ctx.get('tools')?.resolveProcessAuthorization?.({actor,cwd,argv:original})
  if(grant===undefined)return
  if(!grant||grant.cwd!==cwd||!['direct','scoped'].includes(grant.kind))throw failure('PROCESS_CALL_AUTHORIZATION_INVALID')
  if(grant.kind==='direct')return{kind:'direct',cwd,argv:[...original]}
  const roots=(value,writing)=>{
    if(!Array.isArray(value))throw failure('PROCESS_CALL_SCOPE_INVALID')
    return value.map(path=>{
      if(typeof path!=='string'||!isAbsolute(path))throw failure('PROCESS_CALL_SCOPE_INVALID')
      // 不存在的精确目标不能变成父目录授权，以免同时放开兄弟路径。
      let physical;try{physical=realpathSync.native(path)}catch{throw failure('PROCESS_CALL_SCOPE_TARGET_MISSING')}
      if(physical!==path||privacy.denied(path,actor)||privacy.roots.some(root=>inside(path,root))||inside(path,privacy.workspaces)||inside(privacy.workspaces,path)&&!inside(workspace,path))throw failure('PROCESS_CALL_SCOPE_PRIVATE')
      if(writing&&task&&inside(task,path)&&!['work','tmp'].some(name=>inside(join(task,name),path)))throw failure('PROCESS_CALL_SCOPE_HOST_OWNED')
      return path
    })
  }
  const readRoots=roots(grant.readRoots,false),writeRoots=roots(grant.writeRoots,true)
  if(!inside(workspace,cwd)&&![...readRoots,...writeRoots].some(root=>inside(root,cwd)))throw failure('PROCESS_CALL_SCOPE_CWD')
  if(process.platform!=='linux')throw failure('PROCESS_SCOPED_AUTHORIZATION_UNAVAILABLE')
  return{kind:'scoped',cwd,readRoots,writeRoots,argv:[...original]}
}
export async function installProcessPrivacy(ctx,privacy){
  let runner
  if(process.platform==='linux')try{runner=await ctx.subprocess.resolveExecutable('bwrap')}catch{}
  const originalSpawn=ctx.subprocess.spawn,originalTerminal=ctx.subprocess.spawnTerminal
  const wrap=spec=>{
    const recorder=currentProcessResourceRecorder()
    // 仅在原 Job 执行上下文捕获；副本不把一个 Job 的回调留在可复用入参上。
    if(recorder!==undefined)spec=bindProcessResourceRecorder(retainProcessPolicy(spec,{...spec}),recorder)
    const agent=ctx.agents.currentInitiator();if(!agent)return spec
    const workspace=canonical(origin(agent,privacy.workspaces)),task=privacy.taskRoot(workspace)===workspace?workspace:undefined
    const authorization=processAuthorization(ctx,privacy,spec,agent,workspace,task)
    if(authorization?.kind==='direct'){
      let env=spec.env
      if(['bash','pwsh'].includes(ctx.get('tools')?.currentPermissionExecution?.()?.name)){
        // 凭据仅在已绑定的 full shell 最后启动边界注入，不进入工具参数或 Job 描述。
        const token=ctx.get('credentials')?.resolveCurrent?.('GITHUB_TOKEN')?.value??launchEnvironmentOf(ctx).getFrom('GITHUB_TOKEN',['process'])?.value
        if(token!==undefined&&(typeof token!=='string'||token.includes(String.fromCharCode(0))))throw failure('PROCESS_GITHUB_TOKEN_INVALID')
        if(token)env={...env,GITHUB_TOKEN:token}
      }
      return retainProcessPolicy(spec,{...spec,cwd:authorization.cwd,argv:authorization.argv,...env===undefined?{}:{env}})
    }
    if(!privacy.installRoot){if(authorization?.kind==='scoped')throw failure('PROCESS_SCOPED_AUTHORIZATION_UNAVAILABLE');return spec}
    if(privacy.installRoot){const safe=/^(?:PATH|LANG|LANGUAGE|LC_.*|TERM|COLORTERM|TZ|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CURL_CA_BUNDLE|NIGHT_BOT_SHELL|NIGHT_BOT_SESSION_ID)$/i;const env={};for(const key of new Set([...Object.keys(process.env),...Object.keys(spec.env??{})])){const value=Object.hasOwn(spec.env??{},key)?spec.env[key]:process.env[key];let allowed=safe.test(key);if(/^NIGHT_BOT_/i.test(key)&&!Object.hasOwn(spec.env??{},key))allowed=false;if(allowed&&/proxy$/i.test(key)&&value)try{const url=new URL(value);if(url.username||url.password)allowed=false}catch{}env[key]=allowed?value:undefined}if(process.platform==='win32'){
      // 系统依赖只取Host实际值；模型同名/异大小写覆盖不成为可信依赖。
      for(const name of ['SystemRoot','WINDIR','ComSpec','PATHEXT']){
        const key=Object.keys(process.env).find(key=>key.toLowerCase()===name.toLowerCase()),value=key===undefined?undefined:process.env[key]
        if(typeof value!=='string'||!value||value.includes(String.fromCharCode(0)))throw failure('NIGHT_WINDOWS_SYSTEM_ENVIRONMENT_UNAVAILABLE')
        for(const key of Object.keys(env))if(key.toLowerCase()===name.toLowerCase())delete env[key]
        env[name]=value
      }
    }else Object.assign(env,{HOME:'/tmp/night-home',TMPDIR:'/tmp',TMP:'/tmp',TEMP:'/tmp',XDG_CACHE_HOME:'/tmp/night-cache'});spec=retainProcessPolicy(spec,{...spec,env})}
    if(privacy.installRoot&&(!inside(privacy.workspaces,workspace)||!inside(workspace,canonical(spec.cwd))&&authorization?.kind!=='scoped'))throw failure('NIGHT_WORK_OUTSIDE_WORKSPACES')
    if(privacy.denied(spec.cwd))throw failure('MEMORY_PRIVATE_PATH_DENIED')
    if(process.platform==='win32')spec=windowsPrivateProcessSpec(spec,privacy,workspace,authorization)
    if(!runner)throw failure('MEMORY_PROCESS_PRIVACY_UNAVAILABLE')
    const masks=[...privacy.roots,...task?[join(task,'sessions')]:[]].filter(existsSync).flatMap(path=>['--tmpfs',path,'--remount-ro',path])
    const request=processFileRequest(spec),scoped=authorization?.kind==='scoped'
    const nested=spec.argv[0]==='bwrap'||spec.argv[0]===runner
    const writableRoots=scoped?(request?.mode==='read-only'?[]:[workspace]):nested?spec.argv.flatMap((value,i)=>value==='--bind'&&spec.argv[i+1]===spec.argv[i+2]&&inside(workspace,canonical(spec.argv[i+1]))?[canonical(spec.argv[i+1])]:[]):[workspace]
    const writable=privacy.installRoot?writableRoots.flatMap(path=>task?['work','tmp'].map(name=>join(task,name)).filter(dir=>inside(path,dir)||inside(dir,path)).flatMap(dir=>{const allowed=inside(dir,path)?path:dir;return ['--bind',allowed,allowed]}):['--bind',path,path]):[]
    const granted=authorization?.kind==='scoped'?[...authorization.readRoots.flatMap(path=>['--ro-bind',path,path]),...authorization.writeRoots.flatMap(path=>['--bind',path,path])]:[]
    const boundary=privacy.installRoot?['--tmpfs','/',...['/usr','/bin','/sbin','/lib','/lib64','/etc','/opt'].filter(existsSync).flatMap(path=>['--ro-bind',path,path]),'--dev','/dev','--proc','/proc','--tmpfs','/tmp','--dir','/tmp/night-home','--dir','/tmp/night-cache','--ro-bind',packageRoot,packageRoot,'--ro-bind',privacy.installRoot,privacy.installRoot,'--tmpfs',privacy.workspaces,'--ro-bind',workspace,workspace,...writable,...granted,...task&&writable.length?['--setenv','TMPDIR',join(task,'tmp'),'--setenv','TMP',join(task,'tmp'),'--setenv','TEMP',join(task,'tmp')]:[]]:[]
    // 获批范围由同一 bwrap 强制执行，不能再被内层 Landlock 的旧范围覆盖。
    const argv=scoped?authorization.argv:spec.argv
    if(!scoped&&(argv[0]==='bwrap'||argv[0]===runner)){const separator=argv.indexOf('--');if(separator<0)throw failure('MEMORY_PROCESS_PRIVACY_INVALID');return retainProcessPolicy(spec,{...spec,argv:[runner,...argv.slice(1,separator),...boundary,...masks,...argv.slice(separator)]})}
    return retainProcessPolicy(spec,{...spec,argv:[runner,...privacy.installRoot?boundary:['--bind','/','/'],'--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent',...spec.control==='pipe'?['--preserve-fds','1']:[],...masks,'--',...argv]})
  }
  const runtimeFor=(runtime,agent)=>{const task=agent&&privacy.taskRoot(canonical(origin(agent,privacy.workspaces)));if(!task)return runtime;const scoped=Object.create(runtime);scoped.internals={...runtime.internals,spillDir:join(task,'materials','runtime-evidence','process')};return scoped}
  ctx.subprocess.spawn=function(spec){const agent=ctx.agents.currentInitiator(),handle=originalSpawn.call(runtimeFor(this,agent),wrap(spec));privacy.spills.track(agent,handle);return handle}
  ctx.subprocess.spawnTerminal=async function(spec){const agent=ctx.agents.currentInitiator(),handle=await originalTerminal.call(runtimeFor(this,agent),wrap(spec));privacy.spills.track(agent,handle);return handle}
  const originalSave=ctx.spillStore.saveText;ctx.spillStore.saveText=function(input){const route=ctx.get('taskSessionRoutes')?.get(input.owner.sessionId);if(!route)return originalSave.call(this,input);const scoped=Object.create(this);scoped.root=join(dirname(dirname(route)),'materials','runtime-evidence','tools');return originalSave.call(scoped,input)}
  ctx.effect(()=>()=>privacy.spills.close(),'private spill capability drain')
}
