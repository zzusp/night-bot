import {fileURLToPath} from 'node:url'
import {dirname,resolve,join,isAbsolute,relative,sep} from 'node:path'
import {lstat,realpath,readdir,chmod} from 'node:fs/promises'
import {privateDirectory,failure} from './files.js'

export const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
export const inside=(root,path)=>{const p=relative(root,path);return p===''||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)}
/** New installs are portable. Explicit legacy absolute roots remain untouched. */
export function runtimePaths(config,configPath){
  const portable=config.stateDir===undefined&&config.workspaceDir===undefined||config.dataDir!==undefined
  if(!portable){
    for(const key of ['stateDir','workspaceDir'])if(typeof config[key]!=='string'||!isAbsolute(config[key]))throw failure('NIGHT_BOT_ABSOLUTE_PATH_REQUIRED:'+key)
    const state=resolve(config.stateDir),workspaces=resolve(config.workspaceDir)
    if(inside(state,workspaces)||inside(workspaces,state))throw failure('NIGHT_BOT_STATE_MUST_BE_SEPARATE_FROM_WORKSPACE')
    return {mode:'legacy',installRoot:packageRoot,state,workspaces,memory:join(state,'memory'),credentials:join(state,'credentials.json'),attachmentsHome:state,cache:join(state,'cache'),spills:join(state,'spills'),logs:join(state,'logs'),runtime:join(state,'runtime'),agentsHome:join(state,'runtime','configured-agents'),harnessHome:join(state,'runtime','configured-harness')}
  }
  const base=configPath?dirname(resolve(configPath)):packageRoot
  const installRoot=resolve(base,config.installRoot??packageRoot),data=resolve(installRoot,config.dataDir??'data')
  if(!inside(installRoot,data)||data===installRoot)throw failure('NIGHT_BOT_DATA_OUTSIDE_INSTALL_ROOT')
  if(data!==join(installRoot,'data'))throw failure('NIGHT_BOT_STANDARD_DATA_DIRECTORY_REQUIRED')
  if(config.stateDir!==undefined&&resolve(config.stateDir)!==join(data,'state')||config.workspaceDir!==undefined&&resolve(config.workspaceDir)!==join(data,'workspaces'))throw failure('NIGHT_BOT_MIXED_DATA_LAYOUT')
  return {mode:'portable',installRoot,data,config:join(data,'config'),secrets:join(data,'secrets'),state:join(data,'state'),workspaces:join(data,'workspaces'),memory:join(data,'memory'),credentials:join(data,'secrets','credentials.json'),attachmentsHome:data,attachments:join(data,'attachments'),cache:join(data,'cache'),spills:join(data,'state','spills'),processSpills:join(data,'state','spills','subprocess'),logs:join(data,'logs'),temp:join(data,'temp'),runtime:join(data,'runtime'),skills:join(data,'config','skills'),agentsHome:join(data,'config','agents'),harnessHome:join(data,'config','harness')}
}
async function assertInstallRoot(paths){if(paths.mode==='portable'){let at=paths.installRoot;for(;;){const info=await lstat(at).catch(error=>{if(error.code!=='ENOENT')throw error});if(info){if(!info.isDirectory()||info.isSymbolicLink()||relative(at,await realpath(at))!=='')throw failure('NIGHT_INSTALL_ROOT_ALIAS_UNSAFE');break}const parent=dirname(at);if(parent===at)throw failure('NIGHT_INSTALL_ROOT_UNAVAILABLE');at=parent}}}
export async function prepareSecrets(paths){
  if(paths.mode!=='portable')return
  await assertInstallRoot(paths)
  const visit=async path=>{const prior=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error});if(process.getuid&&prior&&prior.uid!==process.getuid())throw failure('NIGHT_SECRET_OWNER_UNSAFE');await privateDirectory(path);const directory=await lstat(path);if(process.getuid&&directory.uid!==process.getuid())throw failure('NIGHT_SECRET_OWNER_UNSAFE');for(const name of await readdir(path)){const at=join(path,name),info=await lstat(at);if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile()||process.getuid&&info.uid!==process.getuid()||info.isFile()&&info.nlink!==1)throw failure('NIGHT_SECRET_PATH_UNSAFE');if(['effect-operator.credentials.json','settings-operator.credentials.json'].includes(name)&&(!info.isFile()||process.platform!=='win32'&&(info.mode&0o7777)!==0o600))throw failure(name==='effect-operator.credentials.json'?'EFFECT_OPERATOR_SECRET_UNSAFE':'SETTINGS_OPERATOR_SECRET_UNSAFE');if(info.isDirectory())await visit(at);else if(process.platform!=='win32')await chmod(at,0o600)}}
  await visit(paths.secrets)
}
export async function prepareRuntimePaths(paths){
  const values=paths.mode==='portable'?['data','config','secrets','state','workspaces','memory','cache','logs','temp','runtime','skills','agentsHome','harnessHome','spills','processSpills']:['state','workspaces']
  try{
    await assertInstallRoot(paths)
    for(const key of values)await privateDirectory(paths[key]);await prepareSecrets(paths)
  }
  catch(cause){throw Object.assign(failure('NIGHT_BOT_DATA_DIRECTORY_UNAVAILABLE'),{cause})}
}
export function environmentPaths(config,configPath){const p=runtimePaths(config,configPath);return p.mode==='portable'?{cwd:p.secrets,home:p.secrets}:{} }
export function pathInventory(config,configPath){const p=runtimePaths(config,configPath);return {...p,mustPreserve:['config (sanitized config.json plus owned skills/agents/harness folders)','state (sessions, task SQLite, domains, retained output)','memory','workspaces','attachments'],separatePrivate:['secrets (credentials and environment files)','Backup state/memory/workspaces remain private business data'],rebuildable:['cache'],diagnostic:['logs'],transient:['runtime','temp'],external:p.mode==='legacy'?['Explicit state/workspace roots','Explicit project dotenv and inherited process environment']:['Trusted executable plugins and system dependencies are outside the model file fence','OS temporary paths when bypassing the managed launcher','Non-Linux model subprocesses fail closed until a privacy namespace is implemented'],relocation:'New session/workspace controlled paths have install-relative references. Restore to another root with the same dataDir layout; user text and commands remain opaque and must never be blindly rewritten.'}}
