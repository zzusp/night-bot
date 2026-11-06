# Single task Linux boundary validation

`test/task-single-artifact-kernel-native.test.js` uses the actual installed Host,
official Pi runtime and task service through `runtime-official-host`. It does not
install a legacy task Host, Owner, member team or execution facade. The most recent targeted Linux run after the independent FS backend replacement
passed 3/3, with zero skips or cancellations:
`/tmp/night-fs-independent-kernel.tap`. The earlier policy-admission-fix proof is
`/tmp/night-single-artifact-kernel-admitted-final.tap`. The approved outer execution permits
nested UID maps; application bubblewrap remains enabled. Windows was not tested.
These cases include the production policy-admission fix described below. This document does not claim a new kernel run for retiring unchanged legacy tests.
The integration owner replaces the old containment entry with this actual Single
cohort and refreshes generated suite/lifecycle inventories. Package and lockfile
are unchanged in this slice.

## Evidence

- A task writes its original evidence once, closes the Host, and resumes the same
  official session after an explicit trusted Host inspection wake. Cold recovery
  alone invokes no model. Official file writes succeed in work/tmp and fail in
  metadata, materials, outputs, sessions, reviews and a symlink to another task.
  A real Node child reads the original evidence, writes work and task TMPDIR
  markers, then records kernel write denial for those protected targets. It exits
  successfully with its full output, so pretool rejection cannot masquerade as
  the process proof.
- The actual task actor persists its readonly preset before cold shutdown. The
  resumed actor still reports readonly. Its real child emits a startup marker,
  reads the original file, and catches denied writes to work/tmp and Host-owned
  targets. No writable business marker is permitted in this readonly case; a
  successful read and startup output prove execution. A later official file write
  must be rejected by the known readonly policy before a new write intent. The
  task must then submit normal wait, retaining the original write and actual
  child result receipts, without an unknown-effect hold or recovery spin. The updated policy contract passed after the exact-definition pre-effect
  admission fix. Real external failures retain separate unknown-effect tests.
- A completed task is explicitly reopened at the expected revisions in its
  original session. It reads the original result and runs the same actual kernel
  boundary probe. Its own offline portable backup restores at a new installation
  root with the same native session and exactly one original file-write call.
  The restored task remains paused and requires operator review; no model runs,
  and direct unreviewed claim is rejected. The test symlink is removed only after
  its kernel denial is proven, because the independent archive seal correctly
  rejects symlinks. No legacy journal or coordination data is imported.

## Retired test organization: exact six-case mapping

`test/task-artifact-scope-native.test.js` is retired and deleted, not skipped. It
imported a removed split execution driver and a legacy task Host, and generated
historical coordination SQL records. These implementations are not restored to
make the containment list load. No old code copy is retained. The original six
expanded case names are recorded below so deletion cannot imply security
requirements vanished or that six equivalent new cases passed.

| Exact retired case | Current coverage and disposition |
| --- | --- |
| `受信原生完整模式允许原临时Git工作树及MSYS，默认模式保留产物边界` | **Windows validation remains pending**, as specified below. Shared coordination output-root binding is cancelled architecture. The Linux tests do not certify Windows ACLs, Git metadata writes, MSYS children, or full-mode compatibility. |
| `原生Host已授权完整模式在恢复绑定时保留，原生逐次模式与只读模式均不改历史身份` | `Single readonly permission survives cold restore and a real child reads evidence but cannot write work tmp or Host roots` verifies the current official actor's persisted permission, same session, real readonly process, and pre-effect FS refusal. DSH sandbox/mode projections and coordination artifact binding are retired. Restoration of an explicitly authorized Windows full-mode policy is still pending, not inferred from readonly Linux evidence. |
| `official execution artifact binding makes native FS and shell share one root and reject outside writes` | `Single cold continuation keeps official FS and an actually started kernel process within work and tmp` verifies successful FS and actual child writes only in work/tmp, denied metadata/materials/outputs/sessions/reviews and foreign-task symlink escape. Multiple member tasks sharing a coordination artifact root are cancelled. |
| `one Task Owner preserves retained scope across three ordered executions: denyOutside=false` | The cold-continuation case and `Single explicit reopen retains evidence and kernel boundary; own portable archive restores held without replay` verify current task evidence, same official session, one original effect and kernel boundaries across cold/reopen leases. Owner delegation, three execution rows and staged member orchestration are cancelled. No independent-agent review or stage scheduler is claimed. |
| `one Task Owner preserves retained scope across three ordered executions: denyOutside=true` | The same actual Single cases prove denied out-of-bound FS writes and actual child kernel denial. Known policy rejection is now checked **before** a new effect intent, so the old assertion that this refusal itself must create unknown effect state is retired. Real tool failure after an effect still requires an unknown hold: `ordinary tool error after an effect remains unknown and blocks retries, submission and cold replay` in `pi-single-task-official.test.js`, the actual reconciliation E2E cohort, and `unknown old tool effect remains strictly reconcilable after live preserve and disposal without replay` in `task-session-live-supplement-native.test.js` preserve that separate contract. |
| `explicit Task reopen preserves original Owner, retained artifact scope and prior files while old daily dispatch stays retired` | The actual Single explicit-reopen/own-archive case verifies same session, requirement revision increment, original file/effect evidence, backup sealing, restored held state and unreviewed claim refusal. DSH historical coordination import, retained shared Owner root and old daily dispatch migration are cancelled for this new project. Night's own portable backup/restore remains tested. |

All three new cases use one task execution session and actual Pi tools; they do
not silently replace removed Owner/member components with a fake execution
facade. The child emits startup and successful allowed work/tmp markers before
checking write denials. Readonly instead proves child startup plus a successful
original-file read and requires every write to fail. A pretool refusal alone is
never described as a successful kernel test.

## Pending Windows contract and fail-closed boundary

Windows is **not validated** by this Linux cohort. Removing the obsolete fixture
is not permission to weaken any of the following requirements:

1. A real Windows restricted-token/ACL process must prove workspace/task work and
   tmp writes while rejecting cross-task paths and Host-owned task directories,
   including alias/junction/symlink paths. Missing ACL capability must fail closed.
2. After a cold Host restart, the same official task/session must retain its
   authenticated permission policy, without model-driven escalation or changed
   task identity. Readonly and any explicitly Host-authorized full mode need
   separate actual Windows evidence.
3. Real Git worktree/index metadata writes and an actual Git/MSYS helper process
   need default-policy rejection and an explicitly authorized successful path,
   with exact command completion/process drain. A POSIX child is not a substitute.
   The retired coordination-root/legacy-session setup is not the required API.
4. Failure to initialize the applicable Windows containment/portable privacy
   capability must return a capability/runner failure and must never retry the
   command unconfined or silently promote to full mode. Current native sandbox
   code reports `SANDBOX_UNAVAILABLE` for an absent ACL runner; portable process
   privacy also rejects when its required isolation mechanism is unavailable.
   Restricted Windows ACL enforcement is described as partial, not certified
   full containment. This is a source-level boundary description, not a passing
   Windows execution result or a claim that the runner supports every scenario.

A future supported Windows Single test must use the actual official Host and
current task interfaces. It must not resurrect `execution_submit`,
`task_delegate`, a legacy `Session` projection or historical coordination data.
Until then these requirements are pending acceptance and Windows/MSYS/full-mode
support must not be reported as validated.

## Other containment contracts

The two former Node PTC/RPC worker cases in `native-tools-runtime.test.js` are not
replaced by these three cases: isolated Node worker environment, nested exact
RPC dispatch and union validation differ from FS/bash isolation. Their current
component/product disposition belongs to the integration owner; this slice does
not retire them as covered. Runtime capacity, cancellation/drain and unknown-effect
operator reconciliation have independent tests, not extra implied passes here.
Historical evidence files remain historical and may refer to the retired test;
they are not current acceptance results.
