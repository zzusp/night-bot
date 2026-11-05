# Official Pi default runtime checkpoint

The default Host now constructs the public Pi 1.5.0 AgentSession through
OfficialAgentFactory. Pi owns session entries, history, context construction,
tool execution scheduling, model retries, branching and compaction. Night owns
business admission, task authority, durable effect receipts, resource policy,
channels and shutdown ownership. The retired Host LLM service is not mounted.

This is an integration checkpoint, **not a completed migration**. Do not deploy
this work as a fully verified replacement yet.

Verified on the current integration tree:

- Official core cohort: 71 passed; domain: 391 passed; routing: 47 passed.
- Production import and source accounting checks passed (200 retained core
  modules, 45 explicitly adapted modules at this checkpoint).
- Frozen installation passed using the configured registry (621 entries).
- Official retries preserve a preceding completed effect; unknown effects
  fence further requests and remain held for reconciliation.
- Metadata observations contain no message bodies, tool arguments/results or
  raw call identifiers. Model counts represent SDK assistant attempts, not HTTP
  dispatches. Final observations are joined during shutdown.

The first complete default-suite diagnostic run ended with 967 passed, 70 failed
and 1 cancelled. Some fixtures were being ported during that run, so it is not a
stable final snapshot. Failures include obsolete Session/steer fixtures **and
real production wiring gaps**. Targeted fixes do not supersede that result until
a fresh complete run passes.

Remaining work includes ordinary-channel admission verification, first-tier
triage wiring, dynamic instruction discovery, request-image budgets, native
subagent business lifecycle, and the remaining old runtime fixtures/sources.
Night's historical backup/upgrade reader remains; automatic old-Night-to-native
execution upgrade is not implemented. A concrete privileged reconciliation
workflow for single-task unknown effect intents is also still missing; effects
are held rather than replayed or falsely marked successful.

Maintenance drain establishes completion only for explicitly owned jobs and
registered process-provider ranges. It is not evidence of complete platform or
Windows kernel containment. Unsupported native maintenance paths fail closed.

Official Pi read buffers the complete file before applying output limits.
The new Pi file-tool module therefore remains unmounted pending integration of
business guards, lifecycle joins, aggregate image budgets and transport budgets.
Its separate read_window tool provides bounded streaming; its new resource caps
must be reviewed before changing the production defaults.

There are 37 direct DSH development dependencies and zero production DSH
dependencies in package.json. Derived source and historical test copies remain;
their license notices have intentionally not been removed.
