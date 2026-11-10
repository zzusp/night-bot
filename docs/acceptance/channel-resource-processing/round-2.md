# 第二轮：原始文件交付修复与受阻验收

## 范围、版本与结论

- 日期：2026-11-09 至 2026-11-10，现场时间 Asia/Shanghai。
- 修复可选钉钉插件与 Host 的原始文件交付，保留图片、文本、XLSX/adoc，以及身份、权限、哈希、恢复和无重放合同。不修改 Pi，不增加格式解析依赖。
- 修复基线 `fcb39ced89b12724b94b6a1be861b47964d5c02b`。真实插件和完整 default/runtime 使用未提交工作树，运行时代码与实现提交 `0f8a541a7fde200dc5a034691bee91d8ff23e95c` 相同；三文件哈希见 `round-2/proof.json`。
- 收尾整合 main `0dc43ed4402d912b963ac8a800e58124a6abc6a4`，最终代码提交 `571d56362db5f2f5c3afdae73170137b88ceec54`。保留主线 Bot 共享资源、replyPurpose 和归档更新，重新计算合并后的源码哈希。
- **文件交付实现与相关定向验收通过；真实群端到端受阻，完整回归未全绿。** 不生成全绿 report.md，PR 保留为草稿，首轮失败与旧通知原样保留。

## 根因与实现

适配器原白名单在 PDF/Word 下载后拒绝格式，Host 也只接受 text/image。新增互斥 `file: {data: Uint8Array, name, mediaType}`。Host 校验名称、MIME、完整性和 8 MiB 上限，重新计算长度及 SHA-256，以安全哈希文件名冻结到任务 materials。持久描述符不保存内联字节或临时目录，正式模型获得 file 名称、MIME、路径与完整性元数据；typed file.path 支持严格迁移和读回校验。

正式 Host/Pi 用例检出了仅保存 snapshot、没有向模型投影描述符的关联缺口，已在真实调用层修复。第一轮同一 PDF 经模型绕行能解析、插件却拒绝格式，排除了 Pi 白名单拒绝的解释。原件可达不等于环境具备任意格式解析器。

## 本地实跑

| 检查 | 实际结果 |
| --- | --- |
| 资源/路径两文件测试 | 整合前后均 41 PASS / 0 FAIL / 0 SKIP。包含原有格式、PDF/Word/未知附件、在线普通 PDF 下载清理与严格迁移拒绝。 |
| 新增正式 Host/Pi 文件用例 | 整合前 1 PASS。真实 read 取得冻结字节、write 被拒绝；非法名称、混合描述符、不完整和超限失败关闭；恢复不重取，篡改哈希在新模型调用前拒绝。 |
| 整合后正式 Host/Pi 定向复验 | 2 PASS / 0 FAIL / 0 SKIP：新增文件用例，以及 existing authorized file 的实际文本材料读取、原样复制和回读。 |
| pnpm check | 整合前后均三守卫 PASS。最终 productionImportFiles/runtimeJsFiles=400、externalSdkImports=0、legacyOrchestratorDefinitions=0。 |
| pnpm test | 1343 项：1275 PASS / 41 FAIL / 1 CANCELLED / 26 SKIP。 |
| pnpm test:runtime | 单独完整执行：163 项，149 PASS / 2 FAIL / 0 CANCELLED / 12 SKIP。 |
| git diff --check | 实现与整合阶段通过；最终文档另行检查。 |

最终定向命令：

```powershell
node --test test/coordination-resources.test.js test/pi-task-material-paths.test.js
node --experimental-test-module-mocks --test --test-name-pattern 'official Host freezes raw PDF files|official service reads and copies an existing authorized file' test/task-session-service-native.test.js
pnpm check
```

原组合命令的 default 失败使后续 runtime/check 未执行，两者已分别执行。完整 default/runtime 计数只绑定整合前版本；整合后只复验本次路径、两项 runtime 失败对照及守卫，**没有重跑两组完整测试**。未运行独立 routing/containment 分组，本次不修改路由策略或 sandbox。

### 失败反证

内存加载钩子只将本 PR 改动的三个运行时模块换回固定 base 源码，不覆盖磁盘文件或改变断言。

- default 的 41 项失败均在 fcb39ce 基线复现，涉及旧夹具 TASK_WORKSPACE_NOT_READY、私有路径错误类型、Windows LPAC 策略、冷退出聚合错误及附件/归档夹具路径。未顺手修复这些无关问题。
- 1 项取消是 pi-native-business-portability 的 20 秒超时。同一用例在当前代码与原基线单独运行均通过；原全量超时仍保留，未修改期限。
- runtime 的人工等待用例因 assert.ok(request) 失败；来源/效果围栏用例的 FS_SANDBOX_DENIED 断言失败。最终整合工作树与最新 main 0dc43ed 的对照中，两项均再次失败，未降低权限断言。
- 逐用例位置、类别、计数、输出指纹及最终源码哈希见 `round-2/regressions.json`。未修改上述失败用例，也不声称完整回归通过。

## 真实平台和插件原件

仅使用既有授权测试安装、同一保存 profile、唯一测试群，无账号、凭据或运行数据复制。

23:45:18/19 分别发送新 PDF/Word，23:45:20 发送读取指令，各一次。校验码只在附件内部；指令要求读取 Host 材料、不调用 DWS 重新下载、不读发送侧目录，群回复不带内部编号，不发送报告附件。

三条发送状态均 SUCCESS；使用真实 messageId 独立精确回读，requestedCount=foundCount=3、complete/messagesComplete=true、hasMore=false、failedCount=0、failures/notFoundMessageIds 为空。未将 openTaskId 当消息 ID。真实适配器返回两份原件均 complete，名称/MIME 正确且字节长度、哈希一致：

| 文件 | 长度 | SHA-256 | 样本期望（非实际任务结果） |
| --- | --- | --- | --- |
| material-proof.pdf | 19599 | 1a88828dd650237acab45cf314689136d970305a5ff14d37c47ecb78f9da5d42 | PDF-2B07084C；23+38=61 |
| material-proof.docx | 911 | 9018542d7962bfaa47e7abd1fb5f85443c97e79a2fe60b2ba123f29d5a737b87 | DOC-6CA56875；31+12=43 |

**这些校验码和算式没有被本轮真实群任务验证。** 不能把样本生成或插件下载当成任务内容处理通过。生成配方见 `scripts/create-file-fixtures.mjs`，Python 使用 -I，不执行附件或从下载目录启动解释器。

## 真实入站阻断与边界

新请求及两附件在 dynamic_sources 中均无对应来源，新任务尚未创建。Word 已记录于插件持久 deferredMessages。沿原通知缓存及持久 outbox，只读复现正式 beforeIngress 返回：

> CHANNEL_NOTIFICATION_IDENTITY_PENDING，reason=send-pending

首轮通知仍 unknown、sendAttemptCount=1，没有 ACK/receipt，错误 GROUP_REPLY_INTERNAL_DETAILS、knownNotSent=false。入站保护不能排除自身回声，故暂缓接纳。没有将未知改成未发送、删 deferred、清水位、直接改账本、重发输入或造任务。

本轮真实任务材料读取、隐藏内容结果、completed/drained、Router 消费、群回复 delivered 均未验证。解除历史通知身份阻断后须沿原消息继续验收；本任务不扩修历史通知恢复。

候选服务最终以退出码 0 结束；独立确认启动元数据不存在，Core/Web 端口拒绝连接，没有再次启动。安装数据、正式任务材料、会话及历史通知保留。

## 证据、清理与交付

最终证据为 `round-2/proof.json`、`round-2/regressions.json`；本报告与证据核对后，以 --check 预检清理发送侧临时样本、原始响应和内存基线钩子。可复用脚本及首轮报告/proof 保留，平台原件和安装持久数据不删。

通过新 feature 分支交付草稿 PR，不合并 PR、不正式部署、不触发 CI。PR URL/编号/草稿状态以真实交付回查和唯一 goal.md 为准；创建草稿不代表整体验收完成。
