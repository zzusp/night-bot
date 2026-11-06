// Portable task-artifact directory resolution; no execution/session driver.
import {parseArtifactReference} from './execution-artifacts.js'
import {taskDirectories} from './session-workspaces.js'
export {closeExecutionResources} from './resource-close.js'
export {freezeCandidate,readCandidate,verifyCandidate} from './execution-candidate.js'
export {createGitDelivery} from './execution-git.js'
export {createManagedWorkspaces} from './execution-workspace.js'
export function createTaskDirectoryResolver({ store, workspaceRoot }) {
  return async (taskId, { logicalTaskId } = {}) => {
    const plan = await store.query({ kind: 'task.plan', taskId })
    const reference = plan?.task.requirementRef ?? plan?.stages.find(stage => stage.requirementRef)?.requirementRef
      ?? (await store.query({ kind: 'run.list', taskId, limit: 1 }))[0]?.requirementRef
    if (reference) {
      const storedId = parseArtifactReference(reference).logicalTaskId
      if (!storedId) return null
      if (logicalTaskId && logicalTaskId !== storedId) throw new Error('TASK_DIRECTORY_IDENTITY_CONFLICT')
      logicalTaskId = storedId
    } else if (plan) return null
    logicalTaskId ??= (await store.query({ kind: 'task.family', taskId }))?.rootTaskId ?? taskId
    return taskDirectories(workspaceRoot, logicalTaskId)
  }
}
