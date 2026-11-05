import {existsSync,realpathSync} from 'node:fs'
import {dirname,join,resolve,relative} from 'node:path'
import {inside,packageRoot} from '../runtime/paths.js'
import {spillAccess} from '../runtime/spill-access.js'
import {failure} from '../runtime/files.js'

const canonical=path=>{try{return realpathSync.native(path)}catch{return resolve(path)}}
/** Model processes and generic file tools must not bypass scoped memory by
 * reading the service's raw files. Trusted Host storage uses direct IO. */
export async function createPrivacy(paths){
  const spills=await spillAccess(paths)
  const roots=[paths.state,paths.memory,dirname(paths.credentials),join(paths.attachmentsHome,'attachments'),paths.cache,paths.logs]
  const protectedRoots=[...new Set(roots.map(canonical))].filter((path,index,all)=>!all.some((other,n)=>n!==index&&inside(other,path)))
  const taskRoot=path=>{const rel=relative(paths.workspaces,path),match=/^tasks[/\\]([^/\\]+)(?:[/\\]|$)/.exec(rel);return match?join(paths.workspaces,'tasks',match[1]):undefined}
  const privateTaskPath=path=>{const root=taskRoot(path);return root&&inside(join(root,'sessions'),path)}
  return {taskRoot,spills,installRoot:paths.mode==='portable'?canonical(paths.installRoot):undefined,workspaces:canonical(paths.workspaces),roots:protectedRoots,denied:(path,agent)=>(privateTaskPath(canonical(path))||protectedRoots.some(root=>inside(root,canonical(path))))&&!spills.allows(canonical(path),agent)}
}
export async function installProcessPrivacy(ctx,privacy){
  let runner
  if(process.platform==='linux')try{runner=await ctx.subprocess.resolveExecutable('bwrap')}catch{}
  const originalSpawn=ctx.subprocess.spawn,originalTerminal=ctx.subprocess.spawnTerminal
  const wrap=spec=>{
    const agent=ctx.agents.currentInitiator();if(!agent||!privacy.installRoot)return spec
    const workspace=canonical(agent.session.header.cwd??privacy.workspaces),task=privacy.taskRoot(workspace)===workspace?workspace:undefined
    if(privacy.installRoot){const safe=/^(?:PATH|LANG|LANGUAGE|LC_.*|TERM|COLORTERM|TZ|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CURL_CA_BUNDLE|DSH_HOME|DSH_SHELL|DSH_SESSION_ID|DSH_PROFILE|DSH_PROFILE_DIR)$/i;const env={};for(const key of new Set([...Object.keys(process.env),...Object.keys(spec.env??{})])){const value=Object.hasOwn(spec.env??{},key)?spec.env[key]:process.env[key];let allowed=safe.test(key);if(allowed&&/proxy$/i.test(key)&&value)try{const url=new URL(value);if(url.username||url.password)allowed=false}catch{}env[key]=allowed?value:undefined}Object.assign(env,{HOME:'/tmp/night-home',TMPDIR:'/tmp',TMP:'/tmp',TEMP:'/tmp',XDG_CACHE_HOME:'/tmp/night-cache'});spec={...spec,env}}
    if(privacy.installRoot&&(!inside(privacy.workspaces,workspace)||!inside(workspace,canonical(spec.cwd))))throw failure('NIGHT_WORK_OUTSIDE_WORKSPACES')
    if(privacy.denied(spec.cwd))throw failure('MEMORY_PRIVATE_PATH_DENIED')
    if(!runner)throw failure('MEMORY_PROCESS_PRIVACY_UNAVAILABLE')
    const masks=[...privacy.roots,...task?[join(task,'sessions')]:[]].filter(existsSync).flatMap(path=>['--tmpfs',path,'--remount-ro',path])
    const nested=spec.argv[0]==='bwrap'||spec.argv[0]===runner
    const writableRoots=nested?spec.argv.flatMap((value,i)=>value==='--bind'&&spec.argv[i+1]===spec.argv[i+2]&&inside(workspace,canonical(spec.argv[i+1]))?[canonical(spec.argv[i+1])]:[]):[workspace]
    const writable=privacy.installRoot?writableRoots.flatMap(path=>task?['work','tmp'].map(name=>join(task,name)).filter(dir=>inside(path,dir)||inside(dir,path)).flatMap(dir=>{const allowed=inside(dir,path)?path:dir;return ['--bind',allowed,allowed]}):['--bind',path,path]):[]
    const boundary=privacy.installRoot?['--tmpfs','/',...['/usr','/bin','/sbin','/lib','/lib64','/etc','/opt'].filter(existsSync).flatMap(path=>['--ro-bind',path,path]),'--dev','/dev','--proc','/proc','--tmpfs','/tmp','--dir','/tmp/night-home','--dir','/tmp/night-cache','--ro-bind',packageRoot,packageRoot,'--ro-bind',privacy.installRoot,privacy.installRoot,'--tmpfs',privacy.workspaces,'--ro-bind',workspace,workspace,...writable,...task&&writable.length?['--setenv','TMPDIR',join(task,'tmp'),'--setenv','TMP',join(task,'tmp'),'--setenv','TEMP',join(task,'tmp')]:[]]:[]
    const argv=spec.argv
    if(argv[0]==='bwrap'||argv[0]===runner){const separator=argv.indexOf('--');if(separator<0)throw failure('MEMORY_PROCESS_PRIVACY_INVALID');return {...spec,argv:[runner,...argv.slice(1,separator),...boundary,...masks,...argv.slice(separator)]}}
    return {...spec,argv:[runner,...privacy.installRoot?boundary:['--bind','/','/'],'--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent',...spec.control==='pipe'?['--preserve-fds','1']:[],...masks,'--',...argv]}
  }
  const runtimeFor=(runtime,agent)=>{const task=agent&&privacy.taskRoot(canonical(agent.session.header.cwd??privacy.workspaces));if(!task)return runtime;const scoped=Object.create(runtime);scoped.internals={...runtime.internals,spillDir:join(task,'materials','runtime-evidence','process')};return scoped}
  ctx.subprocess.spawn=function(spec){const agent=ctx.agents.currentInitiator(),handle=originalSpawn.call(runtimeFor(this,agent),wrap(spec));privacy.spills.track(agent,handle);return handle}
  ctx.subprocess.spawnTerminal=async function(spec){const agent=ctx.agents.currentInitiator(),handle=await originalTerminal.call(runtimeFor(this,agent),wrap(spec));privacy.spills.track(agent,handle);return handle}
  const originalSave=ctx.spillStore.saveText;ctx.spillStore.saveText=function(input){const route=ctx.get('taskSessionRoutes')?.get(input.owner.sessionId);if(!route)return originalSave.call(this,input);const scoped=Object.create(this);scoped.root=join(dirname(dirname(route)),'materials','runtime-evidence','tools');return originalSave.call(scoped,input)}
  ctx.effect(()=>()=>privacy.spills.close(),'private spill capability drain')
}
