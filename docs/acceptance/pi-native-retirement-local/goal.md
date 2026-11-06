# Pi 原生清理与本机验收

> 状态：PAUSED（重构前检查点已交付，验收缺口移交）
> Goal ID：pi-native-retirement-local
> 最近维护：2026-11-06T09:22:20.140Z
> 权威目标：goal.md

## 总目标

在指定提交 741696438f5feef82504b3282dc7b975333070ee 基础上完成 Pi 原生化剩余清理、修复文件系统竞态、回归构建，并在当前 Windows 主机安全部署验证真实推理及任务执行，提交推送工作分支，不合并 main。

## 完成条件

- DSH 依赖、派生源码、测试副本和许可证逐项核对；移除项有来源核查，必要保留项明确列出。
- 文件系统竞态根因已修复，定向测试、完整回归、适用构建及安全守卫有当前源码证据；未覆盖项明确。
- 本机独立安装保留所有现有配置、账号与数据，启动、健康、真实 Pi 推理和任务执行达到可观察终态。
- Codex 登录仅通过官方状态/授权接口验证，不读取、输出或复制凭据。
- 代码与证据提交并推送工作分支，独立回查远端；不合并 main、不触发 CI、不发送真实钉钉消息。

## 范围与约束

- 主检出 refactor/pi-native-core 的四处未提交改动原样保留，不迁移或提交。
- 本轮工作树 .claude/worktrees/pi-native-retirement-local，分支 worktree-pi-native-retirement-local，基于远程指定分支最新 7416964。
- 现有 DSH 服务监听 18998/3080，属于另一套安装，不替换、不停服；Night Bot 使用独立安装/端口。
- 所有运行数据和业务产物放各安装根的 data 对应子目录，运行数据不入 Git。
- 仅使用官方 Pi 推理、SessionManager 历史和上下文；应用保留授权、安全边界和副作用收据。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 保护现场与恢复基线 | Git/服务核对，隔离指定提交，账号状态安全核查 | 完成 | 起始 HEAD 457270a；隔离 HEAD 7416964；codex login status: Logged in using ChatGPT |
| SG2 | 竞态修复与 DSH 清理 | 根因回归与来源/许可守卫通过 | 完成 | round-2：事务队列、活 owner/备份拒绝及来源守卫通过，保留 51 份 notice |
| SG3 | 完整回归与构建 | 定向、test/runtime/routing/domain/containment、适用构建完成 | 部分完成 | 最终 runtime 149 通过/12 跳过；用户要求收尾，最终默认全量未重复跑，旧失败及复验如 round-2 |
| SG4 | 本机部署与真实模型/任务 | 启动健康、OAuth 和 API Key 真调用、受控文件任务与重启持久化 | 部分完成 | 当前最终源码健康及同一任务冷重启不重放通过；API Key 缺实际引用值 |
| SG5 | 提交推送与交付 | 工作分支远端哈希和报告回读 | 完成 | 源码 b59daa34137226fcc270e30c0dade00fabc6bdcd 已提交/推送并 ls-remote 核对；PR #1 OPEN / Draft / MERGEABLE；后续仅交付记录文档提交 |

## 当前检查点

- 当前子目标：SG5
- 已确认：真实 OAuth 文件任务 completed；IPC 正常退出后同一任务文件/journal SHA-256 不变，write 仍一次。用户指定的 API Key YAML 只有引用，当前进程无实际值；不搜索其他秘密文件。
- 用户最新授权：适当放宽单测，完整功能优先。Windows 的真实集成测试业务期限使用原基准的两倍；双冷启动来源用例使用 60 秒，Linux 与生产期限不变。权限、CAS、32 轮续办、scope 和 no-replay 断言未删。
- 已完成修复：Windows 链接/路径、SQLite 所有权关闭、UTF-8 Python、受管 IPC 与资源阶段化；调度 22/22。最终 runtime 149 通过/12 跳过；32 轮专项实际 303638 ms，通过 32 个来源 lease、30 次官方摘要及 25 条原生 compaction，原效果一次。
- 来源结论：只删除 projection 专属 notice。两份 FS notice 因保留精简派生契约/算法恢复，相关源码和文档已署源；扫描无 40-token 匹配不作为独立来源证明。移除三个未接线的上下文/目录适配模块；官方会话入口保留。
- 当前源码：基线 7416964 + 未提交工作树；runtime 400 模块，指纹 0b3799325503d509dabc03dcdf86ea47d593ffd68ac139f28fae1bf6a0001fde；外部生产/开发/lock DSH 包均为 0，保留 51 份 notice。
- 回归检查点：最终 runtime 161 项，149 通过、0 失败/取消、12 跳过，exit 0；32 lease/30 官方摘要/25 compaction/write=1。锁层定向 2/2，事务异常释放及活 Host/备份拒绝 2/2。最终默认未全量重跑；版本及历史结果集中见 round-2.md 和 round-2/results.json。
- 本轮实例：bkhl9b3qq 监督器，127.0.0.1:19198；bh32h44dl 已 IPC 正常退出 0。当前 0b379932 源码冷启动，同一真实任务文件/journal 哈希和 write=1 保持不变（proof-after-queue-restart.json）。仅本轮 data，未注册系统服务，保留原安装与既有服务。
- 成员结果已从实际 end_turn 回传记录接回：retirement-source-audit 只读完成；windows-schedule-regression 交回文件写入权，无在途操作。无需重派或等待重复回执。
- 未闭环项：最终默认全量未重跑；routing/domain/containment 为最终队列之前的通过证据。API Key 缺实际引用值；Windows 进程隐私成功路径不可用，保留失败关闭。用户要求尽快收尾，接下来重构，这些边界明确移交，不宣称全部验收通过。
- 唯一下一步：重构从工作分支 worktree-pi-native-retirement-local 的源码检查点 b59daa34137226fcc270e30c0dade00fabc6bdcd 继续，接续 round-2 的默认全量/API Key/Windows 平台验收缺口。本目标不再自动推进；无在途测试。PR https://github.com/zzusp/night-bot/pull/1 为 OPEN、Draft、MERGEABLE，base 为 refactor/pi-native-retirement；未合并 main，未触发 CI。
