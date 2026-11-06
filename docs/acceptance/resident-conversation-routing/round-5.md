# 第五轮：渠道职责本地贯通与隔离实例准备

## 范围与结论

- 本轮对应唯一 [goal.md](goal.md) 的 SG8；仅准备隔离配置并执行一条脚本模型 / fake DWS 定向用例。SG9 的真实监听、群内实际交付与真实模型尚未执行。
- 定向复验 **1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，自然 exit 0**。业务子例 34754.3509 ms，Node 总耗时 37219.4365 ms。两个事项均 completed、drained，各唯一执行 session；两次 fake 发送、两次实际 fake 回读和两个 delivered 收据均核对。
- 两群各自 triage、Router、task、reflection 的实际 Pi HTTP 请求只含本群完整职责；另在 alpha 群核对 application 安装前的独立渠道接入角色。职责内 `${notAnInstruction}` 保持原文，正文、quote、platformFlags 中的伪职责与已持久旧职责均未进入 system 职责。
- 两事项复盘均为合法空 lessons，持久状态 `skipped`，不是失败；每条记录绑定同一 task/event、各自 group memory scope，且与本任务 `reviews/` 副本逐字段相等。复盘请求无 tools，user 仍仅含 taskId/eventId/facts。
- 首次运行因新测试错误断言不存在的 `task.executionState` 字段而失败；按现有账本合同改验 `task.drained === true`，保留本轮失败事实。产品代码、权限、sandbox、排空守卫均未因测试失败修改。

## 授权与运行边界

- Windows 11 / PowerShell 7，Node 24.19.0 / pnpm 11.25.0；工作目录和分支沿唯一目标，不切分支、不提交或 push。
- 受验基线 HEAD 为 `d27350972df888bf864186eabe64513c12460382`，实际执行绑定下面的未提交工作树指纹，不能用 HEAD 代替。
- Core/Platform 本轮九文件冻结交接后才运行。两次操作各自九个生产/公开配置文件加本测试共十项 SHA 起止一致；源码没有在运行中漂移。
- 模型由官方 Pi 走本机 loopback HTTP 脚本端点；DWS runner 仅为内存 fake，`listen:false`，spawn 调用直接拒绝。fake 用例的 `writesAuthorized:true` 仅用于经过正常授权守卫的模拟发送/状态查询/回读，没有运行真实 DWS CLI。
- 私有实例始终保持 enabled/listen/writesAuthorized/directChats/operatorNotifications 五开关 false；没有实例、真实 DWS 或上游模型在途，没有读取 API 秘密、复制系统账号或更改全局账号。

## 命令、操作与失败历史

唯一业务入口：

```powershell
node --test --test-name-pattern='^configured channel responsibilities isolate all model roles through the default application$' test/pi-channel-plugin.test.js
```

宿主操作输出目录为本会话原临时 tasks 目录；下面操作 ID 可定位原始回执，本报告保留自包含结果及必要文字证据，不另复制整份日志或 journal。

| 操作 ID | 结果 | 子例 / Node 总耗时 | 受验测试 SHA-256 |
| --- | --- | --- | --- |
| bf1t75804 | 0 PASS / 1 FAIL；自然 exit 1；10/10 起止稳定 | 37986.6824 / 47626.4233 ms | 79cb3b95eba1b0d981d5ceb9b258c152441a2ff136a8f51888678551578972b9 |
| bec06vy3v | 1 PASS / 0 FAIL；自然 exit 0；10/10 起止稳定 | 34754.3509 / 37219.4365 ms | 73a660becabfa2cf9e04c5d571409773866846ab96474d84b2fcb9d0f16f85d0 |

首次原错误为 `undefined !== 'drained'`，位置是新增测试的 `task.executionState` 断言。现有 dynamic task 记录和已有测试使用布尔 `drained`。修正这一测试合同后，仍检查 completed、drained、执行表为空、唯一 session、所有角色真实入模、持久复盘和 delivered 收据，没有删掉业务断言。同步增加有界终态 diagnostic，保留合成任务身份、角色请求计数与 review 目的位置，未保存完整请求正文或私有配置。

更早一次过长 heredoc 被 Bash 以 `unexpected EOF` 拒绝，未执行写入；随后分段完成同一用例。application 安装前的独立渠道轮次直接调用 `channels.receive`，遵循插件须在 night/ready 后才能调用 acceptHistoryMessage 的真实合同；该本地注入不冒充 SDK 监听。

## 实际角色与业务终态

最终回执记录共 23 次本地脚本模型请求；角色计数如下，其余为既有无工具 Router handoff 请求。

| 合成群 | 直接 channel | triage | Router | task | reflection |
| --- | --- | --- | --- | --- | --- |
| alpha | 1 | 1 | 6 | 1 | 1 |
| beta | 0 | 1 | 6 | 1 | 1 |

两群在接入前已订阅并持久保存旧职责；当前显式配置替换该旧值，不仅覆盖首次新群。每个已观测角色的 system 都检查完整本群 marker、字面模板片段以及无另一群 marker、无伪造 marker、无旧 marker。beta 的独立直接 channel 路径未重复运行，不泛称两群全部五种角色各跑一遍。

| taskId | 唯一 sessionId | 当前完成 eventId | 账本 / 复盘 |
| --- | --- | --- | --- |
| role-task-alpha | task-session-60e927d0-a45c-407a-93d8-8e83e811e469 | task-completed:complete:role-task-alpha:1 | completed / drained=true / skipped |
| role-task-beta | task-session-34745634-6cf0-4604-99ea-e85c57cf481d | task-completed:complete:role-task-beta:1 | completed / drained=true / skipped |

- alpha group memory scope ID：`4db17480146657e888b31b5541c14a2e3895d9bc3386b31bd24ea3dd1242297e`；本任务 review 为 `tasks/role-task-alpha/reviews/9923f3f1c22a9cef96d33778d973749c072b8831ad68786a210bee38d336cadd.json`。
- beta group memory scope ID：`f8b833c7e12b0c2d9097d04fff851ea3532b1c41a1b34d8f26286f1f93068157`；本任务 review 为 `tasks/role-task-beta/reviews/960882ed42276d84c245c5e550d71e9e90bd7488133252f3d1a76df840cbefee.json`。
- 两次 reflection 的 user JSON 键精确为 eventId/facts/taskId，与当前 task/event 相符，tools 为空；实际 memory review 与任务专属 review JSON 深等。`whenIdle` 只是等待手段，没有替代持久终态断言；空 lessons 不宣称产生新技能或业务事实。
- 两条通知均 delivered：`router-operation:d9afbcfbd6eb8a36bf8c19d56c2ca63b87e43ccd3e03f4920ad0c69073db81f0` → `role-visible-1`；`router-operation:f18a79ba9b52c06b1e8adb0926bfe41c5a89b4b2ad013164611e9ca732d53e48` → `role-visible-2`。send、状态查询、mget 回读及持久 receipt 的群和 messageId 对齐；分别只发本群。
- 本轮没有文件交付需求，不以这两次文本模拟发送冒充附件交付。本次也未产生真实平台回声、真实监听或同账号 SDK 入站证据。
- Host、应用及本机模型 server 沿既有 fixture teardown 关闭，隔离测试根由 fixture 清理；Node 自然退出，未强杀进程。私有准备配置为后续交接所需交付物，保留而不启动。

## 受验源码指纹

以下生产/公开配置九项在两次业务运行中均保持一致；测试最终指纹绑定复验，不追认首次失败版本已通过。

| 文件 | SHA-256 |
| --- | --- |
| config.example.json | 99acbc412d3edc9ce6f1ed59329b3b05d193d912fd2219f150c86aa1435798ab |
| src/config.js | 673c669068264a467d8715d923af95e963bfbac45c47b3de774234b8cc99df2a |
| src/channels/service.js | bdb1a84d28910fc6548d3926bfca3589c993961e8e0115cf0a643cc19613e10d |
| src/channels/plugins/dingtalk-dws.js | 75d601300aa5c13b2491242647b673cc575746a04f4b95a590082dc3e2b208ab |
| packages/dingtalk-core/task-session-service.js | 866966b8c97d69a09acfc40dbe7dc0569b2162e0378fdc6fd7e65d2a25a7a5d0 |
| src/channels/resident-router-business.js | edc2c1d72f7b3c80fd0f212dec710a96dca51ea026cbc489e20088bfb2a70c4f |
| src/tasks/single-session.js | 88d05164b772725bf3c10dee3336f53fdec9376d7eb6fb9314a540f1346737e4 |
| src/memory/reflection.js | 8876dfc80f3687dca77b5fad16088e6c1e43fc838d17cc3eddc45d5e4aabff01 |
| src/memory/reflection-inference.js | 8c945064b9fc82a22864a140f054de8e7e88d0b4fd4c29ede042f1ea92124c39 |
| test/pi-channel-plugin.test.js | 73a660becabfa2cf9e04c5d571409773866846ab96474d84b2fcb9d0f16f85d0 |

Lead 本轮单独回传的 `pnpm check` 自然 exit 0、194 retained / 53 adapted、404 production/runtime JS / 190 imports、0 external SDK / 旧编排，九项起止稳定；原前台回执以 `GUARD_SOURCE_STABLE: 9/9; diff whitespace clean` 唯一标记定位。S6 不重复跑 guard，该回传与本条业务结果分开记录。Platform 的离线 loadConfig/helper smoke 另属配置证据，不计作额外业务用例或实际平台验收。

## 私有实例准备与真实接入缺项

- 唯一准备配置：`data/workspaces/resident-router-sg8-instance/data/secrets/config.json`，安装根为该专用实例，受控 state/workspaces/secrets 均在其 data 内，Git 忽略已独立核验；具体目标群和 profile 不进入本报告、源码、矩阵或 Git。
- 创建前先零副作用 `--check`，随后独立 loadConfig/路径断言与回读通过。五项渠道开关 false；职责字段是显式未批准占位，模型为 loopback 端口 1 的未配置占位，不是已经可用的真实模型或账号配置。没有读取上游模型秘密。
- 真实启动入口沿现有 runbook：`node bin/night-bot-run.js CONFIG`；本轮未执行。19298 当时只读检查未占用，不代表端口已保留。受管关闭须用原 IPC/shutdown 路径排空，不按进程名结束其它实例。
- Windows 的 system 模式复用当前 OS 用户保护的外部 CLI 登录；应用数据隔离不代表第三方账号独立。未复制或修改系统账号，未运行账号查询，登录、profile 可用性、账号权限均未验。
- 尚缺本会话明确的真实连接/外发授权、核实后的 assistantActorId 和 owner/Web 主体、真实模型配置；不得从 profile 后缀或群 owner 推断身份。授权与版本齐备后仍须原 Lead 串行交接唯一实例执行权。
- 单成员群中同账号真实 SDK 手动入站、回声隔离，以及真实事项→群内结果/附件→持久复盘闭环均未执行。fake、注入、health 或订阅就绪不能替代这些终态。

## 矩阵与复用边界

- [matrix.csv](matrix.csv) 本轮仅追加 round_5，并新增本条业务与禁用实例准备两行；原 60 行及 round_1–round_4 的字段和顺序保持。旧组默认 NOT_RERUN；本轮没有把旧失败、取消、源码漂移或 Windows 平台 skip 改成通过。
- 第1–4轮报告、矩阵历史及第4轮最后两份安全 JSON 不变，继续支持原已交付 SG1–SG7。第4轮真实 Router/Web 是旧职责代码的历史验收，不冒充本轮实际平台证明；历史 verified-4/5 未知根因照旧。
- 未重跑全量、旧用例组、真实模型、真实 DWS 或附件场景；不声称统一版本全量全绿。未合并、部署、触发 CI、真实发送或修改权限配置。Git/原 PR 更新由 Lead 负责，SG9 保持待授权/接入条件齐备。
