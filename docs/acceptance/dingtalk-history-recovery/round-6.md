# 第六轮：启动修复发布与完整重启

## 版本与范围

按用户明确选择的“合并部署并复测”执行。PR [#32](https://github.com/zzusp/night-bot/pull/32) 已于 2026-11-10 16:17:24 +08:00 合并，发布精确 merge `568fd2813e2d553741a76b0c76bbfffb869891f8`，替换原 `585e1c767ee7d45b6422ff43e5d288489c06f697`。发布目录 tracked 工作树干净，两个运行文件与 42 项回归所验 `516babbe21c548dda3ab273c717dd7df02391fc6` 完全一致；实际 SHA-256 和本轮结果见 [restart-proof.json](round-6/restart-proof.json)。本轮提交仅回填验收文档，不改变受验源码。

合并树包含同时进入主线的渠道添加卡与页面标题改动，因此先在精确 merge 上执行 Web 类型检查和生产构建，停机后部署对应静态文件；不能复用旧 dist。依赖与 lockfile 相对原发布未变，不安装新包。准备期间旧服务保持运行，未碰其他会话的主检出。此后主线另有 PR #28/#31，未纳入本次精确 #32 发布；两运行文件及本验收目录相对随后主线未变，不为追逐浮动主线扩大部署范围。

## 连续计时

先执行 `--check` 零副作用预检，再从正常 IPC 停机请求用同一进程 `performance.now()` 连续计时。等待旧 supervisor、launcher、worker 全退出且所有权释放后，切换源码和已准备的静态文件，再启动无诊断 preload 的原受管入口。250 ms 轮询、单请求必要超时 2 秒；没有整体截断、强退、手工删锁或跳过恢复。终点为 Web/resident HTTP 200，认证渠道列表回读原两个渠道均 connected/listening、无运行错误、无需重启。

本机时间：2026-11-10 **16:28:59.025 +08:00** 请求停机，**16:29:40.613 +08:00** 首次确认全部就绪。

| 指标 | 耗时 | 口径 |
| --- | ---: | --- |
| 正常停机 | 15.641 秒 | 旧三进程退出、安装所有权释放 |
| 发布切换及启动前检查 | 1.143 秒 | 源码检出、已构建 Web 复制校验和启动前检查 |
| Web 可用 | 36.728 秒 | 从停机请求起算 |
| resident HTTP 可用 | 36.748 秒 | 从停机请求起算 |
| 启动及渠道恢复 | 24.803 秒 | 新启动请求至全部就绪 |
| **完整发布重启** | **41.587 秒** | **停机请求至 Web、resident 和原双渠道全部就绪，包含切换** |

这是一次真实现场结果，不是稳定冷启动上限。本轮停机并非之前的 0.443 秒；不把历史停机成绩替代此次实际值。缓存与系统负载未受控，不用第四轮 259.662 秒或第五轮原版带诊断的 28.481 秒计算严格同条件提速比例。直接机制证据仍是第五轮同一 4061 会话快照完全一致、中央读取 8112→4056、单次枚举 39.575→15.340 秒。

## 终态与持久性

- 原两个渠道均 `runningConnected=true`、`runningConnectionState=listening`、`runningErrorCode=null`、`restartRequired=false`。
- 两渠道 `paused=false`、deferred=0、`recoveryFromAt` 清除；完成补拉水位 `backfillThroughAt` 均推进。没有新消息，消费水位 `consumedAt` 保持不变。
- SQLite 18 来源、14 通知、5 任务和 0 执行记录逐记录哈希与停机前一致；14 通知仍 delivered，18 条 messageFacts 一致。驻留 groups/tasks/alerts 哈希亦一致，`quick_check=ok`，配置字节哈希不变。
- 新 supervisor/launcher/worker 存活、精确版本匹配；真实 HTTP 首页及两个 CSS/JS 静态文件 SHA-256 与精确 merge 构建及部署文件一致。
- 原 `degraded`、`recoveryIssueCount=1` 外部效果待核实告警保留；不清告警、不自动续办、不改回执、不发送测试消息。服务保持运行。

首次验收脚本错误要求 `backfillThroughAt=null`，在服务已就绪且原持久数据及配置核对通过后报断言失败。真实 `src/channels/plugins/dingtalk-storage.js:80` 的 `completedRange` 应保留并推进此水位，只有 `recoveryFromAt` 清除。依据该合同修正只读验收，复验通过；没有改生产逻辑、改持久状态或再重启。连续时间已在首次达到就绪时保存，未因复验延长或重置。

## 验证与清理

- 精确 merge 的 Web `tsc --noEmit && vite build` 通过：293 modules、构建 5.32 秒；有单 chunk 大于 500 kB 的非阻断提示，未顺手改打包策略。真实 HTTP 回读产物哈希一致。
- 精确合并工作树及实际发布目录分别 `pnpm check` 通过：source/hash、production-import、Native runtime 三守卫；404 生产 import 文件、404 runtime JS、外部 SDK import=0。
- 第五轮 42 PASS/0 FAIL/0 SKIP 绑定的两运行文件与发布完全一致，本轮不重复跑，也不称作新实跑。未重跑完整 runtime/routing/containment，未重新验收其他会话的 UI 全套浏览器用例；没有相关权限或执行器变更。
- 最终脱敏证据读回核实后，清理第五轮被替代 JSON、CPU profile/诊断/基准/测试日志、私人快照及不再使用的一次性脚本；保留全部历史 round 报告、矩阵历史与本轮必要最终 JSON。仍托管现有服务的两脚本保留，未清理运行数据、WAL、会话或其他会话资源。

结论：重复会话枚举/读取修复已合并、部署并完成正常重启现场复验。当前全程 41.587 秒，其中启动恢复 24.803 秒；不承诺固定耗时，不扩大为持久缓存或无关性能治理。
