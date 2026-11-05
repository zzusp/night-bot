# Task input and native retry boundary

The default single-task runtime uses Pi 1.5.0 public AgentSession input queues,
steer delivery, SessionManager branches and native retry settings. Night owns
source authentication, task revisions, permissions and durable effect receipts.

Initial task context is retained in the authenticated source/material and the
actual native task input. Missing or foreign source references fail before task
creation. Tasks without Topic references do not invent Topic facts; actual Topic
references still require their normal scope and version checks.

## Preserve inputs

The existing `progressImpact: preserve` entry retains the objective and authority.
While a normal task is active, it keeps the same actor, AgentSession, lease and
owned background producer. It sends a typed packet through official Pi steer.
Only a committed native admission permits the SQL revision/precise wake ACK to
advance. A previous assistant turn cannot submit a result for unseen context.
Read-only dialogue and human-review runs cannot use this live continuation.

Effect origin comes from the actual official assistant/tool-call branch and its
authenticated admitted input. The mutable latest task revision is not the origin.
Equal tool names and arguments alone do not prove replay: an authenticated new
input can deliberately request the same operation. Invocation identity, source
authority and explicit continuation/replay relationships must distinguish those
cases. Unknown and operator-reconciled effects retain their stricter no-replay
fences. The cross-context same-arguments proposal was withdrawn rather than
silently preventing intentional repeated work.

The older effect key still groups equal arguments within one admitted task
context. Thus intentional repeated calls within that very same input can still
be refused; this stage does not claim to resolve that existing limitation.
Any later change must identify the actual committed call (`callEntryId/callId`),
its admitted source (`packetId/inputEntryId`) and a trusted replay/continuation
relationship. A model-provided replacement identity is insufficient. Existing
operator no-replay commitments must not be weakened during that change.
The existing reconciled-effect fence also blocks matching tool/arguments in later
contexts. Distinguishing a newly authorized independent action from the original
closed effect remains part of that identity work; it is not claimed as solved by
the successful-effect/new-source counterexample.

An owner spanning several admitted inputs emits one scope-limited drain proof
covering exact original intent identities. It does not fabricate multiple owner
joins or change the original bindings. A restart repairs only already committed
native admission facts into SQL; it never redelivers input or invokes a model to
repair that crash window. Proofs cover registered owned-provider ranges, not
arbitrary external processes or kernel-wide quiescence.

## Retry behavior

The former Night task recovery timer used 5s, 10s, 20s, 10m, 30m and 1h delays.
It could start another run after Pi exhausted its budget and thereby reset that
budget. The official single-task path no longer creates that timer or classifies
provider errors using the old DSH policy. An exhausted native error or final
response without task_result becomes a technical wait. Dialogue records an
explicit reply failure; human review retains its pending evidence and failure.
Recovery alone does not resume the model. A new explicit source or trusted Host
wake can resume the task under its existing authorization and effect fences.

Provider profiles accept `retry.enabled`, `maxRetries`, `baseDelayMs`,
`maxAgentDelayMs` and `provider.{timeoutMs,maxRetries,maxRetryDelayMs}`. Defaults
are read through public SettingsManager: enabled, 3 agent retries, 2000ms base
delay, 60000ms maximum agent delay and 60000ms provider retry-delay ceiling.
Provider and agent retry layers are distinct native Pi settings. Old
retryableCodes/backoff/jitter settings are rejected rather than translated.

Night's own older persisted providerRecovery records are retained as held
diagnostic evidence with their automatic retry disabled. This is Night state
upgrade support, not DSH data import. Prepared reconciliation and unknown effects
remain held. No retry configuration authorizes replay of an attempted effect.

## Tool permissions and scope

Observational exemptions bind the exact installed capability, not its name.
Replacing a read tool with an effectful registration cannot inherit its exemption
or bypass read-only review. Execution sessions cannot inherit coordinator,
delegation or scheduling tools. Official file capabilities retain their private
identity markers and normal preflight checks; see PI-FILE-TOOLS.md.

Named-resource/member-slot orchestration has only the cancelled delegation
entry and legacy tests in the inspected tree. No independent current Single
entry or explicit product requirement was found, so no replacement was added.
Task queue capacity remains separate and is retained.
