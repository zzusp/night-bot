// Application-owned lifetime for the documented weaker POSIX-group fallback.
// A direct-process result is independent of the lifetime of its descendants.
import {readFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
function leaderIdentity(pid) {
  try {
    const text=readFileSync(`/proc/${pid}/stat`,'utf8')
    const fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)
    return /^\d+$/.test(fields[19]) ? fields[19] : undefined
  } catch {return undefined}
}
export function createLinuxGroupOwner({pid,direct,probe = group => process.kill(-group,0),hasLiveMembers,signal,identity = leaderIdentity,poll = () => delay(10)}) {
  let initialIdentity
  try {initialIdentity=identity(pid)} catch {}
  let lost
  function identityRetained() {
    if(lost)return false
    let current
    try {current=identity(pid)} catch {}
    if(initialIdentity !== undefined && current !== undefined && current !== initialIdentity) {
      lost=Object.assign(new Error('Linux process group leader identity changed; ownership cannot be proved'),{code:'NIGHT_PROCESS_OWNERSHIP_LOST'})
      return false
    }
    return true
  }
  let directEnded = false
  let drained = pid === undefined
  let joining
  direct.then(()=>{directEnded=true},()=>{directEnded=true})
  function present() {
    if(drained)return false
    try { probe(pid) }
    catch(error) {
      if(error.code === 'ESRCH') {drained=true;return false}
      // EPERM, I/O failures and unknown observation errors cannot prove exit.
      return true
    }
    if(directEnded) {
      try { if(hasLiveMembers(pid) === false) {drained=true;return false} }
      catch { return true }
    }
    return true
  }
  return {
    signal(value) {if(identityRetained() && present())signal(value)},
    waitForExit() {
      joining ??= (async()=>{while(true) {if(!identityRetained())throw lost;if(!present())return;await poll()}})()
      return joining
    },
    terminateForHostExit() {if(!drained && identityRetained())signal('SIGKILL')}
  }
}
