import {existsSync,realpathSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
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
  return {spills,installRoot:paths.mode==='portable'?canonical(paths.installRoot):undefined,workspaces:canonical(paths.workspaces),roots:protectedRoots,denied:(path,agent)=>protectedRoots.some(root=>inside(root,canonical(path)))&&!spills.allows(canonical(path),agent)}
}
export async function installProcessPrivacy(ctx,privacy){
  let runner
  if(process.platform==='linux')try{runner=await ctx.subprocess.resolveExecutable('bwrap')}catch{}
  const originalSpawn=ctx.subprocess.spawn,originalTerminal=ctx.subprocess.spawnTerminal
  const wrap=spec=>{
    const agent=ctx.agents.currentInitiator();if(!agent||!privacy.installRoot)return spec
    const workspace=canonical(agent.session.header.cwd??privacy.workspaces)
    if(privacy.installRoot){const safe=/^(?:PATH|LANG|LANGUAGE|LC_.*|TERM|COLORTERM|TZ|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CURL_CA_BUNDLE|DSH_HOME|DSH_SHELL|DSH_SESSION_ID|DSH_PROFILE|DSH_PROFILE_DIR)$/i;const env={};for(const key of new Set([...Object.keys(process.env),...Object.keys(spec.env??{})])){const value=Object.hasOwn(spec.env??{},key)?spec.env[key]:process.env[key];let allowed=safe.test(key);if(allowed&&/proxy$/i.test(key)&&value)try{const url=new URL(value);if(url.username||url.password)allowed=false}catch{}env[key]=allowed?value:undefined}Object.assign(env,{HOME:'/tmp/night-home',TMPDIR:'/tmp',TMP:'/tmp',TEMP:'/tmp',XDG_CACHE_HOME:'/tmp/night-cache'});spec={...spec,env}}
    if(privacy.installRoot&&(!inside(privacy.workspaces,workspace)||!inside(workspace,canonical(spec.cwd))))throw failure('NIGHT_WORK_OUTSIDE_WORKSPACES')
    if(privacy.denied(spec.cwd))throw failure('MEMORY_PRIVATE_PATH_DENIED')
    if(!runner)throw failure('MEMORY_PROCESS_PRIVACY_UNAVAILABLE')
    const masks=privacy.roots.filter(existsSync).flatMap(path=>['--tmpfs',path,'--remount-ro',path])
    const nested=spec.argv[0]==='bwrap'||spec.argv[0]===runner
    const writableRoots=nested?spec.argv.flatMap((value,i)=>value==='--bind'&&spec.argv[i+1]===spec.argv[i+2]&&inside(workspace,canonical(spec.argv[i+1]))?[canonical(spec.argv[i+1])]:[]):[workspace]
    const writable=privacy.installRoot?writableRoots.flatMap(path=>['--bind',path,path]):[]
    const boundary=privacy.installRoot?['--tmpfs','/',...['/usr','/bin','/sbin','/lib','/lib64','/etc','/opt'].filter(existsSync).flatMap(path=>['--ro-bind',path,path]),'--dev','/dev','--proc','/proc','--tmpfs','/tmp','--dir','/tmp/night-home','--dir','/tmp/night-cache','--ro-bind',packageRoot,packageRoot,'--ro-bind',privacy.installRoot,privacy.installRoot,'--tmpfs',privacy.workspaces,'--ro-bind',workspace,workspace,...writable]:[]
    const argv=spec.argv
    if(argv[0]==='bwrap'||argv[0]===runner){const separator=argv.indexOf('--');if(separator<0)throw failure('MEMORY_PROCESS_PRIVACY_INVALID');return {...spec,argv:[runner,...argv.slice(1,separator),...boundary,...masks,...argv.slice(separator)]}}
    return {...spec,argv:[runner,...privacy.installRoot?boundary:['--bind','/','/'],'--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent',...spec.control==='pipe'?['--preserve-fds','1']:[],...masks,'--',...argv]}
  }
  ctx.subprocess.spawn=function(spec){const agent=ctx.agents.currentInitiator(),handle=originalSpawn.call(this,wrap(spec));privacy.spills.track(agent,handle);return handle}
  ctx.subprocess.spawnTerminal=function(spec){const agent=ctx.agents.currentInitiator(),handle=originalTerminal.call(this,wrap(spec));privacy.spills.track(agent,handle);return handle}
  ctx.effect(()=>()=>privacy.spills.close(),'private spill capability drain')
}
