# 第三轮：合并与本机更新验收

## 结论与授权

用户在 PR 交付后追加授权“合并 PR，更新本地 bot 并验证”。本轮已完成；普通更新没有创建备份，既有备份、业务数据及凭据保留。没有主动发送业务测试消息、重放历史效果或部署云端。

记录时间：2026-11-16T23:43:13+08:00。

## 版本与实际运行

- PR #169：gh 独立回查 `MERGED`，合并时间 `2026-11-16T15:24:23Z`，合并提交 `a11e9f220e97d14de90e66bede94f65f4177ecdd`。
- 原运行版本008a4e2，现运行上述已合并提交。使用独立 detached 发行检出 `<install-root>/.claude/worktrees/execution-reliability-release-a11e9f2`，没有修改主检出或另一会话的运行 worktree。
- 首次 checkout 前指定 `core.autocrlf=false`、`core.symlinks=false`；发行 Git 状态干净。核心、可选 Web 插件及构建资源同源。
- 实际监督器PID36024、launcher PID38872、核心PID33328，CIM 命令行均绑定该发行；旧监督器/launcher/核心三个实际进程已退出。
- 16个受影响源码/测试文件与第二轮逐文件 SHA256 完全一致；代码集合指纹仍为 `0f9a4ff15ad69bb3f94f48533553d173e980eca57d499c8ea93ee01d29f15468`。本轮文档位于工作分支，运行发行保持已合并提交，不加载未合并的文档分支。

## 执行与实跑证据

| 验收 | 观察结果 | 结论 |
| --- | --- | --- |
| 发行依赖与检查 | root / Web 独立 `pnpm install --frozen-lockfile`、Web `tsc --noEmit && vite build`、`pnpm check` 均exit0；来源190 retained/10 retired/60 adapted，生产导入451、runtime451、externalSdkImports0 | PASS |
| 构建边界 | Web 341模块；生成 JS 666.48kB、CSS136.21kB；只有既有大chunk提示，不是失败。本轮不顺手改拆包策略 | 已披露 |
| 配置零写预检 | `updateConfig(...,{checkOnly:true})` 前后文件哈希一致；只计划替换 `channelPluginDirs` 中旧发行的 packages；插件发现恰有 dingtalk-dws / web-console | PASS |
| 正常停机 | 既有监督器 `--stop --check` 后 `--stop`；关闭收据 `phase:closed, code:0, ipcShutdownSent:true`，`closedAt:2026-11-16T15:30:30.203Z`；三个旧实际进程均不存在 | PASS；无强杀 |
| 配置保存与启动 | 在排空后再次 `--check` 核对，再经同一受控事务保存；除目录字段外逻辑配置完全相同，只移除本次停止标记；新监督器 `--start --check` 报 pluginSourceMatches=true 后启动 | PASS |
| 实际就绪 | 新监督器 startedAt `2026-11-16T15:37:25.763Z`；就绪回查 `2026-11-16T15:38:28.532Z`。resident `/health`:ok、channels、recoveryIssueCount0、taskAttentionCount0；`/state/recovery-issues` 空数组；Web根200 | PASS；时间含人工检查，不作为提速结论 |
| 认证 Web 与渠道 | 登录、session、tasks、deployment、channels均200。三条渠道 savedVersion=runningVersion、restartRequired=false、liveApplied=true；两条钉钉均 listening / connected=true，Web connected=true；任务页11项、实时查询无缓存 | PASS；不是仅HTTP200 |
| 静态产物 | 实际服务HTML及两份资源逐字节 SHA256 与发行 dist 一致：`index-CW8km0GI.js`、`index-g8Sw80RW.css` | PASS |
| 业务保持 | 重启前后11任务、187来源、145通知、0operation、3545receipt完全相同；未排空任务0，unknown/starting通知0。task/session、版本、状态、来源和完成记录的选择投影摘要相同 | PASS；没有创建任务或重复交付 |
| 合并发行关键回归 | 在发行cwd执行下方命令，6 pass / 0 fail / 0 skipped，16241.3047ms | PASS；实际发行代码+隔离Host/Pi，本地脚本模型及假渠道 |

任务业务选择投影摘要：`e0818139b61095ecc5ce4d6bc1a6c100056f519f6ff620e18a444e09c68b2645`。这是只读对照摘要，不提交任务标识、正文、真实资源或数据库。

## 行为回归覆盖

```powershell
pnpm --dir "<release>" exec node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='released (completed|failed|killed) job|terminal output snapshot|historical job lookup|conversation task questions' test/pi-official-job-ledger.test.js test/pi-resident-router.test.js
```

- completed/failed/killed 真终态 → 删除registry → 重开持久化 → 原会话重复回读，producer仍只启动一次。
- UTF-8及更小输出预算、observer log不入输出、旧无快照明确不可恢复、外来owner与未知效果拒绝。
- 默认/显式操作者及原请求人三种答复受众，原task/session completed/drained，来源、CAS和重复答复防重放保持。
- 第二轮完整runtime150通过、routing152、作业54、单会话22对应代码未变，不重复跑整组；重叠集合不相加。

矩阵中的 `PASS_REUSED` 表示复用相同代码字节的既有通过结果，未在本轮重跑整组；`SKIP` 延续第二轮平台跳过边界。`BOUNDARY-03` 的 `PARTIAL` 仅表示本机更新已验，Windows OS containment 仍未验，云端未部署。

## 隐私、保留与未验边界

- 现有安装数据位置、实例/账号/渠道身份、权限模式及供应商配置未改，只有插件发行目录变化。没有复制凭据、业务数据或私有Skill；认证读取未输出token/cookie/CSRF，验收会话已logout。
- 新发行及其依赖/构建、当前监督器和安装内诊断日志是运行所需资源，继续保留。没有删除仍运行的代码、数据、缓存或既有备份；停止标记仅在关闭收据与实际退出证据齐备后清理。
- 历史第1/2轮报告与矩阵保留；本轮无私有截图/数据库/日志附件入Git，只保留必要文字证据。实际路径用受控占位符表达。
- 两条实际钉钉监听状态通过，但没有发送厂商测试消息；不据此宣称厂商外发E2E或session_expired真实认证流程已修复。
- 真实模型对任意分诊/范围措辞的语义保证、Windows OS containment、真实端到端性能仍未验；Linux专属的12个场景仍跳过。当前本机Bot更新完成不代表云端部署。
- 原新journal字段兼容边界不变：不得用旧代码直接打开本版已写的新格式收据。无备份更新不承诺无损回滚。
