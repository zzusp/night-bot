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
