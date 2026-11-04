# Migrate headless DingTalk execution to Pi (in progress)

Pi 1.5.0 now owns model/tool iteration and SessionManager durable branch context. The application owns model routing, live-agent and tool registries, background jobs, sandbox policy, Session/Projection registries, layered environment and durable credentials. Messages, Topic routing, coordination/execution, recovery, notifications, permissions, file delivery and HTTP routes retain the source behavior; three UI entries are excluded. Coverage maps preserve 200 core modules with six explicit adaptations.

Tool side effects require durable intent before dispatch and durable results before the next model step. Recovery preserves unknown-outcome fences and never replays completed actions. Genuine Pi event streams retain signatures; transformed middleware output uses an explicit compatibility path without redispatch. Local process code is an attributed MIT source fork, not a from-scratch rewrite.

This remains an incomplete migration: the pinned v4 Session in-memory facade/publication hook, generic scope/message/RPC helpers, authorization sessions, attachments, filesystem/shell and permission wrappers, Windows ACL, skills/workspace and child-agent services remain. There are54 direct production DSH dependencies and15 removed active services; dependency counts do not establish functional completion.

Validation:793 independent passes/one Windows-only skip, including208 own,142 runtime,47 routing,388 domain and8 previously verified unchanged containment cases. Fresh production-only installation repeats118 cases, with243 runtime files and manifest/lock identical. Late credential confirmation/cancellation fixes have final own and production regression evidence. No real DingTalk, vendor OAuth/models or production business acceptance. See VALIDATION.md and validation-results.json for stage-specific evidence.

The GitHub push dry-run was denied with HTTP403. No retry, remote branch/PR, merge, deployment or business message occurred. This file is the local reviewable PR draft.
