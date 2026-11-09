import {checkedText} from './format.js'
const text=value=>{if(typeof value!=='string'||!value.trim())return;try{return checkedText(value).slice(0,256)}catch{}}
// Only Host-admitted packets, task ledger rows and authenticated channel context
// reach this function. No model-provided origin fields are accepted.
export function memoryProvenance({channel,task,message}={}){
 const input=message?.source,source={}
 const values={channelId:channel?.channelId??input?.channelId,conversationId:channel?.conversationId??input?.conversationId,
  conversationName:channel?.conversationName,conversationKey:task?.groupId,
  taskId:task?.taskId,taskTitle:task?.title,messageId:input?.channelMessageId}
 for(const [key,value]of Object.entries(values)){const valid=text(value);if(valid)source[key]=valid}
 const type=channel?.type??input?.channelType
 if(['chat','chat-room'].includes(type))source.conversationType=type
 return Object.keys(source).length?source:null
}
