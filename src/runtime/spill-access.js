import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
import {join,resolve,relative} from 'node:path'
import {readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inside} from './paths.js'
import {atomicWrite,readRegular,withLock} from './files.js'
const hash=value=>createHash('sha256').update(value).digest('hex')
/** Capabilities originate from trusted process handles, never parsed stdout. */
export async function spillAccess(paths){
  const owners=new Map(),handles=new Map(),pending=new Set(),root=join(paths.state,'spill-access')
  const controlled=path=>paths.processSpills&&inside(paths.processSpills,path)
  if(paths.mode==='portable')for(const file of await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error})){
    if(!/^[a-f0-9]{64}\.json$/.test(file))continue
    const value=JSON.parse(await readRegular(join(root,file)));if(typeof value.owner!=='string'||file!==hash(value.owner)+'.json'||!Array.isArray(value.paths))throw Error('SPILL_ACCESS_INVALID')
    const allowed=new Set();for(const ref of value.paths){const path=resolve(paths.data,ref);if(typeof ref!=='string'||!controlled(path))throw Error('SPILL_ACCESS_INVALID');allowed.add(path)}owners.set(value.owner,allowed)
  }
  const capture=(owner,handle)=>{let changed=false;for(const stream of [handle.collected?.stdout,handle.collected?.stderr]){const path=stream?.readFrom(0)?.spillPath;if(path&&controlled(resolve(path))){let owned=owners.get(owner);if(!owned)owners.set(owner,owned=new Set());if(!owned.has(resolve(path))){owned.add(resolve(path));changed=true}}}return changed}
  return {allows(path,agent){if(!agent)return false;const owner=agent.piSession?(officialWorkingDirectoryOrigin(agent),agent.id):agent.session.id;for(const handle of handles.get(owner)??[])try{capture(owner,handle)}catch{}return inside(join(paths.spills,'session-'+hash(owner).slice(0,12)),path)||owners.get(owner)?.has(path)===true},
    track(agent,handle){if(!agent||paths.mode!=='portable')return;const owner=agent.piSession?(officialWorkingDirectoryOrigin(agent),agent.id):agent.session.id;let tracked=handles.get(owner);if(!tracked)handles.set(owner,tracked=new Set());tracked.add(handle)
      const work=Promise.resolve(handle.done).then(async()=>{capture(owner,handle);const file=join(root,hash(owner)+'.json');await withLock(file+'.lock',async()=>{const previous=JSON.parse(await readRegular(file)??'{"paths":[]}'),refs=new Set([...previous.paths,...[...owners.get(owner)??[]].map(path=>relative(paths.data,path))]);await atomicWrite(file,JSON.stringify({owner,paths:[...refs]})+'\n')})}).catch(()=>{}).finally(()=>pending.delete(work));pending.add(work)
    },async close(){await Promise.allSettled([...pending])}}
}
