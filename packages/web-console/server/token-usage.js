import {fail} from './security.js'
const keys = ['input','output','cacheWrite','cacheRead']
const unknown = () => Object.fromEntries(keys.map(key=>[key,null]))
const valid = value => Number.isSafeInteger(value) && value >= 0
// Pi 1.5.0 AgentSession.getSessionStats inclusion rules over ALL native entries,
// not the current compacted branch/projection. No live/cost/provider totals.
export function nativeTokenUsage(entries) {
  const totals = Object.fromEntries(keys.map(key=>[key,0])), seen = new Map()
  for (const entry of entries) {
    if (typeof entry.id !== 'string') fail('SESSION_USAGE_INVALID',503)
    if (seen.has(entry.id)) {if (JSON.stringify(seen.get(entry.id)) !== JSON.stringify(entry)) fail('SESSION_USAGE_INVALID',503);continue}
    seen.set(entry.id,entry)
    if (typeof entry.type !== 'string') {for (const key of keys) totals[key]=null;continue}
    let usage, included = false
    if (entry.type === 'usage') {usage=entry.usage;included=true}
    else if (['branch_summary','compaction'].includes(entry.type) && entry.usage) {usage=entry.usage;included=true}
    else if (entry.type === 'message') {
      const message=entry.message
      if (message?.role === 'assistant') {
        included=true;usage=message.usage
        // Host observation normalizes missing cache fields to zero; use its
        // retained raw observation to distinguish real zero from missing data.
        if (Object.hasOwn(message,'_hostUsage')) {
          const raw=message._hostUsage
          usage=raw ? {input:raw.inputTokens,output:raw.outputTokens,cacheWrite:raw.cacheWriteTokens,cacheRead:raw.cacheReadTokens} : unknown()
        } else if (message.api === 'host') usage=unknown()
      } else if (message?.role === 'toolResult' && message.usage) {usage=message.usage;included=true}
    }
    if (!included) continue
    for (const key of keys) totals[key]=totals[key] !== null && valid(usage?.[key]) && valid(totals[key]+usage[key]) ? totals[key]+usage[key] : null
  }
  const total=keys.every(key=>totals[key] !== null) ? keys.reduce((sum,key)=>sum+totals[key],0) : null
  return {...totals,total:valid(total)?total:null,basis:'committed-native-entries'}
}
