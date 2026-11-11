# Router 记忆与 Skill 维护验证

## 源码与范围

- 日期：2026-11-11；Node.js v24.19.0，Windows 11，独立分支 worktree-router-learning-mutations-20261111。
- 起点 23a470bd7c31b71c81e61aa0499f1c525e243a33；收尾已快进整合 origin/main 6a2bcc9b1571c64e1f102d0bea63c080d3e5770d。目标分支增量仅文档，不含运行源码；README 的不同段落已保留双方内容。
- 本轮验证绑定未提交工作树，不用 HEAD 代替实际改动。5 个运行源码与 5 个测试/夹具文件的排序路径及内容 SHA256 指纹：9fdb1b91b0151acd7666030a71cde8f8677353368c662160da70350395e5fee3。后续提交 SHA 由 PR/交付回查提供，不循环修改本文件。
- 使用真实 Host、官方 Pi、SQLite、本地脚本模型 HTTP 端点与假渠道。私有学习正文只在隔离临时安装目录生成；没有真实渠道消息、凭据/业务数据复制、CI 触发或生产部署。

## 结论

Router 的记忆/Skill 增改删、来源/权限边界和持久化效果均有实跑证据。完整 Router 文件为 **27 PASS / 1 FAIL / 0 SKIP**；唯一失败为既有 DWS receipt flags 用例，在未应用本补丁的干净最新 main 上同样失败。本轮没有改 DWS 实现、删除断言或把该项记为通过，完整 Router 套件不宣称全绿。

## 实跑与结果

1. `node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-resident-router-flow.test.js`：28 tests，27 PASS / 1 FAIL，675744.418 ms。其中来源矩阵 15 场景通过；旧两条直接请求、新的背景后半句请求、无特定请求句式的事实、含“今天”的长期约定均按 Router 决定保存；历史/跨会话/旧版本、非完整摘录、伪造背景、秘密、缺上下文和只读拒绝继续生效。
2. 同一命令中的新生命周期用例包含 16 场景：记忆新增/更新/删除、记忆与 Skill 版本冲突、Skill 查询/新增/修改/删除/同名重建、秘密/路径/摘录拒绝、共享 provider、冷启回读、旧加载正文撤销、派生目录实际删除；未制造 experience、空任务或外发消息。只读用例同时验证 memory 与 Skill 均未落盘。其余 Router 批次上限、轮换、恢复、取消排空、原任务唯一会话续接均通过。
3. 关联批次命令：`node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-wire.test.js test/pi-memory-official-source.test.js test/pi-memory-official-extraction.test.js test/pi-memory-store.test.js test/pi-official-memory-privacy.test.js test/pi-evolution.test.js test/pi-reflection.test.js test/pi-reflection-forget.test.js test/pi-reflection-official.test.js`。首次 61 tests：56 PASS / 5 FAIL。记忆、官方来源/提取、隐私、事务存储、演进及 Skill 故障/重试的 48 项均通过；5 项复盘在 task.claim 前被 TASK_WORKSPACE_NOT_READY 拦住，尚未进入复盘业务。
4. 复盘夹具改为走真实 task.workspace.begin → initializeTaskDirectories → task.workspace.finish。修正 SQLite 仍打开时先删临时目录的关闭顺序。未放松产品守卫，未跳过 Windows 验证。集中复验 `node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-reflection.test.js test/pi-reflection-official.test.js`：13 PASS / 0 FAIL / 0 SKIP（含 4 个子用例），45194.8641 ms。覆盖既有任务复盘、单任务有证据即可生成 Skill、冷启去重、旧正文快照、秘密拒绝、scope 变更隔离和真实 submit 后自动复盘。
5. `test/pi-reflection-forget.test.js` 的 3 项通过：已提交遗忘不被回调失败恢复；稳定操作冲突、旧创建/删除不重放、删除后版本不归零及冷启；故意将 SKILL.md 建为目录造成派生发布失败，两次均返回 REFLECTION_WRITE_UNCONFIRMED/committed:true，解除故障后才回读成功；等待锁期间撤权不写入。结果也包含在第 3 项关联批次中。
6. 整合主分支并恢复补丁后 `pnpm check` 通过：424 runtime JS，0 external SDK imports，原生来源/哈希/import guard 通过；`git diff --check` 通过。运行源码在上述业务验证后没有再修改。

## 既有失败反证

完整 Router 的 `durable receipt echoes tolerate later DWS flags without replacing existing message facts` 在 test/pi-resident-router-flow.test.js:273 返回 `Missing expected rejection`。本轮使用唯一带名暂存保存所有增量，快进至 6a2bcc9，确认工作树干净后单独运行：

`node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='durable receipt echoes' test/pi-resident-router-flow.test.js`

干净 main 仍为 0 PASS / 1 FAIL，12156.7836 ms，失败断言与行号完全一致。随后按确切 SHA 恢复本轮增量，只删除本会话暂存引用，未碰其它暂存或主检出。该 DWS 问题超出本次 Router 学习维护目标，保留失败并建议单独修复。

## 边界与未验证

- 脚本模型验证工具合同、来源绑定和实际效果，不证明真实 LLM 总能正确评估语义、学习价值或引用适用性。
- 没有跑全仓 pnpm test / runtime / routing / containment 全集；本轮按影响选择上述实际文件并运行项目源码守卫。
- 不验证真实厂商、生产升级、历史漏存补写或业务访问权限。用户关于数据库/Playwright/OSS 可达的原话是来源陈述，未在本轮变成已验证事实。
- 不新增环境变量或数据库 schema。升级/回滚按 Windows 运维说明执行；旧代码须配套离线数据恢复，不能丢失新来源与幂等状态后直接运行。
