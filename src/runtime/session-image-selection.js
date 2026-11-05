import {deepFreeze} from '../native-values.js'

// Read-only codec for Night's persisted image/offload audit records. It never
// opens attachments, resolves paths, or changes Pi's committed model context.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const index = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
const invalid = reason => { throw new Error(`image/offload: ${reason}`) }

export const imageSelectionProjection = Object.freeze({
 type: 'image/offload',
 project({data}, {nodes, events, baseSeq, messages}) {
  if (!record(data) || Object.keys(data).length !== 1 || !Array.isArray(data.targets) || !data.targets.length)
   invalid('data must contain a nonempty targets array')
  const selected = new Map()
  for (const target of data.targets) {
   if (!record(target) || Object.keys(target).length !== 2 || !index(target.seq) || !Array.isArray(target.imageIndexes) || !target.imageIndexes.length)
    invalid('each target must contain a seq and nonempty imageIndexes')
   if (selected.has(target.seq)) invalid(`duplicate target seq ${target.seq}`)
   if (!nodes.includes(target.seq)) invalid(`target seq ${target.seq} is not a current surface node`)
   const event = events[target.seq - baseSeq]
   if (!['user/message', 'tool/result'].includes(event?.type)) invalid(`target seq ${target.seq} must be user/message or tool/result`)
   let previous = -1
   for (const ordinal of target.imageIndexes) {
    if (!index(ordinal) || ordinal <= previous) invalid('imageIndexes must be strictly increasing non-negative safe integers')
    previous = ordinal
   }
   const message = messages.get(target.seq) ?? (event.type === 'user/message' ? event.data : event.data.message)
   // Clone the entire projection boundary: a caller cannot mutate an untouched
   // attachment/text block through a returned view or freeze its input by alias.
   const projected = structuredClone(message)
   const images = projected.content.filter(block => block.type === 'image')
   for (const ordinal of target.imageIndexes) {
    const image = images[ordinal]
    if (!image) invalid(`image index ${ordinal} does not exist`)
    if (image.offloaded === true) invalid(`image index ${ordinal} is already offloaded`)
    image.offloaded = true
   }
   selected.set(target.seq, deepFreeze(projected))
  }
  return selected
 },
})
