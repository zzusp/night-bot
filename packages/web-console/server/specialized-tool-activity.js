// This is presentation projection, not an authorization grant. Call only after
// the normal session/generation checks and (for output) unique call/name pairing.
// Memory/Skills bodies keep their independent read boundary. The actual Router
// lookup is a tool-free NativeJob, not a child AgentSession with an openable tab.
const lookupName = 'resident_task_lookup_async'
const lookupStates = new Set(['pending', 'completed', 'failed', 'timed-out', 'interrupted'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const router = identity => object(identity) && identity.taskId == null
  && typeof identity.sessionId === 'string' && identity.sessionId.length > 0
  && typeof identity.conversationId === 'string' && identity.conversationId.length > 0
  && Number.isSafeInteger(identity.generation) && identity.generation >= 1
const projected = value => ({toolName: lookupName, text: JSON.stringify(value, null, 2), redacted: true})

export function specializedToolInput(name, args, identity) {
  if (name !== lookupName || !router(identity) || !object(args)) return null
  const ids = args.taskIds
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3
    || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) return null
  // Count the requested targets, never claim their existence, progress or access.
  return projected({taskCount: ids.length})
}

export function specializedToolOutput(name, raw, identity) {
  if (name !== lookupName || !router(identity) || !object(raw)
    || raw.readOnly !== true || !lookupStates.has(raw.status)) return null
  // A returned pending receipt is not a completed lookup or a completed task.
  // IDs, model summaries, snapshots, private details and errors are not selected.
  return projected({status: raw.status, readOnly: true})
}
