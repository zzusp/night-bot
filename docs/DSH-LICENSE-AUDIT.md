# DSH 许可逐份核查（2026-11-16）

外部 DSH 运行/开发依赖已为零，但删除包依赖不代表复制或派生的源码已经消失。以下按仍分发的具体实现逐份核查，而不是按文件名批量删除许可。

## 本次退休

| 许可 | 退休对象与核查 |
| --- | --- |
| `dsh-agent-MIT.txt` | 无生产消费者的 `native-consumed-work.js` 与专属测试case；JSON工具测试保留 |
| `dsh-util-time-MIT.txt` | 无生产消费者的 `native-time-zone.js` 与旧子代理helper专属测试 |
| `dsh-session-MIT.txt` | 无外部消费者的 `native-values.js` 中 `deepEqualJson` |
| `dsh-session-title-MIT.txt` | 无生产消费者的 `SessionTitleInvalidError` 及专属测试 |

算法、副本及调用核查记录见 `dsh-license-copy-audit.json`。连续token扫描是辅助证据，不能代替来源审查，也不等同通用版权法律判断。原始来源提交、历史验收记录保持不变。

## 保留清单

以下所有许可路径均为 `licenses/dsh-<名称>-MIT.txt`，源码路径默认以 `src/` 为根。默认未挂载的完整保留源/测试副本也仍需归属；下表不将它们误记为生产必需。

| 名称 | 对应仍分发的派生实现 / 保留依据 |
| --- | --- |
| `agent-instructions` | native-agent-instructions.js：指令发现、解析、渲染和限额 |
| `agent-preset-registry` | native-agent-presets.js：scope/Loader、generation与lease |
| `app-boot` | native-profile-preflight.js：manifest/include准入子集 |
| `attachment-local` | native-attachment-{codec,storage,errors}.js、native-attachments.js：v1内容寻址与图像规范化 |
| `authorization` | native-capability-errors.js；test/fixtures/legacy-authorization-interface.mjs：错误及独立参考算法 |
| `bash-local` | native-bash-local.js：旧本地executor；仅测试/保留源链消费，并非默认Host |
| `bash-sandbox` | native-bash-sandbox.js：旧sandbox executor；仅测试/保留源链消费，并非默认Host |
| `credentials` | native-credential-protocol.js、native-credentials.js：scope/id/reference与v1存储协议 |
| `fs` | native-fs-protocol.js：错误与能力契约 |
| `fs-local` | fs-windows-security.js：Windows DACL/ReplaceFileW桥 |
| `fs-observation-policy` | native-fs-observation-policy.js：owner/target观察及CAS意图 |
| `fs-sandbox` | native-fs-sandbox.js：路径containment与调用级策略 |
| `http-proxy` | native-http-proxy.js：代理策略与环境适配 |
| `llm` | native-message-protocol.js、native-llm-{errors,protocol}.js：消息、错误与schema |
| `permission-presets` | native-permission-presets.js：权限preset/投影及准入算法 |
| `pwsh-local` | native-pwsh-local.js：旧PowerShell executor；仅测试/保留源链消费，并非默认Host |
| `pwsh-sandbox` | native-pwsh-sandbox.js：旧PowerShell sandbox；仅测试/保留源链消费，并非默认Host |
| `sandbox` | native-sandbox-protocol.js；test/fixtures/legacy-sandbox-interface.mjs：root/escalation/diagnostic算法 |
| `sandbox-windows-acl` | process/windows-acl.js、process/windows-acl-runner.js：Windows ACL派生源 |
| `schedule` | native-schedule-protocol.js、native-schedule.js：calendar/record/history管理 |
| `scope` | native-scope.js；test/fixtures/legacy-scope.mjs：scope存储、parent graph及事件 |
| `session-persistence` | native-persistence-protocol.js：严格IO/error契约 |
| `shell` | native-shell.js：旧shell/render协议；仅测试/保留源链消费，并非默认Host |
| `shell-env` | native-shell-env.js：registry/contributor ownership及snapshot |
| `skill` | native-skill-protocol.js：技能协议算法 |
| `skill-filesystem` | native-skill-watcher.js：watcher平台后端 |
| `spill` | native-spill.js：spill数据契约 |
| `spill-local` | native-spill.js：私有IO、编码与sweep算法 |
| `subagent` | native-sandbox-protocol.js、native-pwsh-sandbox.js及sandbox fixture：仍含共享算法片段，非保留子代理架构 |
| `subprocess-local` | process/{index,runner,runner-launch-B2zsQ1Dz,control,win32,windows-acl,windows-acl-runner}.js：平台进程/FFI/ACL派生实现 |
| `system-prompt` | native-system-prompt.js：prompt排序、registry与assembly |
| `tool-bash` | native-tool-bash.js：命令参数、权限提示、Job与结果适配 |
| `tool-call-timeout-policy` | native-tool-timeout.js：结构化超时结果和cooperative await协议 |
| `tool-fs-search` | native-tool-fs-search.js：保留配置schema及rg路径/相对路径代码；扫描仍发现连续40-token副本 |
| `tool-jobs` | native-tool-jobs.js：Job control/notice/rendering |
| `tool-pwsh` | native-tool-bash.js及native-tool-pwsh.js：共享PowerShell适配不等于源码退休 |
| `tool-schedule` | native-tool-schedule.js：调度工具协议 |
| `tool-skill` | native-tool-skill.js：schema/catalog/invocation/formatting |
| `tool-todo` | native-tool-todo.js：schema/validation/projection/presentation |
| `tool-web` | native-tool-web.js、runtime/web-html.js：查询合并、HTML转换和输出适配 |
| `tool-working-directory` | native-tool-working-directory.js：模型工作目录工具schema/rendering |
| `tools` | native-tool-protocol.js：authoring DSL、Python SDK及错误/schema/rendering |
| `user-approval` | native-approval.js：审批策略词汇、事件与command/RPC契约 |
| `util-values` | native-values.js：JSON snapshot/freeze；移除session等值函数不删除这些算法 |
| `web` | native-capability-errors.js：Web能力错误词汇 |
| `web-fetch-http` | native-http-fetch.js：公网/DNS/NAT64和固定HTTP传输 |
| `workspace` | native-workspace.js、native-capability-errors.js及workspace fixture：v2账户协议、admission与错误 |

## 后续移除边界

- 旧 shell/local/sandbox 完整源链若另行退休，可在清理专属测试与共享片段后继续减少通知；不能只删 notices。
- Windows process/ACL、网络、文件策略、凭据和调度属于跨平台或持久化边界，替换需逐模块实现、Linux/Windows 回归和格式兼容检查，不是改名或删除许可可完成的清理。
- 小型错误/schema/工具适配片段也保留真实来源；使用 Pi 的工具定义并不自动覆盖 Night 保留的进程、输出和策略实现。
- 保留的具体范围由 `THIRD_PARTY.md` 与对应 source manifest 说明。历史归属文字不因退休而伪造或覆盖。
