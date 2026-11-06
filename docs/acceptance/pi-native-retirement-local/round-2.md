# 重构前验证检查点

## 范围与源码

Windows 11、Node.js 24.19.0、pnpm 11.25.0。验证时为指定基线 `741696438f5feef82504b3282dc7b975333070ee` 加未提交工作树，分支 `worktree-pi-native-retirement-local`。最终运行时指纹为 `0b3799325503d509dabc03dcdf86ea47d593ffd68ac139f28fae1bf6a0001fde`（400 个运行模块及依赖清单/锁文件）。提交本身不改变已测代码字节；交付 SHA 和远端回查另记，不为让报告包含自身 SHA 循环提交。

用户要求尽快收尾，接下来重构：不再扩改，取消尚未启动的重复全套回归队列，仅接回已运行的最终 runtime。本检查点不是所有验收全绿；真实 API Key 验收仍受阻。

## 结果与版本边界

| 检查 | 实际终态 | 版本边界 |
| --- | --- | --- |
| `node scripts/test-pi.mjs runtime` | 161 项：149 通过、0 失败/取消、12 平台跳过，exit 0；1584957 ms | 最终指纹 |
| 活子进程 owner、死亡回收、16 写者、15+1 入站 | 定向 2/2；实际 batch 为 15、1，送达 16 | 最终指纹 |
| 事务异常不毒化队列、默认 Host 布局、活 Host/在线备份拒绝 | 定向 2/2 | 最终指纹 |
| `pnpm check`、runtime audit、`git diff --check` | 源码/哈希/导入守卫及空白检查通过 | 最终指纹；项目没有独立 build 脚本 |
| 默认完整批次 | 1162 项：1123 通过、12 失败、1 取消、26 跳过，exit 1 | 较早源码，不可称最终全绿 |
| 默认失败文件复验 | 92 项：89 通过、2 失败、1 跳过，exit 1 | 失败的原子退役方案；两个锁失败随后按最终专项复验通过 |
| 提醒/路由纠错、未决作业冷恢复 | 4/4、2/2 | 最终队列之前；这些修复保留 |
| routing / domain | 47/47、391/391，exit 0 | 最终队列之前，未重复全量执行 |
| containment | 5 通过、17 平台跳过、0 失败，exit 0 | 最终队列之前；不是 Windows 内核等价认证 |
| 调度完整文件 | 22/22，exit 0；两次 CLI 以 IPC 排空退出 0 | 最终队列之前 |
| 依赖冻结安装 | `pnpm install --frozen-lockfile` 成功 | undici 8.12.3；同首轮记录 |

结构化摘要见 [round-2/results.json](round-2/results.json)，从实际日志提取计数，区分最终源码与先前源码。默认完整批次修复后的全量重跑未执行，明确交接。

## 根因、失败与复验

- Windows watcher 的 lexical 根被同路径新目录替换后，旧句柄仍可能绑定原目录。增加 dev/inode 身份观察与重新绑定，close 同时释放监听；未吞权限错误。
- 应用 undici 7 dispatcher 被 Pi SDK 的 undici 8 覆盖，导致真实 OAuth 请求未走既定代理。直接依赖对齐 8.12.3，显式 CONNECT；官方 SDK 导入顺序及真实 Codex 文件任务已实跑。
- 并发登记会话会在读取 owner 文件时撞上旧锁目录删除。目录原子退役也被真实 rename EPERM 和 16 写者超时反证，已撤回。最终在通用共享事务 `withLock` 按路径排队，再取得原磁盘租约。跨进程 PID/token、死亡回收、活 Host 拒绝和真实权限错误保留；不声称 Windows 高并发跨进程写者的内核等价保证。
- Windows SIGTERM 强杀返回 null，不能证明排空。受管 launcher/service 走 IPC close；测试消费输出并等 close。SQLite 调用方先关闭 store 再删除夹具；路径使用原生 join/resolve；Windows 用真实 junction 验拒绝路径，不冒充普通文件 symlink 特权。
- Windows 集成测试采用用户同意的较宽期限；32 轮专项使用 600 秒业务预算，Linux 保持 120 秒。最终实际耗时 303638 ms，32 个来源 lease、33 次业务模型调用、30 次官方 summary、25 条原生 compaction，原 write/effect 均一次；不制造空闲恢复模型唤醒。权限、来源、CAS、轮数及 no-replay 断言保留。

## 来源与权威

外部 DSH 生产/开发/锁定依赖均为 0，保留 51 份 notice。只删除已退休 projection 的专属 notice。FS protocol 与 observation 仍含精简派生契约/算法，两份 FS notice 及署源注释保留；40-token 无匹配不能证明独立来源。

删除未接线的 provider/context/tool-catalog 三模块及其专属测试；守卫禁止回流。当前入口仍是官方 AgentSession、SessionManager、catalog 和 context seam；不恢复 Host 消息影子或旧可变 Session。

## 真实任务与冷重启

既有 OAuth 任务 `task-8f44cfd527e23890adc1a77e58e89d64` 为 completed，正式 task_result 为 complete，结果包含 703。当前最终指纹启动后，脚本独立核对同一任务、文件及官方 journal，与停止前摘要完全一致：

- 工具顺序 write → read → task_result；write 仍为 1。
- 文件 SHA-256：`abff1f9599a29167c677bb1b48e8069e91f91819822464158056745876bdee30`。
- journal SHA-256：`8f52ff7d09038a6f36082190ea8d5b216db20a88aac07f411c5b341fd7f159cc`。
- loopback 19198 健康，modelMode=real；未重建任务代替冷恢复。
- 原 18998/3080 服务与主检出补丁未替换，本轮未注册系统服务。

## 未闭环与交接

1. 默认完整回归在最终修复后未重跑；旧批次失败不能勾成通过。此前已通过的 routing/domain/containment 未在最终队列字节上重跑。
2. 用户指定私有 YAML 仅有环境引用，当前环境缺实际 API Key；未搜索其他秘密文件，未读取/复制 OAuth grant，未以 fake endpoint 代替真实调用。安全提供引用值后才能补真实 API Key 验收。
3. Windows 模型子进程隐私 namespace 尚无实现，继续 `MEMORY_PROCESS_PRIVACY_UNAVAILABLE` 失败关闭；shell、后台作业等成功路径未认证，不关闭 sandbox。
4. DWS 是可选插件；未发送真实渠道消息、触发 CI 或合并 main。重构在本检查点之上继续，剩余项并入重构验收，不另起后台重复回归。

## 证据保留

历史 round-1 与 matrix 旧轮列保留；本轮摘要自包含关键失败、复验及真实任务哈希。不提交原始业务任务、模型会话、凭据或运行数据。旧临时诊断按本任务明确清单清理，保留结构化摘要、当前 runtime/锁专项和冷重启必要本机证据；运行中的监督器及其文件不清理。
