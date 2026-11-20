import {ROUTER_CONTEXT_TOKENS} from './runtime/pi-official-settings.js'

// Per-role catalog snapshots; never mutate the ordinary model registry. A
// fallback is an operator assumption, not evidence of upstream capacity.
const snapshots=new WeakMap()
export function routerModelProfiles(profiles){
 let result=snapshots.get(profiles)
 if(!result){
  result=new Map([...profiles].map(([id,profile])=>[id,{...profile,models:profile.models.map(model=>({...model,contextWindow:profile.fallbackContextModels?.has(model.id)?ROUTER_CONTEXT_TOKENS:model.contextWindow}))}]))
  snapshots.set(profiles,result)
 }
 return result
}
