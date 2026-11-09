export const nativeEscalationTargets=['workspace-write','danger-full-access']
export function validateNativeEscalation(mode,justification){
 if(mode!==undefined&&justification===undefined)throw new Error('sandbox_permissions requires a justification')
 if(justification!==undefined&&mode===undefined)throw new Error('justification requires sandbox_permissions')
 if(justification!==undefined&&(typeof justification!=='string'||!justification.trim()))throw new Error('Sandbox justification must not be empty')
}
/** Grant a wider mode only for the explicit caller-owned request. This function
 * never mutates the standing policy, executes code, or retries an operation.
 */
export async function approveNativeSandbox(request,{approver,agent,callId,toolName,signal}){
 const {requestedMode,effectiveMode,justification,subject}=request
 if(requestedMode===effectiveMode)return effectiveMode
 const allowed=effectiveMode==='read-only'?nativeEscalationTargets:effectiveMode==='workspace-write'?['danger-full-access']:[]
 if(!allowed.includes(requestedMode))throw new Error(`Sandbox mode ${requestedMode} is not strictly wider than ${effectiveMode}`)
 if(!approver)throw new Error('Sandbox escalation requires an approval service')
 if(!agent)throw new Error('Sandbox escalation requires an agent to route approval')
 const outcome=await approver.request({agent,toolName,callId,reason:`escalate sandbox to ${requestedMode}: ${justification}`,displayReason:{en:`Allow this operation with ${requestedMode} permissions: ${justification}`,zh:`允许本次操作使用 ${requestedMode} 权限：${justification}`},...signal?{signal}:{}})
 if(outcome==='allowed-once')return requestedMode
 if(outcome==='rejected')throw new Error(`The user rejected escalating this ${subject} to ${requestedMode}; stop and explain instead of working around the denial`)
 if(outcome==='cancelled')throw new Error('Sandbox escalation approval was cancelled')
 if(outcome==='unavailable')throw new Error('No sandbox escalation approval channel is available')
 throw new Error('Unknown sandbox escalation approval outcome')
}
