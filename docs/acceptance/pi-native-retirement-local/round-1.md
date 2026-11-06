# 首轮本机验证

## 源码与范围

基线为 `741696438f5feef82504b3282dc7b975333070ee`，分支为 `worktree-pi-native-retirement-local`。本轮工作树有未提交改动，排障期间继续修改，完整批次不具有单一冻结指纹，不能据此宣称最终源码全绿。Windows 11、Node.js 24.19.0、pnpm 11.25.0；未使用 Linux、容器或真实渠道消息。

## 已观察结果

| 检查 | 实际结果 |
| --- | --- |
| 文件系统、watcher、Host 资源、备份定向 | 42 通过，0 失败/取消/跳过 |
| 授权 poison 与备份定向 | 11 通过，0 失败/取消/跳过 |
| 代理与官方 SDK 导入顺序 | 6 通过，0 失败；实际 loopback CONNECT 请求通过 |
| 默认完整回归 | 中断；已经暴露失败，未获得完整通过结论 |
| runtime 首批 | 109 通过、19 失败、3 取消、0 跳过，退出 1 |
| routing 首批 | 44 通过、3 失败，退出 1 |
| domain 首批 | 389 通过、2 失败，退出 1 |
| containment 首批 | 5 通过、0 失败、17 跳过；不等于 Windows 内核隔离认证 |
| 新 undici 锁文件冻结安装 | 成功，`Already up to date` |
| 源码/哈希/生产导入守卫 | 通过；更新后的退休适配器守卫另作下一轮冻结验证 |
| Codex 真实任务与冷重启 | 通过，见后述独立文件与官方日志核对 |
| API Key 真调用 | BLOCKED：指定配置仅提供环境变量引用，当前执行环境无实际值 |

## 关键失败及修复依据

- Windows 目录 watcher 在根目录被重命名、同路径重建后仍持有旧句柄。以目录 dev/inode 身份和 lexical root 的 `watchFile` 观察重新绑定，关闭时释放两类监听；对应定向组通过。
- 应用 undici 7 dispatcher 被官方 SDK 导入的 undici 8 覆盖，真实 Codex 请求直连超时。对齐为 8.12.3，并显式保留 CONNECT。真实 SDK 导入顺序回归及 OAuth 文件任务通过。
- poison 证明子进程故意保留未知提交的所有权；子进程主动 `process.exit` 在 Windows 触发 libuv 关闭断言。父进程接收完成证明后终止隔离子进程，未放开生产关闭或所有权守卫。
- Windows 强制终止 launcher 不能证明子服务排空。受管入口接入 IPC 关闭，启动、健康、日志/临时根与正常退出已实跑。
- 部分测试仍引用旧包目录、缺少官方 actor metadata，或混用 POSIX 绝对路径、权限位和文件 symlink 特权。只修对应夹具及平台前提，不降低生产身份/权限检查。
- 调用方自建 SQLite 在 fixture 删除目录之后才关闭，Windows 报 `EBUSY`。调整到 service/Host 排空、调用方 store 关闭、删除目录的所有权顺序，不以删除重试掩盖仍打开的句柄。
- 原 15ms 定时等待不足以证明持久恢复已经发出 steer，改为等待实际 steer 通知；保留 epoch 与去重断言。
- 首批 runtime/routing 的业务期限超时尚不能作为成功。下一轮重新执行，不能只因失败看起来与负载有关就扩大期限。
- 原默认批次仍包含未接线的 Host 上下文/工具目录适配器测试。核查调用方后退休这条旧链，保留真实 `AgentSession`、签名保护与内存策略测试，下一轮验证替代入口。

## 真实 OAuth 与重启证据

验收任务 `task-8f44cfd527e23890adc1a77e58e89d64` 达到 `completed`，正式 `task_result.action` 为 `complete`。官方工具顺序为 `write`、`read`、`task_result`，仅一次写入，无 shell 或渠道外发。结果包含 `37*19=703`，实际 `work/pi-native-proof.txt` 内容为 `NIGHT_BOT_PI_NATIVE_OK`。

独立脚本 `scripts/verify-live-task.mjs` 在移除临时网络诊断后的冷重启前后读取同一任务、文件及官方 journal；两次摘要完全相等：

- 文件 SHA-256：`abff1f9599a29167c677bb1b48e8069e91f91819822464158056745876bdee30`。
- journal SHA-256：`8f52ff7d09038a6f36082190ea8d5b216db20a88aac07f411c5b341fd7f159cc`。
- 任务仍完成，调用总数为 3，`write` 仍为 1，未重放。
- `/health` 为 `ok`、`modelMode=real`；独立端口 `19198`，未启用渠道。

不提交原始业务任务、凭据、日志或模型会话。原安装、主检出未提交补丁与旧 DSH 服务保持原状。

## 证据保留

本报告保留本轮结果和必要文字证据。本轮旧临时诊断及失败批次附件已在 round-2 摘要形成并核对后清理；本报告的原轮次结果、关键失败与文字证据保留。当前版本和最终证据见 round-2.md、round-2/results.json，不以旧附件证明当前源码通过。
