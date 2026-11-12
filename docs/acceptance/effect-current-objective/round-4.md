# 第四轮：安全停机、已合并发行与同安装记忆迁移

## 版本与结论

2026-11-12，PR #81 于 07:22:26Z 合并；真实合并提交为 `569a6dc5da63cb0438d0aa193e5e019a337b36f0`，包含 main 的 #80 分层记忆。独立发行签出该提交，安装、Web 构建及守卫通过，Git 干净。实际核心、Web 和插件均已切换到此发行；不是工作分支热替换。

本轮完成用户授权的 PR 合并、本地安全升级与记忆迁移。原业务 Excel 未续跑或验收。Web 记忆缓存强制刷新存在已复现的 Windows 文件替换故障，未通过；不写全绿报告，不把旧缓存的 HTTP 200 当成功。

第三轮记录保持原受验范围。本轮代码验证头为 `7300a399be5da5dfb61e275294c75524ea8ac26e`；其后的合并提交未增加源码。当前证据分支为 `worktree-router-memory-deployment`，只新增本轮验收文档及目标检查点，不再推已合并 PR 的原分支。

## 本地组合验证

| 检查 | 结果与范围 |
| --- | --- |
| main 整合后的 Router 实际完整调度链 | 1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，111322.0375ms；真实模型请求、原会话停启、冷重开与归档再激活 |
| 效果完成权威 | 4 PASS；不把旧已结效果变成后续工具或 complete 的新授权门槛 |
| 迁移全组最终实跑 | 17 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，31675.9554ms；含标准技能历史文件字节、Windows 重解析点拒绝、崩溃恢复、备份、锁和遗忘 |
| 生产守卫 | `pnpm check` PASS：190 retained / 10 retired / 3 excluded UI / 59 adapted；428 production/runtime JS；externalSdkImports=0，legacyOrchestratorDefinitions=0 |
| 发行准备 | `pnpm install --frozen-lockfile`、Web `tsc --noEmit && vite build`、发行 `pnpm check` PASS；autocrlf=false、symlinks=false，HEAD 匹配合并版本，Git 干净 |
| 配置准备 | `updateConfig(...,{checkOnly:true})` 与插件发现通过；计划仅替换发行 packages 目录，无重复类型，磁盘字节未写入 |

初次组合运行共 20 条：19 PASS / 1 FAIL，唯一失败在 Windows 创建文件 symlink 的夹具 EPERM。改用真实目录 junction，并让 snapshot 不跟随链接；生产拒绝重解析点的守卫不变。新增夹具首次存在字符串换行语法错误，修正后最终 17 条全部通过。没有 skip、提权或放宽断言。未重跑无关全量 default/runtime/routing/containment/UI 组；第三轮首次全路由组的失败与补验历史仍保留。

## 真实安全停机与恢复

- 持续等待全部本地任务终态或等待且 drained=true；最后一项先 completed/drained=false，继续等待，没有强停。15:48:33+08:00 的监控确认 9 项均满足条件。
- 正式操作前独立回查，再通过认证、带版本 CAS 的渠道入口临时暂停两个 DWS 实例；均 liveApplied=true/paused。暂停后重新读取全部任务，unsafe=0；服务所属子进程只余核心，没有业务 process runner。
- 通过既有监督器 IPC 正常停止。15:50:27+08:00 核对原 supervisor/launcher/service 全部退出、metadata 由监督器正常清理、19198/3080 无监听。停机请求至退出 1.914 秒。未使用强杀、删除锁/WAL 或清游标。
- 离线配置事务仅替换插件发行目录并恢复原 receivePaused 偏好；实例、账号引用、权限 full 和其他配置保留。新监督器 `--check` PASS，模型 credential 引用可用，无探测副作用。
- 新 supervisor/launcher/core 分别为 111076/76228/84984。独立核对核心和 Web 监听都归新发行的核心进程，插件发现也指向新发行。
- 15:55:10+08:00 两个真实 DWS 实例都恢复 receiving，connected=true、errorCode=null、restartRequired=false、requestedPaused=false。新启动至渠道就绪 145.017 秒；停机请求至渠道就绪共 284.742 秒，含离线迁移和配置验证，不仅计算关闭耗时。
- 两份耐久接收记录仍保留原 firstStartedAt；补拉水位继续前进，deferredMessages=0、pendingRecalls=0、paused=false。未重置历史或向真实渠道发测试消息。

## 同安装记忆迁移

在线 `--check` 曾正确拒绝活 Host；正常停机后使用新发行正式执行：

```powershell
node scripts/migrate-memory.mjs --install-root <原安装根> --check
node scripts/migrate-memory.mjs --install-root <原安装根> --apply
node scripts/migrate-memory.mjs --install-root <原安装根> --check
```

结果依次为 ready → completed → already-layered；layoutVersion=3，21 条、2 个分类、0 候选，scopeRevision=32。完成收据及工具内建原件保留，备份 manifest 的 4 个源文件逐一核 hash。未另建整安装备份，局部原件不代表可无损回退整安装。

使用正式旧解码器取得离线基线，再用新 MarkdownMemoryStore 完整快照核对：按分类保留的每条正文及全部元数据（ID、版本、source、context、previous 等）、候选、seen、forgotten 均一致；只剔除预期新增的 layoutVersion 字段后，前后规范化语义 SHA256 都为 `55e69c5ed87591eb1cf8cbf263c78be5472c80ee692ba85f9485575c42df6218`。`installed-previous.json` 的原始字节 hash 不变。启动后对实际目录的只读盘点也成功读出 21 条记忆、41 项记忆/技能元数据；未复制技能正文、账号、聊天或业务数据入库。

## Web 读回与明确失败项

- 认证 `/api/tasks?limit=100` 读取 9 项，无 stale/error；原有 9 个 task/session 逐一保留。实际 HTTP 首页的 hash 与新发行 dist/index.html 一致，非旧页面。full 保留，两个渠道健康与偏好读回一致。
- **FAIL：`/api/evolution?...&refresh=1`** 返回缓存 stale=true、EVOLUTION_CACHE_REFRESH_FAILED，不能算记忆页刷新成功。缓存仍显示 21 条/0 候选；这不否定离线迁移和逐条语义核对，也不证明前端已刷新。
- 排查先实际观察到当前核心持有进化锁，独立盘点返回 EVOLUTION_BUSY，未清锁或中断复盘；锁释放后盘点可以成功。随后以当前完整、无正文的公开 DTO 在安装内一次性临时目录复现缓存：第一次刷新 stale=false；第二次在保留旧 generation 读句柄时，Windows rename 抛 EPERM，缓存退回 stale。隔离临时目录已删除，未改运行发行。这证明除短暂盘点并发外，还存在独立的缓存替换问题，不继续把等待锁释放当唯一解决办法。
- 该既有 Web 缓存实现问题另需修复；本轮没有扩大为 UI/缓存协议改造，没有绕过保护或删除正在使用的缓存来宣称成功。

## 原任务与边界

原 Excel 任务仍为 waiting/drained=true，保原 session；旧效果结清仍 committed / closed-with-possible-partial-effects / noReplay=true。只验证了平台新合同、安装升级、数据保留，没有通过改账本、伪造来源或重新执行旧调用恢复任务。

`/health` 仍 degraded、recoveryIssueCount=2，实际对应两个既有业务等待记录，含原授权门槛的历史失败摘要；不把历史摘要当新版本又触发门槛，也不抹掉它们来让 health 变绿。没有创建新的真实模型业务调用来证明 Excel 已恢复。业务代码、中英文 Excel 生成/读回、业务系统发布均未执行。本轮合并/本地升级授权不扩展成跨仓发布。

详细运行态和无正文 hash 证据只留在受忽略的安装工作区；本报告自包含必要文字证据，不提交运行账本、私密记忆、技能、凭据或完整日志。唯一长期目标见 [goal](goal.md)，跨轮结果见 [matrix](matrix.csv)。
