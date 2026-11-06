// Night's per-official-actor file observations. Pi owns edit matching and tool
// iteration; these facts only authorize guarded Host IO, never model context.
import {officialWorkingDirectoryOrigin} from './native-working-directory.js'
import {FsError} from './native-fs-protocol.js'
export const name='night-native-fs-observation-policy'
export const inject=['agents','sandboxPolicy']
export function apply(ctx){
 let observations=new WeakMap()
 function owner(exec){
  const actor=exec?.agent,registry=ctx.get('agents')
  if(!actor?.piSession||registry?.get(actor.id)!==actor||registry.currentInitiator()!==actor)throw new FsError('Official file observation actor is not authenticated','FS_ACTOR_AUTHORITY_REQUIRED')
  try{officialWorkingDirectoryOrigin(actor);const policy=ctx.get('sandboxPolicy');if(!policy)throw Error('No file policy');policy.resolve({actor})}catch{throw new FsError('Official file observation actor has no bound file authority','FS_ACTOR_AUTHORITY_REQUIRED')}
  return actor
 }
 function prior(target,exec){return observations.get(owner(exec))?.get(target.targetKey)}
 ctx.effect(()=>()=>{observations=new WeakMap()},'file observation disposal')
 ctx.on('fs/observed',(target,fact,exec)=>{
  const actor=owner(exec)
  if(!fact||!['present','absent'].includes(fact.kind)||fact.kind==='present'&&typeof fact.version!=='string')throw new FsError('Invalid file observation','FS_OBSERVATION_INVALID')
  let files=observations.get(actor);if(!files){files=new Map();observations.set(actor,files)}
  // Retain an immutable copy, not a mutable emitter-owned object.
  files.set(target.targetKey,fact.kind==='present'?{kind:'present',version:fact.version}:{kind:'absent'})
 })
 ctx.on('fs/write-intent',async(target,exec)=>{
  const fact=prior(target,exec)
  return fact?.kind==='present'?{kind:'replaceIfVersion',version:fact.version}:{kind:'createIfAbsent'}
 })
 ctx.on('fs/edit-intent',async(target,exec)=>{
  const fact=prior(target,exec)
  if(!fact)throw new FsError(`edit requires reading "${target.displayPath}" first`,'FS_NOT_OBSERVED')
  if(fact.kind==='absent')throw new FsError(`cannot edit "${target.displayPath}": not found`,'FS_NOT_FOUND')
  return {version:fact.version}
 })
}
