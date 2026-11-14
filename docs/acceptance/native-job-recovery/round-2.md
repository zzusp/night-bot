# 第二轮：实际作业结清与原任务恢复

## 版本与交付

2026-11-14。本轮源码 PR [#142](https://github.com/zzusp/night-bot/pull/142) 已合并，head `809902c1f4e39781fcb817e569291e5c6065b23e`，merge / 本机实际发行 `1d7c76b48a334fc1370066fea4a21d141691e75a`。已独立核对该发行与受验 head 的 src/bin/test 无差异，发行工作树干净。本文是事后证据归档，不改变运行源码版本。

独立发行安装依赖使用 frozen lockfile，Web TypeScript 与 Vite 实际构建通过。原安装数据继续就地使用；仅更新 channelPluginDirs 到同一已合并发行，permissionMode full 保留，不复制凭据/技能，不创建备份。supervisor 121676、launcher 36036，19198 / 3080 同属 service 132036。监督器 metadata 与实际进程/端口分别核对，不以启动回执替代恢复结果。

## 原作业核验与结清

- 严格完整 Pi decoder + 显式 portable codec 读取原登记、tool call/result。原命令在任务工作区执行 lint 和前端生产构建；lint 完整记录 completed、exitCode=0，stdout/stderr 摘要匹配。构建记录停在 running、exitCode=null，不能宣称成功或无部分产物。
- Win32_Process 全量快照核对原候选 PID、任务路径、wrapper 和 Vue build 命令，未发现对应生产者；保留观察范围和未知退出限制。七份原始记录/输出/进程核验材料的摘要进入操作者报告，不伪造 producerReported。
- 正常 IPC 关闭旧实例确实报 `Host shutdown failed; ownership retained`。渠道监听已结束、端口均关闭、无业务子进程后，重新核对旧 metadata、PID、命令、CreationDate 与父子链，再精确结束残留旧服务；独立确认旧 supervisor/launcher/service/监听子进程均退出、metadata 消失。不将强制结束冒充原作业退出或正常 drain，不删除锁、WAL 或 journal。
- 先运行真实 `night-bot-jobs close ... --check`，返回 checked/noWrites/unknown/noReplay；随后 actual close，独立严格读回独立 job/reconciled。原 journal 18,766,475 字节前缀逐字节不变；追加后 18,768,505 字节；原 job 无新增 settled，producerReported 不存在；该原未决项清零。task body 与三条未 ACK wake 在结清前后逐项相同。
- 原 journal 前缀 SHA-256 `8a69086f91a4ea6ab5a939d45c893fe19d33a7d50ec62c64f6059df82fc76ac4`；冻结操作者报告 SHA-256 `b179988096b6996ae04a0dd537e12b8e2ecb291cb4c7f5b85bcaacb5bd612eff`。固定结论 unknown / closed-with-possible-partial-effects / noReplay，不声称历史构建成功。

## 实际恢复证据

2026-11-14T05:02:30.626Z 的独立验收：

- 正常 Host 冷恢复保留原 taskId/sessionId，lease 17 → 18；sessionFailure=null，task/session 均 running，drained=false 为当前活执行状态。
- 结清后有四次新的成功 PowerShell 调用、一次成功 write 和一次成功 job_list；按新 callId 与实际 toolResult 对应证明恢复，不凭 running 标签、接纳、模型排程或局部 idle 作结论。原具体 callId 在整个 journal 中仍仅一次，原 job 不再未决。
- 原会话的新 task-input 实际含 jobReconciliations，带 unknown/noReplay；冻结操作者报告字节摘要再验证通过。三条 wake 仍由正在执行的会话处理，没有提前 ACK 或代答。
- 认证 Web 任务详情 HTTP 200、session running、无 session-drain-failed blocker；当前实际 JS 字节匹配发行 dist，SHA-256 `92b89c38d1f608b5408e2a69abef37a7dfabc046622b4b1bd1f9d3e1f62e15da`；登录/注销均 200。
- health degraded、recoveryIssueCount 2 → 1；剩余既有业务等待未处理。没有因本次恢复扩大到另一任务。

## 完成与边界

本次“核清未知作业并恢复原任务执行”已完成。原业务修复仍在继续，并未宣称其目标完成、构建通过、PR 合并或业务已验收；未知历史退出码仍未知。完整 test/runtime/routing/containment 未重跑；本轮无 UI 改动，未新增浏览器截图验收。两次验收脚本中的插件层级与相对路径解析问题按真实配置修正后通过，未改运行代码或降低断言。

私有证据在原任务 work/checks/ 的 native-job-recovery-*.json 和 Host-owned materials/runtime-evidence/jobs/ 下，不入 Git。一次性 docs/tmp/native-job-recovery 脚本与 PR 草稿在归档核对后统一清理；不清理运行任务的数据或当前发行。后续判断以本轮和原任务当前执行证据为准，不用第一轮的“尚未部署”替代本轮事实。
