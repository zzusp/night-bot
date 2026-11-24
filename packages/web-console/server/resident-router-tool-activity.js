// Public summaries of authenticated Router tools. Neither an admitted source
// reference nor a historical result grants access to its private contents.
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const count = (value, max = 100) => Array.isArray(value) && value.length <= max ? value.length : undefined
const integer = (value, max = 100) => Number.isSafeInteger(value) && value >= 1 && value <= max ? value : undefined
const oneOf = (value, allowed) => allowed.includes(value) ? value : undefined
const has = (value, key) => Object.hasOwn(value, key)
const scalar = (value, key) => typeof value === 'string' && value.length > 0 ? {[key]:true} : {}
const boolean = (value, key) => typeof value === 'boolean' ? {[key]:value} : {}
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$)/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined
const states = ['prepared','sending','unknown','held','failed','delivered','cancelled','superseded','awaiting-readback']
const purposes = ['direct-answer','task-update','acknowledgement']
const classify = (values, key, allowed, max) => {
  if (count(values,max) === undefined) return undefined
  const entries = new Map()
  for (const row of values) if (object(row) && oneOf(row[key], allowed)) entries.set(row[key], (entries.get(row[key]) ?? 0)+1)
  return entries.size ? Object.fromEntries(entries) : undefined
}

const routerTools = new Set(['resident_router_settle','resident_router_reply','resident_operator_reply','resident_reply_query','resident_source_query','resident_source_get'])
export const isResidentRouterActivity = name => routerTools.has(name)
const router = identity => !identity?.taskId && typeof identity?.conversationId === 'string' && Boolean(identity.conversationId)
  && typeof identity.sessionId === 'string' && Boolean(identity.sessionId) && Number.isSafeInteger(identity.generation) && identity.generation > 0
const summary = (toolName, value) => value && {toolName,text:JSON.stringify(value,null,2),redacted:true}
const eventKinds = ['source.message','operator.message','task.completed','task.blocked','task.failed','task.changed','task.inspection',
  'task.arranged','task.reopened','task.started','task.resumed','task.result','task.waiting','task.cancelled','task.notification','task.interrupted',
  'schedule.triggered','router.lookup.completed','notification.delivered','notification.failed']
const dispositionsAllowed = ['handled-inline','clarification','not-assigned','context-only','async-query']
export function residentRouterSettleDetails(args,provedEvents) {
  if (!count(args?.eventIds,30) || args.eventIds.some(id=>typeof id!=='string'||!id)) return
  const events = [...new Set(args.eventIds)].map(id => {
    const event = provedEvents.get(id)
    if (!event?.kind) return {recorded:false}
    const submitted = Array.isArray(args.noTaskDispositions) && args.noTaskDispositions.length <= 15
      ? args.noTaskDispositions.filter(row=>row?.eventId===id && dispositionsAllowed.includes(row.outcome)) : []
    return {recorded:true,kind:event.kind,...event.at?{at:event.at}:{},...event.title?{title:event.title}:{},
      ...event.snippet?{snippet:event.snippet,...event.snippetTruncated?{snippetTruncated:true}:{}}:{},
      ...submitted.length===1?{disposition:submitted[0].outcome}:{}}
  })
  // Legacy snapshots without any match keep the recorded count without
  // presenting a list of invented identities.
  return events.some(event=>event.recorded) ? events : undefined
}
export function safeRouterSettlementEvent(event) {
  const kind=oneOf(event?.kind,eventKinds)
  return kind ? {kind,at:date(event.source?.timestamp??event.taskEvent?.recordedAt??event.taskEvent?.createdAt??event.createdAt)} : undefined
}


export function residentRouterActivityInput(name, args, identity) {
  if (!routerTools.has(name) || !router(identity) || !object(args)) return
  if (name === 'resident_router_settle') {
    const ids = args.eventIds
    if (!count(ids,30) || ids.some(id => typeof id !== 'string' || !id)) return
    const requestedEventCount = new Set(ids).size
    const dispositions = classify(args.noTaskDispositions,'outcome',['handled-inline','clarification','not-assigned','context-only','async-query'],15)
    const inspectionReviews = classify(args.inspectionReviews,'decision',['wait','investigate','continue','notify'],30)
    return summary(name,{requestedEventCount,dispositions,inspectionReviews})
  }
  if (name === 'resident_router_reply') return summary(name,{
    text: typeof args.text === 'string' ? args.text : undefined,
    ...boolean(args.replyToSource,'replyToSource'),
    replyPurpose:oneOf(args.replyPurpose,purposes),
    recipientCount:count(args.recipientActorIds),
    deliveryFileCount:count(args.taskDelivery?.artifactIds,20),
  })
  if (name === 'resident_operator_reply') return summary(name,{text:typeof args.text === 'string' ? args.text : undefined})
  if (name === 'resident_reply_query') return summary(name,{
    by: ['sourceId','taskId','notificationId'].filter(key=>has(args,key)).length===1
      ? ({sourceId:'source',taskId:'task',notificationId:'notification'})[['sourceId','taskId','notificationId'].find(key=>has(args,key))] : undefined,
    limit:integer(args.limit), ...(integer(args.cursor,Number.MAX_SAFE_INTEGER)?{continued:true}:{}),
  })
  if (name === 'resident_source_query') return summary(name,{before:date(args.before),after:date(args.after),limit:integer(args.limit,20),
    ...scalar(args.keyword,'keywordFilter'),...(integer(args.cursor,Number.MAX_SAFE_INTEGER)||args.anchorSourceId?{continued:true}:{}),
  })
  if (name === 'resident_source_get' && typeof args.sourceId === 'string' && args.sourceId) return summary(name,{by:'source'})
}

export function residentRouterActivityOutput(name, value, identity, input, events) {
  if (!router(identity) || !object(value)) return
  if (name === 'resident_router_settle') {
    const conversation = value.result?.conversation
    if (!object(conversation) || conversation.id !== identity.conversationId
      || conversation.generation !== identity.generation || !Number.isSafeInteger(conversation.cursor) || conversation.cursor<0
      || !integer(input?.requestedEventCount,30)) return
    // Successful settlement says nothing about task completion, send status, or
    // how many of these requests were newly consumed rather than already settled.
    return summary(name,{settled:true,requestedEventCount:input.requestedEventCount,
      dispositions:input.dispositions,inspectionReviews:input.inspectionReviews,events})
  }
  if (name === 'resident_operator_reply') {
    const receipt = value.result
    if (receipt?.accepted !== true || receipt.webOnly !== true || typeof receipt.text !== 'string') return
    return summary(name,{result:{accepted:true,webOnly:true,...boolean(receipt.reused,'reused'),text:receipt.text}})
  }
  if (name === 'resident_router_reply') {
    if (value.accepted === false) return summary(name,{accepted:false})
    const notification = value.notification
    if (!object(notification) || notification.payload?.conversationId !== identity.conversationId) return
    const payload = notification.payload, state = oneOf(notification.state,states)
    return summary(name,{accepted:true,state,replyPurpose:oneOf(payload.replyPurpose,purposes),
      recipientCount:count(payload.recipientActorIds),deliveryFileCount:count(payload.artifactFiles,20),
    })
  }
  if (name === 'resident_reply_query' && count(value.replies) !== undefined && typeof value.hasMore === 'boolean') {
    return summary(name,{replyCount:value.replies.length,hasMore:value.hasMore,replies:value.replies.filter(object).map(row=>({
      kind:oneOf(row.kind,['triage-reply','router-reply','platform-reply','fixed-topic-reply','question','status']),
      state:oneOf(row.state,states),replyPurpose:oneOf(row.replyPurpose,purposes),
      createdAt:date(row.createdAt),deliveredAt:date(row.deliveredAt),...boolean(row.truncated,'truncated'),
    }))})
  }
  if (name === 'resident_source_query' && count(value.sources,20) !== undefined && value.backgroundOnly === true && typeof value.hasMore === 'boolean') {
    const sources = value.sources.filter(row=>object(row)&&row.conversationId===identity.conversationId)
    return summary(name,{sourceCount:sources.length,hasMore:value.hasMore,sources:sources.map(row=>({
      timestamp:date(row.timestamp),...boolean(row.truncated,'truncated'),...boolean(row.hasAttachments,'hasAttachments'),
    }))})
  }
  if (name === 'resident_source_get') {
    if (value.status === 'superseded') return summary(name,{status:'superseded'})
    if (value.conversationId !== identity.conversationId || typeof value.sourceId !== 'string') return
    return summary(name,{status:value.retracted===true?'retracted':'current',timestamp:date(value.timestamp),attachmentCount:count(value.resources),
      associatedTaskCount:count(value.taskIds),quoteStatus:oneOf(value.quote?.status,['current','unverified','superseded','unavailable']),
    })
  }
}
