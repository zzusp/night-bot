# 第五轮：启动慢根因与单次严格枚举

## 版本与范围

原基线及仍运行的发布为 `585e1c767ee7d45b6422ff43e5d288489c06f697`。本轮在 `worktree-runtime-startup` 修改 2 个运行文件及相关测试/文档，候选尚未合并部署；受验文件 SHA-256 见 [startup-proof.json](round-5/startup-proof.json)。不改配置、schema、权限、默认渠道或 Pi SDK，不删除历史日志或业务文件。

## 取证与反证

第四轮完整重启 259.662 秒，其中正常停机 0.443 秒、启动恢复 259.218 秒。分别比较模块加载、插件初始化和任务恢复：

- 仅加载 Host、application 模块约 5.9/5.7 秒，秘密目录仅 3 条目，不足以解释四分钟。
- 在一次正常 IPC 重启中，仅用本地忽略目录的只计时钩子与 CPU 采样观察原版：Host loader 从 2.553 秒到 23.222 秒，任务服务构造 23.468 → 23.507 秒，HTTP 23.518 秒可用；主要瓶颈在插件加载内的会话枚举，不是任务排空或钉钉恢复。
- 真实安装有 4056 份中央 Pi 日志、约 74 MB。工作区初始化先 `sessionPersistence.list()` 再 `sessionCatalog.listHeaders()`，后者又完整枚举；旧 list 对每份先读 header，再通过 stat 全量重读并解码。共享 cwd 随每个会话重复 realpath/stat。
- 原版此次带采样的完整重启为 28.481 秒，两个渠道已恢复，forced=false，配置不变。系统缓存/负载未受控，因此不能把第四轮与此次时间差当作修复效果，也不声称原版稳定需要四分钟。

## 修复

- `src/native-workspace.js:100`：只取一次应用会话目录的受信元数据快照，用于索引及首次 bootstrap，保留 live/stored 身份冲突拒绝。共享 cwd 只在同批复用解析，每次新索引重新核验。
- `src/pi-session-persistence.js:154`：每份文件只读一次，用同份字节核 filename/identity、严格 commit/checksum、审计及官方 Pi 上下文投影。小批并行最多 8 份，本批失败先等待 I/O 全部结束再抛错；路径父链、符号/硬链接拒绝、writer 原快照、task route、取消语义保留。
- 不增加持久会话缓存或轻量 header 代替完整验证，不提前开放 HTTP，不改维护/离线 requireComplete/no-replay 合同。

## 实跑

1. `node --test test/pi-native-store.test.js test/pi-native-workspace.test.js test/pi-application-session-catalog.test.js test/pi-routed-journal.test.js test/pi-maintenance-journal.test.js`：42 PASS、0 FAIL、0 SKIP，38230.5123 ms。覆盖真实 Host 目录权威、中央/任务/活 writer 多批列表、未提交尾原样保留但严格 open 拒绝、checksum/改名/硬链接拒绝、重启只枚举一次及新索引重新检查已删除 cwd。
2. 新增夹具首轮有多余完整空行及空目录 rm 用法错误，修正夹具后原断言全部通过；未改生产 decoder 或降低目录守卫。
3. 同一安装只读列出 4061 个会话（4056 中央及 5 任务），旧新每一份快照摘要一致。单次 list：原版 39574.846 ms、8112 次中央文件读取；候选 15340.255 ms、4056 次读取。本比较仅为同数据枚举，不是修复版完整重启，也不代表受控冷缓存试验。
4. `pnpm check` 三守卫通过；`git diff --check` 通过。无依赖/Web 代码变化，不重复无变化的构建与完整 runtime/routing/containment。

## 当前边界

本地修复与回归完成，正在运行的仍是旧版；须取得合并/本机部署授权后按 runbook 发布，再用不带诊断钩子的正常 IPC 完整重启验证。原外部效果待核实告警保留，不自动续办。

本轮最终脱敏 JSON 核实后清理第四轮被替代的附件，保留第四轮自包含文字与矩阵历史。包含本机路径的计时器、CPU profile、私有哈希映射均不入库；当前运行脚本仍保留。
