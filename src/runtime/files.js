import {mkdir,lstat,open,rename,unlink,readFile,rm,chmod} from 'node:fs/promises'
import {join,dirname,resolve,parse} from 'node:path'
import {randomUUID} from 'node:crypto'

export const failure=code=>Object.assign(new Error(code),{code})
export async function privateDirectory(path){
  path=resolve(path)
  const parent=dirname(path)
  if(parent!==path)await privateDirectoryParent(parent)
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error})
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')
  if(process.platform!=='win32')await chmod(path,0o700)
  return path
}
async function privateDirectoryParent(path){
  try{const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')}
  catch(error){if(error.code!=='ENOENT')throw error;await privateDirectory(path)}
}
export async function readRegular(path){
  const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error})
  if(!info)return
  if(!info.isFile()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')
  const file=await open(path,'r')
  try{const actual=await file.stat();if(actual.ino!==info.ino||actual.dev!==info.dev)throw failure('NIGHT_PATH_CHANGED');return await file.readFile('utf8')}finally{await file.close()}
}
export async function atomicWrite(path,text){
  await privateDirectory(dirname(path))
  const prior=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
  if(prior&&(!prior.isFile()||prior.isSymbolicLink()))throw failure('NIGHT_PATH_UNSAFE')
  const temporary=join(dirname(path),'.write-'+randomUUID());let file,renamed=false
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(text);await file.sync();await file.close();file=undefined
    await rename(temporary,path);renamed=true
    if(process.platform!=='win32'){const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}}
  }catch(error){if(renamed)throw Object.assign(failure('NIGHT_WRITE_COMMIT_UNCERTAIN'),{cause:error,committed:true});throw error}
  finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
}
async function processIdentity(pid){
  if(process.platform!=='linux')return
  const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),stat=await readFile(`/proc/${pid}/stat`,'utf8')
  return boot+':'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]
}
async function alive(owner){
  if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string')throw failure('NIGHT_LOCK_UNCERTAIN')
  try{process.kill(owner.pid,0)}catch(error){if(error.code==='ESRCH')return false;return true}
  if(owner.identity)try{return await processIdentity(owner.pid)===owner.identity}catch{return true}
  return true
}
/** Cross-process lease; a live owner is never evicted by a timeout. */
export async function acquireLock(path,{timeoutMs=5000}={}){
  await privateDirectory(dirname(path));const until=Date.now()+timeoutMs,token=randomUUID()
  for(;;){
    try{
      await mkdir(path,{mode:0o700})
      try{await atomicWrite(join(path,'owner.json'),JSON.stringify({pid:process.pid,token,identity:await processIdentity(process.pid)}))}
      catch(error){await rm(path,{recursive:true,force:true});throw error}
      let released=false
      return async()=>{if(released)return;const current=JSON.parse(await readRegular(join(path,'owner.json'))??'null');if(current?.token!==token)throw failure('NIGHT_LOCK_OWNERSHIP_LOST');await rm(path,{recursive:true});released=true}
    }catch(error){
      if(error.code!=='EEXIST')throw error
      const info=await lstat(path).catch(e=>{if(e.code!=='ENOENT')throw e});if(!info)continue
      if(!info.isDirectory()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')
      const text=await readRegular(join(path,'owner.json')).catch(e=>{if(!['ENOENT','NIGHT_PATH_CHANGED'].includes(e.code))throw e})
      if(text){let owner;try{owner=JSON.parse(text)}catch{throw failure('NIGHT_LOCK_UNCERTAIN')}
        if(!await alive(owner)){
          const guard=path+'.reap';let owned=false
          try{await mkdir(guard,{mode:0o700});owned=true;const again=JSON.parse(await readRegular(join(path,'owner.json'))??'null');if(again?.token===owner.token&&!await alive(again))await rm(path,{recursive:true})}
          catch(e){if(e.code!=='EEXIST')throw e}finally{if(owned)await rm(guard,{recursive:true})}
          continue
        }
      }
      if(Date.now()>=until)throw failure(text?'NIGHT_DATA_IN_USE':'NIGHT_LOCK_UNCERTAIN')
      await new Promise(r=>setTimeout(r,15))
    }
  }
}
export async function withLock(path,work,options){const release=await acquireLock(path,options);try{return await work()}finally{await release()}}
