import {lstat,symlink as nativeSymlink} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'

// Directory junctions exercise Windows reparse-point boundaries without asking
// for the privileged file-symlink right. File links keep native semantics.
export async function symlink(target,path,type){
 if(process.platform==='win32'&&type!=='file'){
  const directory=type==='dir'||type==='junction'||await lstat(resolve(dirname(path),target)).then(info=>info.isDirectory(),error=>{if(error.code==='ENOENT')return false;throw error})
  if(directory)return nativeSymlink(target,path,'junction')
 }
 return nativeSymlink(target,path,type)
}
