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
Router for investigation while retaining the actual owner and its execution fence. Human, external-event and scheduled waits remain on existing source/dependency/
native schedule admission paths. A current wait/blocked decision becomes eligible
for an advisory Router review after 24 hours, including unresolved user questions
and agreed instants still in the future. Age never creates an execution wake.

`task.inspect` checks requirement/control/context revisions and the execution
lease in the SQLite transaction. One pending incident per lease and requirement /
control revision is stored on the task. The existing `dynamic_task_events` and
Router inbox retain its compact objective, progress, limitations, evidence class
and remaining work; task archives use their existing ledger snapshot machinery.
No extra database, log directory or model decision entry point is introduced.
The current task, journal and effect receipts remain authoritative.

An execution incident holds automatic task claim until an explicit, current-version
Router scheduling action, an existing trusted Host explicit-continuation wake,
or actual new input invalidates that older version. Generic inspection and
ordinary wakes do not grant continuation. A
24-hour waiting review is advisory and never holds legitimate source/schedule
admission. Settling an execution incident can mean continuing to wait and does not clear
its execution hold. A current `wait-overdue` event requires an `inspectionReviews`
disposition in the existing `resident_router_settle` tool: inspection key, current
requirement/control/context revisions, decision, concrete reason and nextCheckAt.
The next check must be at least one hour away; normally it is a day later or an
appropriate agreed time. This records a decision but never starts execution or
sends a message. A pending review is not re-enqueued every five minutes. Its
identity, decision and next check survive restart; a new wait identity or actual
input/control change invalidates the old review. Stale events can be consumed
without overwriting the new state. A later Router action uses the existing task/session
identity, source provenance, dependency, cancellation and no-replay fences.
Unknown sends, jobs and mutations require existing readback/reconciliation; neither
inspection nor drain establishes external success or permits replay.

Router recovery skips conversations already in flight. Inspection runs before
the recovery single-flight join, so a busy Router cannot stop later scans from
recording other incidents. A failed inbox attempt
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
does not terminate it. Absence from the in-memory registry also does not prove a
writer or external producer drained: inspection never fabricates drain. Existing
restart/drain-proof paths retain that authority. Session creation that fails
before successful binding retains the existing known-not-started backoff path. Legacy tasks without a conversation retain their existing
recovery/operator path. External vendor integration and Windows execution
containment require separate environment validation. All runtime state remains
under the installation's existing data/state, task workspaces and Pi journals.

## Initial validation checkpoint (2026-11-18, Linux / Node 24.19.0)

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
- Final busy-Router integration: passed. A second orphaned execution is recorded
  and fenced while the original Router model request is deliberately held; after
  release, its durable event is processed without starting the orphan.
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


## Final follow-up acceptance (2026-11-18)

This supersedes the initial checkpoint's unresolved runtime status. The final
production code is `8eba731`; the subsequent documentation-only commit does not
change that tested implementation. Base remains the unmodified
`906e1e4685eaf8c8cba00ccd71793b31f931ab3e` worktree with its own frozen install.

Acceptance required a terminal result for the complete runtime cohort, comparison
of failures with main, correction of PR regressions, and durable 24-hour waiting
review evidence without automatic execution or repeated five-minute dispatch.

| Version / check | Result | Duration |
| --- | --- | --- |
| Unmodified main `906e1e4`, full runtime | 162 passed, 0 failed, 0 skipped, exit 0 | 266.6 s |
| Intermediate PR `cb8aef5`, full runtime | 158 passed, 4 failed | 267.0 s |
| Fixed PR `8eba731`, full runtime | **162 passed, 0 failed, 0 cancelled, 0 skipped, exit 0** | 242.9 s |
| Fixed PR, Router ledger / task E2E / model-input / business-failure cohort | 63 passed, 0 failed, 0 skipped | 27.5 s |
| Source/hash/import/native guards and diff check | Passed | — |

The complete runtime command was
`NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:runtime`, with an outer 480-second observation
bound (not reached). Both complete comparison runs used approved executor access
so the tests' own bubblewrap could operate, as AGENTS.md permits. The application
sandbox, assertions, retry budgets and lifecycle deadlines were unchanged. The
restricted executor's shell/job failures and incomplete old mixed-checkpoint
processes are not treated as final product results; those owned processes were
stopped before these committed-version runs.

Regression findings and fixes:

- A pending execution inspection incorrectly blocked actual newer authenticated
  inputs. Inspection now binds requirement/control/context revisions, and a new
  version invalidates the old hold; stale technical decisions cannot re-hold the
  new input. The provider and execution-provider recovery scenarios pass in the
  final full run.
- Session construction failure had been treated as an execution failure before
  there was a successfully bound session. Execution-start evidence now comes from
  the successful native binding callback; known-not-started setup failures retain
  the existing backoff. Both persistent and recoverable setup scenarios pass.
- The existing trusted `host.explicit-continuation` wake was incorrectly blocked
  by the old hold. It now resolves that hold without inventing a new input or
  replaying an effect; generic wakes still cannot bypass it. The original completed
  effect is read back once and is not rewritten.
- Missing registry handles had incorrectly caused inspection to mark an undrained
  writer drained, losing its conflict alert. Inspection now records the anomaly
  without fabricating drain; existing restart/drain-proof paths remain authoritative.
  The live-writer conflict scenario and its original alert survive recovery.

The new waiting tests cover user questions, external events and agreed future
instants. They verify the 24-hour boundary, pending-event deduplication, Router
reason/next-check recording, refusal of five-minute rechecks, next-due eligibility,
cold restart, newer source/context changes, pause/cancellation and stale review
rejection. Actual Host/Pi tests preserve the original execution lease and wait
start, do not send another question or execute the task, and restore the recorded
next check after restart. Legacy waits use the admitted claim context when their
old decision lacks the newly explicit contextRevision.

Remaining evidence boundaries: the 24-hour threshold uses controlled clock
advancement plus real cold restart, not a 24-hour wall-clock soak. A live internally
stuck tool is not declared dead from silence. Unknown external effects and
unproven drain still require their existing proofs/readback. These runtime results
do not certify the full default/routing/containment cohorts, Windows or real vendor
channels. No real channel message, local deployment, merge or manual CI run was
performed. The PR remains draft.
