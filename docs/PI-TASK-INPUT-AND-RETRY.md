# Task input and native retry boundary

The default single-task runtime uses Pi 1.5.0 public AgentSession input queues,
steer delivery, SessionManager branches and native retry settings. Night owns
source authentication, task revisions, permissions and durable effect receipts.

Initial task context is retained in the authenticated source/material and the
actual native task input. Missing or foreign source references fail before task
creation. Router actions bind tasks directly to authenticated source versions,
authors and exact quotes. Topic fields retained in old archives are audit evidence,
not an active routing or authorization path; handoff summaries cannot supply a
missing source or grant permissions. Dependencies are checked at scheduling and
claim, separately from ordinary task pause/control state. See CHANNELS.md.

## Preserve inputs

The existing `progressImpact: preserve` entry retains the objective and authority.
While a normal task is active, it keeps the same actor, AgentSession, lease and
owned background producer. It sends a typed packet through official Pi steer.
Only a committed native admission permits the SQL revision/precise wake ACK to
advance. A previous assistant turn cannot submit a result for unseen context.
Read-only dialogue and human-review runs cannot use this live continuation.

Effect origin comes from the actual official assistant/tool-call branch and its
authenticated admitted input. The mutable latest task revision is not the origin.
Equal tool names and arguments alone do not prove replay. New v2 attempts bind
the actual official session, assistant entry and call ID, plus the exact admitted
input entry, packet digest and original task binding. Two independently requested
calls in one input may use identical arguments. Re-entering the same execution
sequentially or concurrently shares its original body result and never executes
that body again. Native provider retry does not create another body attempt.

Night's earlier v1 receipts are read without rewriting history: the original full
key and verified official input must identify exactly one call. Provider call-ID
reuse across distinct inputs is supported when that proof is unique; genuinely
ambiguous old records remain held. This is Night upgrade support, not DSH import.

Unknown effects still hold execution until reconciliation. After closure, a new
call ID, lease or bare unpause cannot authorize effects or declare the old partial
outcome successful. A separately authenticated operator may authorize a new
objective referencing the exact set of closed intents; this produces a new
business source and requirement revision under unchanged permissions. Only calls
following that actual admitted grant may perform the new work or complete it.
The original closed invocation remains permanently blocked. See
EFFECT-ACTION-AUTHORIZATION.md for the private HTTP/CLI entry and crash boundaries.

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
