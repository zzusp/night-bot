# 第一轮：故障状态与本机部署闭环

## 结论与版本

2026-11-14，排空失败仍显示执行中的状态问题已修复、合并并部署本机。实现 PR [#139](https://github.com/zzusp/night-bot/pull/139)，候选 `4341de95aa303766ad318dd49d2574d45eedf70f`，实际运行 **`3837735803f6f56d44b7b728851e070595a22d7f`**；合并树和受测候选树均为 `e5bd68b981ba1ff9930430738fcdaddb4e265cf7`。

本轮相关 Web/账本 78 项通过，列表 24 项集中复验通过，真实 Host/HTTP/Edge 与部署原任务只读验收通过。更宽投影文件仍存在无关 quote 引用相等断言失败，不把全仓测试说成全绿。后续归档提交不改变实际运行代码 SHA。

## 修复前证据及因果链

旧恢复会话最后助手错误是 `NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY`，随后 `TASK_SESSION_DRAIN_FAILED`；日志已停更，接口仍 task running、session running，三个原始 blockers 数组均空。未知作业禁止重放符合合同，问题是排空失败只留在内存告警，`drained=false` 被 JS、SQL 和会话状态误当作仍在推进。

不是通过强行 drained 或前端改字解决：Host 以会话/租约记录独立 `sessionFailure`，不修改业务决定、不 ACK 输入、不改变收据；任务 waiting、会话 failed，Web 仅提供固定安全原因。真实排空后清本轮故障。旧租约拒绝、正常运行/完成/取消路径保留。安装期同步 active/archive/wake 触发器与派生索引，GET 不做 DDL。

## 本地验证

- `node --test test/pi-task-business-failure.test.js test/observer-pagination.test.js packages/web-console/test/agent-progress.test.js packages/web-console/test/server.test.js packages/web-console/test/session-host.test.js`：102 项首次 100 PASS / 2 FAIL。两项为旧投影夹具的缺失依赖及已退役拆分执行假设；转为现行 core 路径、实际工作区事务与单会话拒绝合同后，`node --test test/observer-pagination.test.js` **24 PASS / 0 FAIL / 0 SKIP**；其余 **78 项已通过**，未重复计算为额外用例。
- 故障注入使用真实默认 Host、Pi 和原生作业 guard：隔离测试登记作业后不启动生产者、保留缺失终态，得到实际 `NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY` 和 drain failure。模型只调用 1 次，无 settled，wake 仍 claimed，drained=false；HTTP 返回 waiting/failed，恢复扫描不重放。
- 同一隔离应用由 Edge 登录并打开任务、执行栏，核对等待中、失败提示、无运行光效；[最终截图](browser-final.png) 已实际查看。未决 owner 保留在独立测试进程中，退出该专用进程后清理临时安装，未为测试伪造终态。
- `pnpm check` 三项来源哈希/生产导入/原生运行时守卫通过；`pnpm --dir packages/web-console build` 类型检查和构建通过，已有大 chunk 警告保留。发行检出重新 frozen 安装两套依赖，同样检查和构建通过、工作树干净。
- 更宽的 `test/task-message-projections.test.js` 有一项 `new inbound image bytes...` 的 quote 对象引用相等断言失败（结构相同、引用不同）；本次没有改图像/quote 行为，不扩展修复。完整 runtime/containment 全组未重跑；本次未改变工具权限、沙箱或作业结清。

## 合并和部署

主线合并前再次 fetch，无新增主线功能差异；#139 使用精确 head SHA 合并，真实 GitHub 状态 MERGED。未手动触发 CI，提交含 `[skip ci]`，主线规则只有 deletion/non_fast_forward，无 required checks，不声称 CI 通过。

独立发行检出在首次 checkout 前固定 autocrlf=false/symlinks=false。原安装 data、凭据、权限模式 full 及其他配置保留；经 `updateConfig(checkOnly)` 核对后只替换原插件目录，保存后独立读回，核心与插件来自同一发行；没有创建备份或操作原脏主检出。

旧实例 IPC 关闭仍报告 `Host shutdown failed; ownership retained`。正常关闭后，核实端口均已退出、无业务子进程、PID/父子关系/命令行与原发行匹配；先 `--check` 再精确强制结束残留旧 service。随后独立确认旧 service/launcher/supervisor 均退出、原 metadata 消失，再启动新发行。没有删除锁、WAL 或 journal，也没有把强制结束当作正常排空证据。

实际进程只读核验：supervisor 114712、launcher 140128、service 64152；19198/3080 均属于该新 service。新 supervisor stderr 为 0 字节。

## 原任务真实终态

等恢复实际落账后验证，不以启动就绪或 HTTP 200 代替终态。原问题任务在 **2026-11-14T04:13:45.598Z**（北京时间 12:13:45）持久记录 `TASK_SESSION_DRAIN_FAILED`：

| 观察 | 结果 |
| --- | --- |
| 原任务及会话 | task waiting，session failed；drained=false，recovering=false，leaseEpoch=17 |
| 待处理输入 | 3 条未 ACK，保留原输入 |
| 原生未知作业 | 严格 Pi 解码后仍有 1 个未决作业；最后助手错误仍为 `NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY` |
| 日志 | 18,766,475 字节，完整已提交；整个只读验收前后字节完全一致 |
| 列表及关联卡 | waiting 包含、running 排除、所属会话 taskSummary waiting |
| 实际浏览器 | 原任务等待提示可见，执行会话失败，无任务运行光效 |
| 静态资源 | 实际 JS SHA-256 与 metadata 对应发行 dist 一致 |
| 原任务数量 | 11 个，其中 9 个 completed；未代答其他业务等待 |
| 健康 | degraded，2 项恢复问题；状态修复没有结清业务阻断 |
| 认证 | 登录与注销均 200；不输出令牌、不发真实渠道验收消息 |

[部署只读验收脚本](scripts/verify-local-state.mjs) 参数为安装目录、现有任务 ID、预期已合并 SHA；真实路径/身份仅在本地传入。脚本使用实际发行的严格解码及显式 portable codec，不手工解析或修复 journal。已执行版本 SHA-256：`b33bbf34f3b82c63e299dda6231469d167a6a8fe4763c23d34b84bb9b3e5ab78`。

本次交付修复状态真实性。原业务仍需核实未知作业及其可能副作用，不能据此声称业务修复完成或可以重放原调用。
