# 第 4 轮：Router 上下文提炼式记忆

## 范围与结论

用户要求记忆结合消息与上下文提炼内容，原消息留作证据。本轮实现 Router 结构化输入、四维正文、逐项来源绑定和个人/场景适用范围，复用共享存储、事务、检索、详情与差异。内容指引要求直接写清可复用结论、决定或偏好，以及有证据的原因、应用办法与边界，消解“这个 Project”等指代，不把会话过程、承诺或任务流水作为记忆。

本轮相关行为回归通过；完整 `pnpm test:routing` 为 **73 PASS / 15 FAIL / 0 skipped**，15 项均在同一未修改主线版本复现。不宣称完整路由全绿。本轮没有部署、发送真实渠道消息、修改既有业务记忆或验证真实模型的普遍语义判断能力。

## 受验版本

- 隔离分支：`worktree-router-context-memory`。
- 基线：`46a64f5a1c41448018c603552db52a4140b5b7a1`；最终取回的 `origin/main` 与基线相同。
- 测试针对基线上的**未提交工作树**，不能仅以 HEAD 代表受验源码。以下七个文件此后未再修改；验收文档与 PR 收口不改变受验代码。
- Node.js `24.19.0`、pnpm `11.25.0`、Windows 11；已执行 `pnpm install --frozen-lockfile`。

| 文件 | SHA-256 |
| --- | --- |
| src/channels/resident-router-business.js | 85b8287882a5256e9a713476d1fb6efd19305f86b23fdf016fdf435eb4e7f4de |
| src/memory/format.js | 654d4efb7cbfdf62e9c89d92b0a2a52e869bc873b42b956ac26bccfb90eed4b1 |
| src/memory/service.js | 47c8785c08be5cf6d6b24e68a75a3b396063f60b45335ce4143df84794b70a7e |
| src/memory/store.js | df5e7e2c64803ae3b49d7178ab5b7afd57e10cfa53abebbe691ad677a7e080e3 |
| test/pi-resident-router-flow.test.js | 4946a89aaefcf45fed7cd028ef7186c872148149e88e23e030094393d67ad446 |
| test/pi-memory-store.test.js | 71563bac57a0b4880997432e9d994b03c36d0f041ec08076706b339af367a660 |
| test/pi-shared-memory-migration.test.js | 8b89cc29f66d4009cc02fae3fc0f47ceee3d0d15fe447228542ba492437a24b7 |

按表中顺序对 `[文件名, SHA-256]` 数组的紧凑 JSON 再取 SHA-256：`a0b42ea75dc8bf75d1b96f2b187f0d5faae0dd877d68e0b3214e19758d798f5b`。

## 实跑与结果

### 1. Router 真实 Host/Pi 调用链

命令：`pnpm test:routing`。终态 `tests 88 / pass 73 / fail 15 / cancelled 0 / skipped 0 / todo 0`，进程退出码 1。使用隔离 SQLite、真实 Host/Pi 工具与持久化、本地脚本模型端点和假渠道；不把预编排的摘要当作真实模型能力证明。

本轮相关用例通过：

- 项目记忆：当前消息、引用公告和同会话历史共同生成含明确 Project URL 的自包含内容，保留要求、引用说明、条件、场景及证据；不再只存“这个信息记录一下”。
- 四维正文、`context.version=2` 和证据哈希在磁盘回读一致；详情返回完整正文，更新保留 previous 并生成含新 URL 的差异。
- 原有个人偏好保持 `matching-subject/reference-only`；项目记忆跨作者、跨会话召回为 `context-dependent`，不绑定为原作者个人偏好。
- 精确重复不重写；相同来源/正文但改换 actor/context 类型返回 `MEMORY_WRITE_UNCONFIRMED`，不冒充范围已更新。冷重启重复来源不再次推理，更新保留身份且版本递增，删除后无残留或空任务。
- `channel-memory-authority`：21 场景通过，含外会话、旧版本、不存在来源、缺完整当前证据、无效/重复 evidence ID、错误 observation 类型及秘密拒绝。
- `router-learning-crud`：16 场景通过，记忆/Skill 增改删、冷启动、共享 provider、旧加载内容失效和目录回读保持；只读、当前来源/代际/认证与撤销等相关路由用例保持通过。

关键端到端诊断：

```json
{"case":"router-contextual-memory","dimensions":4,"contextResolved":true,"historyIsEvidenceOnly":true,"subject":"context-dependent","diskAndDetailVerified":true,"coldRecall":true,"duplicateNoReplay":true,"updateAndDiff":true,"optionalInferenceOmitted":true,"deleted":true,"realMessages":0}
```

### 2. 记忆、官方来源、提取、隐私、复盘与迁移

最终源码下三个批次共 **61 PASS / 0 FAIL / 0 skipped**：

```text
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-store.test.js test/pi-reflection-forget.test.js
# 18 PASS
node --experimental-test-module-mocks --test test/pi-shared-memory-migration.test.js
# 3 PASS
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-wire.test.js test/pi-memory-official-source.test.js test/pi-memory-official-extraction.test.js test/pi-official-memory-privacy.test.js test/pi-reflection.test.js test/pi-reflection-official.test.js
# 40 PASS
```

结构化存储反例：伪造 actor、无证据、未经支持的 verified-result、秘密、篡改证据哈希和正文/context 不一致均拒绝，失败不增加版本。四维正文超过 2048 字符时完整保留原话证据，复用既有 64 KiB 演进快照边界；普通记忆仍拒绝超过原上限的正文。即使重算正文哈希，也不能让不符结构的正文通过解码。

中间失败与处理：新测试曾未显式结清批次，已修正驱动；渲染括号语法错误已修正；`checkedText` 增加 limit 曾误接 `.map()` 的 index，已恢复单参数 API 并分离显式限长函数；Windows 原生 symlink 缺权限导致两项迁移失败，改用仓库已有 junction 夹具，保留链接逃逸拒绝断言。以上均已在最终源码复验通过。

### 3. 完整路由既有失败的反证

在同一基线 `46a64f5` 的独立、未修改发行检出上只读执行对应测试，未改源码或业务数据：

| 失败类型 | 本轮完整路由 | 同基线反证 |
| --- | --- | --- |
| `pi-router-ledger.test.js` 工作区未 ready | 13 FAIL，均为 `TASK_WORKSPACE_NOT_READY` | 整个文件 22 项：9 PASS / 13 FAIL，同错误及 `session-workspaces.js:43` 栈；夹具直接 claim pending 任务，未完成现行工作区初始化事务 |
| DWS receipt 后续 flags | 1 FAIL，`Missing expected rejection` | 精确筛选 `durable receipt echoes tolerate`，同断言失败 |
| 历史冻结启动确认 | 1 FAIL，期望 completed，实际 active | 精确筛选 `a historical frozen start confirmation`，同断言失败 |

反证命令以该发行检出的绝对测试路径为参数：

```text
node --experimental-test-module-mocks --test <baseline>/test/pi-router-ledger.test.js
node --experimental-test-module-mocks --test --test-name-pattern="durable receipt echoes tolerate" <baseline>/test/pi-resident-router-flow.test.js
node --experimental-test-module-mocks --test --test-name-pattern="a historical frozen start confirmation" <baseline>/test/task-notification-retry-native.test.js
```

没有修改无关任务合同、改变派发策略或放宽沙箱使其转绿。本轮相关记忆用例未出现未解释的新失败。

### 4. 静态与来源守卫

`pnpm check` 与 `git diff --check` 通过。守卫实际摘要：

```json
{"retainedModules":190,"retiredModules":10,"excludedUiModules":3,"explicitlyAdaptedModules":59}
{"productionImportFiles":424,"literalBareImports":202,"status":"declared-production-imports"}
{"runtimeJsFiles":424,"externalSdkImports":0,"legacyOrchestratorDefinitions":0,"legacySourceFilesVerified":2,"historicalFormatFilesRemoved":9}
```

## 兼容、安全与未执行项

- 通用 task/generic 工具仍执行逐字原话、明确授权、候选与临时内容规则；只改变 Router 已认证当前来源的提炼式写入，不新增授权模型。
- `context.version=1` 及无 context 的条目仍读取；不自动迁移/回填生产旧记忆。产生 v2 后旧版不认识该结构，回滚须使用匹配的代码与数据快照，不能删字段伪造兼容。
- 来源逐字匹配只证明认证出处，不能证明用户陈述属实或摘要正确；个人/场景范围不是执行权限。
- 未运行完整 `pnpm test`、`pnpm test:runtime`、`pnpm test:containment`；本轮选用上述相关回归、完整 routing 和源码守卫。未做浏览器视觉验收，详情/差异通过实际 Host 接口回读。
- 未执行真实模型语义验收、真实渠道发送、合并或部署；现有业务记忆保持原样，升级后旧条目不会自动改好。
- 没有复制私有记忆/Skill 正文，没有新增截图、日志或 dump 附件；必要文字证据集中于本报告，既有 round-1/2/3 及附件未动。
