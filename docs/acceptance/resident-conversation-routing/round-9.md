# 第九轮：既有交付真实回读、受控冷启动与自身回声反例

## 阶段结论

- 原 R7 文字和冻结附件的真实只读回读通过：原 profile/唯一群，`enabled:true / writesAuthorized:false`，2 次发送状态、2 次精确 mget、1 次资源下载。正文用现有 `sameDeliveredText` 核对，48B 文件与原 descriptor/receipt 的 SHA256 相同。没有启动 Host、监听、模型调用或发送。
- 随后沿原监督入口实际启动同一安装，SDK listener ready、完整 backfill 和 HTTP 健康通过；这次启动允许原指定群监听/交付，不能称为只读启动。
- 冷启动实际接到一条停机期间的晚到真人来源，执行一次过期通知判断并发出一条文字答复；随后本次答复的自身回声进入了来源/分诊，出现 `TRIAGE_BATCH_INCOMPLETE`、`ROUTER_TRIAGE_CONFLICT` 两次工具失败，另一次分诊最终 ignore。自身回声去重用例 FAIL，不能把监督命令自然 exit0 当成全链通过。
- 晚到来源在本轮首次入账，只有 version1；不是已消费来源再次 admission，也不是同一消息产生新 version。调度工具实际返回 `expired`，没有创建未来排期。原 3 个任务及原 3 条通知整 body 保持，旧 unknown/已消费 proof 没有操作。
- 已通过原监督器 `--check --stop` 后正式请求 IPC 关闭，监督器/launcher 自然退出；独立 OS 检查三个精确 PID 和 19298 监听均不存在。实例保持关闭。尚未收到约定的新文件/原生引用/@请求，没有新执行任务、文件交付或本轮事项复盘，不声明“完成 DWS 现场验收”。

## 受验版本与边界

- HEAD：`67d2d5011f54b1f63704b84c81b24c1216d0e3fa`；分支 `worktree-resident-conversation-routing`。执行时已有 Lead 的 goal.md 未提交增量，Tests 临时驱动另行创建且已清理；产品及原监督入口未修改。
- 外层逐项校验 [round-8.md](round-8.md) 的 43 项实际文件 SHA，启动前等于 R8，结束后与启动前相同；沿用原监督器自己的 15 项守卫，不修改入口/manifest 扩展守卫。
- 原配置 SHA：`cb7aca3948dc952948459a806bd82a2cd04c521db942672b9a69cc525cdc602b`，全程未变。原两份私有技能字节未变，未复制正文/脚本/凭据到仓库。
- 真实连接阶段仅原安装、原 profile、原指定群。未登录、换账号、修改权限或配置；真实模型密钥仅由原监督器按已有授权在进程内读取并注入，未输出/落盘。监督器结束核 `keyInPrivateLog:false`。
- 未重跑 R8 测试或 guard。未执行最新全量 `pnpm test`、runtime/routing/containment，不宣称全组通过。Git/PR/CI/部署/合并不在 Tests 本轮写入范围。

## 真实既有交付回读

执行任务 `b5jokmzks`，自然 code0/signal null；先经本次驱动 `--check`，effects0/network=false。此前 `bphyt2nig` 长 Bash heredoc 在 shell 解析阶段 EOF/code2，Node 未执行、无 DWS/模型/Host/下载，不改判为产品失败或成功。

| 检查 | 实际结果 |
| --- | --- |
| 2 条原发送状态 | SUCCESS，精确绑定原 openTaskId、messageId、群；非仅退出码 |
| 2 次 mget | complete=true、hasMore=false、failedCount=0、foundCount=1、failures/notFound 空；message/conversation/sender 均精确核对 |
| 原文字 | 现有协议比较通过；平台正文 SHA256 `9759ca49f364cb50a58ccdb62e934ce1128b859671c90a63e3d54b0325f0c602` |
| 原文件 | 唯一 fileId、文件消息类型、原资源引用、下载 receipt/消息/路径/大小与实际字节核对；48B，SHA256 `1c2ec48694affb8c6414695062b6b46c9f3c5d031211a18770e6f5f526c97d69` |
| 原生 @ / quote | 两条旧交付 expected@=0、无 quote，平台未提供原生 mention 元数据；不判新 @/quote 用例 PASS |
| 安装保护 | 64 个保护文件起止一致：config、SQLite、监督 metadata、18 journals、43 源码；无非空 WAL/SHM |
| 临时下载 | 原安装 workspaces 下本次新建空目录；下载后先 --check 核唯一普通文件/48B/hash，再精确删除并独立确认不存在 |

上述阶段真实 DWS 读 5 次、send0、Host0、listen0、model0；不能把这个零发送结论推广到随后真实监听阶段。

## 同安装实际冷启动与业务终态

执行任务 `bxfu4kavz`；外层只读基线及原监督器均先 --check。原监督器读取真实模型连接，受控启动，不重建安装/任务、不直接注入消息。

| 阶段 | 实际证据 |
| --- | --- |
| 启动 | 北京时间 2026-11-07 14:33；supervisor90932、launcher63144、service32668 |
| SDK ready | readyAt `2026-11-07T06:33:24.217Z`，即北京时间14:33:24 |
| 首次完整补读 | ok、completionScope=durable-receipt，succeededAt06:33:25.139Z；独立就绪任务另观察06:33:31.098Z补读成功 |
| HTTP/业务账 | `/health` status=ok/recoveryIssueCount=0；逐一读取原3个 task detail，同 status/drained/run1/session/completion/通知 |
| 原任务 | 旧 cancelled/control cancelled/drained/run1；R7与私有技能任务仍 completed/drained/run1；没有重跑 execution |
| 本轮模型/工具 | 真实模型确有调用；严格历史 assistant 消息65→77、toolResult47→56，不能把12条 assistant 计成12个 HTTP请求；observer工具9、其中失败2，agent/error0 |
| 历史效果意图 | effect-intent 仍2，历史计数未变；不将其解释成旧 unknown 已结清 |
| 新数据 | source新增2、task新增0、notification新增1且 delivered/sendAttempt1；Router从g6完成当前来源并交接至g7 |
| 历史保护 | 原18份物理前缀全保；现22份全部 strict/requireComplete 解码，无未提交尾。原3task、原3notification整body不变；config/私有技能/43源码不变 |
| SQLite | 启动前 `99871513b33105d79de4fe4444029ad88c710c9ec6f4e4aa6b492d3aac98e515`；正式关闭后 `87dd3410354b6ebf3e74060312dd2561e667175177b5a3c054a54e0a484312de`。新增合法来源/答复使账本改变，不强求文件全字节不变 |

外层历史摘要算法为排序的 `{id,sha256}` JSON：18份启动前 `dcbb8beef880122aca532661bda4ddea5dc8ab8d845ce9080b6c5ef598df4cfe`，22份结束后 `10c4bafc4ca058b600210c64bc637d14db913ceff5b5dd5547919311a302dd90`。它不同于离线预检的另一聚合算法，不互换比较。

## 晚到来源与自身回声的区分

仅记录摘要/hash，不复制平台正文或原生 ID。

1. 真人通知来源 sourceHash `c8cdf807e2d3d2c6c9e763d37544a57bb0ac82f050013e264f634ca152515a8d`，messageHash `97e97641203e283fca7a3c3cb70dc7baac3bbded9e19f5205150a86dadf8813a`。平台 timestamp02:45:44Z（北京时间10:45:44），本轮 receivedAt06:33:25.064Z（14:33:25）才入账，ownerActor映射匹配、version1，同消息版本集合仅[1]；本轮前后 source 差集和 inbox 首次创建06:33:31.598Z共同区分此前已消费来源。
2. Router实际读取该来源、查询配置后提交过期平台事项。正式 toolResult 为 `{"status":"expired","at":"2026-11-07T02:50:00.000Z"}`（原约定北京时间10:50）。工具不是创建成功，不存在需要本轮取消的未来排期；没有修改 scheduler 或补写 producer。
3. Router随后发送一次文字答复。notificationHash `c974bb478996fad98d44894f5d9bbe11835330b131002f6d0087d0f21c6705b7`，sendStarted06:33:54.406Z、acked06:33:54.963Z，最终delivered06:33:56.411Z。
4. 本次答复自身回声 sourceHash `140bad0ad2c86aa35d618fb26944541626cd82230ddcb426cfd7b167b8c115b4`，messageHash `8a34eb1c8ef7a7952b6a6f06d0f976e003512f33b13d5d1e0aec5316d2eb96a4`，平台timestamp06:33:55.097Z、receivedAt06:33:55.860Z；其 messageId 精确等于本轮notification receipt，内部payload会话等于source.groupId，receipt厂商会话经原持久context映射精确匹配，version1；原生ID与内部ID不直接混比。receipt observedAt为06:33:56.403Z，入站发生在其落账之前。
5. 06:34:02Z的 `channel_triage_submit` 因 `TRIAGE_BATCH_INCOMPLETE` 失败；06:34:09Z提交包含已处理真人来源和回声的 dispositions，因 `ROUTER_TRIAGE_CONFLICT` 失败；另一次分诊于06:34:19Z只对回声提交 needsHandling=false/reply缺省并成功。没有新task，但确实新增了回声来源和模型轮，不能把最终ignore视为入口去重成功。
6. 当前 `isOwnNotification` 依赖精确 outbox messageId 或 notification ack/receipt messageId，插件在入站前调用该判据。本次ack仅有sendReceipt.openTaskId和result.result.openTaskId，没有可供该判据使用的messageId/conversationId；status首次获得messageRef及mget起止未观测。实证缺口位于原发送ack/精确回读落账与真实入站之间，已交Lead/Platform继续定位和最小修复；本报告不凭时序猜定最终补丁，也不以同账号、正文或通用DWS标记粗筛。

## 正常关闭、清理与未完成项

- 出现未确认工具/排期效果后，执行原监督器 `--check --stop`（effects0）及 `--stop`，收到正式 stop request；原监督器发 IPC，launcher code0，supervisor closed/code0/signal null/IPC=true/sourceStable=true。外层的 `stopRequested:false` 只表示停机请求由本会话另一条正式命令提交，不表示未经过IPC。
- 独立 OS 只读核90932/63144/32668均不存在、19298无监听。Monitor `bs4nlke34`在HTTP关闭瞬间出现一次 `LIVE_STATE_READ_FAILED`，随后观察phase closed并自然结束；这不是agent/error，也未用静默空结果覆盖。
- 本轮下载目录及两份 docs/tmp 一次性驱动都已在结束后按精确路径/hash/普通文件/未tracked或staged先 --check，再精确清理，另行核不存在。未删除旧安装文件、runtime metadata、日志、live WAL/locks或他人资源。驱动SHA：回读 `eb7c8738b6c0accab078f7578dfbf9b8287162fafb16b7bcb3b167bed88b9d28`；冷恢复 `7953326b9e63c843ff1cb4be28f3f23b83a19e7eadaf212508fe04a226e38743`。
- 尚无所约定的新文件任务来源，没有本轮文件生成/读回/冻结/附件交付、该事项无工具复盘、新事项再冷恢复或原生@/quote通过证据。下一步先由原实现负责人处理自身回声窗口，再由唯一现场执行者接续原入口；真人新来源不能由Tests代发、注入或重放。
- Windows sandbox/privacy、Linux未实跑、异常close/取消专项和旧unknown缺producer证明等既有边界保留。R1–R8报告与matrix历史不改，不创建全绿 report.md，不宣称整个现场目标完成。

## 原回执定位

原始脱敏输出留宿主Tests会话 `8d59080e-5ce2-49dc-827d-2663d26a6778` 的 `tasks/<ID>.output`；不搬平台正文、配置、秘密或运行日志到仓库。

| 执行ID | 真实终态 | 输出SHA256 |
| --- | --- | --- |
| bphyt2nig | shell EOF，code2，Node/平台未执行 | `edcb16870d0dc02bd7448e20882c802c209d806a66673fb882b9d5d052975871` |
| b5jokmzks | 既有交付5次真实read通过，自然0 | `5483975d180b49a20cffa081e5032d0bb019139176a3deee107168144bc1c0da` |
| bs5j07w4o | 独立真实ready/backfill/HTTP观测，自然0 | `6bede6c9f72aac115b1f64b0aaf32df861b71b9ee1dfd52e9be1e15dfdabad20` |
| bxfu4kavz | 原任务/历史前缀/43源码保护与自然关闭通过，非无业务变化证明 | `a6900702285b3f07eabd53fad245df1ef0b09ce57736bb1c8c6340f7ed2ed388` |
| bs4nlke34 | 新工具/2错误/正式closed观测，自然结束 | `191f6a26c742c08803918784ff4f4d22c4d8e439f8cf6d13263714d5b1657657` |

必要只读回执（同一Tests transcript，tool_use_id）：

| 原回执 | 证据 |
| --- | --- |
| call_803987cf8c2c490aa375add5cfdb31e3 | 晚到来源时间语义摘要、正式expired结果 |
| call_0753b51b6aef4a33a60eaa9efb596bbc | 首次source/回声与本轮通知时序；本报告只保必要hash，不复制原值 |
| call_806c27f59656482bb778277ff8b3924e | 两个失败attempt及最终ignore dispositions |
| call_939650aee965437ea51008d7caa90750 | ack安全字段类型、时序、status/mget精确时间未知 |
| call_f1ab44218309437ca103c6b78084e3b4 | 精确message与typed会话映射三项true |
| call_7f672c35520342a48a0f50bcc68e9518 | 独立OS准确进程与端口均不存在 |
| call_e507ce9cdf184cf5a51363ecac72219a | 下载先自检再清理及独立不存在确认 |
| call_30ae800a85e24b2090ca4e89df126a64 | cold临时驱动清理及输出hash冻结 |

总目标与后续授权仍以唯一 [goal.md](goal.md) 为准。
