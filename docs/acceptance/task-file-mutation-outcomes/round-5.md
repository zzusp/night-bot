# 第5轮：本机升级与原任务恢复

## 范围与受验版本

2026-11-13，Windows 11、Node.js v24.19.0、pnpm 11.25.0。本轮已取得明确授权：合并 PR #117、平滑更新并重启本机 Night Bot、正式对账并恢复原任务；不操作 Docker/云端，不重放旧调用。操作者要求本地更新不创建备份，原安装 data 保留。

- PR #117：MERGED，合并提交 `71a708388c3df82e0a1032c92e302588683edb28`，`mergedAt=2026-11-13T07:33:16Z`。
- 合并后已 fetch 并同步最新 `origin/main`；本轮收尾再次 fetch，远端主线仍为该提交。
- 运行对象是该已合并提交的独立、干净发行检出，独立安装核心与 Web 依赖；四份修复实现 SHA-256 与第4轮完全相同。没有用脏主检出发布，也未修改其他会话的工作。
- 本轮后续提交仅维护本目录验收文档，不改变受验运行源码。运行数据、原任务业务材料、配置、凭据和原始日志均未提交。

## 验证结果

| 用例 | 真实观察 | 结论 |
| --- | --- | --- |
| 发行准备 | 核心 `pnpm install --frozen-lockfile --prefer-offline`；独立 Web 包相同方式安装后 `pnpm --dir packages/web-console build` 完成 `tsc --noEmit && vite build`；Git HEAD 精确匹配且工作树干净 | PASS |
| 源码守卫 | 在独立发行实跑 `pnpm check`：440 生产导入、440 原生运行时文件、外部 DSH SDK 导入0，源码/许可证/hash 检查通过 | PASS |
| 插件目录接线 | 停机前先做零副作用检查，使用 `updateConfig(...,{checkOnly:true})` 与插件发现验证；正常停机后经同一配置事务只替换 `channelPluginDirs`，独立读回新 Web 插件入口确实来自新发行 | PASS |
| 正常停机与启动 | 旧监督器通过 IPC 正常退出；metadata 消失且19198/3080释放；新监督器 `--check` 输出 effects=0 后启动。独立进程查询确认 launcher 与实际服务均来自已合并发行 | PASS |
| 本机入口与渠道 | resident 与 Web 页面均 HTTP200；认证 `/api/channels` 中两启用钉钉渠道均 listening/receiving、connected=true、restartRequired=false，无错误码 | PASS |
| 同任务只读核验 | 原 task/session 实际 read 保留文件并回复，明确没有写入、运行进程或访问外部服务；Host 随后真实排空，租约8的新切点可正式 inspect | PASS |
| 正式结清 | `night-bot-effects ... inspect/close` 成功；原生 entry `71634d90` 与 SQL 投影一致，outcome 为 `closed-with-possible-partial-effects`，noReplay=true；严格解码及 `verifyTaskEffectClosures` 返回1条有效闭合 | PASS |
| Router 续办 | 通过正式任务 context 传入技术回执，并声明旧技术等待判断失效；业务目标与授权不变。Router 将 control 从 paused 恢复 active，原 task/session 进入租约9 | PASS |
| 真实新工具终态 | 2026-11-13T07:59:06.667Z，新 `pwsh` 返回两仓 Git 状态、当前分支和 HEAD 的真实输出；对应 effect-result 的 isError=false，不是已接纳、running 或局部 idle | PASS |
| 无重放与健康 | 原未知 intent/具体调用仍只有1条，没有补造旧成功或 not-started；保留1条正式 noReplay 结清收据。独立 `/health` 回查 status=ok、recoveryIssueCount=0 | PASS |

新 PowerShell 调用证据链：assistant call entry `b60492c5` → intent `9d5594e5` → 成功 effect-result `e777139e` → toolResult `8083ef63`。同一原执行会话，当前 requirementRevision=5、controlRevision=5、leaseEpoch=9；没有另建执行会话。

## 关键事实与排除

- 原安装本来就是 full。本次没有放宽权限或沙箱；阻断来自未知效果 no-replay 与排空切点，不是继续申请 OS 权限。
- 新代码不会确定旧 write 的底层实际效果。操作者实际读回保留文件：101字节，SHA-256 `687358eac8df89747c1705dc5774085cc5b8262c6ad90725f2cd7d81a34dda5a`；原请求正文327字节，字节不同。这不构成旧调用未开始或成功证明，因此按可能部分效果结清。
- 新切点 `d92a439d` 只证明实际核验 owner；原 producer 证明仍必须成立。正式 inspect 和离线闭合校验同时验证两者，未手工追加证明或修改 SQLite/journal。
- context 的 `replan` 用于明确使已被正式结清回执推翻的旧技术等待判断失效；不改变业务目标、数据边界或业务授权。该入口先产生任务变更事件，再由原 Router 通过已有调度权恢复 active，不直接写控制状态。
- 最初误用根包 filter 构建 Web，pnpm 返回 `No projects matched`，产物核对失败；改用独立包文档入口安装和构建后通过，未将第一次命令当作成功构建。
- 第4轮矩阵中 Linux 隔离与真实发布两行误标 PASS，本轮依当时报告纠正为 NOT_RUN；第4轮报告与实际失败记录均保留。真实本机升级仅计入本轮，Linux 隔离仍未执行。

## 交付与边界

平台根因修复已合并并在本机运行，原任务已实际续办，本次目标完成。原任务后续继续 LCIA 明细删除与分类叶节点处理；本轮恢复证据不表示两项业务修复已经完成、部署、测试通过或实际送达。

未触发 CI，未部署云端或构建发布镜像；没有重跑无关完整 runtime/routing 或 Linux containment。第4轮代码回归的原失败及定点复验结果维持原记录，本轮不重写成整组零失败。未复制私有技能或凭据，未清理其他会话的旧发行、日志、工作区或业务文件。

最终证据是本报告的文字摘要及安装内原生调用/结清链；本轮自行创建的无用临时脚本、proposal/说明副本和 PR 正文源文件收尾清理。正式 Host 证据、原任务材料、当前运行的发行与监督器保留。
