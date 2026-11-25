import {createHash} from 'node:crypto'

export const milestoneParameters={type:'object',additionalProperties:false,required:['trigger','waitForDelivery'],properties:{
  trigger:{type:'string',minLength:1,maxLength:400},waitForDelivery:{type:'boolean'},
}}

const invalid=()=>{throw Object.assign(new Error('TASK_MILESTONE_INVALID'),{code:'TASK_MILESTONE_INVALID'})}
export function bindTaskMilestone(value,source,requirementRevision){
  if(!value||typeof value.trigger!=='string'||!value.trigger.trim()||value.trigger.length>400||typeof value.waitForDelivery!=='boolean'||source.channel!=='im')invalid()
  return {trigger:value.trigger.trim(),waitForDelivery:value.waitForDelivery,sourceId:source.sourceId,sourceVersion:source.version,requirementRevision}
}
export const currentTaskMilestone=task=>task?.milestoneNotification?.requirementRevision===task?.requirementRevision?task?.milestoneNotification:undefined
export const taskMilestoneId=(task,m)=>'task-milestone:'+createHash('sha256').update(JSON.stringify([task.taskId,m.requirementRevision,m.sourceId,m.sourceVersion,m.trigger,m.waitForDelivery])).digest('hex')
export const taskMilestonePending=(task,getNotification)=>{
  const m=currentTaskMilestone(task)
  return !!(m?.waitForDelivery&&m.notificationId&&getNotification(m.notificationId)?.state!=='delivered')
}
export function taskMilestoneView(task,notification){
  const m=currentTaskMilestone(task)
  if(!m)return
  return {trigger:m.trigger,waitForDelivery:m.waitForDelivery,state:notification?.state??'not-reached',
    ...(m.reachedAt?{reachedAt:m.reachedAt}:{}),...(notification?.deliveredAt?{deliveredAt:notification.deliveredAt}:{}),
    ...(notification?{text:notification.payload.text}:{})}
}
