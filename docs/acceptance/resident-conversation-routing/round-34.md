# 第34轮：新版 Profile 三守卫与真实 runner 前置拒绝

## 结论

Profile 最小生产增量 `2d89946f`、来源登记 `a819b051` 上，原 `pnpm check` 三守卫和一个既有 Windows LPAC runner 注册均实际自然 exit0。两命令的四份1125项来源映射全文相同，聚合 `f302cf519b33b09f8709d8ad49ef7887b3e929685d6f66ed0b3f88b52b988fb7`，无受验来源漂移。

烟测实际1 PASS、0 FAIL/CANCEL/SKIP/TODO，证明真实 runner 能导入新 Profile，并在缺 durable Job 协议时于 Native 前拒绝。**不证明真实 Profile/temp 创建、mandatory、Job ACK、launch 或 ConPTY。** `scopeReady=false`、SG11/SG12 ACTIVE保持；不写全绿report。

第33轮原225消费窗、94b出生Low组件及外层失败证据不改、不重跑。本轮不把新生产代码通过守卫倒签为第33轮受验版本，也不覆盖既有NULL业务树恢复失败。

## 版本与原入口

工作目录、分支保持原 `resident-conversation-plan/night-bot` / `worktree-resident-conversation-routing`。受验版本为 HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509` 加未提交协作工作树，不能仅用HEAD代表。

- `src/process/windows-profile.js`：`2d89946f09a7011923be51833730694447ddbeef4e27845b030c69b2dabf7f45`。
- `docs/process-fork-manifest.json`：`a819b051a90b5e76f4b1f13f8cf70aeb9d61e20df78fd4f58a91cb7ab545c5e1`。
- `test/pi-native-process.test.js`：`a330814b26ade35ddb99546418c2a3c0e1fce96f3531e2bc783fdee65f49b8f4`，本轮未改。准确注册仍在27行，原registration锚不改。

来源选择沿第32轮原采集器规则，额外明确纳入本次变更的process-fork-manifest，因此1124→1125。包含Git可见代码/测试/脚本/包资料、明确根合同及tracked删除路径的缺席值，不包含安装数据、secrets、node_modules或验收记录。四份映射相同只证明这份集合无漂移，不是全环境或未执行平台通过证明。

复用原采集方式，仅改两个既定命令、临时前缀和新版本pin；不改项目runner、产品、用例、业务期限或断言，不重试、kill或强停。Node v24.19.0、pnpm11.25.0、Windows本机执行。

## 实际执行与结果

| 检查 | 实际时间（北京时间，UTC+08:00） | 自然终态 |
| --- | --- | --- |
| `pnpm check` | 2026-11-08 22:20:01.918854–22:20:07.068004 | exit0，任务b180fo2xi |
| 原mandatory前拒绝注册 | 2026-11-08 22:20:11.378253–22:20:14.478173 | exit0，任务b77rpld9m |

守卫实际命令为 `pwsh -NoProfile -NonInteractive -Command "pnpm check; exit $LASTEXITCODE"`。原三行JSON分别记录：

- 来源/覆盖守卫：retained190、retired10、UI excluded3、adapted57；relativeImports closed、HTTP routes retained。
- 生产import守卫：productionImportFiles395、literalBareImports193、declared-production-imports。
- Native守卫：runtimeJsFiles395、externalSdkImports0、legacyOrchestratorDefinitions0、legacySourceFilesVerified2、historicalFormatFilesRemoved9。

原 `check.log` 为436B/SHA `bbf6b329dc30a257f34c3d50f5fdc07a55725f12cd541481de7fca9bf737113c`；stderr120B仅pnpm原Node命令echo，不是错误。准确result包含自然终态、起止来源、无干预字段和日志原hash。

烟测直接使用原Node入口，不执行整份测试文件中的其他注册：

```text
node --test --test-name-pattern "^Windows LPAC runner requires durable Job protocol before current-token executable resolution$" test/pi-native-process.test.js
```

实际spec首行完整PASS名与源码27行唯一注册精确相同，duration128.5814ms；汇总tests1/pass1，其余失败、取消、跳过、todo均0，总duration277.8153ms。`profile-smoke.log` 为223B/SHA `b84b732135c8759ede0f8bf0b7d7ad1f8c395b281bafe854042166ae27d027f8`，stderr0B。

真实测试fork原runner并发送缺Job协议的start，核自然exit127、signal=null、stderr空、恰一个error且消息为原durable Job协议拒绝。`src/process/runner.js:9` 静态导入真实Profile，`:269` 在协议不符时拒绝，实际factory调用在`:350`；此用例没有到factory或Native，不能称新temp出生Low真实创建已验。

## 正式证据、库存与矩阵

`round-34/`保留两命令各source/log/stderr/result共8份，另含准确collector.py、archive-update.py及batch-index.json，共11份文字附件。10份被索引资产均与执行/归档临时源逐字相等。源/收据里的旧临时路径是历史来源，通过index的temporarySource映射定位正式附件，不是重放入口。

归档只更新库存中该真实注册的一行7个证据字段，不增删身份、不改源码SHA、registration锚或其他5471行。库存仍5472个唯一身份，当前3320505B/SHA `aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb`。index保存原整行及7个原始字符单元；逆构精确回第33轮3321346B/SHA `b1bdb346d123d45f2ab44c652fd2eab83adb06c2576284e7286b1d245168a018`，不整表重序列化，不追认其他注册。

矩阵294→295业务行，只增加round_34及独立当前runner前置拒绝行。source-import-native-guard记实际三守卫通过；两个总汇行只记局部通过及仍未验证项，其他291个旧行NOT_RERUN_ROUND_34。原scenario、历史列及第33轮组件/外层失败状态均不变。当前190361B/SHA `b2c40bd2e747486a92029bdcc31a84ffb748093774c245a0e50ff60ea1f2217f`；剥本列和新业务行，全文精确回第33轮 `28b87048d05b7920a1b96fc403971baa72af22947e5dcf46de1fe064b4378215`。

归档更新先--check/effects0，再--run；长shell准备命令曾在解析期失败，独立确认未生成部分脚本，后改用文件工具写准确归档源。未由失败命令启动测试或产品执行器；正式archive-update.py保留实际采用源码，不伪造首次命令成功。

## 清理与剩余边界

本轮只清理准确10个自有临时文件及self-cleaner自身：两组8份临时输出、collector和archive updater。清理已先--check/effects0，再--run/effects11，随后独立lstat确认11准确路径全部缺席；终态及各原bytes/hash集中在index。第33轮九私有Native材料、旧五失败根和仍有用途的既有证据不在清理范围。

本轮没有生产/测试源码修改、真实模型或渠道调用、Native新探针、Git写入、CI、合并或部署。全仓既有两个测试文件CRLF/尾空白问题仍由Lead单独核，不以本轮守卫0宣称全工作树diff-check通过。真实生产Profile未launch准备/mandatory链下一准确稿仍须原Review先审；本轮烟测不抵扣该安全门，未启动或Resume。
