import {join} from 'node:path'
import {z} from 'zod'
import {hash} from './format.js'
import {failure} from '../runtime/files.js'
export const bindingSchema=z.object({actorId:z.string().min(1).max(256),groupId:z.string().min(1).max(256).optional(),groupWrite:z.boolean().default(false),projects:z.array(z.object({id:z.string().min(1).max(256),write:z.boolean().default(false)}).strict()).max(32).default([])}).strict()
// A Bot has one shared memory namespace. A binding authenticates the caller and
// attributes writes; channel/project selectors are retained aliases, not stores.
export function memoryScope(binding,{scope='bot'}={},write=false){
 binding=bindingSchema.parse(binding)
 if(!['bot','personal','group','project'].includes(scope))throw failure('MEMORY_SCOPE_INVALID')
 if(write&&binding.groupId&&!binding.groupWrite)throw failure('MEMORY_SCOPE_FORBIDDEN')
 return {kind:'bot',id:hash('bot:shared'),actor:hash(binding.actorId)}
}
export function readableScopes(binding){return [{selector:{scope:'bot'},scope:memoryScope(binding)}]}

export function memoryDirectory(root,scope){if(!['bot','personal','group','project'].includes(scope.kind)||!/^[a-f0-9]{64}$/.test(scope.id))throw failure('MEMORY_SCOPE_INVALID');if(scope.kind==='bot'&&scope.id!==hash('bot:shared'))throw failure('MEMORY_SCOPE_INVALID');return scope.kind==='bot'?join(root,'v2','bot'):join(root,'v1',scope.kind,scope.id)}
