import { z } from 'zod'
import { openNativeDomains, defineDomain } from './native-domain.js'
import {saveModelConfiguration} from './settings/model-configuration.js'

const selectionSchema = z.object({ provider: z.string().trim().min(1), model: z.string().trim().min(1), reasoningEffort: z.string().min(1).optional() }).strict()
export async function openNativeModelSelection(facility, initialModel) {
  const initial = selectionSchema.parse(initialModel)
  const domain = await facility.open(defineDomain({ name: 'night_model_selection', version: 1, global: { schema: selectionSchema, initial }, tables: {} }))
  return { currentSelection: () => structuredClone(domain.global.get()),
    async saveSelection(value) { await domain.global.set(selectionSchema.parse(value)) }, close: () => domain.close() }
}

/** Real file-backed installations have one global configuration authority.
 * The old native selection file is retained, but is not opened or overwritten.
 * Interactive changes persist through the same writer used by Web and CLI. */
export function configuredModelSelection(file,initialModel,{save=saveModelConfiguration}={}){
  let selected=selectionSchema.parse(initialModel),tail=Promise.resolve(),closed=false,poison
  const assertReadable=()=>{if(poison)throw poison;if(closed)throw Object.assign(new Error('NIGHT_BOT_MODEL_SELECTION_CLOSED'),{code:'NIGHT_BOT_MODEL_SELECTION_CLOSED'})}
  return {
    currentSelection(){assertReadable();return structuredClone(selected)},
    async saveSelection(value){
      assertReadable()
      const next=selectionSchema.parse(value)
      const work=tail.then(async()=>{
        if(poison)throw poison
        let committed=false
        try{
          const result=await save(file,{...next,reasoningEffort:next.reasoningEffort??'model-default'})
          committed=true
          selected=selectionSchema.parse(result.config.model)
        }catch(error){
          if(committed||error?.committed===true||/COMMIT_UNCERTAIN|LOCK_OWNERSHIP_LOST/.test(error?.code??''))poison=Object.assign(new Error('NIGHT_BOT_MODEL_SELECTION_UNCERTAIN'),{code:'NIGHT_BOT_MODEL_SELECTION_UNCERTAIN',cause:error,committed:true})
          throw poison??error
        }
      })
      tail=work.catch(()=>{})
      return work
    },
    close(){closed=true;return tail},
  }
}
export const name = 'night-native-state'
export async function apply(ctx, config) {
  const facility = await openNativeDomains({ root: config.root, pathCodec:ctx.get('portablePaths'), onChange: change => ctx.emit('domain/changed', change), onObserverError: error => ctx.logger.warn(error.message) })
  try {
    const model = config.modelConfigurationFile?configuredModelSelection(config.modelConfigurationFile,config.model):await openNativeModelSelection(facility, config.model)
    ctx.provide('storageDomain', facility)
    // Historical cutover readback only needs a backend root, not the former hub.
    ctx.provide('storage', { backend: new Map([['native-json', { root: facility.root }]]) })
    ctx.provide('agentDefaultModel', model)
    ctx.effect(() => async() => {await model.close();await facility.closeAll()})
  } catch (error) { await facility.closeAll(); throw error }
}
