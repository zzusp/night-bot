import {resolve,relative,isAbsolute,basename} from 'node:path'
/** Single-session file delivery freezes reported task artifacts with the same
 * immutable import/digest protocol as the retained delivery ledger. */
export async function freezeSingleTaskFiles({selected=[],reported=[],task,directory,files}){
  if(!Array.isArray(selected)||selected.length>20||!Array.isArray(reported))throw Error('TASK_DELIVERY_FILES_INVALID')
  const frozen=[],seen=new Set()
  for(const item of selected){if(!item||typeof item.path!=='string'||!reported.includes(item.path))throw Error('TASK_DELIVERY_ARTIFACT_NOT_REPORTED')
    const path=resolve(directory,item.path),ref=relative(directory,path);if(!ref||isAbsolute(ref)||ref.split(/[\\/]/).includes('..'))throw Error('TASK_DELIVERY_ARTIFACT_OUTSIDE_TASK')
    const input={taskId:task.taskId,requirementRevision:task.requirementRevision,producer:{runId:task.taskId,nodeRunId:task.sessionId,outputRef:'single:'+task.requirementRevision},role:'final-delivery',fileName:basename(path),sourceRoot:directory,relativePath:ref}
    const prepared=await files.prepareImport(input),artifact=await files.importFile({...input,expectedSha256:prepared.sha256});if(seen.has(artifact.artifactId))continue;seen.add(artifact.artifactId);frozen.push({artifact,caption:item.caption??''})
  }
  if(frozen.length)await files.validateManifest(frozen.map(item=>item.artifact),task)
  return frozen
}
