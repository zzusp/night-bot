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

以下所有许可路径均为 `licenses/dsh-<名称>-MIT.txt`，源码路径默认以 `src/` 为根。需同时核对动态加载：`src/host.js:250` 按 shell 拼接加载 Bash/PowerShell sandbox，不能只查完整文件名引用。独立保留测试副本也仍需归属。

| 名称 | 对应仍分发的派生实现 / 保留依据 |
| --- | --- |
| `agent-instructions` | native-agent-instructions.js：指令发现、解析、渲染和限额 |
| `agent-preset-registry` | native-agent-presets.js：scope/Loader、generation与lease |
| `app-boot` | native-profile-preflight.js：manifest/include准入子集 |
| `attachment-local` | native-attachment-{codec,storage,errors}.js、native-attachments.js：v1内容寻址与图像规范化 |
| `authorization` | native-capability-errors.js；test/fixtures/legacy-authorization-interface.mjs：错误及独立参考算法 |
| `bash-local` | native-bash-local.js：本地executor；Host动态加载sandbox后继承此实现 |
| `bash-sandbox` | native-bash-sandbox.js：sandbox executor；Host第250行按shell动态加载 |
| `credentials` | native-credential-protocol.js、native-credentials.js：scope/id/reference与v1存储协议 |
| `fs` | native-fs-protocol.js：错误与能力契约 |
| `fs-local` | fs-windows-security.js：Windows DACL/ReplaceFileW桥 |
| `fs-observation-policy` | native-fs-observation-policy.js：owner/target观察及CAS意图 |
| `fs-sandbox` | native-fs-sandbox.js：路径containment与调用级策略 |
| `http-proxy` | native-http-proxy.js：代理策略与环境适配 |
| `llm` | native-message-protocol.js、native-llm-{errors,protocol}.js：消息、错误与schema |
| `permission-presets` | native-permission-presets.js：权限preset/投影及准入算法 |
| `pwsh-local` | native-pwsh-local.js：PowerShell executor；Host动态加载sandbox后继承此实现 |
| `pwsh-sandbox` | native-pwsh-sandbox.js：PowerShell sandbox；Host第250行按shell动态加载 |
| `sandbox` | native-sandbox-protocol.js；test/fixtures/legacy-sandbox-interface.mjs：root/escalation/diagnostic算法 |
| `sandbox-windows-acl` | process/windows-acl.js、process/windows-acl-runner.js：Windows ACL派生源 |
| `schedule` | native-schedule-protocol.js、native-schedule.js：calendar/record/history管理 |
| `scope` | native-scope.js；test/fixtures/legacy-scope.mjs：scope存储、parent graph及事件 |
| `session-persistence` | native-persistence-protocol.js：严格IO/error契约 |
| `shell` | native-shell.js：shell/render协议；Host动态加载的Bash/Pwsh执行器继承此实现 |
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

## 当前维护边界

- 保留当前正常运行的执行实现，不为消除 DSH 名称重写或替换 Pi 后端。
- 只清理无消费者的旧入口、失效命名和容易误导当前架构的说明；不改工作中的接口、持久化协议、进程控制、取消排空及隔离行为。
- shell/local/sandbox 是实际生产执行链。Pi提供工具定义，应用适配提供后台Job、完整输出、取消排空及隔离，继续按现状使用。
- Windows process/ACL、网络、文件策略、凭据、调度及工具协议保留现有实现与许可。名称整理不代表这些代码已独立重写。
- 原版权头、许可正文、来源包名、source manifest和历史验收身份原样保留；这些是有效归属，不属于无用标记。

## 动态加载核对更正

初次静态文件名检索将shell链误判为仅测试引用，已纠正。实际链路为 Host 动态加载 native-{bash,pwsh}-sandbox → native-{bash,pwsh}-local → native-shell → process backend。Pi工具定义不等于其默认本地执行后端已采用。
