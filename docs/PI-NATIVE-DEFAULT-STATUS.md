# Official Pi default runtime checkpoint

The default Host now constructs the public Pi 1.5.0 AgentSession through
OfficialAgentFactory. Pi owns session entries, history, context construction,
tool execution scheduling, model retries, branching and compaction. Night owns
business admission, task authority, durable effect receipts, resource policy,
channels and shutdown ownership. The retired Host LLM service is not mounted.

This is an integration checkpoint, **not a completed migration**. Do not deploy
this work as a fully verified replacement yet.

Verified on the current integration tree:

- Official core cohort after sealed presets and skill observers: 178 passed.
  Domain: 391 passed. The latest routing diagnostic is 16 passed / 31 failed;
  the old PiLoop fixture is being replaced with an actual official Host fixture.
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

Ordinary-channel admission, first-tier triage, dynamic instruction discovery
and request-image budgets now have actual official-Host coverage. Further
checks passed: ingress/triage startup and shutdown 14; presets and startup
barriers 20; live jobs and official retries 6; backup/archive/preflight 29.
Linux kernel privacy/containment passed 8 using the repository-approved outer
execution mode while retaining application bwrap. This does not prove Windows
isolation.

A second full default diagnostic ended with 1,020 passed and 40 failed, without
cancellations. That run overlapped the final filesystem repair and predates
subsequent fixture and scheduler fixes; it is not final acceptance. A fresh
stable full run is still required.

Remaining work includes native subagent business lifecycle, an official skill
command ingress (the retired DSH inline /name gesture is not reimplemented),
workspace admission verification, and the remaining old runtime fixtures/sources.
Night's historical backup/upgrade reader remains; automatic old-Night-to-native
execution upgrade is not implemented. Earlier experimental native headers
missing a declared preset are rejected rather than silently rewritten. A concrete privileged reconciliation
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
