# Validation (2026-11-12)

Local Linux/scripted-model checks; no real channels, provider billing, deployment,
production migration or Computer Use.

- Routing cohort: **98 passed, 0 failed, 0 skipped**, 221.6s. This is the final
  resource-retry implementation, including the retrospective publication race.
- Integrated observation/admission/resource tests: **71 passed**. Additional
  shell/job/process lifecycle regression: **25 passed** (sets may overlap).
- Terminal single-session regression: **9 passed**, including thirteen queued
  completion notices, late/duplicate notices, cold reopen, and wait/new lease.
- Actual Router handoff regression fails on base `569a6dc` (generation advances
  while its task is active), passes with the fix; the completion is admitted in
  the original generation, followed by normal durable rotation.
- Runtime cohort on base and changed tree: **162 tests, 156 passed, 5 failed,
  1 cancelled** on both. This runtime run preceded the final resource retry-only correction;
  that correction was subsequently covered by the full routing and focused
  resource suites. Same six reported scenarios: provider failure during
  human review; unknown-effect readback; requester-only reopen; and three
  historical-context/live-supplement variants. These are not claimed fixed.
- Source/hash accounting, production imports and native-runtime guards pass.
  Commands were run as the exact Node scripts because the pnpm launcher tried
  to create an unavailable home package-manager directory.

The initial integrated routing run found an actual new cross-actor resource
revision-invalidation race (97/98). It was fixed, not waived: if another actor
has already invalidated the catalog revision, retry the fresh catalog without
invalidating it again. Final routing is 98/98.

Two old scripted fixtures repeated mutating tools forever after an unknown
side-effect was held. Both reproduce on the base. Their cold-recovery script now
uses the supported read-only investigation + wait contract, retaining the single
effect, unresolved receipt, original journal-prefix/material and no-replay
assertions. `pi-single-task-official` and `pi-task-material-backup` pass (9 and 2).

The default cohort and remaining limits are recorded below; focused results are
not substitutes for a full green run. The unrelated legacy
`performance-runtime.test.js` still imports the removed `openResidentRuntime`
export and is not included as a passing check. Windows containment and the
historical compiler/drain incident require independent local evidence.

Final default cohort: **1,656 tests, 1,629 passed, 4 failed, 23 skipped,
0 cancelled**, 327.1s. All four failures also occurred on the unmodified base:

- `pi-file-tools-wire`: packaged grep normal result and capped private result.
- `pi-search-safety`: authorized packaged grep and real-process cancellation.

Their current diagnostic is `SEARCH_FAILED` / “Search process reported
diagnostics instead of a clean no-match result”. No search/sandbox check was
weakened to turn these green. The full baseline default run was interrupted at
its stale infinite-script fixtures, so no completed baseline aggregate is claimed.
The final changed-tree default run completed after both fixture corrections.

Reproduce the cohorts with:

```sh
NIGHT_BOT_TEST_CONCURRENCY=4 node scripts/test-pi.mjs default
NIGHT_BOT_TEST_CONCURRENCY=2 node scripts/test-pi.mjs routing
NIGHT_BOT_TEST_CONCURRENCY=2 node scripts/test-pi.mjs runtime
node scripts/check-coverage.mjs
node scripts/check-production-imports.mjs
node scripts/check-native-runtime.mjs
```

This is a partial implementation of issue 82's broader investigation checklist,
not evidence to auto-close that issue. Remaining repeated refreshes, already
started handoff latency, durable end-to-end trace and historical Windows evidence
are listed in [README](README.md).
