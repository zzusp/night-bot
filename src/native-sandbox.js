import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {HarnessError} from './native-llm-protocol.js'
import {spawnSync} from 'node:child_process'
import {existsSync,mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {LAUNCHER_BIN,LAUNCHER_FAILURE_EXIT,grantArgs,launcherPath,probe} from '@deepseek-ai/node-addon-system/landlock-run'
import {AclWriteGrant,assertTempRootOutsideWorkspace,registerAclDiagnosisSkill,tempWriteSid,workspaceWriteSid} from './legacy-v4/dsh-sandbox-windows-acl/lib/index.js'
const chains={linux:['bwrap','landlock'],darwin:['seatbelt'],win32:['windows-acl']}
const denial={bwrap:['read-only file system'],landlock:['permission denied'],seatbelt:['operation not permitted'],'windows-acl':['access is denied','access to the path','permission denied','operation not permitted'],custom:['read-only file system','permission denied']}
const fatal={bwrap:[{fatalSignatures:['bwrap: ']}],landlock:[{allowedExitCodes:[LAUNCHER_FAILURE_EXIT],fatalSignatures:[`${LAUNCHER_BIN}: `],informationalLines:[`${LAUNCHER_BIN}: partial enforcement (older Landlock ABI)`]}],seatbelt:[{fatalSignatures:['sandbox-exec: ']}],'windows-acl':[{allowedExitCodes:[127],fatalSignatures:['windows-acl-run: ']}]}
const canonical=path=>{try{return realpathSync.native(path)}catch{return path}}
const quote=value=>JSON.stringify(value)
export function sandboxProfile(runner,policy){
 if(!['read-only','workspace-write'].includes(policy.mode))throw new TypeError('Confined sandbox mode must be read-only or workspace-write')
 if(typeof policy.workspaceRoot!=='string'||!policy.workspaceRoot)throw new TypeError('Sandbox workspaceRoot must be a non-empty path')
 const workspace=canonical(policy.workspaceRoot)
 if(runner==='bwrap')return['--ro-bind','/','/','--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent',...policy.mode==='workspace-write'?['--tmpfs','/tmp','--bind',workspace,workspace]:[]]
 if(runner==='landlock')return grantArgs({readOnly:['/'],readWrite:['/dev/null',...policy.mode==='workspace-write'?['/tmp',workspace]:[]]})
 if(runner==='seatbelt'){const roots=policy.mode==='workspace-write'?[...new Set([workspace,'/tmp',tmpdir()].map(canonical))]:[];return['-p',['(version 1)','(allow default)','(deny file-write*)','(allow file-write* (literal "/dev/null"))',...roots.length?[`(allow file-write* ${roots.map(p=>`(subpath ${quote(p)})`).join(' ')})`]:[]].join(' ')]}
 throw new Error(`Unsupported sandbox profile ${runner}`)
}
export class NativeSandboxUnavailableError extends HarnessError{
 constructor(mode,detail){super(`sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or use a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the restricted-token ACL runner can start (Windows).${detail?' '+detail:''}`,'SANDBOX_UNAVAILABLE');this.name='SandboxUnavailableError'}
}
/** Owns profile construction, backend admission and failure metadata. The Windows
 * ACL capability implementation remains an explicit platform dependency. */
export default class NativeSandbox extends Service{
 static Config=z.object({runnerCommand:z.array(z.string()).default([]),runnerFailureSignatures:z.array(z.string()).default([]),probeTimeoutMs:z.natural().default(5000)})
 constructor(ctx,config={}){
  super(ctx,'sandbox');this.internals={};this.command=[...(config.runnerCommand??[])];this.signatures=[...(config.runnerFailureSignatures??[])];this.timeout=config.probeTimeoutMs??5000;this.workspaceGrants=new Map();this.temps=new Map();this.closed=false
  if(!Number.isFinite(this.timeout)||this.timeout<=0)throw new Error('sandbox probeTimeoutMs must be positive and finite')
  if(Boolean(this.command.length)!==Boolean(this.signatures.length)||this.signatures.some(s=>!s.trim()||/[\r\n]/u.test(s)))throw new Error('Custom sandbox runner requires non-empty single-line failure signatures')
  if(this.command.some(s=>typeof s!=='string'||s.includes('\0'))||this.command.length&&!this.command[0])throw new Error('Invalid sandbox runner argv')
  if(process.platform==='win32'&&!this.command.length)ctx.inject(['skills'],registerAclDiagnosisSkill)
  ctx.effect(()=>()=>this.close(),'native sandbox cleanup')
 }
 async confine(argv,policy,signal){
  signal?.throwIfAborted();if(this.closed)throw new Error('Sandbox provider is closed')
  if(!Array.isArray(argv)||!argv.length||argv.some(s=>typeof s!=='string'||s.includes('\0')))throw new TypeError('Sandbox command must be exact non-empty argv')
  // Validate even operator-selected runners. Unsupported modes never fall through.
  sandboxProfile('bwrap',policy);policy={...policy,workspaceRoot:canonical(policy.workspaceRoot)}
  if(this.command.length)return{argv:[...this.command,...sandboxProfile('bwrap',policy),'--',...argv],enforcement:'full',denialSignatures:[...denial.custom],runnerFailureRules:[{fatalSignatures:[...this.signatures]}]}
  this.verdict??=this.choose();if(this.verdict==='unavailable')throw new NativeSandboxUnavailableError(policy.mode)
  const {runner,enforcement}=this.verdict;let prefix
  if(runner==='windows-acl')prefix=this.windowsArgv(policy)
  else prefix=[runner==='bwrap'?'bwrap':runner==='landlock'?this.landlockPath():this.seatbeltPath(),...sandboxProfile(runner,policy)]
  signal?.throwIfAborted();return{argv:[...prefix,'--',...argv],enforcement,denialSignatures:[...denial[runner]],runnerFailureRules:structuredClone(fatal[runner])}
 }
 choose(){const chain=this.internals.chain??chains[this.internals.platform??process.platform]??[];if(!chain.length)return'unavailable';for(const runner of chain)if(!Object.hasOwn(fatal,runner))throw new Error(`Unknown sandbox backend ${runner}`);if(chain.length===1)return{runner:chain[0],enforcement:chain[0]==='windows-acl'?'partial':'full'};for(const runner of chain){const enforcement=this.probeRunner(runner);if(enforcement!=='unusable'){if(!['full','partial'].includes(enforcement))throw new Error('Invalid sandbox probe verdict');return{runner,enforcement}}}return'unavailable'}
 probeRunner(runner){
  if(runner==='landlock')return(this.internals.probeLandlock??((path)=>probe(path,{timeoutMs:this.timeout})))(this.landlockPath())
  const key={bwrap:'probeBwrap',seatbelt:'probeSeatbelt','windows-acl':'probeWindowsAcl'}[runner];if(!key)throw new Error('Unknown sandbox probe')
  const program=runner==='bwrap'?'bwrap':runner==='seatbelt'?this.seatbeltPath():this.windowsInvocation()[0]
  const args=runner==='windows-acl'?[...this.windowsInvocation().slice(1),'--workspace',tmpdir(),'--temp',tmpdir(),'--mode','read-only','--','cmd','/c','exit','0']:[...sandboxProfile(runner,{mode:'read-only',workspaceRoot:'/'}),'--','true']
  const okay=this.internals[key]?this.internals[key](runner==='seatbelt'?program:undefined):spawnSync(program,args,{timeout:this.timeout,stdio:'ignore'}).status===0
  return okay?(runner==='windows-acl'?'partial':'full'):'unusable'
 }
 landlockPath(){return this.internals.landlockLauncher??launcherPath()}
 seatbeltPath(){return this.internals.seatbeltExec??'sandbox-exec'}
 windowsInvocation(){if(this.internals.windowsAclRunnerArgs)return[...this.internals.windowsAclRunnerArgs];const entry=this.internals.windowsAclRunnerEntry??fileURLToPath(import.meta.resolve('./legacy-v4/dsh-sandbox-windows-acl/lib/runner.js'));if(!existsSync(entry))throw new NativeSandboxUnavailableError('workspace-write','Windows ACL runner is absent');return[process.execPath,entry]}
 windowsArgv(policy){const base=[...this.windowsInvocation(),'--workspace',policy.workspaceRoot];if(policy.mode==='read-only'||policy.sessionId===undefined)return[...base,'--temp',tmpdir(),'--mode',policy.mode];const capability=this.grant(policy.sessionId,policy.workspaceRoot);return[...base,'--temp',capability.dir,'--mode',policy.mode,'--write-sid',workspaceWriteSid(policy.workspaceRoot),'--temp-write-sid',capability.sid]}
 grant(session,workspace){
  assertTempRootOutsideWorkspace(workspace,tmpdir())
  if(!this.workspaceGrants.has(workspace)){const grant=AclWriteGrant.create(workspaceWriteSid(workspace));try{grant.add(workspace,true)}catch(error){try{grant.dispose()}catch(cleanup){throw new AggregateError([error,cleanup],'Workspace ACL grant and cleanup failed')}throw error}this.workspaceGrants.set(workspace,grant)}
  const key=JSON.stringify([String(session),workspace]);if(this.temps.has(key))return this.temps.get(key)
  const dir=mkdtempSync(join(tmpdir(),'night-sandbox-'));let grant
  try{const sid=tempWriteSid(dir);grant=AclWriteGrant.create(sid);grant.add(dir);const capability={dir,sid,grant};this.temps.set(key,capability);return capability}catch(error){const failures=[error];try{grant?.dispose()}catch(e){failures.push(e)}try{this.removeTemp(dir)}catch(e){failures.push(e)}if(failures.length>1)throw new AggregateError(failures,'Private sandbox grant and cleanup failed');throw error}
 }
 removeTemp(dir){(this.internals.rmTempDir??(p=>rmSync(p,{recursive:true,force:true})))(dir)}
 close(){if(this.closed)return;this.closed=true;const failures=[];for(const grant of [...this.workspaceGrants.values(),...[...this.temps.values()].map(t=>t.grant)])try{grant.dispose()}catch(e){failures.push(e)}for(const {dir}of this.temps.values())try{this.removeTemp(dir)}catch(e){failures.push(e)}this.workspaceGrants.clear();this.temps.clear();for(const e of failures)this.ctx.logger.warn(e)}
}
