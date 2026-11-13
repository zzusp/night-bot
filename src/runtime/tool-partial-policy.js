import {Context,symbols} from '@deepseek-ai/cordis'
const policies=new WeakMap()
const hooksOf=ctx=>(ctx.events?.[symbols.original]??ctx.events)?._hooks
/** Cordis binds listeners during registration and again during dispatch. Pair
 * the exact registered hook and bound callback, never names or hook counts.
 * Unsupported bus layouts and unknown callbacks fail closed.
 */
export function registerPartialCompatiblePostPolicy(ctx,postPolicy,allowsPartial){
 const before=new Set(hooksOf(ctx)?.['tools/post-execute']??[])
 const wrapper=function(...args){return postPolicy.apply(this,args)}
 const dispose=ctx.on('tools/post-execute',wrapper)
 const added=(hooksOf(ctx)?.['tools/post-execute']??[]).filter(h=>!before.has(h))
 if(added.length===1){const hook=added[0];policies.set(hook,{callback:hook.callback,ctx:hook.ctx,check:allowsPartial})}
 return()=>{try{return dispose()}finally{for(const hook of added)policies.delete(hook)}}
}
export function partialPoliciesCompatible(ctx,target,exec){
 const all=hooksOf(ctx);if(!all||typeof all!=='object')return false
 const hooks=all['tools/post-execute']??[];if(!Array.isArray(hooks))return false
 const filter=target?.[Context.filter]
 return hooks.every(hook=>{
  if(!hook||typeof hook.callback!=='function')return false
  if(!hook.global&&filter&&!filter.call(target,hook.ctx))return true
  const policy=policies.get(hook)
  return policy?.callback===hook.callback&&policy.ctx===hook.ctx&&policy.check(exec)===true
 })
}
