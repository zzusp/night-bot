import { z } from 'zod'
import { openNativeDomains, defineDomain } from './native-domain.js'

const selectionSchema = z.object({ provider: z.string().trim().min(1), model: z.string().trim().min(1), reasoningEffort: z.string().min(1).optional() }).strict()
export async function openNativeModelSelection(facility, initialModel) {
  const initial = selectionSchema.parse(initialModel)
  const domain = await facility.open(defineDomain({ name: 'night_model_selection', version: 1, global: { schema: selectionSchema, initial }, tables: {} }))
  return { currentSelection: () => structuredClone(domain.global.get()),
    async saveSelection(value) { await domain.global.set(selectionSchema.parse(value)) }, close: () => domain.close() }
}
export const name = 'night-native-state'
export async function apply(ctx, config) {
  const facility = await openNativeDomains({ root: config.root, pathCodec:ctx.get('portablePaths'), onChange: change => ctx.emit('domain/changed', change), onObserverError: error => ctx.logger.warn(error.message) })
  try {
    const model = await openNativeModelSelection(facility, config.model)
    ctx.provide('storageDomain', facility)
    // Historical cutover readback only needs a backend root, not the former hub.
    ctx.provide('storage', { backend: new Map([['native-json', { root: facility.root }]]) })
    ctx.provide('agentDefaultModel', model)
    ctx.effect(() => () => facility.closeAll())
  } catch (error) { await facility.closeAll(); throw error }
}
