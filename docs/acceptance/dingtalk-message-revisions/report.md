# 钉钉编辑与撤回修复交付

已完成代码、本地相关验证、PR 合并、本地部署与原渠道接收恢复；约定的渠道矩阵全部有 PASS 证据。当前服务有一项任务级待授权告警，不声明全局无告警。唯一矩阵见 [matrix.csv](matrix.csv)，本地回归及失败修正见[第一轮](round-1.md)，实际部署和来源保留见[第二轮](round-2.md)。

- PR [#77](https://github.com/zzusp/night-bot/pull/77) MERGED；实际运行 `a691993dd1d34ddb91c7ffbef185c0cc4c286163`，包含性能 PR #76。
- 原失败渠道已 listening/receiving、无错误；原 v1 留存且正文 hash 未变，编辑 v2 已 routed；deferred/pendingRecalls 均 0，耐久水位正常推进。
- 原任务、数据、身份、记忆及凭据保留。全程不删锁、不清游标、不注入旧业务、不自动回滚外部效果，不额外发送测试消息。
- 编辑、明确撤回、两个中断窗口、原子撤权、旧分诊/回执与 Windows 原子写入已实跑。未发送真实撤回探针，不把实际订阅 recall 作为已收到真实撤回事件的证据；无全量测试或受限 OS 执行通过声明。

## 当前业务遗留

12:33（UTC+08:00）复核：两个渠道仍 receiving/无错误；health 已因一项旧任务续办的 TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED 变为 degraded/1，当前 9 任务中 6 completed、3 active。12:24 的 7 任务全部完成与 health ok 是部署阶段快照。没有替业务补授权、重放效果或改账本消警；详见第二轮最新状态段。
