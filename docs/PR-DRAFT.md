Pi headless DingTalk runtime migration (in progress)

The existing DingTalk assistant needs to run on Pi without its visual interface, while preserving message/topic routing, durable task coordination, recovery, permissions, tools and delivery. This branch retains the pinned source core and original HTTP/DWS protocols; Pi agent-core owns inference/tool iteration, and Pi SessionManager owns durable context and checksummed single-writer history.

Application-owned services now cover provider/auth/credential binding, agent/session/projection lifetimes, job/process/sandbox execution, scoped tool admission and bounded concurrency, permission/approval gates, attachments, skills/workspace/CWD, prompts/instructions, preset generations, child lifecycle/cold query, title metadata, Web capability/HTTP and generic cooperative tool budgets. Attributed local model bindings cover Web, directory, todo, child controls/delegation, skills and jobs. Local filesystem IO/CAS/watch/containment, owner observation gates, file/image tools and packaged ripgrep search now replace active rows. Missing scoped image capability injection and complete-search-result spillStore are repaired; real Pi reads an omitted result back from its private locator.

Native Bash/Pwsh executors, sandbox consumers and tools now replace all remaining active DSH plugin rows. Admitted confinement preparation drains on cancel/timeout, with no late spawn; owned timer reason identity preserves caller-first cancellation. Real Linux background/promotion wires collect each single managed effect; PowerShell is fake-subprocess-only validation.

Native shared proxy policy/transport now serves both CLIs, public HTTP and ordinary child overlays; real authenticated local CONNECT plus actual Pi loopback/Web routing is verified. Local language hints and unused direct interface declarations no longer require those root SDK packages.

Sandbox escalation/root/runner-diagnostic helpers are now local and independently compared with the original; the canonical public sandbox error identity remains external.

Scope parent/event/store identity is application-owned with a transparent local SDK peer alias and startup resolution fence; independent original-source semantics and production peer identity are verified. No additional active service-removal credit is claimed.

Strict prompt/context rendering, interoperable RPC descriptors and workflow credential protocols are local. The seventh explicit core adaptation changes only the key-helper import; persisted scope/id addresses, secret redaction and frozen run revisions are verified across NativeCredentials reopen.

Effects require durable intent before execution; receipts and terminal Pi commit gates prevent successful completion on uncertain persistence. Cold continuation does not replay completed tools. Cancellation waits for admitted tool bodies; job kill acknowledgement remains distinct from producer exit. Permission guards and the application kernel sandbox remain enabled.

This is not a completed DSH-independent migration. Canonical v4 Session/publication/inbox facade, abstract service/error/type/schema/message/format helpers, Windows ACL and optional worker boundaries remain. There are16 direct DSH production dependencies and49 active component replacements, with no active DSH plugin rows; counts are inventory, not completion proof. Explicit MIT compatibility forks are attributed in THIRD_PARTY.md and licenses, not presented as original algorithms. Visual UI is excluded; presentation metadata needed by protocols is retained.

Validation at this checkpoint:499 own, freshly rerun runtime142/routing47/domain388; fresh real Linux containment11 passes/one Windows-only skip.1087 aggregate independent passes;16 extra workflow configuration regressions reported separately. Fresh production-only frozen installation repeats381 meaningful cases including three real kernel wires;308 runtime files plus manifest/lock/workspace configuration are byte-identical. Source manifest retains200 core modules, excludes3 UI modules and tracks7 explicit adaptations. See VALIDATION.md, validation-results.json and evidence logs. No actual DingTalk/vendor/Windows production acceptance is claimed.

Remote delivery remains blocked: the target Git push was denied HTTP403; no retry or alternate account/environment route was attempted. Local commits and verified bundles preserve all checkpoints. No PR, merge, deployment or CI trigger occurred.

Follow-up sandbox helper validation:502 own +41 targeted runtime +11 real containment (one Windows skip);343 production core and3 production kernel repetitions. The full142 runtime/routing47/domain388 baseline is the immediately preceding Scope checkpoint, not claimed rerun after extraction.309 runtime files byte-identical; no dependency or active-service removal credit.

Message/stream follow-up: immutable messages, image/file/tool projection, compact assistant streams and exact-object Pi loop markers are local; the legacy LlmRuntime class is excluded.506 own/142 runtime/47 routing/388 domain/11 Linux containment pass (one Windows skip),1094 unique;388 production repetitions;310 runtime files identical.200 retained core modules now have17 explicitly recorded adaptations, including behavior-preserving constructor import changes. Errors/attribution remain external.
