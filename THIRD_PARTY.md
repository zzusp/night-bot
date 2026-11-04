# 来源与许可

- 仓库既有 `LICENSE`（MIT）原样保留。
- `packages/dingtalk-core`、原有 `test`（不含 `pi-*`）、上游 `scripts` 移植自用户指定的百部插件项目 `HiQ-AI/dingtalk-dsh-assistant`，提交 `93e431a2a76938d32aefc070b093fcfb65691c70`。源项目声明 `UNLICENSED`；移植不将其自动改授 MIT。核心 package 及本仓库 package 保守地保留 `UNLICENSED`，且 `private: true`，不执行 npm 发布。
- `src/pi-loop.js` 的生命周期、持久 inbox、工厂和会话适配代码基于 `@deepseek-ai/dsh-agent-loop@0.2.1-alpha.2`，版权 DeepSeek，MIT 许可原文见 `licenses/deepseek-agent-loop-MIT.txt`。原模型/工具 step 循环已替换为 pi-agent-core 驱动。
- Pi 与 Host 外部依赖的许可证随各依赖包保留；版本和完整性由 `pnpm-lock.yaml` 固定。明确复制的MIT源码及适配边界另列于下。

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
