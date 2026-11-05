# 来源与许可

- 仓库既有 `LICENSE`（MIT）原样保留。
- `packages/dingtalk-core`、原有 `test`（不含 `pi-*`）、上游 `scripts` 移植自用户指定的百部插件项目 `HiQ-AI/dingtalk-dsh-assistant`，提交 `93e431a2a76938d32aefc070b093fcfb65691c70`。源项目声明 `UNLICENSED`；移植不将其自动改授 MIT。核心 package 及本仓库 package 保守地保留 `UNLICENSED`，且 `private: true`，不执行 npm 发布。
- `src/pi-loop.js` 的生命周期、持久 inbox、工厂和会话适配代码基于 `@deepseek-ai/dsh-agent-loop@0.2.1-alpha.2`，版权 DeepSeek，MIT 许可原文见 `licenses/deepseek-agent-loop-MIT.txt`。原模型/工具 step 循环已替换为 pi-agent-core 驱动。
- Pi 三个固定 `1.5.0` SDK 包声明 MIT，但安装包未附许可证正文；已从上游 `v1.5.0` 对应提交核对并保存在 `licenses/pi-1.5.0-MIT.txt`，版本、来源提交及哈希见 `docs/pi-license-source.json`。其余 Host 外部依赖的许可证随依赖包保留；版本和完整性由 `pnpm-lock.yaml` 固定。明确复制的 MIT 源码及适配边界另列于下。

`src/native-schedule-protocol.js` and the management contracts in
`src/native-schedule.js` derive from `@deepseek-ai/dsh-schedule@0.2.1-alpha.2`;
`src/native-tool-schedule.js` derives from `@deepseek-ai/dsh-tool-schedule` at the
same version, Copyright (c) 2026 DeepSeek (MIT). Original notices are in
`licenses/dsh-{tool-schedule,schedule}-MIT.txt`; source and adapted hashes are in
`docs/schedule-source-manifest.json`. Calendar/record/history/schema algorithms
are attributed compatibility code, not a DSH runtime base. The active scheduler
and ordinary-session controller are local implementations over Pi and native
storage. Temporal is a generic calendar dependency, pinned separately in the lock.

## Local managed-process backend

`src/process/{index,runner,runner-launch-B2zsQ1Dz,output}.js` derive from
`@deepseek-ai/dsh-subprocess-local@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek,
under MIT (`licenses/dsh-subprocess-local-MIT.txt`). This is an explicit source fork
of the platform backend, not a from-scratch implementation or a claim that all
DSH semantics have been removed. Local contracts and runner resolution replace
DSH service/loading dependencies; Windows process FFI remains a separate library.

`src/process/control.js` derives from `@deepseek-ai/dsh-subprocess@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek, under the same MIT terms. The legacy control marker is retained for unmodified worker interoperability.

`src/process/win32.js` derives from `@deepseek-ai/dsh-win32-process@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek, under the same MIT terms. It retains the Job/token/pipe FFI implementation with local lazy loading. Windows runtime validation remains outstanding on Linux.

Credential storage compatibility: `src/native-credentials.js` implements the existing v1 YAML/reference/record format; `src/credential-file.js` retains the PID-newline and hash-named takeover protocol of MIT @deepseek-ai/dsh-atomic-write for mixed-version refresh safety. Application-owned implementation adds inode ownership fencing, fsync and guarded close/drain. These protocols are not Pi SDK services; this is not a claim of full DSH independence. Existing DSH MIT notices remain in licenses/.

Attachment compatibility: `src/native-attachment-{codec,storage,errors}.js` and `src/native-attachments.js` are application-owned implementations preserving the MIT @deepseek-ai/dsh-attachment-local@0.2.1-alpha.2 v1 content-addressed publication and request-image-v6 normalization/encoding protocols. Sharp performs raster transforms. The source normalization/quality/identity and publication algorithms are adapted with attribution; the original notice is in `licenses/dsh-attachment-local-MIT.txt`. Codec/format parity is tested rather than treating copied protocol fields as proof of complete migration. Generic message/attachment admission and LLM projection helper dependencies still remain explicitly.

`src/native-skill-watcher.js` is an explicit MIT source-derived platform backend from @deepseek-ai/dsh-skill-filesystem@0.2.1-alpha.2 (Copyright (c) 2026 DeepSeek), with local imports and a bounded changing-root admission loop. See `licenses/dsh-skill-filesystem-MIT.txt` and `docs/skill-watcher-fork-manifest.json`. The filesystem provider/discovery is application-owned, uses capability-checked reads and Pi frontmatter parsing, and preserves legacy roots/body bytes plus an explicit delimiter-compatibility fallback. The watcher fork is not described as a from-scratch rewrite or proof of full migration.

Workspace compatibility: `src/native-workspace.js` is an application-owned registry preserving the MIT @deepseek-ai/dsh-workspace v2 account protocol and public error identities. Its archived-subagent admission rule preserves the nonvisual behavior previously mounted by @deepseek-ai/dsh-api-session-controller; the legacy controller itself is excluded from production. The guard follows known session headers and does not copy or mount the UI controller. Existing DeepSeek MIT notices apply.

Prompt assembly compatibility: `src/native-system-prompt.js` is an application-owned registry/assembly implementation preserving @deepseek-ai/dsh-system-prompt@0.2.1-alpha.2 ordering constants and admission algorithms, adapted under MIT (Copyright (c) 2026 DeepSeek), see `licenses/dsh-system-prompt-MIT.txt`. Shared scope collections and public rendering helpers remain explicit libraries; no old SystemPrompt service is constructed or delegated. The optional identity text now names Pi; default Host keeps this identity disabled as before.

Model-request retry compatibility: `src/native-llm-retry.js` preserves the MIT @deepseek-ai/dsh-llm-retry@0.2.1-alpha.2 retry-chain event/projection and backoff algorithms (Copyright (c) 2026 DeepSeek), see `licenses/dsh-llm-retry-MIT.txt`. Application-owned recovery additionally requires Pi committed-event admission, drains cancelled writes and excludes self-close waits. It retries model requests and does not replay completed tools or business receipts. The old retry implementation is retained only for development differential tests.

Local child-provider compatibility: `src/native-subagent-providers.js` preserves @deepseek-ai/dsh-subagent-{spawn,fork}-in-process@0.2.1-alpha.2 capability declarations and balanced completed-turn seed behavior under MIT (Copyright (c) 2026 DeepSeek). The identical upstream notices are preserved in `licenses/dsh-subagent-providers-MIT.txt`. Providers are application-owned; the continuation manager and generic child-composition helpers remain explicit DSH dependencies. PiLoop/Pi journals own the actual child model execution and context.

Approval/preset compatibility: `src/native-approval.js` and `src/native-permission-presets.js` preserve the MIT @deepseek-ai/dsh-{user-approval,permission-presets}@0.2.1-alpha.2 policy vocabulary, model notices, canonical events, preset/projection mathematics, Auto hook, command and RPC contracts (Copyright (c) 2026 DeepSeek). Original notices are in `licenses/dsh-user-approval-MIT.txt` and `licenses/dsh-permission-presets-MIT.txt`. The application owns the services, Pi commit admission, revocation/close fences and terminal journal settlement. Generic message/scope/RPC and filesystem/shell capability adapters remain explicit dependencies.

Trusted shell facts: `src/native-shell-env.js` preserves the MIT @deepseek-ai/dsh-shell-env@0.2.1-alpha.2 per-execution `DSH_*` protocol, reserved built-ins, contributor ownership, metadata and snapshot behavior (Copyright (c) 2026 DeepSeek), see `licenses/dsh-shell-env-MIT.txt`. The registry/home resolution is application-owned; original shell/tool consumers remain explicit. Declarations are captured at registration so later object mutation cannot acquire reserved authority or strand the original owner.

## Agent instruction compatibility algorithms

`src/native-agent-instructions.js` includes MIT source-derived discovery, rendering, bounded reads, deduplication and reconciliation algorithms from `@deepseek-ai/dsh-agent-instructions` (installed pinned version in pnpm-lock.yaml), plus the historical root labels/precedence from `dsh-home-paths`. The application controller now uses Pi journal hostMessages exclusively for visible instruction history, native launch snapshots, scoped capability reads and cancellation/drain. This is an attributed compatibility fork, not a claim of a from-scratch algorithm rewrite. See `licenses/dsh-agent-instructions-MIT.txt` and `licenses/dsh-home-paths-MIT.txt`.

## Preset generations and profile compatibility

`src/native-agent-presets.js` retains attributed MIT scope/Loader audit, generation/lease, inventory and remote surface algorithms from pinned `@deepseek-ai/dsh-agent-preset-registry@0.2.1-alpha.2`. The active controller owns its registrations and Pi selection commit/start-race fences. `src/native-profile-preflight.js` retains the required MIT manifest/compatibility/include admission subset from `dsh-app-boot`, without importing or starting app-boot. Legacy peer checks deliberately use the retained v4 ABI `0.2.1-alpha.2`, independently of the Night Bot app/Pi SDK versions; exact historical exemptions never become broader grants. See `licenses/dsh-agent-preset-registry-MIT.txt` and `licenses/dsh-app-boot-MIT.txt`. These compatibility algorithms are source forks, not from-scratch rewrites.

## Subagent control and read-only query compatibility

`src/native-subagents.js` retains MIT source-derived activation/lineage/catalog/control/delegation/structured-result algorithms from pinned `dsh-subagent@0.2.1-alpha.2`. The active service owns its provider registry and activation graph and requires native Pi admission/terminal commit proofs; canonical public SubagentError/SubagentDepthError identities remain imported for existing control-tool compatibility. `native-session-query.js` retains the MIT read-only corpus/observation/search/presentation algorithms from `dsh-session-query`, backed by native Pi storage, with application-owned lifetime cancellation/drain. Its legacy event surface is a presentation/audit API, never model-request authority. `native-time-zone.js` retains its MIT zone helper. See `licenses/dsh-{subagent,session-query,util-time}-MIT.txt`. The application-owned flat-page catalog in `src/runtime/child-catalog.js` replaces the removed recursive chunk-list source. Its checkpoint version 7 rebuilds from complete Night Bot Pi history when an earlier application checkpoint is encountered; it does not import DSH data. The old subagent comparison fixture and chunk-list source are both removed, so their dedicated chunk-list notice is removed. These source forks and retained helper imports are explicit, not claims of independent rewrites.

## Session title protocol

`src/native-session-title.js` retains the pinned `dsh-session-title@0.2.1-alpha.2` MIT normalization/fold/cadence and provider-result protocol, with application-owned registration snapshots and nested self-disposal-safe cancellation/drain. The canonical public SessionTitleInvalidError identity remains imported for existing wire adapters, so the old package remains an explicit production helper while its service is not mounted. NativeSessionQuery imports the local fold. See `licenses/dsh-session-title-MIT.txt`.

## Web capability and HTTP transport

`native-web.js` owns selection/registration and lifetime while preserving the MIT `dsh-web` selection/cap protocol and canonical WebError identity for existing tools. `native-http-fetch.js` retains explicitly MIT source-derived public-address/NAT64 resolution, pinned connector, proxy, redirect, MIME/charset and bounded-response algorithms from `dsh-web-fetch-http`; NativeDeadline retains its MIT signal/timer protocol from `dsh-timeout`. Low-level connector injection/exports are internal testing seams, not a public-request private-network option. Source notices: `licenses/dsh-{web,web-fetch-http,timeout}-MIT.txt`. `ipaddr.js@2.5.0` remains a declared parser dependency with `licenses/ipaddr-js-MIT.txt`. Existing proxy policy stays in the retained shared overlay.

## Web tools and cooperative declaration timeouts

`native-tool-web.js` retains explicitly MIT source-derived schema/validation, query merging, bounded HTML-to-markdown, untrusted-output labels and presentation metadata from `dsh-tool-web@0.2.1-alpha.2`; this remains backend metadata, not a recreated UI. `native-tool-timeout.js` preserves the `dsh-tool-call-timeout-policy` structured result/cooperative await protocol, with local reason-identity ownership for nested same-code deadlines. Notices: `licenses/dsh-{tool-web,tool-call-timeout-policy}-MIT.txt`. Markdown dependencies `turndown@7.2.4` and `@joplin/turndown-plugin-gfm@1.0.68` retain their MIT notices under `licenses/`. Generic defineTool/schema helpers remain explicit libraries.

`src/native-tool-working-directory.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-working-directory@0.2.1-alpha.2`; see `licenses/dsh-tool-working-directory-MIT.txt`. This compatibility fork is not described as an original algorithm.

`src/native-tool-todo.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-todo@0.2.1-alpha.2`; see `licenses/dsh-tool-todo-MIT.txt`. This compatibility fork is not described as an original algorithm.

`src/native-tool-subagent-control.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-subagent-control@0.2.1-alpha.2`; see `licenses/dsh-tool-subagent-control-MIT.txt`. This compatibility fork is not described as an original algorithm.

`src/native-tool-subagent.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-subagent@0.2.1-alpha.2`; see `licenses/dsh-tool-subagent-MIT.txt`. This compatibility fork is not described as an original algorithm.

`src/native-tool-skill.js` retains MIT tool-skill schema/catalog/invocation/formatting algorithms from `@deepseek-ai/dsh-tool-skill@0.2.1-alpha.2`; Pi hostMessages replaces legacy visible-surface authority. See `licenses/dsh-tool-skill-MIT.txt`.

`src/native-tool-jobs.js` and `src/native-output-retention.js` preserve MIT job control/notice/rendering and bounded retention algorithms from `@deepseek-ai/dsh-tool-jobs`/`dsh-output-retention@0.2.1-alpha.2`, explicitly attributed compatibility forks; see matching licenses.

`src/native-fs-local.js`, `native-fs-sandbox.js` and `native-fs-observation-policy.js` preserve MIT filesystem IO/atomic/CAS/watch/Windows-DACL/containment and observation-gate algorithms from matching `@deepseek-ai/dsh-* @0.2.1-alpha.2` packages. These are explicitly attributed compatibility forks, not original security algorithms; canonical FsError/service/type helpers and sandbox writableRoots remain explicit libraries.

`src/native-tool-fs.js` and `native-tool-fs-search.js` preserve MIT file/image model bindings, rendering and argv-only ripgrep bounded search/retention algorithms from matching `@deepseek-ai/dsh-* @0.2.1-alpha.2` packages; see matching licenses. Native attachment errors replace the old identity check. Generic schema, FsError, language hints and sandbox approval helpers remain.

`src/native-spill.js` preserves MIT private spill IO, encoding and sweep algorithms from `dsh-spill-local`/minimal `dsh-spill` service definition@0.2.1-alpha.2; app admission/drain and cleanup scope are explicit adaptations. See matching licenses. External diff9.0.0 and @vscode/ripgrep1.18.0 licenses are included.

NativeSpill additionally rejects substituted root/session symlinks, applies private directory modes, syncs admitted file writes and awaits them on owner shutdown. Active-root-only cleanup is an intentional application policy; inherited arbitrary ancestor-replacement TOCTOU is not claimed eliminated. Native file image registration explicitly injects its required scoped capabilities rather than relying on inherited injection metadata.

Native shell capability/render protocol, Bash/PowerShell local executors, sandbox consumers and model tools preserve MIT algorithms from matching `@deepseek-ai/dsh-* @0.2.1-alpha.2` modules, using local deadline/process/jobs/sandbox/policy owners. See licenses/dsh-{shell,bash-local,pwsh-local,bash-sandbox,pwsh-sandbox,tool-bash,tool-pwsh}-MIT.txt. Canonical sandbox/schema/message helpers remain; copied compatibility algorithms are not described as original. DSH_ remains a historical script protocol.

Native Bash/Pwsh executors explicitly adapt cancellation: admitted confinement preparation is drained before a timeout/cancel outcome, with no late spawn; owned timeout reason identity prevents same-code ancestor deadlines being misclassified. PowerShell retains the historical BASH_TIMEOUT wire code. These are application lifecycle changes beyond the attributed baseline algorithms.

`native-consumed-work.js`, `native-brand.js` and `native-values.js` preserve MIT pure consumed-work audit accounting, primitive nominal identity and duplicate-install-safe JSON snapshot/freeze algorithms from dsh-agent/dsh-brand/dsh-util-values@0.2.1-alpha.2. Only consumed exports are forked; no active-service credit is claimed. See matching licenses.

`native-http-proxy.js` and `native-code-language.js` retain MIT installed-policy/undici/child-env proxy algorithms and path-language mappings from matching dsh-http-proxy/dsh-util-code-language@0.2.1-alpha.2. All app CLI/HTTP/process consumers share the local proxy singleton. See matching licenses. Unused direct launch-environment/sandbox-policy/subprocess declarations are pruned after call-site inventory; no active-service credit is claimed.

`native-prompt-render.js` and `native-typert-protocol.js` preserve MIT prompt/context rendering and RPC metadata/structural error/owned-value/service binding algorithms from matching dsh-system-prompt/dsh-typert-protocol@0.2.1-alpha.2; see licenses. Stable historical descriptor strings and Symbol.for identities remain wire-compatible. Core workflow configuration uses the local two-argument credential-key protocol, recorded as a seventh explicit core adaptation; the actual credential service remains NativeCredentials. No active-service credit.

`native-credential-protocol.js` preserves MIT dsh-credentials scope/id/reference grammar and primitive branding helpers. Core workflow configuration retains exactly the existing stored addresses; its source hash and explicit adaptation are recorded.

`src/native-scope.js` retains MIT scoped stores/parent graph/event carrier algorithms from dsh-scope@0.2.1-alpha.2; test/fixtures/legacy-scope.mjs preserves the original source as an independent reference. The private compatibility package only re-exports the same local implementation for retained SDK peer names, preventing duplicate authority stores. Historical helper ABI version is not a Pi/app version. See licenses/dsh-scope-MIT.txt and docs/scope-compat-manifest.json.

`src/native-sandbox-protocol.js` derives escalation, root and diagnostic algorithms from MIT `@deepseek-ai/dsh-sandbox@0.2.1-alpha.2` (license: `licenses/dsh-sandbox-MIT.txt`). Its public SandboxUnavailableError identity remains explicitly external; no abstract legacy provider is mounted or copied.

`src/native-message-protocol.js` derives immutable message construction, context/image/file projections and assistant stream assembly from MIT `@deepseek-ai/dsh-llm@0.2.1-alpha.2`; see `licenses/dsh-llm-MIT.txt`. Pi continues to own execution. The legacy LlmRuntime service, duplicate retry schema/resolver and differential LLM fixture are removed. Public error classes remain attributed local source; product attribution is application-owned. Provider catalog acceptance is checked against the pinned Pi SDK rather than a DSH provider package. Remaining derived message/stream/error code still requires the DSH LLM notice.

`src/native-capability-errors.js` retains MIT error vocabulary from `dsh-web`, `dsh-authorization`, `dsh-workspace` and `dsh-session-title` version0.2.1-alpha.2 (individual licenses in `licenses/`). `packages/capability-compat/` transparently maps their historical public names to native owners and shared constructors; it is not an additional service replacement. Independent original service references in `test/fixtures/legacy-*-interface.mjs` retain their own constructors/algorithms; verified values/brands/domain support imports are local, with original and fixture hashes in `docs/capability-error-reference-manifest.json`.

Local `native-fs-protocol.js` and the abstract/error additions in `native-sandbox-protocol.js` retain MIT capability contracts from `dsh-fs`/`dsh-sandbox`0.2.1-alpha.2. `native-skill-protocol.js` retains the MIT naming/invocation/rendering helpers of `dsh-skill`0.2.1-alpha.2. Corresponding licenses are in `licenses/`. Four historical namespaces map to these protocols or existing native owners; original registry/base references remain independent fixtures with support-only adaptations and hashes in `docs/interface-reference-manifest.json`. No legacy runtime service is mounted and no extra active-service removal credit is claimed.

`native-llm-errors.js`, `native-llm-protocol.js`, `native-tool-protocol.js` and `native-subagent-errors.js` retain MIT public contracts/algorithms from the corresponding0.2.1-alpha.2 LLM/tools/subagent SDK packages (individual licenses in `licenses/`). AST extraction excludes old LlmRuntime, ToolRuntime and ToolLayer implementations; historical runtime names map to existing native owners. Independent full original runtime references are test-only fixtures with verified local support imports and original private markers/scheduler retained; hashes and extraction details are in `docs/execution-protocol-reference-manifest.json`. Default product attribution identifies Night Bot; the explicit custom-identity API remains.

`native-session-protocol.js` retains MIT data/audit/publication/inbox contracts from `dsh-session` 0.2.1-alpha.2; `native-persistence-protocol.js` retains the abstract IO/error contract from `dsh-session-persistence`. These still require their notices. DSH historical JSONL import, v0–v4 converters, format catalog, verifier worker and the original bundled test reference have been deleted. Their two standalone notices and seven directory-local licenses were removed with the corresponding copied sources. Historical tests still importing registry DSH packages receive the packages' own licenses; this is not a claim that all development DSH dependencies are gone. `src/legacy-v4/` now retains only the attributed Windows ACL/process support and image-offload projection used by the application. Retained hashes and removed-format accounting remain in `docs/legacy-runtime-source-manifest.json`.

## Further Pi migration stage

Session publication now uses an application-private capability and branded local
instances, replacing the DSH method-interception compatibility bridge. The original
Session differential fixture was deleted; event validation and folding in
`native-session-protocol.js` remain attributed DSH-derived code, so its notice is
still required. Unreachable original `createRunCodeTool` and tool-result pipeline
helpers were removed from `native-tool-protocol.js`; retained schemas/SDK rendering
remain attributed, and the application code transport keeps its isolation/cancel
semantics. Removing 65 unused direct SDK development declarations does not remove
the remaining development graph or the copied runtime code's license duties.
