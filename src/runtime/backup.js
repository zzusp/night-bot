import {join,resolve,relative} from 'node:path'
import {readdir,lstat,readFile,writeFile,mkdir,rename,rm,copyFile} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {runtimePaths,inside,prepareRuntimePaths,pathInventory} from './paths.js'
import {acquireLock,privateDirectory,atomicWrite,readRegular,failure} from './files.js'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const secretName=name=>/^(?:\.env(?:\..*)?|.*credentials.*|.*private[-_]?key.*|id_rsa|id_ed25519)$/i.test(name)
export function sanitizedConfig(value){
  if(Array.isArray(value))return value.map(sanitizedConfig)
  if(typeof value==='string'){
    try{const url=new URL(value);let changed=!!url.username||!!url.password;url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(/token|secret|password|api[_-]?key|credential/i.test(key)){url.searchParams.delete(key);changed=true}return changed?url.toString():value}catch{}
    if(/\bBearer\s+\S+|(?:password|api[_ -]?key|secret|access[_ -]?token)\s*[:=]\s*\S+/i.test(value))return '[REDACTED]'
    return value
  }
  if(!value||typeof value!=='object')return value
  return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:password|passwd|privateKey|accessToken|refreshToken|apiKey|secret|token|authorization|cookie|credentials)$/i.test(key)).map(([key,v])=>[key,sanitizedConfig(v)]))
}
async function tree(root,path=root,excluded=[]){
  const output=[]
  for(const name of await readdir(path).catch(error=>{if(error.code==='ENOENT')return [];throw error})){
    if(secretName(name)||name.startsWith('.write-')){excluded.push(relative(root,join(path,name)));continue}
    const current=join(path,name),info=await lstat(current)
    if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw failure('NIGHT_BACKUP_UNSAFE_ENTRY')
    if(info.isDirectory())output.push(...await tree(root,current,excluded));else output.push(relative(root,current))
  }
  return output
}
/** Offline directory snapshots are intentionally separate from deployment.
 * No logs/cache/runtime files or credential/env files enter a default backup. */
export async function backupData(config,destination,{includeSecrets=false}={}){
  const paths=runtimePaths(config);if(paths.mode!=='portable')throw failure('NIGHT_LEGACY_BACKUP_REQUIRES_LAYOUT_REVIEW')
  destination=resolve(destination);if(destination===join(paths.installRoot,'backups')||!inside(join(paths.installRoot,'backups'),destination))throw failure('NIGHT_BACKUP_OUTSIDE_BACKUPS_DIRECTORY');if(inside(paths.data,destination)||inside(destination,paths.data))throw failure('NIGHT_BACKUP_DESTINATION_OVERLAPS_DATA')
  await prepareRuntimePaths(paths)
  const release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0}),stage=destination+'.staging-'+randomUUID()
  try{
    if(await readRegular(join(paths.runtime,'restore.pending.json'))!==undefined)throw failure('NIGHT_RESTORE_INCOMPLETE')
    if(await lstat(destination).catch(e=>{if(e.code!=='ENOENT')throw e}))throw failure('NIGHT_BACKUP_DESTINATION_EXISTS')
    await privateDirectory(stage)
    const records=[],excluded=[]
    for(const name of ['state','memory','workspaces','attachments',...includeSecrets?['secrets']:[]]){
      const base=join(paths.data,name)
      const skipped=[],files=includeSecrets&&name==='secrets'?await secretTree(base):await tree(base,base,skipped)
      excluded.push(...skipped.map(file=>name+'/'+file.split('\\').join('/')))
      for(const file of files){const from=join(base,file),to=join(stage,name,file);await privateDirectory(resolve(to,'..'));const bytes=await readFile(from);await writeFile(to,bytes,{mode:0o600,flag:'wx'});records.push({path:name+'/'+file.split('\\').join('/'),sha256:digest(bytes),bytes:bytes.length})}
    }
    for(const directory of ['skills','agents','harness']){
      const base=join(paths.config,directory)
      const skipped=[],files=await tree(base,base,skipped);excluded.push(...skipped.map(file=>'config/'+directory+'/'+file.split('\\').join('/')))
      for(const file of files){const from=join(base,file),to=join(stage,'config',directory,file);await privateDirectory(resolve(to,'..'));let bytes=await readFile(from);if(file.endsWith('.json'))bytes=Buffer.from(JSON.stringify(sanitizedConfig(JSON.parse(bytes)),null,2)+'\n');await writeFile(to,bytes,{mode:0o600,flag:'wx'});records.push({path:'config/'+directory+'/'+file.split('\\').join('/'),sha256:digest(bytes),bytes:bytes.length})}
    }
    const portableConfig={...config,installRoot:'../..',dataDir:relative(paths.installRoot,paths.data)};delete portableConfig.stateDir;delete portableConfig.workspaceDir;
    const clean=JSON.stringify(sanitizedConfig(portableConfig),null,2)+'\n';await atomicWrite(join(stage,'config','config.json'),clean);records.push({path:'config/config.json',sha256:digest(Buffer.from(clean)),bytes:Buffer.byteLength(clean)})
    await atomicWrite(join(stage,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),installRoot:paths.installRoot,dataRoot:paths.data,includesSecrets:includeSecrets,excludedRoots:[...includeSecrets?[]:['secrets'],'cache','logs','temp','runtime'],excludedFiles:excluded,privacy:'State, memory and workspaces contain private user/business data even when credentials are excluded.',files:records},null,2)+'\n')
    await rename(stage,destination);return {ok:true,destination,files:records.length,excludedFiles:excluded,includesSecrets:includeSecrets,privateData:true}
  }finally{await rm(stage,{recursive:true,force:true});await release()}
}
async function secretTree(root){const files=[];for(const name of await readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e})){const at=join(root,name),info=await lstat(at);if(info.isSymbolicLink())throw failure('NIGHT_BACKUP_UNSAFE_ENTRY');if(info.isDirectory())files.push(...(await secretTree(at)).map(f=>name+'/'+f));else if(info.isFile())files.push(name);else throw failure('NIGHT_BACKUP_UNSAFE_ENTRY')}return files}
async function hasData(root){for(const name of await readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e})){const at=join(root,name),info=await lstat(at);if(info.isSymbolicLink())throw failure('NIGHT_BACKUP_UNSAFE_ENTRY');if(!info.isDirectory()||await hasData(at))return true}return false}
export async function restoreData(config,backup){
  const paths=runtimePaths(config);if(paths.mode!=='portable')throw failure('NIGHT_LEGACY_BACKUP_REQUIRES_LAYOUT_REVIEW')
  backup=resolve(backup);const rootInfo=await lstat(backup);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw failure('NIGHT_BACKUP_UNSAFE_ENTRY')
  const manifest=JSON.parse(await readRegular(join(backup,'manifest.json'))??'null')
  if(manifest?.version!==1||!Array.isArray(manifest.files))throw failure('NIGHT_BACKUP_MANIFEST_INVALID')
  const relocated=resolve(manifest.installRoot)!==paths.installRoot
  if(relative(manifest.installRoot,manifest.dataRoot)!==relative(paths.installRoot,paths.data))throw failure('NIGHT_DATA_LAYOUT_MISMATCH')
  const seen=new Set()
  const checked=async file=>{
    if(typeof file.path!=='string'||! /^(?:state|memory|workspaces|attachments|config|secrets)\//.test(file.path)||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||file.path.startsWith('config/')&&!/^config\/(?:config\.json$|(?:skills|agents|harness)\/)/.test(file.path)||file.path.startsWith('secrets/')&&!manifest.includesSecrets)throw failure('NIGHT_BACKUP_MANIFEST_INVALID')
    let at=backup;for(const part of file.path.split('/')){at=join(at,part);const info=await lstat(at);if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw failure('NIGHT_BACKUP_UNSAFE_ENTRY')}
    const bytes=await readFile(at);if(digest(bytes)!==file.sha256||bytes.length!==file.bytes)throw failure('NIGHT_BACKUP_HASH_MISMATCH');return bytes
  }
  for(const file of manifest.files){if(seen.has(file.path))throw failure('NIGHT_BACKUP_MANIFEST_INVALID');seen.add(file.path);await checked(file)}
  await prepareRuntimePaths(paths);const release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0}),stage=join(paths.runtime,'.restore-'+randomUUID()),moved=[]
  let markerWritten=false
  try{
    if(await readRegular(join(paths.runtime,'restore.pending.json'))!==undefined)throw failure('NIGHT_RESTORE_INCOMPLETE')
    const roots=['state','memory','workspaces','attachments','config/skills','config/agents','config/harness',...manifest.includesSecrets?['secrets']:[]]
    for(const name of roots)if(await hasData(join(paths.data,name)))throw failure('NIGHT_RESTORE_REQUIRES_EMPTY_DATA')
    await privateDirectory(stage)
    for(const file of manifest.files){await privateDirectory(resolve(join(stage,file.path),'..'));await writeFile(join(stage,file.path),await checked(file),{mode:0o600,flag:'wx'})}
    await atomicWrite(join(paths.runtime,'restore.pending.json'),JSON.stringify({version:1,backup,stage,roots}));markerWritten=true
    for(const name of roots){const from=join(stage,name);if(!await lstat(from).catch(e=>{if(e.code!=='ENOENT')throw e}))continue;await rm(join(paths.data,name),{recursive:true,force:true});await rename(from,join(paths.data,name));moved.push(name)}
    const configPath=join(paths.config,'config.json'),configPreserved=!!await lstat(configPath).catch(e=>{if(e.code!=='ENOENT')throw e})
    if(!configPreserved&&seen.has('config/config.json'))await atomicWrite(configPath,await readFile(join(stage,'config/config.json'),'utf8'))
    await rm(join(paths.runtime,'restore.pending.json'));markerWritten=false
    return {ok:true,relocated,files:manifest.files.length,credentialsRestored:manifest.includesSecrets===true,configPreserved}
  }catch(error){for(const name of moved)await rm(join(paths.data,name),{recursive:true,force:true});if(markerWritten)await rm(join(paths.runtime,'restore.pending.json'));throw error}
  finally{await rm(stage,{recursive:true,force:true});await release()}
}
