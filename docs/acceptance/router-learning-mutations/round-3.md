# Web 回复与 Skill 展示修复：第3轮

## 结论与源码版本

两项 Web 缺口已修复并完成本地业务终态验证：Router 直接维护 Skill 的三条无提及最终回复均可靠送达；有效 Router Skill 显示 applied，活动数与正文随增改删同步。最终源码上的 16 项相关定向回归通过，源码覆盖、生产导入与原生运行时守卫通过。

不把扩展批次记为全绿：扩展渠道文件输出 47 PASS / 1 FAIL 后进程未退出，失败为 Windows `ingress.json` 原子替换 EPERM，清理未退出测试进程后，该 DWS 用例在合并基线和最终源码串行环境均通过。先前失败与未正常退出的事实保留，不将其冒称已证明的基线失败，偶发文件竞争根因未收敛。

- 日期：2026-11-11；Node v24.19.0，pnpm 11.25.0，Windows 11。
- 分支：`worktree-router-learning-web-fixes-20261111`。
- 验证起点 HEAD：`4889013405a61b2b3ae752d2234ba296c4034592`，在合并源码 `8c90fc1913638101c2e0bd89462ff1de5280993c` 上只多上一轮验收文档。本轮验证绑定该 HEAD 加以下未提交运行源码及测试增量，不只用 HEAD 代表源码。
- 最终运行源码 SHA256：`src/channels/service.js` = `0e86e55c7482e4e5e9aac6d43803137cfddc0d84e97c01cab7b02d9d72919633`；`packages/web-console/server/evolution-inventory.js` = `3302ce8e6c4854bf027b9709cc5bb869b2e6454587c493b0a20c539a8e6da76b`。
- 最终测试增量 SHA256：`first-reply-runtime.test.js` = `effe5306a106395e0fb50ead4e12969ad8df2416054a93fd732e380b3e837806`；`evolution-inventory.test.js` = `ca8c2a13fe727ce6d23ba8968fdf6ebdbd01b2bfcb0a86b9278cefa18a9c2519`；`test/pi-channel-plugin.test.js` = `e7103f2bde67a7f5f659d7b9a374b526a3c0bbc77d62e6cdd27b6be6553ed14a`。
- 最后 fetch 的 origin/main 仍为 `8c90fc1`，无待整合新源码；后续只有验收文档和 PR 事实回填，不冒充再次执行测试。

## 修复前复现与机制

运行新增真实 Web/Pi 和清单回归：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='Router Skill|Router来源' packages/web-console/test/first-reply-runtime.test.js packages/web-console/test/evolution-inventory.test.js
```

结果 0 PASS / 2 FAIL：清单实际 unsupported、期望 applied；Router Skill 写入 persisted 后，最终回复实际 unknown、期望 delivered，错误为 WEB_DELIVERY_SCOPE_INVALID。冻结 payload 有 sourceRef.actorId 和显式空 recipientActorIds，没有顶层 actorId。

1. `src/channels/service.js:178`：仅 chat 且 actorId 缺省时，从 Host 冻结 sourceRef.actorId 解析对端，仍在同一 conversation 的 participants 中查找。显式非法 actor 不回退；群聊不采用此来源映射。身份与引用、提及分开，不修改冻结 payload、digest 或收据。
2. `packages/web-console/server/evolution-inventory.js:99`：复用核心 learnedSkillSupported；Router 用来源支持，任务复盘仍用当前保留的 experience。没有放松 Web transport 归属检查，也不为清单制造 experience。

反证：写入收据先于送达断言确认 persisted，因此不是 Skill 写入失败；坏 Router 来源即使带有效 experience 也仍 unsupported，正常复盘支持仍 applied；跨会话/未知 actor 继续拒绝。清单读取前后文件树相同，排除靠读取恢复状态造成“成功”。

## 最终源码验证

| 检查 | 结果与实际观察 |
| --- | --- |
| Web/Pi 与清单完整相关文件 | 11 PASS / 0 FAIL，进程 exit 0；包含原首答/unknown/静默场景、只读快照/锁/版本/路径反例，以及新增生命周期 |
| Router Skill 生命周期 | 真实认证 HTTP 入站、Pi 工具、SQLite、存储和 Web transport；版本 1/2/3，各回复 sendAttemptCount=1、delivered；HTTP 原消息时效 confirmed；活动数 1/1/0，新建任务 0，experience 0；新增和更新显式读取当前正文，删除后清单消失 |
| 通用身份及 DWS 串行终验 | 2 PASS / 0 FAIL，exit 0；跨会话/未知 actor 拒绝、显式 null 拒绝、显式有效 actor 优先、无来源不猜身份、群聊不补引用/提及、输入 unknown 对象原样；DWS 未知身份保留冷恢复界用例通过 |
| Web 账本关联回归 | 3 PASS / 0 FAIL，exit 0；同 deliveryKey 去重、冲突拒绝、重启回读、历史 unknown 不重放、跨 sender/channel 的发送及回读拒绝 |
| 源码守卫 | pnpm check exit 0；424 runtime JS、externalSdkImports=0、legacyOrchestratorDefinitions=0，生产导入声明与来源/hash 校验通过 |
| 交付检查 | git diff --check；唯一 goal 校验；暂存 diff 和技能路径检查在提交前执行，不纳入私有 Skill 或业务数据 |

实际命令：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 packages/web-console/test/first-reply-runtime.test.js packages/web-console/test/evolution-inventory.test.js
pnpm check
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='generic message readers|permanently unknown identity' test/pi-channel-plugin.test.js
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='transport delivery uses durable|Web transport binds retained|singleton ledger pins' packages/web-console/test/server.test.js
```

模型端点是本地脚本，外部渠道使用 fake DWS；这证明实际 Host/Pi/Web 协议和业务效果，不证明真实模型的任意语义判断或真实厂商送达。

## 扩展批次失败与范围

首次扩展运行上述两个 Web 文件和整个 pi-channel-plugin 文件，输出 47 PASS / 1 FAIL；DWS 的 permanently unknown identity 用例等待 recoveryFromAt 未成功，诊断记录 ingress.json rename EPERM。单独复验时仍有同错误并出现 DINGTALK_CURSOR_PERSIST_FAILED。两批已输出用例结果但 Node 未退出，停止并独立确认本轮测试进程不存在；不将强制清理算正常测试退出。

使用 Node registerHooks 仅将两处改动的运行模块替换为 `git show 8c90fc1:<path>` 原文，保留相同依赖和 DWS 测试，其日志确认两个 BASELINE_SOURCE 均实际加载；基线 1 PASS / 0 FAIL，正常退出。清除残留进程后的最终源码串行复验 2 PASS / 0 FAIL，正常退出。由此保留 Windows 文件替换的偶发风险，不为本次 Web 修复改 DWS 游标实现、增加重试或降低断言；未重新运行完整扩展文件。

## 交付与未执行项

同步现有 README、DESIGN 和 Web 运维说明，保留第1/2轮及 matrix 历史列；本轮只交付代码、本地验证和独立 PR。没有再次合并、部署、发送真实消息、触发 CI，或处置生产旧 unknown；不声称线上问题已经消失。正式上线与旧收据恢复须独立授权和验收。

临时基线 loader、PR 草稿及本轮未退出测试残留在最终报告核对后统一清理；仅清理自己创建的资源，保留此前私有 release-pointer。最终文字证据即本报告，无另存的截图、日志或私有数据附件；未创建全绿 report.md。
