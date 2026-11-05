import {createHash} from 'node:crypto'
import {deepFreeze} from '../native-values.js'

export const CONTEXT_QUERY_PAGE_MAX = 50
const fail = (code, message) => { throw Object.assign(new Error(message), {code}) }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** One handle and one strict persistence read own the complete committed cut.
 * No live facade, flush, Session restoration, or audit-surface fold participates. */
export async function readCommittedContext(persistence, sessionId, signal) {
 signal?.throwIfAborted()
 if (!persistence) fail('SESSION_QUERY_CONTEXT_REQUIRED', 'committed Pi persistence is required')
 const handle = await persistence.open(sessionId, 'read', {signal})
 let read, header, inheritedEventCount
 try {
  signal?.throwIfAborted()
  read = await handle.read(0, undefined, {signal, includeContext:true})
  header = structuredClone(handle.header)
  inheritedEventCount = handle.inheritedEventCount
 } catch (error) {
  try { await handle.close() } catch {}
  throw error
 }
 await handle.close()
 signal?.throwIfAborted()
 if (header?.id !== sessionId) fail('SESSION_QUERY_SOURCE_CONFLICT', 'committed source identity does not match the requested session')
 const {context, events} = read
 if (context?.engine !== 'pi-session-manager') fail('SESSION_QUERY_CONTEXT_REQUIRED', 'the read did not return committed Pi context')
 if (!Array.isArray(events) || !Number.isSafeInteger(context.eventCount) || context.eventCount !== events.length
  || !Array.isArray(context.projection?.entries) || !Array.isArray(context.projection?.messages))
  fail('SESSION_QUERY_CONTEXT_INVALID', 'the read did not return an official Pi projection for the committed cut')
 // sourceEntry/messages and all projection semantics come from the official
 // buildSessionProjection call in persistence. Night does not reconstruct roles,
 // content, ordering, summaries, edits, or message-to-entry relationships.
 const snapshot = {session:header, inheritedEventCount, authority:'pi-session-manager',
  capturedThroughSeq:events.at(-1)?.seq ?? null, eventCount:context.eventCount,
  projection:structuredClone(context.projection)}
 return deepFreeze({...snapshot, revision:digest(snapshot)})
}

/** Stateless cursors are bound to the session, committed content.
 * A new commit cannot silently splice a later page into an earlier cut. */
export function pageCommittedProjection(snapshot, options = {}) {
 if (!options || typeof options !== 'object' || Array.isArray(options)) fail('SESSION_QUERY_INVALID_WINDOW', 'query options must be an object')
 const {limit = CONTEXT_QUERY_PAGE_MAX, cursor} = options
 if (!Number.isSafeInteger(limit) || limit < 1 || limit > CONTEXT_QUERY_PAGE_MAX)
  fail('SESSION_QUERY_INVALID_WINDOW', `limit must be between 1 and ${CONTEXT_QUERY_PAGE_MAX}`)
 if (options.text !== undefined) fail('SESSION_QUERY_SEARCH_UNAVAILABLE', 'message search has no selected public Pi API; no local search substitute is enabled')
 const binding = digest([snapshot.session.id, snapshot.revision])
 let offset = 0
 if (cursor !== undefined) {
  let decoded
  try {
   if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error()
   decoded = JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))
  } catch { fail('SESSION_QUERY_INVALID_CURSOR', 'invalid committed context cursor') }
  if (decoded?.version !== 1) fail('SESSION_QUERY_INVALID_CURSOR', 'unsupported committed context cursor')
  if (decoded.binding !== binding) fail('SESSION_QUERY_STALE_CURSOR', 'the committed context changed; restart pagination')
  if (!Number.isSafeInteger(decoded.offset) || decoded.offset < 0) fail('SESSION_QUERY_INVALID_CURSOR', 'invalid committed context offset')
  offset = decoded.offset
 }
 const selected = snapshot.projection.entries
 if (offset > selected.length) fail('SESSION_QUERY_INVALID_CURSOR', 'committed projection offset is outside the result')
 const entries = selected.slice(offset,offset + limit), next = offset + entries.length
 return {session:structuredClone(snapshot.session), inheritedEventCount:snapshot.inheritedEventCount,
  authority:snapshot.authority, revision:snapshot.revision, capturedThroughSeq:snapshot.capturedThroughSeq,
  eventCount:snapshot.eventCount, total:selected.length, entries:structuredClone(entries),
  messages:structuredClone(entries.flatMap(entry => entry.messages)),
  thinkingLevel:snapshot.projection.thinkingLevel, model:structuredClone(snapshot.projection.model),
  nextCursor:next < selected.length ? Buffer.from(JSON.stringify({version:1,binding,offset:next})).toString('base64url') : null}
}
