# 第二轮：真实部署反证与恢复分诊热点

## 源码和阶段结论

首轮候选已通过 PR #133 合并，本机发行 `7df8058693de877f6ff51157ddcea305c2cda420` 实际启动，核心与插件同版本，data 保留且未创建备份。正常 IPC 停机失败后，经 PID/父链/命令行、零子进程和端口退出核验，仅强制结束原服务；不记作正常排空成功。

**首轮部署性能未通过**：鉴权轻接口分别约 12/233/148/37/12/43/32ms，但任务无增量读取为 1113/855/618/10688/517ms，同期 health 最大 10109ms。Router 无增量为 1259/283/202/235/256ms。不能用独立单日志对照代替最终运行实例验收。

初次候选验证基于主线 `7336e0014ccf5c9f0df45ca2bbd1b013be68cca6`；随后快进整合已合并 #132，最终候选基于 `58026c05003f9e9ee2b504cc28de2c00d10cf5ef` 加未提交的 router-ledger 索引替换及回归。主线并行 UI 合同及轻量查询原样保留。来源/真实分诊/任务闭环和同库对照通过，候选尚待合并与重新部署；最终运行事实在后续 PR 集中更新。

## 真实服务根因

在已核验发行服务上，仅采样 CPU，不调用业务工具或更改账本。10.9 秒取得 6182 个样本，6 条热点调用栈共 4160 个样本（约 67%）沿：

`recover → kickGroup → triage.pending → latest → SELECT 所有来源 + JSON.parse`

`latest` 对每条候选重复读取并解析全部来源。真实只读统计为 136 条来源、487340 字符、130 条分诊记录，其中 28 条 pending，按最新版本过滤后为 0；旧候选仍参与每次恢复扫描。没有删除/改写这些记录，继续保留历史与版本防护。

第一段较长采样还观察到 Pi 严格解码/写提交成本，不把这些安全校验删掉或改成跳过；此次只消除反复读取全体来源的版本判断。历史快照缓存不能消除此调用链，因此不能把首轮修复称为完整根因。

## 最小修复及反证

`router-ledger.js` 改用参数化 `SELECT 1`，同会话、同消息且版本严格更高时判旧。真实 `EXPLAIN QUERY PLAN` 返回：

`SEARCH dynamic_sources USING COVERING INDEX dynamic_source_history_version (<expr>=? AND <expr>=? AND <expr>>?)`

复用已存在的版本索引；无 schema、频率、批次、权限或 no-replay 变化。没有以清除 pending、放行旧来源、降低隔离或增大缓存预算掩盖问题。

## 已执行验证

- 同一真实账本的只读事务，使用 [compare-pending.mjs](scripts/compare-pending.mjs) 对照真实旧/新 ledger 查询，未复制业务数据，返回逐项一致。5 次完整 pending conversation 查询：旧 `56.57 / 54.66 / 55.63 / 56.17 / 60.02ms`，新 `1.30 / 0.88 / 1.71 / 1.28 / 1.01ms`。
- `node --test test/pi-router-ledger.test.js test/pi-source-history.test.js`：43 PASS，0 fail/skip；同消息跨会话高版本不屏蔽、旧版本拒绝、15 条批次上限及重启一致；撤回/hold/来源授权等原反例保留。
- `node --test test/pi-persistent-triage.test.js test/pi-router-task-e2e.test.js`：10 PASS，0 fail/skip；真实 Pi 历史/压缩、同会话冷恢复、旧版本替换、模型失败排空，以及 A 返工同会话后才释放 B 的闭环完成，`errors:[] / toolErrors:[]`。
- 整合 `58026c0` 后组合核心 7 文件：68 项中 **67 PASS、1 FAIL、0 skip**。唯一失败为新增上游 `pi-live-digest` 用例创建符号链接被 Windows `EPERM` 拒绝；此前实际字节/替换校验已执行到该行，不把该用例记 PASS，不改系统权限或删断言。其余包含上述 53 项及严格 journal/route 和 digest 改变期间拒绝的回归。
- 整合后 Web 历史/live/轻量 proof **45 PASS、0 fail/skip**；类型检查及生产构建通过，既有大 chunk 警告保留。`pnpm check` 单独执行并核对结果。
- 第一轮完整 Web/运行时失败边界继续保留，未为本次 3 行查询替换重跑耗时完整组或声称其全绿。

## 诊断脚本问题与边界

首次真实 smoke 探针遇到 ECONNRESET；服务及 PID 未退出，单独 health 连续 5 次均 200。后续使用独立新连接测量，避免把空闲连接复用竞态混入耗时；上面的 10 秒停顿来自这次后续实测，未因客户端修正而隐藏。该轮脚本注销请求缺少 JSON content-type 返回 415，已按既有接口补正；业务 API 和资源 SHA 验证结果与注销失败区分记录。

私有 CPU 连接、真实身份/路径、cookie、正文和完整 profile 不提交。诊断辅助文件只在忽略目录使用，最终部署重启移除临时 inspector；最终阶段清理本任务资源。此阶段不声称原未知后台作业已结清或业务等待已恢复。
