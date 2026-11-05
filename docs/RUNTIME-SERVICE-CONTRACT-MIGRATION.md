# Runtime service contract migration

The service tests exercise the installed official Pi Host and one execution
session per task. They do not reconstruct an Owner/member/execution facade.
The service cohort contains 45 current contracts. Final joint runtime validation is recorded separately from the targeted results below.

## Retired architecture assertions

- The 180-message DSH Host event/projection retirement fixture required the old
  Session/event/surface model. No old DSH journal import or compatibility fold is
  provided. Current Pi compaction and physical-journal evidence are exercised by
  the 32-continuation test using official SDK components.
- A split executor's `onNativeExecution` DWS callback is not recreated. The
  optional DWS observer keeps its domain parsing tests, and the real service
  tests frozen file sends, exact status identity, early echoes and restart
  readback. Single does not automatically trace arbitrary model DWS shell calls.
- Named resource/member-slot orchestration had only the cancelled delegation
  entry. No independent Single resource-acquisition API is claimed. Actual
  task-session queue capacity is tested independently.
- Eleven members, a separate Owner, cross-execution handoff and independent agent
  review are cancelled product structures. The retained goals are actual output
  generation/readback, sole-session authority, task concurrency, frozen output
  integrity and version fencing. A same-session readback is not described as an
  independent agent review.

## Retained boundaries

The tests retain authenticated source/version links; source identity across SQL,
Host materials and native admission; explicit preserve/replan/cancel meaning;
source replay conflicts; one task/session across continuations and cold restart;
actual process cancellation and provider-range joins; unknown effects held with
no replay; file freeze and remaining outbound delivery; persisted readback
cooldowns and own-echo filtering; task capacity; failed startup/claim cleanup and
alerts; and model failures that cannot spin through Host retries.

A final response without task_result is a technical wait. Recovery retains the
original evidence and does not invent a provider retry. A separate trusted Host
wake or explicit new source can resume the original task. Official SDK retry
settings continue to govern actual provider retries.

The business source DTO excludes only SQL processing telemetry (`stages`). SQL
and source material diagnostics remain intact; user text and source authority
are retained. Pi owns the model history, compaction and projection. Test token
usage uses the SDK's public estimateTokens function rather than a custom
history projection or tokenizer. The scripted summary response is returned to
Pi's native summarizer; Pi creates the compaction entry itself.

## Validation limits

The actual process probe requires the approved outer execution mode that permits
nested UID maps; application bubblewrap remains enabled. This does not prove
Windows containment or real vendor delivery. Unknown or failed range proofs do
not become successful drain evidence. A failed drain remains held. Single does not promise the retired SQL execution-row automatic drain re-observation/retry API.

## Exact legacy lifecycle case mapping

- `running reminder and coordinator clarification preserve one native shell job with received and consumed receipts` is retired with `execution.feedback`. Its current contract is `live preserve retains the exact SDK and original background producer, consumes exact source once` in `test/task-session-live-supplement-native.test.js`, using actual Single/Pi steering.
- `native completion race drains then resumes the original execution without replaying its shell effect` is retired with the split execution facade. `a TaskResult generated before preserve cannot consume the newly arrived source` in the same live-supplement file proves the current source-version completion fence.
- `same-host recovery drains the original native process without replaying an unknown operation` depended on the removed `execution.drained` commit/retry API. Current service cases `official service recovery no-op preserves an undrained task writer conflict alert`, `official service unknown post-write effects remain held and release only the physically drained writer`, and `official service cancellation stops the actual owned process, drains its original session and fences late success` cover safe hold and real cancellation. They do not claim automatic failed-drain re-observation. The live-supplement case `unknown old tool effect remains strictly reconcilable after live preserve and disposal without replay` additionally retains unknown-effect reconciliation.

These cases were removed rather than skipped; no legacy execution facade or historical journal migration was added.

The invalid-summary cases exercise one official correction followed by either a valid submission or a normal final stop. They do not prove a global bound on an indefinitely malformed tool-call stream. Locked Pi agent-core exposes `finishTurn`, but this service does not configure a turn/step budget; no DSH three-correction loop is recreated. Provider retry and invalid-tool correction are separate limits.

## Targeted validation

- Full service file, approved outer mode with application bubblewrap retained: 45 tests, 43 passed, 2 failed, no skips/cancellations; 137 seconds (`/tmp/night-runtime-service-final-cohort.tap`).
- Both failures queried a transient dialogue alert after recovery had cleared that alert. The corrected assertions require durable `task.technicalFailure` and `lastDecision.technicalFailure` to retain `TASK_PI_PROVIDER_ERROR`, and no Host provider-retry timer. Both corrected cases passed (`/tmp/night-runtime-service-provider-durable-final.tap`, 2/2). This is not reported as a single all-green full run; the parent performs the final joint runtime regression.
- The full run includes real kernel-owned process cancellation, 32 leases with official compaction, source identity, notification-to-Topic-fact/command binding, eleven outputs with actual readback, capacity and context version fences. The shared official transport fixture is frozen.
