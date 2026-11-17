# 第一轮反馈调查审查验收

日期：2026-11-17。范围为 PR #174 两轮 23 条审查发现和直接相关回归，不涉及部署、真实模型、真实消息或反馈 Issue。

## 版本与环境

- 修复起点 `a0d2e58c662589c66d7b50edd87222bdad58b26d`，无冲突整合最新核对 main `98648cd84130f069bd4c52add10dacf2ba095f58`。验证期间合并和反馈修复均为未提交工作树；主检出的既有修改未参与。
- Windows 11，Node 24.19.0、pnpm 11.25.0；两处依赖均按 frozen lockfile 安装，清单、锁文件、allowBuilds 未改。
- 验证源码集合 SHA256：`b6fe5aedd9e00b2e77d701b7cd08ab6ce133e612f89e4ddcf0bb76b6888c57d2`。集合为 scripts/test-pi.mjs、按路径排序的 src/feedback/*.js 和 test/feedback-diagnostic-contract.test.js、test/feedback-local-evidence.test.js、test/pi-feedback-session.test.js、test/pi-feedback.test.js；依次以路径、NUL、文件原字节、NUL 累积 SHA256。后续仅添加交付文档不改变该代码指纹。

## 结论

22 项发现对应修复已通过本地相关验证；1 项审查判断被反证，不作实现变更。逐项结果见 matrix.csv。完整默认回归未通过且未取得最终总表，不能称为全绿，不创建 report.md。

- 已打开句柄核验阻断真实父目录 junction 替换；在测试设置的切换时机，私有文件读取次数为 0。短读累计后的原文和 SHA256 正确，提前 EOF 固定失败。
- 全源码脱敏保留换行，跨页多行凭据不泄露；长行分段可重组到最后字符，页面 JSON 均不超过 16000。并发同查询共享同一构建中快照；源码删除、日志 append 后后续页仍稳定。
- 日志 query 只匹配公开投影；私有路径即使带 src 后缀、空格或同名文件也不能伪装产品 frame。目录超过 256 项后仍选到最新日志；轮转/不可读来源保留其他结果并计 skipped。
- Pi 1.5.0 的 `_compactBeforeNextAssistantResponse` 经 `prepareNextTurnWithContext` 在下一次模型响应前检查压缩。真实官方 SDK + 本地 provider 的用例证明：5 次取证尚未全部结束时已经压缩，之后完成取证、重读 E1 和最终报告。因此“仅 agent_end 后检查”不成立，不另加应用压缩循环。
- 摘要流包装去除预解析 apiKey/headers/env，交回同一 ModelRuntime。测试拦截 runtime.getAuth，断言没有把已解析凭据作为显式 apiKey 重新传入；这只是鉴权参数机制证据，不是实际 OAuth 厂商集成验收。
- 4096 窗口调查、length 不完整提示、96 次预算后摘要失败保留证据、引用完整附上或逐项声明缺口、6000 字描述预留和最终 48000 字符限制均通过。

## 实跑结果

| 命令 | 结果及范围 |
| --- | --- |
| `node --experimental-test-module-mocks --test test/feedback-chain-evidence.test.js test/feedback-local-evidence.test.js test/feedback-diagnostic-contract.test.js test/pi-feedback.test.js test/pi-feedback-session.test.js` | 最终 55 项，53 pass、0 fail、2 skip；含链路、文件、日志、真实 Pi 配合本地脚本 provider、服务预览/提交约束。 |
| `node --test packages/web-console/test/feedback-render.test.js` | 整合 main 后 8 pass、0 fail；页面渲染和交互状态合同，不冒充浏览器端到端。 |
| `node --test --test-name-pattern='feedback HTTP' packages/web-console/test/server.test.js` | 整合后 2 pass、0 fail；显式诊断、手动惰性路径、owner、CSRF、单独确认及精确预览绑定。 |
| `pnpm check` | 源码清单、生产 import、native 守卫均通过：190 retained / 10 retired；455 productionImportFiles，212 literalBareImports；externalSdkImports=0，legacyOrchestratorDefinitions=0。 |
| `git diff origin/main --check` | 通过。 |
| `pnpm test` | 已执行 feedback-* 和大量默认用例，但出现下述 5 项失败，后停滞于冷启动 Shell 用例超时后的清理，没有最终总表；停止后台任务并核归属后清理其残留进程树，未计为通过。 |

## 完整默认回归失败与定向排查

默认回归原始输出可观察到以下失败（不是最终数量统计）：

1. `test/pi-channel-plugin.test.js:325`：带 explicit source quote 的中性 Router 交付用例失败；未取得该次聚合器的最终错误详情，未认定根因。
2. `test/pi-file-tool-registration.test.js:21`：15 秒时限用例在默认回归中失败；原样定向复跑通过，约 12.3 秒。不将单次复跑解释为完整回归通过。
3. `test/pi-live-digest.test.js:9`：定向复跑确认文件 `symlink` 操作 `EPERM`，为当前 Windows 账号权限阻断。
4. `test/pi-memory-store.test.js:58`：定向复跑仍失败，子进程 `acquireLock` 报 `NIGHT_DATA_IN_USE`，触发预期 exitCode=0 的断言。未修改记忆锁实现或降低断言。
5. `test/pi-native-job-reconciliation.test.js:134`：冷启动 Shell 效果用例超过自身 60000ms，之后进程未排空，默认回归无法继续结束。未改任务效果、Shell 或 no-replay 合同。

定向诊断命令：`node --experimental-test-module-mocks --test --test-reporter=tap --test-name-pattern='actor-scoped registration executes|native live digest checks|concurrent processes merge' test/pi-file-tool-registration.test.js test/pi-live-digest.test.js test/pi-memory-store.test.js`。结果 1 pass、2 fail。这些测试文件以及 src/memory/store.js、src/runtime/files.js、src/pi-session-persistence.js、src/pi-file-tool-registration.js 相对修复起点均未改；未在独立旧检出重跑整套，故不能把所有失败直接断言为已证实的基线故障。它们是本 PR 的未解决全量验证边界，不顺手扩展修复。

## 跳过与未验证

- 反馈专项两项文件 symlink 用例因 Windows EPERM 跳过，目录 junction 竞态实跑通过不能替代它们。
- Linux `/proc/self/fd`、macOS F_GETPATH 分支未在本轮实跑；其他平台失败关闭。真实 OAuth、生产现场端到端、真实模型和真实 GitHub Issue 均未执行。
- 未执行 runtime/routing/containment 额外分组；本轮未改任务调度、执行主循环或应用沙箱，不声称这些分组通过。
- 修复前完整环境复现未补采；审查基于原源码，修复后用确定性外部文件/并发/模型终态用例验证相关故障，不把 mock 的注入条件本身当修复证据。

## 交付与清理

保留本轮矩阵及自包含文字证据；无截图、运行数据或凭据入库。只停止本任务默认回归的已核归属进程，未操作其他会话的测试。PR 更新后以远端 head、URL、number、state 和 mergeable 的独立读回为交付依据；不合并、不部署、不触发 CI。
