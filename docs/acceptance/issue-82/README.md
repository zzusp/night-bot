# Issue 82: latency fixes and evidence boundaries

Base: `569a6dc` (2026-11-12). Scope: local scripted models, isolated stores and
channels; no real provider requests, live channel messages, production data or
Windows deployment were used by this change.

## Root causes addressed

- Every Router batch previously rotated its generation once the inbox was empty,
  even while its tasks were executing. The serialized tool-free handoff could
  occupy the conversation exactly when a completion event arrived. Defer rotation
  while an active task is owned by the conversation and recheck the inbox before
  starting it. Existing in-progress handoffs are not preempted.
- A terminal task tool ended the Pi tool turn but left official follow-up messages
  queued. Pi AgentSession could start new runs for those job-completion notices,
  each rejected by the already-committed result guard. End the official transient
  queue at the durable result boundary, retain job completion receipts, and retire
  only authenticated internal job notices. External input remains in the durable
  admission ledger. The existing business guard remains in force.
- Independent Skill file authorization/materialization was sequential. Bounded
  concurrency preserves the same checks and ordering; failed work is drained
  before retry and no partial snapshot is published. A controlled 12-item fixture with 20ms per authorized
  mapping took 245ms serially and 69ms with four workers, with the same 12 reads;
  that is not a Windows or end-to-end benchmark. This is not a cross-actor
  cache or authorization TTL.
- `message_start` is a stream-start event, not the start of an SDK provider
  invocation. Observe the public stream function invocation separately from
  assistant completions, retaining unknown boundaries rather than counting
  every assistant error as a paid HTTP request. Host phase observation now covers
  Task and Router as well as triage. Nested phase relationships are retained in
  the bounded live activity view; durable performance remains an aggregate, not
  a complete event trace.
- Router instructions clarify source IDs and current-version task action
  contracts. Shell instructions distinguish short foreground checks from real
  background work, and prohibit inferring process exit from fatal-looking output.

## Deliberately not claimed

This patch does **not** prove that the historical 29m35s unexplained interval has
been attributed, or that a real-model end-to-end request has become a particular
number of seconds faster. Historical missing spans cannot be reconstructed from
new code. Resource phases overlap; summing them is not wall time. SDK provider
invocations are not transport dispatches or billable request counts.

Repeated create/deliver/before-run/turn-end refreshes are not removed blindly.
The official SDK snapshots prompt options between turns; delaying an update
without preserving that boundary can publish stale authorization/resources.
The bounded mapping change reduces serialization, not the number of refreshes.

A rotation already in progress can still delay an arriving event. Future work
needs a durable preparation/priority design, not a second owner or bypassing
result assessment. Historical Windows C1083/drain and temporary-directory
failures require that installation's process/ACL evidence; Linux fixtures do not
establish their cause. No sandbox or file-boundary check was removed, and no
process is marked stopped solely because its output contains an error.

## Validation

See the accompanying final test report for exact tested commands and outcomes.
Regression tests exercise actual Pi sessions with scripted local models; no
production-message replay is used. Deployment and real-model/channel timing
comparison remain separate authorized acceptance steps.
