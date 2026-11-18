# 主线整合与交付验收

## 结论与版本

- 基于最新主线 c1a5796af6a637d7378497482c527a52a0517af9 完成整合。在 Windows 11、Node v24.19.0、pnpm 11.25.0 下，18 个相关文件中的 168 项测试通过（按 Node 统计，含子用例）；分组运行，不是一次单命令。补充定向复验覆盖修改后的维护动作、未启用 Skill、凭据清理和档案重试。最终无失败、取消或跳过。
- pnpm check、git diff --check、long-goal 结构校验通过；最后 git fetch origin 后主线仍为 c1a5796，与受验基线一致。
- 分支 worktree-memory-skill-periodic-review；受验时 HEAD 为 c1a5796，工作树含本任务未提交改动。本文末绑定实际改动源码/测试/通用资源字节 SHA-256；其他未改文件绑定该基线。后续仅回填交付事实的文档与本次源码版本区分。
- 所有推理使用本地脚本模型和真实默认 Host/Pi 工具循环、SQLite 与分层 Markdown store；无真实模型、真实消息、部署或真实 Bot 数据整理。旧 round-1 只保留旧 b9 基线历史，不作为本轮主线通过证据。

## 本轮实现与反证

1. 六类记忆准入进入主请求、候选提取、任务复盘和维护；任务 Skill 使用 guidance，明确目标、环节、信息来源与正反例。保留主线 Summary/Why/How to apply，不新增 hypothesis。无证据判断或适用范围缺失时省略 Skill，不调用 creator。
2. 所有新建和正文更新继续通过真实内置 skill-creator 及受限 Pi Agent 起草；未使用 creator、无效输出、生成失败保持显式失败。保留 body、生成收据、previous、Router 原 steps 候选参数与旧历史渲染，不批量重生成旧技能。
3. 默认关闭的 Host 维护支持显式启用、事件局部检查、168 小时集中检查、冷启到期/水位恢复和取消排空。主请求真实 memory_read 刷新后仍能触发完成回合维护；候选落盘会通知，但不晋升。
4. 慢维护无 evolution 共享发布锁；并发 Router 真正完成写入后，旧维护因完整 evolution 指纹/记忆 revision 不同整批拒绝。未吞掉 Router 更新，没有还原旧自然语言授权门禁或新建业务任务。
5. 记忆、evolution state、派生正文、review、维护收据/水位共用严格受控 redo journal；中断后的读侧先恢复，冷启动无重复模型调用。metadata-only 不增加记忆 revision；未知路径计划在写 pending 前拒绝。
6. 结构化记忆保持主体、原来源、原证据及 previous；跨主体合并、普通记忆晋升长期指令、长期指令丢条件改写被整批拒绝。候选不自动批准；未启用的 learned Skill 更新仍保持未启用。
7. Router 来源 Skill 无须虚构 experience；其维护保持认证来源、creator、单调墓碑和旧操作幂等。删除后同名重建不回到版本 1，旧 marker 失效。失去支持的任务 Skill 及已知秘密本地清理，不把已排除经验经依赖展开重新发给模型。
8. 经验撤销复用实际 reviewLessonMemoryKey 并推进 forgetGeneration；review/destination 同步撤销。档案回调首轮失败后进入 archivePending，后续 scan 以当前报告成功补齐，不重放业务。旧在用 Skill 文件及安装者模板不删除/改写。
9. 使用元数据只发送计数/时间白名单，PRIVATE_USAGE 身份标记不进入请求。凭据样本仅为隔离测试合成文本，原文不进入维护模型或收据；真实数据、凭据与私有 Skill 未复制。

## 实跑记录

| 运行 | 结果 | 说明 |
| --- | --- | --- |
| bbrxuvspk：最初维护/复盘/creator 三文件 | 33 PASS、1 FAIL | 停机用例错误地通过已关闭 store 读审计；改为直接只读已落盘水位/收据，不修改生产关闭保护 |
| bcffeziwx：维护与复盘 | 33 PASS，0 FAIL/CANCELLED/SKIPPED | 增加 Router 来源、并发、结构化主体和长期指令边界 |
| bei5xog2u：最终维护/复盘/creator/主对话四文件 | 62 PASS，0 FAIL/CANCELLED/SKIPPED | 含真实工具回读刷新、候选事件、长 guidance 与无证据过滤 |
| bhzpv48x7：来源/隐私/渐进读取/存储/并发/墓碑/迁移/档案十三文件 | 105 PASS，0 FAIL/CANCELLED/SKIPPED | 双任务离线档案/附件/恢复禁止重放及 Router 技能刷新均实际通过 |
| bzlje5t1l：完整 Router 维护工具链定向用例 | 1 PASS，0 FAIL/CANCELLED/SKIPPED | 原认证消息 → memory/Skill 增改删 → 真实 creator → 冷恢复/撤销/墓碑，无空任务 |
| bsnageq6e：档案失败补偿 | 1 PASS，0 FAIL/CANCELLED/SKIPPED | 本轮新增 archivePending 真实回调失败再成功，遗忘代次和墓碑核对 |
| bglyu3vdf：最后维护两项及 guard | 2 PASS，0 FAIL/CANCELLED/SKIPPED | 未启用 Skill 不激活，四类动作、凭据依赖清理；修改后重验，不重复统计为新增用例 |

主要命令：

```powershell
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-maintenance.test.js test/pi-reflection.test.js test/pi-skill-generation.test.js test/pi-memory-wire.test.js
node --experimental-test-module-mocks --test --test-concurrency=1 test/pi-memory-store.test.js test/pi-memory-official-source.test.js test/pi-memory-official-extraction.test.js test/pi-official-memory-privacy.test.js test/pi-memory-progressive.test.js test/pi-reflection-official.test.js test/pi-reflection-keys.test.js test/pi-reflection-forget.test.js test/pi-reflection-contention.test.js test/pi-router-skill-refresh.test.js test/pi-learned-skill-history.test.js test/pi-shared-memory-migration.test.js test/pi-task-archive.test.js
node --experimental-test-module-mocks --test --test-name-pattern='^Router directly maintains memory and learned skills' test/pi-resident-router-flow.test.js
node --test --test-name-pattern='整理经验同步' test/pi-memory-maintenance.test.js
node --test --test-name-pattern='周期复盘对记忆|既有凭据格式' test/pi-memory-maintenance.test.js
pnpm check
git diff --check
```

最终 guard：

```json
{"retainedModules":190,"retiredModules":10,"relativeImports":"closed","httpRoutes":"retained"}
{"productionImportFiles":460,"literalBareImports":215,"status":"declared-production-imports"}
{"runtimeJsFiles":460,"externalSdkImports":0,"legacyOrchestratorDefinitions":0,"legacySourceFilesVerified":2,"historicalFormatFilesRemoved":9}
```

## 边界与收尾

- 不声称模型语义质量或真实模型正反场景泛化已测；Host 的引用校验不能证明事实真实。未跑全仓默认/runtime/routing/containment 全套；本轮执行上述与变更直接相关的实际链路，不宣称全仓或跨平台验收通过。
- 自动维护仍须安装操作者显式启用；首次只建水位不等于完整历史复盘。无新增渠道手动维护 API，不自动修改真实安装配置，也没有执行 UAT/生产历史整理。
- 原检出其他会话的修改未动；本 worktree 未复制环境文件、node_modules 链接、账号、凭据或私有 Skill。只修改已准入的通用 skill-creator 适配段并同步 UPSTREAM 修改声明；许可与附属脚本保持不变。
- git check-ignore 确认 data/memory、data/skills、data/config 为忽略路径；git ls-files data 无输出。提交前已独立核对 staged diff：运行数据没有暂存，Skill 仅为既有通用 creator 适配/修改声明；无私有技能或凭据。
- 测试自己的 Host、SQLite、本地端点及临时目录均由 fixture 清理。未生成仓库内业务原始日志或大 binary；必要最终文字证据集中于本文，round-1 历史结果保留。

## 受验改动字节指纹

以下按路径排序的 JSON 用 UTF-8 紧凑 separators 序列化计算聚合 SHA-256；只覆盖本轮实际变更的源码、测试及通用 Skill 资源，未改依赖由 c1a5796 基线绑定。

聚合指纹：`6fdc9abd37cd52cf31583ea871d95d1047bf21a4e29657ed95e2de9c2ebcfd12`。

```json
{
  "skills/skill-creator/SKILL.md": "32aeca728f0a3696922177018d418feb902f20b4f0920a9fb1e63206912d8c70",
  "skills/skill-creator/UPSTREAM.md": "ca09e5333638d4e28b0ed373438d30c3603c4cef46d3bd6318a9eeeddb019549",
  "src/channels/resident-router-business.js": "a868f632cbc69a64e33096270d67c9e01c24d1697aed7c59ee79da481ad65ad0",
  "src/host.js": "bc246f60dc230292593fa4bb1eb5da1794dfb50fa3a61a3e94d2937a0055eb24",
  "src/memory/extraction.js": "78398fb7786a847d8eff530116f0b24c2a7a9f3ef225b4f8f7039e2071e7ff2a",
  "src/memory/maintenance.js": "ac270584637a794c58e2e7ecab971a4b88cd3b9adf9efbfed9b67c3941147c02",
  "src/memory/reflection-inference.js": "dee39e4552a703f5544b117e022d315653b6b868bdfd5237712eb5ee339dc1de",
  "src/memory/reflection.js": "49e29135b3a737d887b2ffb0fb1c9de4e26f071a51ebcaf4eb153c611d142ebd",
  "src/memory/service.js": "7610926c48e922ccfc06659baa063302cf2715d1de95cf6e377c927b4a552b07",
  "src/memory/skill-generation.js": "248f824948b8f5e194ee93cc358026d964662fc02229ff6e9118e6e07d8c2172",
  "src/memory/store.js": "a04d74bad921cc33ecd8859f7297d4c44ef7da2181d918c95618048001e5e4e5",
  "test/fixtures/memory-host.js": "951b32b59e956b285b58e984e1511953cdfa16b9e3646e23df76b9d3188ec590",
  "test/pi-memory-maintenance.test.js": "d4cb9bc4a193333724d0d6e66b06f1239e42a4ed573bfd2ce27c9f5f350ef0eb",
  "test/pi-memory-official-extraction.test.js": "f67aa1ec957a448c0c1b8d6194f0d646e992fb138843b3cc35f14ef81d0b169d",
  "test/pi-reflection-official.test.js": "24fb38b87415296ca5943efd4ae78ad56f81a11bd4907e2027cbb623e45e0348",
  "test/pi-reflection.test.js": "56d60496e2a083e0daa83710f0117049051b4d612a4eb92d2f066347c4bc5359"
}
```

## 交付事实

- 功能提交 c0920e0d6007d2c4e08758c3c3bc78dd1ae15cf0；PR 证据文档提交 c2865927da25a1d9df03e269fc3f2219335edeed，后者未改运行时代码或测试。
- [PR #180](https://github.com/zzusp/night-bot/pull/180)：main ← worktree-memory-skill-periodic-review；gh 回查 state=MERGED，mergedAt=2026-11-18T02:12:38Z，mergeCommit=e893bf33e2835e41a0b280a94acf0cec3322060f。
- 创建后 mergeable=MERGEABLE、statusCheckRollup=[]。远程 main 无 required checks，规则只限制删除和非快进；唯一 website workflow 不匹配本轮路径，未手动触发 CI。
- git fetch 后核实 origin/main 为 e893bf3，且 c286592 为其祖先。受验代码字节仍与本文聚合指纹一致；本次后续仅同步已发生的交付事实/goal，不重新声称运行时代码有新变更。
- 未部署、未重启实例、未清理真实 Bot 历史。已向等待本规则的部署会话同步真实合并 SHA 和完整历史复盘仍需另行验收的边界，不接管其操作。
