# Official Pi default runtime checkpoint

Checkpoint: `4568d3f` (following official file/tool wiring at `1cc6ebf`).
This is not a completed removal of all DSH-derived code.
No push, deployment or main merge has been performed.

The default Host uses public Pi 1.5.0 AgentSession and SessionManager for inference,
history, messages, context, queues, retries, branches and compaction. Night owns
source authorization, task state, permissions, durable effect receipts, channels,
resource budgets and shutdown ownership. No legacy Host LLM or child/delegation
service is mounted. User-cancelled subagent product architecture was retired,
with independent ownership, privacy, archive and drain safeguards preserved.

## Verified integration

- Final stable `pnpm test`: 1173 passed, zero failures/cancellations; all
  source/import guards passed (421 runtime modules, zero external DSH imports).
- `pnpm test:domain`: 391 passed. `pnpm test:routing`: 47 passed.
- Current effect reconciliation core/real Host recovery: 44 passed.
- Current priority file/task/permission/state cohort: 60 passed; domain: 391.
- Actual live preserve SDK/actor/lease/producer and unknown-effect closure:
  3 passed with application bwrap kept, using the approved outer execution mode.
- Intentional repeated action under a new authenticated source versus duplicate
  request/cold recovery/unknown effect: 2 passed. Startup cleanup: 7 passed.
- Native provider retry and task/review/dialogue recovery cohort: 35 passed;
  business ledger regression: 168 passed. Counts overlap.
- Operator HTTP/CLI/default application/privacy/backup: 5 passed. A separate
  actual Linux model-process credential probe: 1 passed, application bwrap kept.
- Official skill input/source/queue/revocation/cancellation: 23 passed.
- Official names, default Host binding, pinning/cold recovery and metadata drain:
  14 passed. Automatic naming defaults off; explicit opt-in sends approved labels
  only, with no main conversation or tool bodies.
- Frozen installation previously passed: 621 entries; direct DSH development
  declarations remain 36, production declarations and external runtime imports 0.

Counts overlap. pi-default-checkpoint-evidence.json records source checkpoints,
summary files and full-log hashes; older entries retain their own checkpoint
rather than being presented as new verification. No Windows kernel claim is made.

## Unknown effects

Actual SDK/tool/process/job joins issue a scope-limited drain attestation. The
operator entry requires an independently private capability and configured web
actor. It verifies original official call/input/arguments, current committed
branch and scope, and Host-owned readback evidence. Closure records possible
partial effects, leaves the task paused and permanently forbids replay of the
original tool/arguments. Prepared SQL holds and native receipt/SQL projection
crash windows are tested with zero recovery model/effect dispatches.
See EFFECT-RECONCILIATION.md for the exact operator flow and proof limits.

## Remaining migration and failed checks

The last complete runtime diagnostic was 32 passed, 123 failed, using old
PiLoop/Owner/delegation fixtures. Follow/model, human, jobs, skills, progress and
provider cohorts have since moved to actual official Single sessions. The service
cohort is still being finalized, so no whole-runtime passing result is claimed.
See RUNTIME-SERVICE-CONTRACT-MIGRATION.md for retained contracts and explicit
retirement of cancelled structures.

Default file tools now mount public Pi read/write/edit and an independently
bounded read_window through the actual NativeTools registry. Exact capability
identity, mutation preflight, actor-scoped resource budgets, awaited IO joins and
default Host wiring are tested. Read buffering/window limits and public
path/edits[] schemas are explicit behavior changes documented in PI-FILE-TOOLS.md.
The file cohort passed 51 tests and separate actual Linux boundary checks passed
9; some process/platform components and old fixture file-tool code remain derived.

Task context and preserve delivery now retain real authenticated source and use
the same official AgentSession steer queue. Night no longer restarts its own
provider retry budget after native exhaustion. Unknown effects retain strict
original-input drain/closure proofs. See PI-TASK-INPUT-AND-RETRY.md, including the
existing same-input intentional-repeat limitation; equal arguments across new
authenticated sources are not globally deduplicated.

Some legacy source aliases, manager modules and test copies remain. Their DSH
notices stay until all corresponding retained code and copies are removed.
Portable non-Linux process privacy fails closed; Windows kernel isolation and
real external provider/vendor effects have not been newly validated here.
