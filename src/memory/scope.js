import {z} from 'zod'
import {hash} from './format.js'
import {failure} from '../runtime/files.js'
export const bindingSchema=z.object({actorId:z.string().min(1).max(256),groupId:z.string().min(1).max(256).optional(),groupWrite:z.boolean().default(false),projects:z.array(z.object({id:z.string().min(1).max(256),write:z.boolean().default(false)}).strict()).max(32).default([])}).strict()
export function memoryScope(binding,{scope='personal',projectId}={},write=false){
  binding=bindingSchema.parse(binding)
  let id,allowed=true
  if(scope==='personal'){if(binding.groupId)throw failure('MEMORY_PERSONAL_IN_GROUP_REFUSED');id=binding.actorId}
  else if(scope==='group'){id=binding.groupId;allowed=binding.groupWrite}
  else if(scope==='project'){const project=binding.projects.find(item=>item.id===projectId);id=project?.id;allowed=project?.write}
  else throw failure('MEMORY_SCOPE_INVALID')
  if(!id||write&&!allowed)throw failure('MEMORY_SCOPE_FORBIDDEN')
  return {kind:scope,id:hash(scope+':'+id),actor:hash(binding.actorId)}
}
export function readableScopes(binding){const scopes=[binding.groupId?{scope:'group'}:{scope:'personal'},...binding.projects.map(p=>({scope:'project',projectId:p.id}))];return scopes.map(selector=>({selector,scope:memoryScope(binding,selector)}))}
