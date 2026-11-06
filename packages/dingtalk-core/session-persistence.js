// The generic Session-event format is retired. Read official committed entries
// and typed business audit through readNative; never synthesize a legacy event view.
export async function inspectSession(persistence, sessionId, options) {
  throw Object.assign(new Error('SESSION_EVENT_API_RETIRED'), {code:'SESSION_EVENT_API_RETIRED'})
}

export function inboxHasPending(inbox) {
  return inbox.nextTurn.length > 0 || inbox.nextStep.length > 0
}

// Feedback has no executionSession and never replaces an execution input. Native
// runtimes may persist an input in the inbox before emitting its user/message.
export function latestExecutionInput(events, before = Infinity) {
  for (const event of events.filter(row => row.seq < before).reverse()) {
    const sources = event.type === 'user/message' ? [event.data.source]
      : event.type === 'agent/inbox/spliced' ? (event.data.inserted ?? []).filter(item => item.role === 'user').map(item => item.source) : []
    const source = sources.findLast(item => item && Object.hasOwn(item, 'executionSession'))
    if (source) return { event, binding: source.executionSession }
  }
  return null
}

export function executionInputFor(events, binding, before = Infinity) {
  const latest = latestExecutionInput(events, before), input = latest?.binding
  return input && ['sessionId', 'inputVersion', 'inputDigest', 'leaseEpoch'].every(key => input[key] === binding[key]) ? latest.event : null
}
