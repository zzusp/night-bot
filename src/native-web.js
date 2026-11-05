import {Service} from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import {AsyncLocalStorage} from 'node:async_hooks'
import {isPromise} from 'node:util/types'
import {WebError} from '@deepseek-ai/dsh-web'
import {launchEnvironmentOf} from './native-environment.js'
export {WebError}
const aborted=signal=>new WebError('web operation aborted','WEB_ABORTED',{cause:signal.reason})

/** Application-owned selection and provider lifetime. Canonical public errors
 * preserve existing tool adapters; only registered callbacks execute work. */
export default class NativeWeb extends Service {
  static Config=schema.object({searchProvider:schema.string(),fetchProvider:schema.string()})
  searchProviders=new Map()
  fetchProviders=new Map()
  records=new Set()
  active=new Set()
  lifetime=new AbortController()
  calls=new AsyncLocalStorage()
  closed=false

  constructor(ctx,config={}) {
    super(ctx,'web')
    const env=launchEnvironmentOf(ctx)
    this.searchProviderId=config.searchProvider??env.getFrom('DSH_WEB_SEARCH_PROVIDER',['process'])?.value
    this.fetchProviderId=config.fetchProvider??env.getFrom('DSH_WEB_FETCH_PROVIDER',['process'])?.value
    ctx.effect(()=>async()=>{
      this.closed=true
      this.lifetime.abort(new Error('Native web disposed'))
      for(const record of this.records)record.controller.abort(this.lifetime.signal.reason)
      await this.drain(this.active)
      this.searchProviders.clear()
      this.fetchProviders.clear()
      this.records.clear()
    },'native web cancellation/drain')
  }
  assertOpen(){if(this.closed)throw aborted(this.lifetime.signal)}
  async drain(active) {
    const current=this.calls.getStore()??new Set()
    for(;;){
      const pending=[...active].filter(run=>!current.has(run))
      if(!pending.length)return
      await Promise.allSettled(pending)
    }
  }
  registerSearchProvider(provider){return this.registerProvider(this.searchProviders,provider,'search')}
  registerFetchProvider(provider){return this.registerProvider(this.fetchProviders,provider,'fetch')}
  registerProvider(store,provider,operation) {
    this.assertOpen()
    if(!provider||typeof provider.id!=='string'||typeof provider.available!=='function'||typeof provider[operation]!=='function')
      throw new WebError('invalid web provider declaration','WEB_PROVIDER_ERROR')
    const id=provider.id
    const duplicate=()=>new WebError(`a web provider with id "${id}" is already registered`,'WEB_DUPLICATE_PROVIDER')
    if(store.has(id))throw duplicate()
    const record={id,provider,controller:new AbortController(),active:new Set(),available(){
      const value=provider.available()
      if(isPromise(value))void value.catch(()=>{})
      if(typeof value!=='boolean')throw new WebError('web provider available() must synchronously return a boolean','WEB_PROVIDER_ERROR')
      return value
    }}
    return this.ctx.effect(()=>{
      this.assertOpen()
      if(store.has(id))throw duplicate()
      store.set(id,record)
      this.records.add(record)
      return async()=>{
        if(store.get(id)===record)store.delete(id)
        record.controller.abort(new Error('Web provider disposed'))
        await this.drain(record.active)
        this.records.delete(record)
      }
    },'native web provider lifetime')
  }
  resolve(store,id) {
    if(id!==undefined){
      const record=store.get(id)
      if(!record)throw new WebError(`configured web provider "${id}" is not registered`,'WEB_PROVIDER_CONFIGURED_MISSING')
      if(!record.available())throw new WebError(`configured web provider "${id}" is unavailable`,'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      return record
    }
    const usable=[...store.values()].filter(record=>record.available())
    if(!usable.length)throw new WebError('no usable web provider is registered','WEB_PROVIDER_UNAVAILABLE')
    if(usable.length>1)throw new WebError(`multiple usable web providers are registered (${usable.map(r=>r.id).join(', ')}); configure one explicitly`,'WEB_PROVIDER_AMBIGUOUS')
    return usable[0]
  }
  run(operation,request,upstream) {
    const base=AbortSignal.any([this.lifetime.signal,...upstream===undefined?[]:[upstream]])
    const parents=this.calls.getStore()??new Set()
    if(base.aborted)return Promise.reject(aborted(base))
    let run
    run=Promise.resolve().then(()=>this.calls.run(new Set([...parents,run]),async()=>{
      this.assertOpen()
      if(base.aborted)throw aborted(base)
      const store=operation==='search'?this.searchProviders:this.fetchProviders
      const selected=operation==='search'?this.searchProviderId:this.fetchProviderId
      const record=this.resolve(store,selected)
      const signal=AbortSignal.any([base,record.controller.signal])
      this.assertOpen()
      if(signal.aborted)throw aborted(signal)
      record.active.add(run)
      try{
        const result=await record.provider[operation](request,signal)
        if(signal.aborted)throw aborted(signal)
        if(operation==='search'&&request.maxResults!==undefined&&result.sources.length>request.maxResults)
          return{...result,sources:result.sources.slice(0,request.maxResults),truncated:true}
        return result
      }catch(error){
        if(signal.aborted)throw aborted(signal)
        throw error
      }finally{
        record.active.delete(run)
      }
    }))
    this.active.add(run)
    const settle=()=>this.active.delete(run)
    run.then(settle,settle)
    return run
  }
  search(request,signal){return this.run('search',request,signal)}
  fetch(request,signal){return this.run('fetch',request,signal)}
}
