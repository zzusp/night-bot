# Issue 82 follow-up on merged main

Base: `66ee7d26ef06eb3c85a8f9739819983049ad21f6`. The first batch was merged through
PR #85. This is a separate follow-up; earlier checkpoint test counts do not prove
this merged tree. No deployment, live channel send or real model request is part
of these cloud regressions.

## Scope

- Refresh ordinary business resources at the actual run boundary instead of
  repeating delivery preflight. Cold one-shot triage maps resources twice rather
  than four times. Keep eager Task/Router construction, `/skill:` command preflight,
  turn-end refresh and the one-use Router continuation recovery preflight.
- Check actor lifetime across asynchronous resource preparation without replacing
  an already-rejected policy error with cancellation.
- Let a durable task-completion event preempt an already-started tool-free handoff
  before its prepared-summary barrier. Join native cancellation and preserve one
  owner, the same journal and pending-input authority. Strict reopen must use the
  current durable ledger state, not the pre-handoff active snapshot.
- Keep bounded metadata-only phase/model/tool/source tracing in a separate native
  diagnostic domain. Reuse existing atomic storage, retain legacy metrics as
  read-only fallbacks, avoid double-counting and keep diagnostic failures separate
  from business authority. No message bodies, tool arguments or secrets belong
  in the trace.
- Preserve typed source versions and task-event links. Unknown historical links
  stay unknown; same-millisecond admission order must not retroactively attribute
  a running model/tool span to a later input. Reconstructed phase boundaries do
  not prove order within a millisecond.
- Retain at most 2048 trace entries per partition. Successful new writes enforce
  a global 4096-entry budget while preserving aggregate metrics and deduplication.
  Legacy oversized snapshots are reported with actual retained count and an
  explicit exceeded flag until a new write enforces the budget.
- Bind already-authorized direct task processes to their task temporary directory,
  validating its identity and writability without changing permissions or silently
  falling back elsewhere. Fatal output does not prove process or process-group exit.

## Evidence boundaries

SDK stream invocation is not proof of HTTP dispatch or a billable provider call.
An interval-union ledger avoids double-counting overlapping spans, but unobserved
intervals are unknown rather than idle. Retention loss and unavailable diagnostics
must never be described as a complete historical trace.

Native Windows historical compiler/process-range/EOF evidence remains unverified.
Prior read-only attempts were rejected before process creation; no Computer Use
or sandbox bypass was used. Linux and scripted-model results cannot substitute
for that evidence. Do not auto-close issue 82 based on this follow-up.

## Current validation

Re-run results for this base are recorded here before publication. Earlier
experiments showed trace embedded in the business snapshot amplified whole-domain
serialization. Independent diagnostic storage reduced that overhead, but it is
not free: isolated 32-continuation runs retained the 120-second Linux budget;
concurrent full-cohort load previously exceeded it. Both baseline failures and
load-dependent timeouts must be disclosed rather than hidden by larger budgets.

### Fresh pre-publication checks

These groups overlap; their counts must not be summed as unique tests.

- Resource/session/context/command/close/operator coverage: 40 passed.
- Task temporary-directory and process-lifecycle contracts: 20 passed.
- Handoff and Router ledger: 34 passed; close negative/positive cases: 5 passed.
  The validation/preflight race fixtures now wait for the explicit cancellation
  signal rather than a sleep, so a legally completed prepared summary cannot win
  the branch the test intends to exercise.
- Trace/domain/metrics/observation: 39 passed.
- Official observation, task and source timing: 30 passed.
- Real scripted-SDK source/task trace and legacy pending compatibility: 4 passed.
- Final restored trace output/strict-window checks: 17 passed.
- Main baseline full runtime: 162 total, 156 passed, 5 failed, 1 cancelled,
  280.80s. Candidate full cohorts are still pending at draft publication.

The strict handoff recovery test additionally proves that the old actor is
revoked, a new actor owns the same journal, and recovery uses the current ledger
state rather than silently relying on a later scheduling retry. An unrelated
AbortError object is not accepted as the handoff's cancellation authority.
