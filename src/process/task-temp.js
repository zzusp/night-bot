import {closeSync,lstatSync,openSync,realpathSync,unlinkSync} from 'node:fs'
import {join,win32} from 'node:path'
import {randomUUID} from 'node:crypto'

export const sameTaskTempPath=(expected,actual,platform=process.platform)=>platform==='win32'?win32.normalize(expected).toUpperCase()===win32.normalize(actual).toUpperCase():expected===actual

// Availability check, not isolation from an unrestricted process mutating paths.
// A failed check never redirects task data to a host/global temporary directory.
export function taskProcessEnvironment(taskRoot,env={}){
 const temp=join(taskRoot,'tmp');let fd,probe
 try{
  const info=lstatSync(temp)
  if(!info.isDirectory()||info.isSymbolicLink()||!sameTaskTempPath(temp,realpathSync.native(temp)))throw Object.assign(new Error('Task temporary directory identity changed'),{code:'TEMP_IDENTITY_INVALID'})
  const candidate=join(temp,'.night-temp-probe-'+randomUUID())
  fd=openSync(candidate,'wx',0o600);probe=candidate
  closeSync(fd);fd=undefined;unlinkSync(probe);probe=undefined
 }catch(cause){
  if(fd!==undefined)try{closeSync(fd)}catch{}
  if(probe!==undefined)try{unlinkSync(probe)}catch{}
  throw Object.assign(new Error('Task temporary directory is unavailable'),{code:'NIGHT_TASK_TEMP_UNAVAILABLE',cause})
 }
 const result=Object.fromEntries(Object.entries(env).filter(([name])=>!/^(?:TMP|TEMP|TMPDIR)$/i.test(name)))
 return {...result,TMP:temp,TEMP:temp,TMPDIR:temp}
}
