// Runtime business tests share the actual installed Host/official SDK transport.
// Additional exact model routes are fixture configuration, never Loop adapters.
import {nativeTaskHost} from './routing-official-host.js'
export {available,reason,latestInput,modelToolValues,topicTaskCalls,waitUntil} from './routing-official-host.js'
export const nativeShell=process.platform==='win32'?'pwsh':'bash'
export async function nativeRuntimeHost(root,decide,options={}){
 const h=await nativeTaskHost(root,decide,options)
 const profile=h.ctx.get('nativePiProvider').profiles().get('native-task-test')
 for(const id of options.models??[]){
  if(typeof id!=='string'||!id||profile.models.some(model=>model.id===id))throw new TypeError('Distinct explicit fixture model id required')
  profile.models.push({...structuredClone(profile.models[0]),id,name:id})
 }
 return h
}
