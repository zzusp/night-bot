/** A task binding is a Night receipt; Pi conversation entries carry no ownership. */
export function validateTaskIdentity(payload) {
  return payload!==null&&typeof payload==='object'&&!Array.isArray(payload)
    &&Object.keys(payload).length===2&&Object.hasOwn(payload,'taskId')&&Object.hasOwn(payload,'sessionId')
    &&typeof payload.taskId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(payload.taskId)
    &&typeof payload.sessionId==='string'&&payload.sessionId.length>0
}
export const taskAuditKinds=Object.freeze({'task/identity':validateTaskIdentity})
