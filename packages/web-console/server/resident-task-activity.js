// Presentation only: caller must enforce Router identity, unique call/result pairing,
// committed history and final visibleText redaction (including configured secrets).
const names = new Set(['resident_dependency_evaluate', 'resident_task_action', 'resident_task_lookup_async', 'resident_task_plan', 'resident_task_query', 'resident_web_attachment'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const router = identity => object(identity) && identity.taskId == null && typeof identity.sessionId === 'string' && !!identity.sessionId
  && typeof identity.conversationId === 'string' && !!identity.conversationId && Number.isSafeInteger(identity.generation) && identity.generation > 0
const text = value => typeof value === 'string' ? value.replace(/(?:https?|file):\/\/[^\s<>"']+/gi, '[链接已隐藏]').slice(0, 4000) : undefined
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined
const boolean = value => typeof value === 'boolean' ? value : undefined
const enumeration = values => value => values.includes(value) ? value : undefined
const array = select => value => Array.isArray(value) ? value.slice(0, 100).map(select).filter(value => value !== undefined) : undefined
const fields = schema => value => {
  if (!object(value)) return undefined
  const result = {}
  // Never enumerate unknown keys or read private getters/body trees.
  for (const [key, select] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) continue
    const selected = select(value[key])
    if (selected !== undefined) result[key] = selected
  }
  return result
}
const strings = array(text)
const status = enumeration(['open','active','paused','cancelled','pending','running','completed','error','failed','blocked','waiting','scheduled','accepted','settled','ready','done','unknown','held','deferred','queued','sent','delivered','ok','satisfied','unavailable','timed-out','interrupted'])
const revisions = {requirementRevision:number, controlRevision:number, contextRevision:number, arrangementRevision:number}
const decision = fields({action:enumeration(['complete','wait','blocked']), summary:text, question:text, at:text, ...revisions})
const dependencyFields = {id:text, taskId:text, prerequisiteTaskId:text, condition:text, state:status, ...revisions, prerequisiteRequirementRevision:number}
const dependencies = array(fields(dependencyFields))
const task = fields({taskId:text, title:text, objective:text, requirements:strings, handoff:text, state:status, status, control:enumeration(['active','paused','cancelled']),
  drained:boolean, dependenciesReady:boolean, ...revisions, runSequence:number, lastDecision:decision,
  result:decision, completion:fields({summary:text, at:text, resultAvailable:boolean, result:decision})})
const receipt = {accepted:boolean, received:boolean, scheduled:boolean, settled:boolean, replayed:boolean, dispatchEligible:boolean, status}
const evaluation = fields({...dependencyFields, dependencyId:text, decision:enumeration(['satisfied','continue','wait']), evidence:strings})
const inputSchemas = {
  resident_task_query:{taskId:text, detail:enumeration(['index','summary','full','progress','handoff']), offset:number, limit:number},
  resident_task_plan:{tasks:array(task), dependencies},
  resident_task_action:{taskId:text, kind:enumeration(['supplement','resume','revise','reopen','control','arrange']), handoff:text, title:text, objective:text, requirements:strings,
    control:enumeration(['active','paused','cancelled']), reason:text, sameGoal:boolean, dependencies},
  resident_dependency_evaluate:{dependencyId:text, decision:enumeration(['satisfied','continue','wait']), evidence:strings, ...revisions, prerequisiteRequirementRevision:number},
  resident_web_attachment:{index:number, messageVersion:number},
}
const query = {task, tasks:array(task), dependencies, total:number, hasMore:boolean, nextOffset:number, offset:number, limit:number, status, readOnly:boolean,
  coverage:enumeration(['unavailable','committed-current-run']), reason:text, requiresFullRead:boolean, dependenciesTruncated:boolean,
  activities:array(fields({at:text, kind:enumeration(['assistant','toolResult']), toolName:text, isError:boolean, truncated:boolean,
    verification:enumeration(['recorded-tool-result','model-statement-not-independent-evidence']), toolCalls:array(fields({name:text}))}))}
const outputSchemas = {
  resident_task_query:query,
  resident_task_plan:{...receipt, result:fields({tasks:array(task), dependencies})},
  resident_task_action:{...receipt, task, result:fields({task, dependencies})},
  resident_dependency_evaluate:{...receipt, result:fields({dependency:fields(dependencyFields), evaluation, task})},
  resident_web_attachment:{name:value => typeof value === 'string' && !value.includes('://') ? text(value.split(/[\\/]/).at(-1)) : undefined,
    mediaType:value => typeof value === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value) ? value : undefined,
    bytes:number, size:number},
}
function planTitles(value) {
  const rows = value?.tasks ?? value?.result?.tasks
  const links = value?.dependencies ?? value?.result?.dependencies
  if (!Array.isArray(rows) || !Array.isArray(links)) return value
  const counts = new Map()
  for (const task of rows) if (task.taskId && task.title) counts.set(task.taskId, [...(counts.get(task.taskId) ?? []), task.title])
  for (const link of links) {
    if (counts.get(link.taskId)?.length === 1) link.taskTitle = counts.get(link.taskId)[0]
    if (counts.get(link.prerequisiteTaskId)?.length === 1) link.prerequisiteTitle = counts.get(link.prerequisiteTaskId)[0]
  }
  return value
}
const projected = (name, value) => ({toolName:name, text:JSON.stringify(value, null, 2), redacted:true})
export function residentTaskToolInput(name, args, identity) {
  if (!names.has(name) || !router(identity) || !object(args)) return null
  if (name === 'resident_task_lookup_async') {
    if (!Array.isArray(args.taskIds) || args.taskIds.length < 1 || args.taskIds.length > 3 || args.taskIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(args.taskIds).size !== args.taskIds.length) return null
    return projected(name, {taskCount:args.taskIds.length})
  }
  return projected(name, planTitles(fields(inputSchemas[name])(args)))
}
export function residentTaskToolOutput(name, raw, identity) {
  if (!names.has(name) || !router(identity) || !object(raw)) return null
  if (name === 'resident_task_lookup_async') {
    if (raw.readOnly !== true || !['pending','completed','failed','timed-out','interrupted'].includes(raw.status)) return null
    return projected(name, {status:raw.status, readOnly:true})
  }
  return projected(name, planTitles(fields(outputSchemas[name])(raw)))
}
