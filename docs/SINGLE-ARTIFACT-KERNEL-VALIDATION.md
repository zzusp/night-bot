# Single task Linux boundary validation

`test/task-single-artifact-kernel-native.test.js` uses the actual installed Host,
official Pi runtime and task service through `runtime-official-host`. It does not
install a legacy task Host, Owner, member team or execution facade. The targeted
Linux run passed 3/3, with zero skips or cancellations, in 7.14 seconds after the policy-admission fix:
`/tmp/night-single-artifact-kernel-admitted-final.tap`. The approved outer execution permits
nested UID maps; application bubblewrap remains enabled. Windows was not tested.
These cases include the production policy-admission fix described below. Package, lockfile and existing containment suite list remain unchanged.

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

## Exact legacy mapping and limits

The six cases in `task-artifact-scope-native.test.js` and the two cases in
`native-tools-runtime.test.js` remain unchanged pending the parent's final suite
migration. None should be described as passing through the new fixture.

| Legacy case/location | Current evidence and remaining boundary |
| --- | --- |
| Windows Git worktree/MSYS full-mode case, line 40 | Not replaced: Windows process/ACL and trusted Git/MSYS behavior remain unverified. Do not retire this security contract as covered by Linux. |
| Permission recovery/readonly binding, line 91 | New cold readonly case covers actual official permission persistence and kernel enforcement. Old full-mode identity/artifact binding ABI is retired architecture; Linux readonly evidence does not prove Windows/full-mode equivalence. |
| Shared multi-member artifact-root FS/shell case, line 144 | New cold continuation case proves a single task's official FS and real shell boundaries. It does not recreate or validate cancelled shared coordination artifact roots. |
| Three Owner/execution stages, two cases at line 245 | New cold continuation and reopen cases prove retained task evidence, one original effect and actual kernel boundaries across leases. Team/child execution rows and retained legacy coordination fixtures are not a current product contract. |
| Original Owner/legacy coordination reopen, line 343 | New explicit reopen and own portable archive restore cover current task/session identity, retained evidence, held restore and no original-effect replay. Old plugin upgrade/daily-dispatch migration is not implemented. |
| Two Node PTC/RPC worker cases in native-tools-runtime | Not replaced: isolated Node RPC worker environment, nested tool dispatch and exact RPC union validation are distinct from bash/FS containment. An official component/product decision is still required before their contract can retire. |

Only the cancelled Owner/member/coordination fixture assertions can retire on
architecture grounds after this mapping is accepted. Existing Windows and PTC
security contracts must remain explicitly pending, rather than silently removed
or counted as Linux verification. Runtime capacity, cancellation/drain and
unknown-effect operator reconciliation have separate tests and are not claimed
as extra coverage of these three kernel cases.
