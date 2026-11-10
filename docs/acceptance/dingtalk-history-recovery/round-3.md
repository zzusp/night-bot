# 第三轮：普通停机提速与真实重启

## 范围与版本

2026-11-10，本轮修复普通停机隐式全任务封存，以及四项 Windows 归档测试夹具缺少真实工作区初始化的问题。PR #30 已合并，实际发布版本为 `585e1c767ee7d45b6422ff43e5d288489c06f697`，发布检出 tracked 工作树干净。测试绑定 `ab48be11276869c75cf4485a76b52243d3111c12`；其代码树与部署 merge 一致。本轮后续仅回填验收文档，不再次部署。

前两轮结果保留；当前矩阵见 [matrix.csv](matrix.csv)。最终脱敏证据：[运行及持久状态](round-3/runtime-proof.json)、[测试摘要](round-3/test-proof.json)。不归档消息正文、账号、配置内容、凭据或逐记录私有哈希映射。

## 根因与修复

- 旧普通 close 在真实业务排空后，仍对全部任务逐一 `seal()`。现场一个任务含 84,086 个文件和 10,452 个目录，扫描、哈希及完整复验阻塞进程退出；端口关闭不代表停机完成。
- `packages/dingtalk-core/task-session-service.js:1945` 改为等待 `archives.idle()`，不再隐式全量封存。原任务、执行、通知、复盘、观察器和 SQLite 排空及错误聚合保留，无超时截断、脱离 Host 的后台封存或自动强退。
- 显式离线 backup 的安装锁、事务快照、完整 seal/validate、Pi commit/identity、附件及冻结输出校验不变。普通关闭后的 live-projection 不可直接当作已验证备份。
- 两个归档测试文件使用真实 `task.workspace.begin` → Native 目录初始化 → `task.workspace.finish`，再 claim；修正四项夹具失败，不 mock ready，不放宽生产守卫。

## 本地实跑

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| `node --test test/pi-task-archive.test.js test/pi-native-task-archive.test.js test/task-archive-scheduling.test.js test/pi-business-drain.test.js` | 15 PASS，0 FAIL，0 SKIP | 普通 close 不生成 seal；显式备份/异根恢复、原 Pi 字节、附件和冻结输出、损坏/链接及不完整尾拒绝、hold/no-replay、业务排空 |
| `node --test --test-name-pattern='service close drains the real task, observers and owned SQLite' test/task-session-service-native.test.js` | 1 PASS，0 FAIL，0 SKIP | 早期 reflection cleanup 故意报错后，真实任务、观察器和 SQLite 仍完成清理，原异常保留 |
| `pnpm check` | PASS | 来源/hash、生产 import、Native runtime 三守卫；实际发布目录亦通过 |
| `git diff --check` | PASS | 实现与测试提交前无空白错误 |

本轮未改依赖或 Web 源码，未重建无变化的前端；未重跑完整 runtime/routing/containment 和前两轮浏览器场景，不宣称全项目测试通过。

## 真实安装停机与恢复

旧版 `491adbb` 更新前再次卡在封存阶段：先正常请求停机，确认业务排空且只剩封存后，按本轮明确授权仅受控结束该旧 worker；全部旧进程退出，SQLite 检查正常。这次含强退，不能作为新版正常退出证据，也没有手工删锁。

新版部署后，对同一安装及同一大工作区单独实测正常 IPC 停机：

- 仅发送 `{type:'night-bot-shutdown'}`，`forced:false`。
- 从请求停机到 supervisor、launcher、worker 全部退出耗时 **1256 ms（1.256 秒）**；这是停机耗时，不是完整部署或启动耗时。
- 进程元数据和安装所有权正常释放，无 kill、删锁或业务重放。
- 随即启动同一新版；2026-11-10 15:18:46 +08:00 核实 Web HTTP 200，两个真实渠道均 `listening`、connected，error 为空。本轮此后不再重启。

## 持久终态

2026-11-10 15:20:36 +08:00，与本轮更新前基线逐记录比对：

| 对象 | 基线 | 保持原哈希 | 最终总数 |
| --- | ---: | ---: | ---: |
| 来源 | 16 | 16 | 16 |
| 通知 | 14 | 14 | 14 |
| 任务 | 5 | 5 | 5 |
| messageFacts | 16 | 16 | 16 |

配置哈希不变；14 条通知仍为 delivered，executions=0；SQLite `quick_check=ok`。两个入口均未暂停，deferred=0，无持久恢复界，补拉水位继续推进。这里使用本轮停机前基线，不把第二轮之后自然产生的记录变化计作重启副作用。

原外部效果待核实告警保留，整体 `/health` 仍为 degraded、recoveryIssueCount=1；它不表示本轮渠道恢复失败。本轮没有清告警、修改账本、重建任务、发送测试消息或重试未知外部效果。

## 结论与证据保留

停机全量封存根因和四项归档夹具问题已修复、合并并实际部署；16 项相关测试通过，同安装正常退出 1.256 秒，服务及双渠道已恢复。代码与业务验收完成，无需再重启。

本轮最终证据核实后，清理第二轮已被替代的 JSON 附件，保留第二轮自包含文字结果与矩阵历史；一次性本地脚本、日志及私有基线不入库。当前服务仍使用的本地监督器脚本保留。
