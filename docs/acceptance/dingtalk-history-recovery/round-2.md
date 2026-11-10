# 第二轮：已合并本机部署与真实渠道恢复

## 源码与运行版本

- PR #29 已合并，merge / origin main / 实际发布检出均为 `491adbb2c6ebb58412b64ae73ba25e93b37e2f44`；发布检出 tracked 工作树干净。
- 保留原安装配置及全部 data；未修改配置，未清恢复游标、改旧指纹、手动注入历史、重建任务或发送测试消息。
- 根与独立 Web 依赖按 frozen lockfile 核验，实际发布目录 TypeScript/Vite 构建及 `pnpm check` 三守卫通过。既有 >500 kB chunk 提示仍存在。

## 真实终态

2026-11-10 14:52:47 +08:00 的认证 HTTP 和持久存储联合检查：

- 两个启用的钉钉渠道均 `runningConnected:true`、`runningConnectionState:listening`、无运行错误码。
- 两个持久 ingress 均未暂停、没有 recoveryFromAt、deferred 数均为 0；backfillThroughAt 已推进至本轮检查前。没有手工清状态。
- 原 11 条来源、11 条已送达通知、3 个任务以及 11 条 messageFacts 的逐记录哈希均与部署前相同。补拉另接纳 5 条不同消息来源/事实；总来源和事实为 16，通知仍 11、任务仍 3（2 completed、1 active）。不将新增来源误称为零新增。
- SQLite quick_check=ok，原配置哈希不变。
- 真实 Web HTTP 200，Edge 登录渠道页后三张卡片均「健康检查正常」，没有「恢复连接中」；1440px 实页截图已检查，390px 无横向溢出。未保留含实际会话名称的临时截图。
- 总体 /health 仍 degraded / recoveryIssueCount=1，来自原有外部效果待核实告警；不属于渠道恢复失败，本轮没有清告警或重试该外部效果。

本轮文字保留全部关键结果；旧运行/浏览器 JSON 附件已在第三轮最终证据核实后清理，当前证据见[第三轮](round-3.md)。第一轮的源码/测试证据保留，本轮不重复全套 runtime/routing/containment。

## 停机阻断及边界

正常 IPC 已停止 HTTP 和厂商监听，但旧进程在普通 close 中执行任务全量离线 seal；执行栈为 archive filesUnder，单任务 84,086 个文件、10,452 个目录。业务执行表为 0，旧来源和回执不变。用户明确批准后仅受控结束当时的旧工作进程；安装锁未手删，之后由正常 Host 获取新所有权，数据完整性及原记录已复核。本次不能宣称旧实例正常退出。

临时另做的停机提速修复保存在本地独立提交 `3da377e` / `worktree-runtime-shutdown-sealing`，未推送、未合并、未部署。按用户要求先恢复服务，不再把该修复或额外验证放在启动前。该分支归档回归 8 PASS / 4 FAIL，四项在原主线源码及原测试中同样失败（工作区初始化夹具不满足当前合同，附件项因任务目录未形成而失败）；排空守卫 3 PASS、pnpm check PASS。没有降低守卫或将失败算通过。

## 结论

已部署渠道修复，两个真实渠道恢复完成，服务保持运行。普通停机全量封存的耗时问题尚未部署修复。
