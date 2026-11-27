import {resolve,relative,isAbsolute,basename} from 'node:path'
/** Single-session file delivery freezes reported task artifacts with the same
 * immutable import/digest protocol as the retained delivery ledger. */
export async function freezeSingleTaskFiles({selected=[],reported=[],task,directory,files,reportedDelivery=false}){
  if(!Array.isArray(selected)||selected.length>20||!Array.isArray(reported))throw Error('TASK_DELIVERY_FILES_INVALID')
  const frozen=[],seen=new Set()
  for(const item of selected){if(!item||typeof item.path!=='string'||!reported.includes(item.path))throw Error('TASK_DELIVERY_ARTIFACT_NOT_REPORTED')
    const sourceRoot=reportedDelivery?resolve(directory,'work'):directory
    const path=resolve(sourceRoot,reportedDelivery?item.path.slice(5):item.path),ref=relative(sourceRoot,path);if(!ref||isAbsolute(ref)||ref.split(/[\\/]/).includes('..'))throw Error('TASK_DELIVERY_ARTIFACT_OUTSIDE_TASK')
    const input={taskId:task.taskId,requirementRevision:task.requirementRevision,producer:{runId:task.taskId,nodeRunId:task.sessionId,outputRef:reportedDelivery?'reported:'+item.path:'single:'+task.requirementRevision},role:'final-delivery',fileName:basename(path),sourceRoot,relativePath:ref}
    const prepared=await files.prepareImport(input),artifact=await files.importFile({...input,expectedSha256:prepared.sha256});if(seen.has(artifact.artifactId))continue;seen.add(artifact.artifactId);frozen.push({artifact,caption:item.caption??''})
  }
  if(frozen.length)await files.validateManifest(frozen.map(item=>item.artifact),task)
  return frozen
}

/** Bind a new, same-conversation action to a file reported by a completed task. */
export function reportedWorkFile(task,source,requirementRevision,path){
  return typeof path==='string'&&path.startsWith('work/')&&!path.includes('\\')
    &&path.slice(5).split('/').every(part=>part&&part!=='.'&&part!=='..')&&task?.groupId===source.groupId&&task.ownerActorId===source.actorId
    &&task.status==='completed'&&task.control==='active'&&task.drained&&!task.archivedAt&&!task.archiveRestoreHold&&!task.archiveRestore?.reviewRequired
    &&task.requirementRevision===requirementRevision&&task.completion?.requirementRevision===requirementRevision
    &&task.completion.result?.artifacts?.includes(path)===true
}
