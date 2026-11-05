# Official Pi default runtime checkpoint

Checkpoint: `d31d117`. This is not a completed removal of all DSH-derived code.
No push, deployment or main merge has been performed.

The default Host uses public Pi 1.5.0 AgentSession and SessionManager for inference,
history, messages, context, queues, retries, branches and compaction. Night owns
source authorization, task state, permissions, durable effect receipts, channels,
resource budgets and shutdown ownership. No legacy Host LLM or child/delegation
service is mounted. User-cancelled subagent product architecture was retired,
with independent ownership, privacy, archive and drain safeguards preserved.

## Verified integration

- `pnpm test`: 1117 passed, zero failed/cancelled; source/import guards passed.
- `pnpm test:domain`: 391 passed. `pnpm test:routing`: 47 passed.
- Effect reconciliation core/native-store/real Host recovery: 44 passed.
- Operator HTTP/CLI/default application/privacy/backup: 5 passed. A separate
  actual Linux model-process credential probe: 1 passed, application bwrap kept.
- Official skill input/source/queue/revocation/cancellation: 23 passed.
- Official names, default Host binding, pinning/cold recovery and metadata drain:
  14 passed. Automatic naming defaults off; explicit opt-in sends approved labels
  only, with no main conversation or tool bodies.
- Frozen installation previously passed: 621 entries; direct DSH development
  declarations remain 36, production declarations and external runtime imports 0.

Counts overlap. Summary files and full-log digests are recorded in
pi-default-checkpoint-evidence.json. The latest full test includes the branch-cut
reconciliation fix and tracked naming reads. The later lifecycle-listener fix was
separately checked by jobs ledger/tools (5 passed) and the actual four-lease-epoch
single-task listener regression. No Windows kernel claim is made.

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

`pnpm test:runtime` is not passing: 32 passed, 123 failed. These 155 tests still
largely construct old PiLoop/Owner/delegation fixtures; failures include explicit
PI_SKILL_OBSERVATION_PORT_REQUIRED. Retained human-review, notification, recovery,
model selection, cancellation and no-replay contracts must be ported to actual
single-task official sessions. Do not hide them by dropping the group.

The file-tool replacement remains an unmounted prototype; default file tools and
some process/platform components remain attributed derivations. Official Pi
read buffers full files; a separately named bounded read_window has prototype
coverage but still needs real NativeTools registration, exact pre-effect checks,
resource budgets and lifecycle/IO joins before switching production defaults.
New resource limits and public path/edits[] schemas are behavior changes requiring
explicit documentation. A passing prototype does not prove default Host wiring.

Some legacy source aliases, manager modules and test copies remain. Their DSH
notices stay until all corresponding retained code and copies are removed.
Portable non-Linux process privacy fails closed; Windows kernel isolation and
real external provider/vendor effects have not been newly validated here.
