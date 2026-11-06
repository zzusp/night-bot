# Pi 原生清理本机续作

## 基线与边界

指定云端基线 7416964，使用隔离工作树，保留主仓未提交补丁。现有另一套 DSH 服务不属于本轮替换目标。权威进度与证据入口为 ../acceptance/pi-native-retirement-local/goal.md。

## 决策快照

- 先用冻结依赖运行当前测试定位已报告竞态，修复责任层，不以降低并发、吞错或扩大重试掩盖缺陷。
- 官方 Pi AgentSession/SessionManager 负责会话、消息与上下文；审计日志、任务账本、权限、文件边界与未知效果处理属于应用职责。
- 先对照 source-manifest、生产导入守卫和实际文件，确认派生源码及测试副本均已删除后才移除许可证；不以依赖名消失宣称完全清理。
- 本机验收为未合并工作分支的显式授权隔离验证部署，不替换既有生产服务、不合并 main；配置、账号、数据不复制到 Git。
- 现有部署脚本明确属于旧 DSH，不用于 Night Bot。复用 bin/night-bot-* 官方应用入口；如需补充部署流程，放 docs/ops，带零副作用检查。

## 验证

竞态定向测试、pnpm test、runtime/routing/domain/containment 与源码/哈希/导入守卫；检查 Node 原生依赖及实际构建入口；最后在独立安装中验证健康、真实模型、任务执行及隔离拒绝路径。

## 并发锁退役补充决策（2026-11-06，实施前）

Windows 完整默认回归中，16 条真实 channel ingress 并发登记在 `owner.json` 打开时遇到 EPERM；当前释放直接递归删除仍被竞争者观察的锁目录。比较三条路径：全局重试 EPERM 会隐藏真实权限拒绝，不采用；仅在 Channels 内排队不能修跨进程交接，不采用；采用先原子重命名退出可竞争的 lexical 锁路径，再删除私有退役目录。退役名沿用备份已经排除的 `.write-` 临时前缀。竞争者只在独立 lstat 证实目录已消失或 dev/inode 已变时把 Windows EPERM 视作交接竞态；其余权限错误继续失败。活 owner 不因超时被驱逐，令牌复核、死亡 owner 的 reap guard 均保留。验证使用现有 15+1 入站、备份拒绝 live Host、冷恢复和锁竞态专项。

### 反证与最终选择

实际复验否定了目录原子退役方案：Windows 在另一竞争者仍打开 `owner.json` 时连目录 rename 也返回 EPERM，16 写者随后超时；不能保留它并称已修复。撤回该协议改动，复用 `native-fs-local.js` 已有的同进程按资源键 Promise 队列，在 `withLock` 的共享文件事务边界先排序，再取得原有磁盘租约。这样同一 Host 的 15+1 入站不会彼此读删 lease；跨进程仍由现有活 owner/死亡 owner/reap guard 协议裁决，第二个 portable Host 和在线维护仍被 `.host.lock` 拒绝。无全局 EPERM 重试、无活 owner 驱逐、无新依赖、无锁格式迁移；不声称 Windows 跨进程高频共享写者的内核等价保证。新增真实子进程持有/死亡回收与 16 个事务写者测试验证当前边界。
