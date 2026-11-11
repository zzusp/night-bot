# Issue #65: Router skill refresh race

Base: `76c6f75072a6a60ce06a6d5329223d08cdd7f442` (2026-11-11).

## Cause and change

The official resource bridge refreshes skills both before a Pi run and at
`turn_end`. The catalog and the authorized provider body are separate reads.
Reflection can publish a learned skill concurrently, and its rendered body also
contains the shared memory revision. A concurrent retrospective can therefore
make these reads disagree even when the Router's task query already succeeded.
The resulting `PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED` aborts the run. The
Router then correctly refuses to replay the already admitted, unsettled batch,
which also prevents later messages from proceeding.

Resource preparation now retries only the complete scoped skill snapshot and
materialization, up to three attempts, for that exact authorization-change
error. Each retry invalidates the catalog cache and rechecks the current actor,
lifetime, metadata, invocation permissions, content and filesystem paths. A
revoked skill disappears from the new catalog. No previous resource snapshot is
used as a fallback. Incomplete catalogs, unrelated failures and continuous churn
still fail closed.

The retry does not repeat Pi inference, business admission, task execution,
Router tools or delivery. Router checkpoint and no-replay rules are unchanged.
This patch does not edit existing failed journals, resume production batches,
merge, deploy or send real messages.

## Reproduction and focused verification

`node --test test/pi-official-host-resources.test.js test/pi-router-skill-refresh.test.js`
passes **22/22** on the final implementation, with no skips.

- A real Reflection provider changes its shared memory revision between body
  reads. Only current content is published after retry.
- Metadata/invocation changes and revocation use a fresh catalog. Continuous
  churn stops after three attempts. Cancellation, unsafe cache paths, provider
  errors and incomplete catalogs do not gain retry/fallback authority.
- The end-to-end fixture runs the real Host, official Pi session, task ledger and
  `Reflection.review`. It pauses a Router resource read after a successful task
  query, queues four later messages, and publishes a real retrospective skill
  change before releasing that read. All events settle; task execution, query
  and review each occur once. Original admissions remain unique, no aborted or
  error assistant turn is created, and cold restart performs no replay.
- The same end-to-end test on the unmodified base fails with
  `ROUTER_BATCH_UNSETTLED`. Four focused resource regression cases also fail
  before the fix and pass afterward.

The end-to-end test is part of both the default and routing cohorts. Model
responses and transport are local fixtures; no live vendor or Windows runtime
acceptance is claimed.

## Broader verification

Frozen pnpm installation, `pnpm check` and `git diff --check` pass. The full
cohorts are **not all green**:

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test` | 1528 | 8 | 22 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:runtime` | 158 | 4 | 0 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:routing` | 88 | 1 | 0 |
| `NIGHT_BOT_TEST_CONCURRENCY=2 pnpm test:containment` | 20 | 2 | 0 |

Counts overlap across cohorts. The following **14 unique failures** were each
reproduced independently on the unmodified base with the same frozen dependency
installation. They were not suppressed or changed in this patch:

- `pi-config.test.js`: channel loader expects no `receivePaused: false` field.
- `pi-operator-settings.test.js`: saved-credential shell fixture expects
  `unrelated: true`, receives `false`.
- `pi-resident-router-flow.test.js`: durable receipt echo test expects a
  rejection that does not occur. This appears in default and routing.
- `pi-single-task-review.test.js`: `DYNAMIC_HUMAN_REVIEW_NOT_PENDING`.
- `pi-task-archive.test.js`: two cases, missing `memory` field and review state
  `failed` instead of `done`.
- `pi-task-business-failure.test.js`: two cases,
  `DYNAMIC_HUMAN_REVIEW_NOT_PENDING`.
- `task-session-execution-provider-recovery-native.test.js`: missing
  `reviewFailures.at` input.
- `task-session-service-native.test.js`: three historical-source supplement
  cases, actual count 1 versus expected 2.
- `native-shell-env-kernel-wire.test.js`: both variants observe the fixture
  credential; the portable variant also observes `NIGHT_BOT_EXTRA`.

The final focused 22-test run and all guards were repeated after the last
null-safe error-access and test-assertion edits. The cohort totals above are
from the preceding full runs. No GitHub CI was requested; commits use
`[skip ci]`. No production data or private skill bodies are included.
