# Task inspection and Router recovery

The existing application recovery tick (default 5 seconds) continues to recover
notifications, schedules and durable queues. `resident.taskSessions.inspectionIntervalMs`
(default 300000, integer 1000–2147483647) bounds the task inspection scan. Startup
runs the first scan immediately. A stopped execution also records an incident
immediately after its lifecycle finalizer. There is no inspection model/session.

Inspection acts only on positive evidence: an absent execution owner, process
restart, failed drain, technical failure or an unresolved native-effect hold.
A live agent, Pi authority owner or tracked execution is never considered stalled
because of its age or lack of output. A recorded drain failure can be sent to
Router for investigation while retaining the actual owner and its execution fence. Human, external-event and scheduled waits
remain on existing source/dependency/native schedule admission paths. Unchanged
normal waits do not generate events.

`task.inspect` checks requirement/control/context revisions and the execution
lease in the SQLite transaction. One pending incident per lease and requirement /
control revision is stored on the task. The existing `dynamic_task_events` and
Router inbox retain its compact objective, progress, limitations, evidence class
and remaining work; task archives use their existing ledger snapshot machinery.
No extra database, log directory or model decision entry point is introduced.
The current task, journal and effect receipts remain authoritative.

An incident holds automatic task claim until an explicit, current-version Router
scheduling action. Settling its inbox event can mean continuing to wait; it does
not clear the execution hold. A later Router action uses the existing task/session
identity, source provenance, dependency, cancellation and no-replay fences.
Unknown sends, jobs and mutations require existing readback/reconciliation; neither
inspection nor drain establishes external success or permits replay.

Router recovery skips conversations already in flight. A failed inbox attempt
retains its events and persists the batch identity, attempt count and retry time
on the existing conversation record. Automatic recovery uses 5-second and
30-second backoff, then a 5-minute cooling period after the third failure before
a new bounded burst. New input identities can be processed independently of an
older batch's cooldown. Native batch checks still decide whether an actual model continuation is safe;
retry eligibility never bypasses those checks. A batch with pending inspection
events may continue a stopped/failed native turn through the existing Host
continuation path. Ordinary message batches retain explicit Host recovery.
Legacy committed generation handoffs keep their existing recovery/error contract.

Boundaries: inspection cannot prove a live but internally stuck tool is dead and
does not terminate it. Legacy tasks without a conversation retain their existing
recovery/operator path. External vendor integration and Windows execution
containment require separate environment validation. All runtime state remains
under the installation's existing data/state, task workspaces and Pi journals.

## Validation (2026-11-18, Linux / Node 24.19.0)

Base: `906e1e4685eaf8c8cba00ccd71793b31f931ab3e` (latest main when fetched).
No local installation, live channel messages, merge, deployment or manual CI run.
No applicable `.agents/skills` directory was present in this checkout/workspace.

- `pnpm check` and `git diff --check`: passed, including source/hash, production
  import and native runtime guards.
- Focused config / Router ledger / model input / business failure run: 83 passed
  at its checkpoint (the subsequently removed unrelated recovery-interval check
  is not part of the final change).
- Combined Router ledger, model input, business failures and real Host/Pi Router
  task tests: 55 passed at its checkpoint.
- Final inspection/config scenarios: 7 passed. Includes cold-restart incident
  persistence, stale-version rejection, repeat scans, paused/cancelled and normal
  live-tool exclusion, durable retry budget, same-session continuation, Router
  provider outage, and a Router wait decision surviving cold restart without
  another execution.
- Original generation handoff crash windows: both passed after preserving legacy
  error propagation. Interrupted original-settle retry: passed. Material preparation
  failure: passed after retaining the existing known-not-started retry path.
- The DWS timeout deferral test now explicitly waits for its live health projection
  after the durable checkpoint; the focused test passed. Its exact count, source,
  isolation and cold-recovery assertions remain intact.
- A representative actual official runtime read-only web failure test passed.
- Broad `pnpm test:routing` initial checkpoint: 196/200 passed. Its four failures
  identified the handoff/error-propagation and material retry regressions above;
  those scenarios were corrected and individually rerun successfully. This is not
  a claim that the entire final routing cohort was rerun.
- Broad `pnpm test` was launched; search and job-operator fixtures fail. The two
  packaged-ripgrep scenarios and the missing `work/readback.txt` job fixture failure
  were reproduced on a separate clean `906e1e4` worktree with its own frozen
  dependency install. They are not certified passing in this environment.
- Broad `pnpm test:runtime` was launched but had not produced a final cohort result
  at the evidence checkpoint. No full-green claim is made for either broad suite.
  Containment and real Windows/vendor tests were not certified by this change.
