import {createHash} from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
const failure = code => Object.assign(new Error(code), {code})
const logicalEvent = entry => entry.type === 'custom' && entry.customType === 'night.event' ? entry.data?.event
  : entry.type === 'message' && !entry.message?.night?.copy ? entry.message?.night?.event
  : entry.type === 'custom_message' && !entry.details?.copy ? entry.details?.event : undefined

export function piJournalFilename(id) {
  if (typeof id !== 'string' || !id) throw failure('PI_SESSION_ID_INVALID')
  return digest(id) + '.pi.jsonl'
}

/** Decode the exact bytes used by both live persistence and offline evidence.
 * Live readers may observe a torn final batch; offline proofs require the whole
 * physical file to be committed. Neither mode repairs or discards evidence.
 */
export function decodePiJournal(bytes, id, {codec, requireComplete = false} = {}) {
  let text
  try { text = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes) }
  catch { throw failure('PI_SESSION_JOURNAL_CORRUPT') }
  let offset=0, committedBytes=0, entries=[], committed=[], header, previousCommit=null, batch=[], eventCount=0, native=false, auditCount=0
  const seen=new Set()
  for (const raw of text.split(/(?<=\n)/)) {
    if (!raw.endsWith('\n')) break
    let entry
    try { entry=JSON.parse(raw) } catch { throw failure('PI_SESSION_JOURNAL_CORRUPT') }
    offset+=Buffer.byteLength(raw)
    if (!header) {
      if (entry?.type!=='session'||entry.version!==3||entry.id!==id) throw failure('PI_SESSION_FORMAT_UNSUPPORTED')
      header=entry;continue
    }
    if (!entry || typeof entry.id!=='string' || !entry.id || seen.has(entry.id) || entry.parentId!==null&&!seen.has(entry.parentId)) throw failure('PI_SESSION_TREE_CORRUPT')
    if(entry.type==='custom'&&entry.customType==='night.header'){
      if(entries.length||entry.data?.storage&&(entry.data.storage.engine!=='pi-native'||entry.data.storage.version!==1))throw failure('PI_SESSION_FORMAT_UNSUPPORTED')
      native=entry.data?.storage?.engine==='pi-native'
    }
    if(native&&(typeof entry.type!=='string'||typeof entry.timestamp!=='string'))throw failure('PI_SESSION_ENTRY_INVALID')
    if(native&&entry.type==='custom'&&entry.customType==='night.audit'){validateNativeAudit(entry.data);auditCount++}
    if(!native&&entry.type==='custom'&&entry.customType==='night.event'&&(!entry.data?.event||typeof entry.data.event!=='object'))throw failure('PI_SESSION_EVENT_PROVENANCE_REQUIRED')
    if(!native&&(entry.type==='message'&&!entry.message?.night?.event||entry.type==='custom_message'&&!entry.details?.event))throw failure('PI_SESSION_CONTEXT_PROVENANCE_REQUIRED')
    if(native&&entry.type==='custom'&&entry.customType==='night.event')throw failure('PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN')
    const event=native?undefined:logicalEvent(entry)
    if(event){if(event.seq!==eventCount)throw failure('PI_SESSION_EVENT_SEQUENCE_INVALID');eventCount++}
    entries.push(entry);seen.add(entry.id)
    if (entry.type==='custom'&&entry.customType==='night.commit') {
      const hash=digest((previousCommit===null?JSON.stringify(header)+'\n':'')+batch.map(e=>JSON.stringify(e)).join('\n'))
      if(native&&(entry.data?.version!==2||entry.data.entryCount!==entries.length-1||entry.data.auditCount!==auditCount))throw failure('PI_SESSION_COMMIT_INVALID')
      if(!native&&entry.data?.eventCount!==eventCount)throw failure('PI_SESSION_EVENT_SEQUENCE_INVALID')
      if (entry.data?.previousCommit!==previousCommit||entry.data?.entriesHash!==hash) throw failure('PI_SESSION_CHECKSUM_MISMATCH')
      committed=entries.slice();committedBytes=offset;previousCommit=entry.id;batch=[]
    } else batch.push(entry)
  }
  if (!header||!committed.length) throw failure('PI_SESSION_COMMIT_REQUIRED')
  if (requireComplete&&committedBytes!==bytes.length) throw failure('PI_SESSION_UNCOMMITTED_TAIL')
  const headers=committed.filter(e=>e.type==='custom'&&e.customType==='night.header')
  const metadata=headers[0]?.data
  if (headers.length!==1||metadata?.header?.id!==id) throw failure('PI_SESSION_IDENTITY_MISMATCH')
  if (metadata.importedFrom!==undefined) throw failure('PI_SESSION_IMPORT_UNSUPPORTED')
  const logicalHeader=codec?.readHeader(metadata.header)??metadata.header
  if(native)return {format:'pi-native-v1',header:logicalHeader,audit:committed.filter(e=>e.type==='custom'&&e.customType==='night.audit').map(e=>e.data),entries:committed,piHeader:header,committedBytes,totalBytes:bytes.length}
  const events=committed.map(logicalEvent).filter(Boolean).map(event=>codec?.readEvent(event)??event)
  if (events.some((e,i)=>e.seq!==i)||committed.at(-1).data.eventCount!==events.length) throw failure('PI_SESSION_EVENT_SEQUENCE_INVALID')
  return {header:logicalHeader,inheritedEventCount:metadata.inheritedEventCount,events,entries:committed,piHeader:header,committedBytes,totalBytes:bytes.length}
}

/** Business envelopes only; Pi owns all conversation and context entry semantics. */
export function validateNativeAudit(value) {
  if(!value||value.version!==1||typeof value.domain!=='string'||!value.domain||typeof value.kind!=='string'||!value.kind||!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload)||['user','assistant','toolResult','message','event'].includes(value.kind))throw failure('PI_SESSION_AUDIT_INVALID')
  return value
}
