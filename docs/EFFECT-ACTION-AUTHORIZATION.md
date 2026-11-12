# A new action after effect reconciliation

Closing an uncertain attempt records possible partial effects and leaves the task
paused. It never grants permission to replay that official tool invocation.

The private operator credential protects a separate Host-only endpoint:
`POST /tasks/:taskId/effects/new-action`. The equivalent CLI is:

```
node bin/night-bot-effects.js CONFIG new-action AUTHORIZATION.json --operator-text-file NOTE.txt
```

The strict authorization JSON contains `taskId`, a unique `requestId`, the exact
complete `closedIntentEntryIds` array, a nonempty new `objective`, and the current
task's `expectedRequirementRevision` and `expectedControlRevision`. The separate
note is the real operator's explanation. It is recorded as an authenticated web
source under the configured web actor; a model cannot supply an actor or grant.
The credential never becomes source text, a model message, or task state.

The Host holds task admission and the real native writer while verifying the
committed SQL closures against their exact official journal entries, digests,
original calls, inputs and admissions. The standing scope must still match every
closure. The task must be drained with no live owner. If ordinary routing has
left it active, the Host first pauses it after all these checks, using a durable
command whose identity also binds the complete proposal and operator note digest.
It then records the operator source, revises the task while paused, and activates it. These steps have deterministic command identities. An interruption
after pause, source or revision remains paused; resubmitting the identical authorization
completes the remaining steps without adding another revision. The proposal keeps
the pre-pause control revision; retries read the exact pause receipt rather than
pausing twice or guessing the revision. A changed replay
body is rejected. Activation acknowledges an explicitly requested continuation;
this is not a distributed transaction across arbitrary external effects.

A later effect call is admitted only when its actual official input is after all
closure receipts, its requirement revision is newer than each closure's revision,
and its real admitted source matches the authenticated SQL operator source and
the committed revision/activation receipts. Bare unpause, a new lease, a new call
ID, or model-supplied text is insufficient. A distinct authorized invocation may
use the same arguments; the old closed invocation remains permanently blocked.
This authorization does not expand filesystem, channel, memory, process or
approval capabilities, and it does not claim earlier partial effects were undone.

`test/pi-task-effect-action-e2e.test.js` exercises actual Host tool effects,
private HTTP/CLI authentication, same-argument distinct invocation, rejected
model-initiated authorization, paused and drained-active entry,
pause/source/revision/activation-response crash cuts, cold service recovery,
and idempotent replay of the operator request. Kernel isolation and real vendor
delivery are validated separately.

Validation: the new five actual-Host action cases, five private operator/HTTP/application cases and three reconciliation crash cases passed together (13/13, no skips or cancellations), recorded in `/tmp/night-effect-action-joint-activate-final.tap`. This is targeted validation; full application/runtime and platform isolation regression is coordinated separately.

If activation commits but its response is lost, the task is already explicitly authorized and active. Task admission cleanup immediately scans the durable SQLite queue, so the action does not depend on a periodic recovery timer or a fresh wake. Identical same-process operator retries return the original authorization receipt and cannot repeat an acknowledged action.
