# 来源与许可

- 仓库既有 `LICENSE`（MIT）原样保留。
- `packages/dingtalk-core`、原有 `test`（不含 `pi-*`）、上游 `scripts` 移植自用户指定的百部插件项目 `HiQ-AI/dingtalk-dsh-assistant`，提交 `93e431a2a76938d32aefc070b093fcfb65691c70`。源项目声明 `UNLICENSED`；移植不将其自动改授 MIT。核心 package 及本仓库 package 保守地保留 `UNLICENSED`，且 `private: true`，不执行 npm 发布。
- 已退休的 `src/pi-loop.js` 及专属循环/重试实现不再随源码分发；对应专属许可证在源码及测试副本核查后移除。历史来源与保留副本见 `docs/retired-notice-copy-audit.json`。
- Pi 五个固定 `1.5.0` SDK 包使用 MIT；原文见 `licenses/pi-1.5.0-MIT.txt`，来源提交、版本及哈希见 `docs/pi-license-source.json`。依赖版本和完整性由 `pnpm-lock.yaml` 固定，其他包保留其随包许可证。

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

`src/process/{index,runner,runner-launch-B2zsQ1Dz}.js` derive from
`@deepseek-ai/dsh-subprocess-local@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek,
under MIT (`licenses/dsh-subprocess-local-MIT.txt`). This is an explicit source fork
of the platform backend, not a from-scratch implementation or a claim that all
DSH semantics have been removed. Local contracts and runner resolution replace
DSH service/loading dependencies; Windows process FFI remains a separate library.

`src/process/output.js` is replaced by an application implementation using a private circular byte buffer and lazy, exclusive, owner-only complete-output spooling. It handles short writes, fsync/seal, spool budget retirement, symlink-root refusal and detached snapshots. Its existing internal provider-facing method contract is retained while the platform fork is migrated. The former collector source is recorded only as historical provenance in `docs/process-fork-manifest.json`; the notice remains necessary for the provider and runner sources.

`src/process/control.js` derives from `@deepseek-ai/dsh-subprocess@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek, under the same MIT terms. The legacy control marker is retained for unmodified worker interoperability.

`src/process/win32.js` derives from `@deepseek-ai/dsh-win32-process@0.2.1-alpha.2`, Copyright (c) 2026 DeepSeek, under the same MIT terms. It retains the Job/token/pipe FFI implementation with local lazy loading. Windows runtime validation remains outstanding on Linux.

Credential storage: `src/native-credentials.js` retains Night Bot's v1 YAML/reference/record format at an explicit path. Implicit DSH home discovery and automatic flat-layout import are removed; unsupported flat files remain untouched and fail startup. `src/credential-file.js` retains the attributed PID-newline/hash takeover protocol from MIT @deepseek-ai/dsh-atomic-write, with inode ownership fencing, fsync and guarded close/drain. Tests now use two application credential processes, with no mixed DSH writer or differential credential implementation. The retained format/lock code still requires the existing notices.

Attachment compatibility: `src/native-attachment-{codec,storage,errors}.js` and `src/native-attachments.js` are application-owned implementations preserving the MIT @deepseek-ai/dsh-attachment-local@0.2.1-alpha.2 v1 content-addressed publication and request-image-v6 normalization/encoding protocols. Sharp performs raster transforms. The source normalization/quality/identity and publication algorithms are adapted with attribution; the original notice is in `licenses/dsh-attachment-local-MIT.txt`. The attachment storage root is explicit; it never falls back to a DSH home. Direct comparison dependencies on dsh-attachment and dsh-attachment-local are removed. Tests now verify content-addressed references, bounded decoded geometry, metadata stripping, immutable originals, variant separation, private storage, cancellation and symlink boundaries directly; source algorithms remain attributed rather than claimed as independent rewrites. Other generic message and LLM projection helpers remain.

`src/native-skill-watcher.js` is an explicit MIT source-derived platform backend from @deepseek-ai/dsh-skill-filesystem@0.2.1-alpha.2 (Copyright (c) 2026 DeepSeek), with local imports and a bounded changing-root admission loop. See `licenses/dsh-skill-filesystem-MIT.txt` and `docs/skill-watcher-fork-manifest.json`. The filesystem provider/discovery is application-owned, uses capability-checked reads and Pi frontmatter parsing, and uses `.agents`/explicit roots with body bytes preserved plus an explicit delimiter-compatibility fallback. Implicit project/user `.dsh/skills` discovery and the DSH home/agents/bundled environment-variable roots are removed; the filesystem provider no longer imports the DSH home resolver. The watcher fork is not described as a from-scratch rewrite or proof of full migration.

Workspace compatibility: `src/native-workspace.js` is an application-owned registry preserving the MIT @deepseek-ai/dsh-workspace v2 account protocol and public error identities. Its archived-subagent admission rule preserves the nonvisual behavior previously mounted by @deepseek-ai/dsh-api-session-controller; the legacy controller itself is excluded from production. The guard follows known session headers and does not copy or mount the UI controller. Existing DeepSeek MIT notices apply.

Prompt assembly compatibility: `src/native-system-prompt.js` is an application-owned registry/assembly implementation preserving @deepseek-ai/dsh-system-prompt@0.2.1-alpha.2 ordering constants and admission algorithms, adapted under MIT (Copyright (c) 2026 DeepSeek), see `licenses/dsh-system-prompt-MIT.txt`. Shared scope collections and public rendering helpers remain explicit libraries; no old SystemPrompt service is constructed or delegated. The optional identity text now names Pi; default Host keeps this identity disabled as before.

模型请求重试由官方 Pi AgentSession/SettingsManager 处理。旧本地重试实现及比较副本已退休，对应专属 notice 已在副本核查后移除；业务未知效果的禁止重放约束仍由 Night 管理。

已退休的子代理 provider、manager、catalog、control 和工具没有替代产品能力。`dsh-subagent` 的共享 sandbox 算法片段仍在，因此保留 `licenses/dsh-subagent-MIT.txt`；专属 provider/control/tool notices 的删除证据见 `docs/retired-subagent-source-manifest.json` 和 `docs/retired-notice-copy-audit.json`。

Approval/preset compatibility: `src/native-approval.js` and `src/native-permission-presets.js` preserve the MIT @deepseek-ai/dsh-{user-approval,permission-presets}@0.2.1-alpha.2 policy vocabulary, model notices, canonical events, preset/projection mathematics, Auto hook, command and RPC contracts (Copyright (c) 2026 DeepSeek). Original notices are in `licenses/dsh-user-approval-MIT.txt` and `licenses/dsh-permission-presets-MIT.txt`. The application owns the services, Pi commit admission, revocation/close fences and terminal journal settlement. Generic message/scope/RPC and filesystem/shell capability adapters remain explicit dependencies.

Trusted shell facts: `src/native-shell-env.js` retains attributed registry/contributor ownership and snapshot behavior from MIT @deepseek-ai/dsh-shell-env@0.2.1-alpha.2 (Copyright (c) 2026 DeepSeek), see `licenses/dsh-shell-env-MIT.txt`. Its DSH home/profile ABI is removed. The application now publishes `NIGHT_BOT_SHELL` and `NIGHT_BOT_SESSION_ID`; declared extensions use `NIGHT_BOT_`, with no home/profile coupling. Bash/PowerShell pass `executionEnv`; process inheritance strips ambient DSH/Night Bot namespaces. Portable privacy admits only explicitly supplied standard execution facts, preserving its restriction on arbitrary extension values. This is an interface/ownership cleanup, not a claim that the retained shell/registry algorithms have been independently rewritten.

## Agent instruction compatibility algorithms

`src/native-agent-instructions.js` 保留 MIT 派生的指令发现、解析、渲染、限额和去重算法，见 `licenses/dsh-agent-instructions-MIT.txt`。现行资源由官方 Pi resource loader 及扩展 hook 刷新；旧 Session 事件、publication/projection 和 Host 消息影子已删除，见 `docs/NATIVE-INSTRUCTION-RESOURCES.md`。受控根、能力读取与取消排空仍属于应用。

## Preset generations and profile compatibility

`src/native-agent-presets.js` retains attributed MIT scope/Loader audit, generation/lease, inventory and remote surface algorithms from pinned `@deepseek-ai/dsh-agent-preset-registry@0.2.1-alpha.2`. The active controller owns its registrations and Pi selection commit/start-race fences. `src/native-profile-preflight.js` retains the required MIT manifest/compatibility/include admission subset from `dsh-app-boot`, without importing or starting app-boot. Legacy peer checks deliberately use the retained v4 ABI `0.2.1-alpha.2`, independently of the Night Bot app/Pi SDK versions; exact historical exemptions never become broader grants. See `licenses/dsh-agent-preset-registry-MIT.txt` and `licenses/dsh-app-boot-MIT.txt`. These compatibility algorithms are source forks, not from-scratch rewrites.

## Subagent control and read-only query compatibility

子代理 manager/control/query 和对应测试副本已删除，见 `docs/retired-session-drivers.md`。会话观察使用严格提交的 Pi journal 与官方 `buildSessionProjection`/`convertToLlm`，不恢复旧缓存或 Session facade。`native-time-zone.js` 的 MIT 派生时区 helper 保留 `licenses/dsh-util-time-MIT.txt`；共享 sandbox 片段仍要求 `licenses/dsh-subagent-MIT.txt`。

## Session title protocol

会话标题服务、fold 和原测试副本已删除。`src/native-capability-errors.js` 仍保留 `SessionTitleInvalidError` 的派生错误构造器，因此 `licenses/dsh-session-title-MIT.txt` 继续保留；这不代表恢复旧标题服务。

## Web capability and HTTP transport

`native-web.js` owns selection/registration and lifetime while preserving the MIT `dsh-web` selection/cap protocol and canonical WebError identity for existing tools. `native-http-fetch.js` retains explicitly MIT source-derived public-address/NAT64 resolution, pinned connector, proxy and MIME/charset policy algorithms from `dsh-web-fetch-http`; The old NativeDeadline source and unused idle-watchdog/public reason constructor are removed. `src/runtime/deadlines.js` schedules disposable clocks with Node timers/promises, combines upstream cancellation and recognizes only clock-produced reason objects for classification. HTTP resource cleanup now uses an explicit finally block instead of the removed compiler disposal helpers. Low-level connector injection/exports are internal testing seams, not a public-request private-network option. Source notices: `licenses/dsh-{web,web-fetch-http}-MIT.txt`. `ipaddr.js@2.5.0` remains a declared parser dependency with `licenses/ipaddr-js-MIT.txt`. Existing proxy policy stays in the retained shared overlay.

## Web tools and cooperative declaration timeouts

`native-tool-web.js` retains explicitly MIT source-derived schema/validation, query merging, bounded HTML-to-markdown, untrusted-output labels and presentation metadata from `dsh-tool-web@0.2.1-alpha.2`; this remains backend metadata, not a recreated UI. `native-tool-timeout.js` preserves the `dsh-tool-call-timeout-policy` structured result/cooperative await protocol, with local reason-identity ownership for nested same-code deadlines. Notices: `licenses/dsh-{tool-web,tool-call-timeout-policy}-MIT.txt`. Markdown dependencies `turndown@7.2.4` and `@joplin/turndown-plugin-gfm@1.0.68` retain their MIT notices under `licenses/`. Generic defineTool/schema helpers remain explicit libraries.

`src/native-tool-working-directory.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-working-directory@0.2.1-alpha.2`; see `licenses/dsh-tool-working-directory-MIT.txt`. This compatibility fork is not described as an original algorithm.

`src/native-tool-todo.js` preserves MIT model-facing schemas/validation/projection and presentation algorithms from `@deepseek-ai/dsh-tool-todo@0.2.1-alpha.2`; see `licenses/dsh-tool-todo-MIT.txt`. This compatibility fork is not described as an original algorithm.

已退休的 subagent control 专属源码与测试副本不再分发，专属 notice 删除证据见 `docs/retired-notice-copy-audit.json`。

已退休的 delegation 专属源码与测试副本不再分发，不声称迁移为新的子代理产品。

`src/native-tool-skill.js` 保留 MIT 派生的技能 schema/catalog/invocation/formatting 算法，见 `licenses/dsh-tool-skill-MIT.txt`。技能当前可见性通过官方 Pi 资源和当前授权 provider 核对；旧 publication loop 已移除。

`src/native-tool-jobs.js` retains MIT job control/notice/rendering source from `@deepseek-ai/dsh-tool-jobs@0.2.1-alpha.2`; its notice remains. The old bounded-retention source module and comparison test are removed. `src/runtime/output-window.js` is an application implementation with scalar-based bounded text windows, exact UTF-8 byte accounting and detached item snapshots; tools retain their domain output schemas. No local retention-library source/test copy remains, so its dedicated notice is retired. Other development tools can still depend transitively on the original library and retain their package licenses. Direct development declarations for the original tool-jobs, tool-fs and tool-fs-search packages are retired; tests validate public schemas, literal argv boundaries, model output privacy and actual Pi execution without loading those original modules. Their remaining source forks still require the corresponding notices.

`src/native-fs-local.js` 使用 Node IO，模型 read/write/edit 使用 Pi 官方工具。`native-fs-protocol.js` 与 `native-fs-observation-policy.js` 仍保留精简改写的能力契约及 owner/target 观察、CAS 意图算法；官方 actor 校验等新增逻辑不消除原来源，继续保留 `licenses/dsh-fs-MIT.txt` 与 `licenses/dsh-fs-observation-policy-MIT.txt`。`src/fs-windows-security.js` 的 DACL/ReplaceFileW 派生桥及 `native-fs-sandbox.js` 隔离策略分别保留 `licenses/dsh-fs-local-MIT.txt` 和 `licenses/dsh-fs-sandbox-MIT.txt`。来源复核见 `docs/acceptance/pi-native-retirement-local/`。

旧 `src/native-tool-fs.js` 及语言映射、副本已删除，当前模型文件能力来自官方 Pi。搜索使用官方 find 与 Night 有界 grep/进程适配；尚未完成专属副本核查的搜索 notice 继续保留，见 `docs/SEARCH-IO-MIGRATION.md`。

`src/native-spill.js` preserves MIT private spill IO, encoding and sweep algorithms from `dsh-spill-local`/the `dsh-spill` data contract@0.2.1-alpha.2; app admission/drain and cleanup scope are explicit adaptations. The old root discovery/scanner, temporary default-root fallback and empty service/locator wrappers are removed. The service now requires an absolute application root; direct comparison dependencies are retired while inherited storage/encoding/sweep attribution remains. See matching licenses. External diff9.0.0 and @vscode/ripgrep1.18.0 licenses are included.

NativeSpill additionally rejects substituted root/session symlinks, applies private directory modes, syncs admitted file writes and awaits them on owner shutdown. Active-root-only cleanup is an intentional application policy; inherited arbitrary ancestor-replacement TOCTOU is not claimed eliminated. Native file image registration explicitly injects its required scoped capabilities rather than relying on inherited injection metadata.

Native shell capability/render protocol, Bash/PowerShell local executors, sandbox consumers and model tools preserve MIT algorithms from matching `@deepseek-ai/dsh-* @0.2.1-alpha.2` modules, using local deadline/process/jobs/sandbox/policy owners. See licenses/dsh-{shell,bash-local,pwsh-local,bash-sandbox,pwsh-sandbox,tool-bash,tool-pwsh}-MIT.txt. Canonical sandbox/schema/message helpers remain; copied compatibility algorithms are not described as original. DSH_ remains a historical script protocol.

Native Bash/Pwsh executors explicitly adapt cancellation: admitted confinement preparation is drained before a timeout/cancel outcome, with no late spawn; owned timeout reason identity prevents same-code ancestor deadlines being misclassified. PowerShell retains the historical BASH_TIMEOUT wire code. These are application lifecycle changes beyond the attributed baseline algorithms.

`native-consumed-work.js` and `native-values.js` retain MIT consumed-work audit accounting and JSON snapshot/freeze algorithms from `dsh-agent`/`dsh-util-values@0.2.1-alpha.2`, with their notices. The primitive brand runtime was a pair of identity functions without runtime state or validation. Calls are inlined without changing evaluation or values; both the standalone source and the embedded skill-tool copy are removed, including the test-support import. The dedicated `dsh-brand` notice is removed only after those copies are gone. Session/tool ownership and validated event positions remain enforced separately.

`native-http-proxy.js` 保留 MIT `dsh-http-proxy` 派生策略和 undici/子进程环境代理算法，见 `licenses/dsh-http-proxy-MIT.txt`。旧 `native-code-language.js` 及其专属 notice 已删除。所有应用 CLI/HTTP/进程共享受控代理；未新增备用凭据或外部 home。

The former `native-prompt-render.js` implementation and original-renderer comparison test are removed. `src/runtime/prompt-template.js` compiles application literal/reference operations with own-property, single-pass string expansion and structured owner-attributed errors. The prior context framing sentence and variable grammar remain part of Night Bot context/history behavior; system-prompt registry/assembly adaptations and their MIT notice remain. The unused `native-typert-protocol.js`, structural DSH error/owned-value markers, method descriptors, invocation accessor and Gateway binding machinery are removed, together with their differential tests and optional agent Gateway lookup registration. Application control services inherit Cordis Service directly. `runtime/control-error.js` independently snapshots ordinary diagnostic facts with immutable codes; it is not a replacement RPC transport or an authority token. No local protocol source/test copy remains, so the dedicated `dsh-typert-protocol` notice is removed. Retained preset/subagent/model algorithms retain their own notices.

`native-credential-protocol.js` preserves MIT dsh-credentials scope/id/reference grammar and primitive branding helpers. Core workflow configuration retains exactly the existing stored addresses; its source hash and explicit adaptation are recorded.

`src/native-scope.js` retains MIT scoped stores/parent graph/event carrier algorithms from dsh-scope@0.2.1-alpha.2; test/fixtures/legacy-scope.mjs preserves the original source as an independent reference. The private compatibility package only re-exports the same local implementation for retained SDK peer names, preventing duplicate authority stores. Historical helper ABI version is not a Pi/app version. See licenses/dsh-scope-MIT.txt and docs/scope-compat-manifest.json.

`src/native-sandbox-protocol.js` derives escalation, root and diagnostic algorithms from MIT `@deepseek-ai/dsh-sandbox@0.2.1-alpha.2` (license: `licenses/dsh-sandbox-MIT.txt`). Its public SandboxUnavailableError identity remains explicitly external; no abstract legacy provider is mounted or copied.

`src/native-message-protocol.js` derives immutable message construction, context/image/file projections and retained compact audit decoding from MIT `@deepseek-ai/dsh-llm@0.2.1-alpha.2`; see `licenses/dsh-llm-MIT.txt`. Pi continues to own execution. The legacy LlmRuntime service, duplicate retry schema/resolver and differential LLM fixture are removed. Public error classes remain attributed local source; product attribution is application-owned. Provider catalog acceptance is checked against the pinned Pi SDK rather than a DSH provider package. The old stream accumulator and block assembler are removed; owned Pi attempt observation and compact audit writing are in `src/runtime/{attempt-observation,assistant-audit}.js`. Remaining derived message/projection/error code still requires the DSH LLM notice.

`src/native-capability-errors.js` retains MIT error vocabulary from `dsh-web`, `dsh-authorization`, `dsh-workspace` and `dsh-session-title` version0.2.1-alpha.2 (individual licenses in `licenses/`). `packages/capability-compat/` transparently maps their historical public names to native owners and shared constructors; it is not an additional service replacement. Independent original service references in `test/fixtures/legacy-*-interface.mjs` retain their own constructors/algorithms; verified values/brands/domain support imports are local, with original and fixture hashes in `docs/capability-error-reference-manifest.json`.

`native-fs-protocol.js` 保留 MIT 派生的错误/能力契约及 `licenses/dsh-fs-MIT.txt`。`native-sandbox-protocol.js` 与 `native-skill-protocol.js` 的 MIT 派生 sandbox/skill 算法继续保留对应 notices。现行独立 sandbox 比较 fixture 见 `docs/interface-reference-manifest.json`；失效的 projection fixture 条目已经移除。

`native-llm-errors.js`、`native-llm-protocol.js` 与 `native-tool-protocol.js` 保留 MIT 派生的 LLM/tools 公共错误、schema 和渲染算法，对应 notices 保留。旧 LlmRuntime/ToolRuntime/子代理 errors 实现与独立运行时副本已删除，记录见 `docs/execution-protocol-reference-manifest.json`。默认产品标识为 Night Bot。

旧 `native-session-protocol.js` 和 Session/projection facade 已删除；`native-values.js` 仍含共享 JSON 等值算法，保守保留 `licenses/dsh-session-MIT.txt`。`native-persistence-protocol.js` 保留 MIT 派生的严格 IO/error 契约及对应 notice。DSH 历史 JSONL import、v0-v4 converters、format catalog、verifier worker 和原测试副本已删除，不再提供历史数据转换。`src/legacy-v4/` 只保留 attributed Windows ACL/process 支撑，来源见 `docs/legacy-runtime-source-manifest.json`。

## 当前原生权威与保留边界

官方 Pi AgentSession/SessionManager 负责模型调用、消息、上下文、分支、压缩、工具目录与重试。Night 只维护授权、任务账本、可移植路径、writer lease、严格提交封装和副作用收据；不再发布可变 Session 或另一份消息投影。

独立投影注册表及其测试副本均已删除，本轮移除相应专属 notice。副本扫描及人工核查入口见 `docs/acceptance/pi-native-retirement-local/scripts/audit-retired-copies.mjs`；扫描不构成通用版权法律判断。

外部 DSH 生产/开发声明及锁定包均为零，但派生源码和四份独立测试参考仍保留各自许可。Windows ACL/process、Linux/macOS 进程平台桥、scope、权限、凭据、附件、技能、shell、HTTP、调度及部分协议继续显式署源。Linux 进程观察与后续 signal 非原子；非 Linux 的便携模型进程隐私 namespace 尚不支持，保持 fail closed，不为验收取消限制。
