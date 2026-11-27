import {createHash} from 'node:crypto'

export const peerRoles=['development','verification','investigation','general']
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const peerError=code=>Object.assign(new Error(code),{code})
export const collaborationKey=(conversationId,sourceId,operationId)=>'work:'+hash([conversationId,sourceId,operationId])
export const sameCollaboration=(a,b)=>Boolean(a&&b&&a.taskId!==b.taskId&&a.groupId===b.groupId&&a.ownerActorId===b.ownerActorId
  &&a.metadata?.work?.id&&a.metadata.work.id===b.metadata?.work?.id)
export const peerAvailable=task=>Boolean(task&&!task.archivedAt&&!task.archiveRestoreHold&&!task.archiveRestore?.reviewRequired&&task.status==='active'&&task.control==='active')
export const peerMessageKey=(sender,target,id)=>'peer:'+hash([sender,target,id])
export const peerProjection=task=>({taskId:task.taskId,title:task.title,role:task.metadata.work.role,
  reportsFinal:task.metadata.work.reportsFinal,state:task.drained?'idle':'running'})

const str=(maxLength)=>({type:'string',minLength:1,maxLength})
const parameters=(required,properties)=>({type:'object',additionalProperties:false,required,properties})
const output={schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}
export const peerToolNames=['task_peer_list','task_peer_send','task_peer_request','task_peer_wait']
export function peerTools({invoke,park}){
  return [
    {name:'task_peer_list',isConcurrencySafe:()=>true,description:'Like ListAgents. Find active independent execution sessions for the same assignment, by role if useful. Use an exact taskId from the list to send directly.',
      parameters:parameters([],{role:{enum:peerRoles}}),output,execute:(args,exec)=>invoke('list',args,exec)},
    {name:'task_peer_send',description:'Send a concise internal message directly to another execution session in this assignment. Use a stable messageId for this handoff. It wakes an idle peer; a busy peer reads it before its next model request, without interrupting tools already running. Queued is not read. Never use this to get around a denied action or send externally.',
      parameters:parameters(['taskId','messageId','text'],{taskId:str(300),messageId:str(128),text:str(8000)}),output,execute:(args,exec)=>invoke('send',args,exec)},
    {name:'task_peer_request',description:'Ask Router to create a missing peer when task_peer_list has no usable session for this role. Supply the specific goal, limits and needed output. Reuse the same requestId for the same request. Do not ask the user here.',
      parameters:parameters(['role','requestId','text'],{role:{enum:peerRoles},requestId:str(128),text:str(8000)}),output,execute:(args,exec)=>invoke('request',args,exec)},
    {name:'task_peer_wait',description:'Yield this execution slot only when no independent work remains and you have already sent a peer handoff or requested a missing peer. Keeps the same task and Pi session available for peer messages; does not send a result to the Router.',
      parameters:parameters(['receiptId'],{receiptId:str(256)}),output,execute:park},
  ]
}
