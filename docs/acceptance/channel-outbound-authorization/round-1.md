# 第一轮：外发配置、真实投递与提醒阻断

## 范围与版本

- 日期：2026-11-09；现场时间使用 Asia/Shanghai。
- 分支：feature/channel-outbound-authorization。
- HEAD：1177e5fa524660b19e9c62861176f4abdfad239d；验证对象包含未提交工作树，不能仅用 HEAD 代表。
- 本轮 14 个 tracked 文件的 git diff --binary HEAD SHA-256：e9a47e3968f527358572ec9399220996763f5c3a8359a930b81b07226c5038e8。该指纹不包含本目录新增的验收记录。
- 真实验收仅使用用户指定的既有测试安装与目标群，不推广到其他目标。私有目标、账号、密钥、业务正文和原始回执不进入版本库；原始业务证据仍留在安装自己的账本和 Pi journal。

## 实现与本地验证

新增/编辑 DTO、Host 白名单与详情增加可选 boolean writesAuthorized。缺省关闭；编辑未提供时保留原值；目标变更不允许同时开启并会清除授权。模型 initiator 不能配置授权，原 CAS、认证、CSRF、目标门禁和配置事务保留。保存不热改运行快照。

| 验证 | 实跑结果 |
| --- | --- |
| node --test test/pi-channel-edit.test.js | 5 PASS，含真实 Host 保存与冷启 transport 检查 |
| node --test --test-name-pattern 'Web新增钉钉' test/pi-channel-plugin.test.js | 定向 1 PASS |
| pnpm check | 三项源码/导入/生产守卫 PASS |
| pnpm --dir packages/web-console build | 类型检查和 Vite 生产构建 PASS |
| pnpm --dir packages/web-console test:browser test/channels-create.spec.ts | 14 PASS，含授权、撤销、目标变更、CAS、断线回查、认证换代、移动端与局部 axe |
| pnpm --dir packages/web-console test | 31 PASS / 1 FAIL，见基线失败说明 |
| git diff --check | PASS |

Web 全量失败为 packages/web-console/test/session-host.test.js 的学习 HTTP 用例，错误 TASK_WORKSPACE_NOT_READY，测试任务 learn-one。使用内存加载钩子仅把本轮修改的三个后端模块替换成 git show HEAD 的原代码后，同一用例仍失败，确认原基线也存在；未撤回工作树或顺手修改学习功能。

## 真实应用与平台结果

1. 真浏览器登录正式 Web，编辑原测试渠道，将外发从关闭改为开启。PATCH 200；独立 GET 证实保存值 true。响应 restartRequired=true、liveApplied=false；运行中原通知仍 prepared，证明保存不热改。
2. 通过原安装 IPC 正常排空并冷启动。原 prepared 通知由应用原队列发送：18:58:58 开始，18:58:59 得到 ACK，18:59:01 完成平台回读并进入 delivered。sendAttemptCount=1、readbackAttemptCount=1。
3. 使用同一保存 profile，经 DWS +messages-mget 精确查询持久收据中的消息 ID：complete=true、messagesComplete=true、hasMore=false、failures=[]，请求 1 条、找到 1 条；群身份、正文与原消息引用均匹配。未通过另行发送制造验收结果。
4. 第二次正常 IPC 停止后，独立确认自有托管进程退出、元数据与 Host 锁释放，再冷启动。原通知仍 delivered，发送次数仍为 1，平台消息 ID 与收据 SHA-256 保持不变，无重放证据。
5. 冷恢复后独立认证读取 /api/channels：外发 true，保存/运行版本相同，connectionState=listening、runningConnected=true、restartRequired=false、liveApplied=true。

## 新提醒：失败与当前阻断

用户反馈的新定时提醒在 18:59:37 发出、18:59:47 入库。其原来源保留、分诊状态 pending，尚未进入 Router，也没有为它创建定时提醒或通知。19:02 的原期限已经错过，不能声明准点提醒通过。

在线 GET /state/recovery-issues 返回该会话 TRIAGE_NO_DISPOSITION。对绑定原 source 的 Pi journal 使用运行时共用的 decodePiJournal(..., {requireComplete:true}) 检验，物理内容全部已提交，assistant stopReason=error，具体错误为：

> API key auth failed for provider cortex-gateway: No credential is available for provider cortex-gateway

本次启动环境及同名 User/Machine 环境引用均不存在 LOCAL_PREVIEW_MODEL_KEY。只核对本会话已有来源指针，未找到明确凭据来源文件；未遍历其他秘密文件、复制凭据、改写来源状态或直接注入提醒。

当前 Core/Web 可访问，实例保持运行；/health 为 degraded，recoveryIssueCount=1。HTTP 200、渠道 listening 或旧回复 delivered 均不代表新提醒处理成功。

## 结论与保留项

外发授权配置、真实原队列发送、平台回读与冷恢复去重通过；完整提醒链路未通过，受模型凭据缺失阻断。原定时间已过，恢复后须沿原来源与已有逾期合同核实业务终态，不能手工补发充当原链路通过。另保留 1 项 Web 原基线失败；未运行与本次改动无关的全量 runtime/routing/containment 检查。

浏览器临时截图与本轮浏览器输出目录已核验清理；仍在使用的启动 helper 保留于被 Git 忽略的 docs/tmp/。没有提交、push、PR、合并、部署或触发 CI。
