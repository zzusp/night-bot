# 记忆与技能周期复盘验收

## 结论与版本

- 本轮代码、文档与隔离本地验收完成；11 个相关测试文件共 78 个不同用例在分组运行及失败项定向复验后全部通过，不是一次单命令 78/78。
- 最终维护专项 15/15 通过，`pnpm check` 和 `git diff --check` 通过；未跳过用例、降低隔离保护或延长既有测试期限。
- 验收日期：2026-11-17 至 2026-11-18，Windows 11、Node v24.19.0、pnpm 11.25.0。
- 分支：`feature/public-marker-delivery-recovery`；HEAD：`b9a7bd2a61f0c31d0f8e03457431dace8c976617`。工作树未提交，开始时已有大量其他任务的修改；本轮没有暂存、提交、push、创建 PR、触发 CI、合并或部署。
- HEAD 不是本轮受验内容的完整标识。本文末附相关源码/测试的 SHA-256，聚合指纹为 `9404d26e5ac72732d57c9b87509b6d7f4095c4baee89f8875c01586694da8ed5`。该指纹不代表整个仓库的所有未提交文件都已验收。
- 使用真实默认 Host/Pi、SQLite、Markdown store 和本地脚本化模型端点，无真实模型或真实渠道外发。

## 验收范围

准入政策由主对话、候选提取、任务复盘和维护共同复用。新复盘不请求/持久化 hypothesis；证据或适用范围不足的 Skill 不保存。新 Skill 使用自由 Markdown guidance，包含事项、目标、主要环节、信息来源和正反例；不自动排成逐条强制执行清单，既有 steps 作为历史参考保留，正式安装 Skill 不自动改写。

安装操作者显式启用后，事件局部维护与默认每 168 小时集中复盘共同运行。维护先索引、后按组读取正文，支持记忆/候选/受管 Skill 的受控清理、合并、拆分、更新，保留来源、版本和审计。候选不能自动晋升，业务不重放，旧在用技能文件不删除。Host 负责引用/权限/版本/事务校验，不将 evidenceBacked 标志当作结论真实的证明。

重点验证：四类动作，非法目标/形状/证据/候选晋升/并发版本冲突的整计划拒绝，journal 未知提交恢复，冷启动幂等，定时器，空复盘不增加版本，取消/排空，经验撤销的派生失效，安装 Skill 不变，默认不启用，只读保护，凭据不外发，来源及使用摘要不外发身份。

## 实跑与复验

| 运行 | 实际结果 | 处理及最终结论 |
| --- | --- | --- |
| 首批 memory/reflection 相关 4 文件 | 34 个用例，30 PASS、4 FAIL | Windows 旧夹具直接 claim 未初始化；改走真实 task.workspace.begin / initializeTaskDirectories / finish，未改运行时保护 |
| 相关 11 文件 | 78 个用例，74 PASS、4 FAIL | 2 个 Windows 原生目录 symlink 权限失败、2 个档案夹具未初始化；复用既有 junction helper 与真实初始化 |
| 迁移及档案 2 文件，任务 blgzc9mih | 12 个用例，11 PASS、0 FAIL、1 CANCELLED | 原先四个失败均通过；双任务完整档案用例触及原 60 秒期限，未调大期限 |
| 最终记忆/复盘 9 文件，任务 bgfch7h23 | 66 个用例，65 PASS、1 FAIL | 新长正文断言未考虑既有 checkedText.trim()；按正式空白规范修正期望，未改变持久化行为 |
| 两个失败项串行定向复验，任务 bjyyhp0qo | 2/2 PASS，0 FAIL/CANCELLED/SKIPPED | 长 Skill 全文保留、去重/遗忘/冷恢复通过；完整双任务档案 52.24 秒通过，同一原 60 秒期限 |
| 凭据经验被技能依赖引用的反证 | 修复前实际失败 | 已识别凭据被重新列作技能依赖，原本只需本地清理却触发模型请求；本地排除后同步过滤失效技能及依赖展开 |
| 最后维护专项与 guard，任务 bwwes3xsl | 15/15 PASS，0 FAIL/CANCELLED/SKIPPED；guard 通过 | 最后维护源码包含依赖排除修复、telemetry 来源白名单和一致快照；其余入口逻辑未再改变，复用对应已通过结果 |

最后维护专项之外的 Host fixture 默认明确关闭自动维护。最后源码变更仅限维护 review 内的凭据/过期依赖排除；对此完整重跑维护专项，未无差别重复此前已通过的其余用例。

主要命令：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=2 test/pi-memory-maintenance.test.js test/pi-memory-wire.test.js test/pi-memory-store.test.js test/pi-memory-official-extraction.test.js test/pi-memory-official-source.test.js test/pi-official-memory-privacy.test.js test/pi-reflection.test.js test/pi-reflection-official.test.js test/pi-reflection-forget.test.js
node --experimental-test-module-mocks --test --test-concurrency=2 test/pi-shared-memory-migration.test.js test/pi-task-archive.test.js
node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='^real default Host learns|^default application archives two' test/pi-reflection.test.js test/pi-task-archive.test.js
node --experimental-test-module-mocks --test test/pi-memory-maintenance.test.js
pnpm check
git diff --check
```

最终 guard 文字证据：

```json
{"retainedModules":190,"retiredModules":10,"relativeImports":"closed","httpRoutes":"retained"}
{"productionImportFiles":401,"literalBareImports":196,"status":"declared-production-imports"}
{"runtimeJsFiles":401,"externalSdkImports":0,"legacyOrchestratorDefinitions":0,"legacySourceFilesVerified":2,"historicalFormatFilesRemoved":9}
```

## 修复与边界

- 记忆、evolution 状态、受影响复盘与维护收据通过受控 journal 一次提交；读取 learned Skill 时使用同一事务快照。失败或取消的未提交计划不应用，未知提交由原 journal 恢复，不重新调用模型或重放动作。
- 维护索引的原会话/消息身份经哈希化，usage 仅发送计数及时间白名单。带 PRIVATE_USAGE 来源标记的真实请求回归通过，标记未进入维护请求。
- 超过 2048 字符的 guidance 经真实 Host 模型响应、存储和 Skill 读取完整保留，只有既有 trim 规范化；仍受辅助响应及秘密校验边界约束，不静默裁剪为 brief。
- 原始凭据/显式过期经验本地清理，派生技能失去支持后同步失效，不经依赖展开重新发给模型；审计未包含凭据正文。
- 任务档案回调在权威提交之后失败时为 applied-archive-pending；正常任务复盘恢复使用当前报告重同步，不回滚已提交整理。没有单独新增该回调失败的端到端用例；现有 forget 回调失败保护回归通过，维护的该状态由源码检查确认。
- 自动整理默认关闭；只有可信安装级 reflection.maintenance.enabled:true 才启用，intervalHours 默认 168。当前没有独立批量复盘 CLI 或管理 API；内部 trigger 不是面向操作者的公共入口。
- 未编辑真实安装 memory、Skills、配置或运行数据，未执行历史内容清理或复制私人技能。git check-ignore 确认 data/memory 与 data/skills 被忽略；git diff --cached 和 git ls-files 的 data/Skill 路径检查均无输出。
- 本轮隔离测试的 fixtures 负责关闭 Host/SQLite/本地端点并清理自己的临时目录；没有创建仓库内临时业务数据或复制原始模型/凭据日志，必要文字证据保留于本文。未停止或改动其他任务的常驻进程。
- 未跑全仓默认/runtime/routing/containment 全套：本轮为记忆与工具外复盘变更，采用上述相关真实 Host/Pi/隐私/档案回归；不据此宣称全仓、Linux 隔离或生产验收通过。
- 模型语义质量、真实模型判断和当前 Bot 安装升级均未验；模型依据提示遵循准入不等于 Host 实现了通用语义真伪分类器。

## 当前受验源码与测试指纹

以下 JSON 按键排序，以 UTF-8、紧凑 separators=(逗号,冒号) 序列化后 SHA-256 得到本文聚合指纹。包含共用依赖及原先已修改文件，不表示这些文件的全部差异均由本任务产生。

```json
{
  "src/host.js": "660db4a787234ebf278cf23a110af8cddd1371b70e7b59b198b992349bcf35c9",
  "src/memory/commands.js": "9e4ffa876a6c2072e9896d9e621baf35bee22203511dfe33ed45647ca5d0376d",
  "src/memory/evolution.js": "fd58a4e122c4463663ae51292cf4650d48cd65407f5a84b9821473106f40ea56",
  "src/memory/extraction.js": "b2e7b678b4604ef589520639bc763ae6bc6966b73d9acbdc808317a7c33cedbd",
  "src/memory/format.js": "ba3ea99fab5a8117986b2f8e018f921b4fffbdd47f38fbfb275ee67a5befc86d",
  "src/memory/maintenance.js": "42350cc929de007e50626727c2b60caf0eac7bc99d26480ecf8469d7eec52136",
  "src/memory/privacy.js": "1ef3d78bff73b5dd592b1fa3b384b8e5fc27282815bae1d7a063f2fd7afd5879",
  "src/memory/private-fs.js": "8b9bf149541e04204cc17e58dcce0b904d52b1045fe3ede9bd4ae550a7b6f621",
  "src/memory/provenance.js": "f1f878d27587a98e325ea7263aeaf7980b4f28e954dc530b080f9195832700ee",
  "src/memory/reflection-inference.js": "0fef5c891359ecc9b39cd4cb572114c77d271371df9c18b5b916d69c7e996b23",
  "src/memory/reflection.js": "73b21390cbc29193ff2879ab7956ddb6b1dfc88f5b06f58671189ede02991291",
  "src/memory/scope.js": "fa44b6df8d1d2f9cbe6aa13571fc6c58d410407698838b0b2b8ce6e721694642",
  "src/memory/service.js": "b18686be2f7a6e3c54587e169266df93ea58f7be33237a5709bd3581f84cb14c",
  "src/memory/shared-migration.js": "20d82270425d7b12db9fa77bcfc9c97ce887d3fd95ee7def96a3de478149f890",
  "src/memory/skill-usage.js": "9d39517850ebbd294ea3d3c18680da3fb61041fdfd8168f93a70d679d2b68e20",
  "src/memory/store.js": "a99e5df58eacbb79c7e51c130021f0266c062b4cd0c9aa7e65836e0d76f3924a",
  "src/memory/tools.js": "e0d95f47507a020be3d7cd2b893174b6baecb33014b82e02c2fe08c2ce0aba3a",
  "test/fixtures/memory-host.js": "9efb51631b5a6d4df4bd8d7939f74044ab1f88254e10161bb055f599d16411d9",
  "test/fixtures/filesystem-link.js": "c8a8f85c696663a76326eb6bad70a09dea09c8cd38dceafbd55683ef62c7f232",
  "test/pi-memory-maintenance.test.js": "2b8bed1ee2e6ddc4e893578b0b40e8d633a2fdd0694037c95a9ff693c1196696",
  "test/pi-memory-wire.test.js": "8fc7d09a3d08b330cc81d8256dc18d35de825d0be3c498b54da98fa0a634a859",
  "test/pi-memory-store.test.js": "467dd64346ec64ea8a80e5d3c6583772bccddbfd1101b0a0cf25dfb2cdeefd78",
  "test/pi-memory-official-extraction.test.js": "0710cace02a5ec608b5a5ca0d26ae1c8ed7818059a6616975f5804d49f5b84cf",
  "test/pi-memory-official-source.test.js": "8f706b12e24641124f9926522473da5c3ffc2ed1e4fe68d08b9376bfc948e18e",
  "test/pi-official-memory-privacy.test.js": "5fcd654d7453e2092d5a54037ec463ea9353bedb80e3796d31634d3ad2599c3b",
  "test/pi-reflection.test.js": "be2da7635c6b11d6545988c935139466f98dfa177fb4d0a467bac5326392c1ad",
  "test/pi-reflection-official.test.js": "41f5be91d100c4890cb8f46d0a80d346f5f94f990df72097835805d87b908c3b",
  "test/pi-reflection-forget.test.js": "9d6b9a5856040b0e1922d4c675210f6d6d5c90ab41597389e53f2531d8ff19b4",
  "test/pi-shared-memory-migration.test.js": "8c11d2c7114b72df14cffca879bd6841bcedf795cbfe4bac83434d0879e3a5a6",
  "test/pi-task-archive.test.js": "7d6dbc216e6be139c7fdf659ce978d8b0edf1150c74c9d02514fd343e6a5b2b3"
}
```
