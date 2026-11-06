# 常驻 Router 与事项直连

> 状态：WAITING_INPUT
> Goal ID：resident-conversation-routing
> 最近维护：2026-11-06T21:58:23+08:00
> 权威目标：goal.md

## 总目标

按 `docs/spec/resident-conversation-task-routing.md` 完成去 Topic 重构：一级分诊只作处理/短回复/静默决定；每个已认证 chat/chat-room 有持久 Router；每事项唯一执行 session；A→B 依赖经当前授权、版本与证据评估释放；空闲时无工具交接并安全换 Pi generation；来源、通知、归档、恢复和特殊入口合同不丢失。

## 完成条件

- 默认接线实跑、相应回归、独立审查问题修复、来源/导入/hash guard、中文文档、提交与 push/PR 的真实状态核验均完成；异步路径以业务终态为准。
- 验证绑定实际源码与未提交工作树，失败、停止、漂移、跳过和未验边界分别保留；真实模型与脚本模型分报。合并、部署、真实外发和触发 CI 未授权，不由 push/PR 推导授权。

## 范围与约束

- 工作目录为本 worktree `resident-conversation-plan/night-bot`，不修改主检出。实施分支 `worktree-resident-conversation-routing`；PR base 为保留的 `refactor/pi-native-retirement`，不是初始 main。
- 开始版本及本轮验收基线 HEAD 为 `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`；开始工作树 clean，本轮验证基于团队共享未提交实现，最终实现提交由下方交付记录核对。最近 fetch 时 HEAD 与远端目标线无差异，最终验证前再核目标线。
- Node 24.19.0 / pnpm 11.25.0。`pnpm install --frozen-lockfile` 已完成（bnq767sur，exit 0，354 包），锁文件未改。
- 用户另授本任务必要真实模型验证：只读 `D:/baibu-agent/.secrets/ai_api.yml` 所需连接与密钥字段；不修改、打印或写入日志/消息/代码/验收/Git。tests 为唯一真实模型执行者，此授权不包含邻接私有文件或从其它会话搬凭据。
- 最近独立 gh 核对：仓库 `zzusp/night-bot`，ADMIN，远端 workflows=0、webhooks=[]，当前准确分支无 PR；HEAD 无 `.github/workflows`。push 前仍复核 CI 入口、PR state 与目标线，不用 skip CI 配置绕过禁令。
- 本文为唯一总目标，由 Lead 单写；以下授权文件变动属于预期协作。成员不自行切分支、commit、push、merge、deploy、真实发送、CI 或修改权限配置。

## 分工与写入权限

| 工作项 | 负责人 / 准确通信地址 | 唯一可写范围 | 依赖与完成判据 |
| --- | --- | --- | --- |
| 总体整合、归档/升级与交付 | night-router-lead [969341] | 本文；`src/tasks/ledger-archive.js`、`src/tasks/archive.js`、`packages/dingtalk-core/task-archive.js` 及相关归档校验；离线升级脚本；来源 manifest/兼容记录及必要 guard；Git | 不越成员边界，证据与源码一致后交付 |
| 核心入口与 Router 业务 | night-router-core [12adcc] | task-session-service、coordination-sessions、resident/group/Topic/fixed-topics/http/config/prompt 相关业务；`src/channels/service.js`、`triage.js`、`resident-router-business.js`、platform-schedule/platform-notification；不含平台专属文件 | 默认入口分诊→Router→唯一执行会话，退休活动 Topic 路径 |
| 持久账本与 Pi 生命周期 | night-router-platform [873e10] | dynamic-task-store 及直接 schema/helper；`src/channels/router-*.js`；Pi factory/session-persistence/business-admission 及必要 Pi 边界 | 来源/依赖/事件/轮换 API；调度/claim 双守卫，native handoff/CAS/恢复成立 |
| 测试与回归 | night-router-tests [63ee0b] | `test/**`、`scripts/test-pi.mjs`、本目录 matrix.csv/round-N.md 及最终证据 | 不改产品/不放宽断言，轮末集中记录真实终态 |
| 独立审查 | night-router-review [6f4329] | 默认全仓只读，仅本目录 review.md 可写 | 独立找反例，核证修复；不以自报代替证据 |
| 活文档 | night-router-docs [81f69c] | README、AGENTS.md、现有运行/迁移/验证/归档/运维文档；不改本文、方案、matrix/round/review/manifest | 按核实实现更新，不虚写通过 |

成员直接沟通依赖，不逐条经 Lead 转发；接口、范围、责任变化同步 Lead。同文件单写，写入权变化先交接；不新开副本或恢复仍活成员。

## sub goal matrix

SG1–SG7 对应原 S1–S7，工作范围和负责人不变。

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 基线、分工、安装与 API 对齐 | 目录/分支/授权和依赖确认 | 完成 | 本文及安装终态 |
| SG2 | 直接来源、依赖及完成评估账本 | 当前来源/权限/CAS、调度/claim 双守卫、重安排/归档实跑 | 本地完成；ledger22/升级3分批通过，当前guard与独立审查收口 | round-1.md、round-2.md、review.md |
| SG3 | 分诊与常驻 Router 默认接线 | 四处置/隔离/≤15/溢出、A返工后释放B实际终态 | 本地完成，默认链路与受影响专项分批通过；不宣称新全量全绿 | round-1.md、round-2.md、matrix.csv |
| SG4 | 空闲交接、换代与故障恢复 | native commit/CAS/冷恢复及非法摘要保留原代 | flow6/独立冷恢复2/非法摘要3通过 | round-1.md、round-2.md、review.md |
| SG5 | 去 Topic、特殊入口、归档及升级 | 保留当前平台/文件/媒体合同，单任务归档和离线升级不重放 | 原链路、固定start冷续与默认旧v1归档迁接分批通过，生产守卫未放宽 | round-2.md、review.md |
| SG6 | 回归、独立审查与修复 | 必要组及最后增量真实终态、当前源码guard、综合审查 | runtime受影响12例与default受影响10例修后全过；末段guard及独立审查完成；本地收口，真实模型缺凭据 | 当前检查点、matrix.csv、review.md |
| SG7 | 提交、push/PR 与最终核验 | 合理提交、无CI触发、正确base/head、gh独立回查 | 完成：实现d38b6a7已push；PR #2 OPEN / MERGEABLE，正确base/head已独立回查 | 本轮git/gh输出 |

## 当前检查点

- 当前子目标：SG6
- 当前阶段：真实模型待输入；本地实现、必要验证、独立审查及SG7 Git交付已收口。
- 唯一下一步：用户在tests执行环境配置已授权配置所引用的凭据，或明确授权准确密钥来源后，由原tests唯一执行者恢复真实模型预检/必要验收。没有凭据时不重复读取秘密、搜索旁路或请求端点，不再空轮询。无需重开实施/审查或重复已通过专项。
- 未闭环项：真实模型验收仍BLOCKED_MISSING_CREDENTIAL；当前完整runtime/default未重新全量跑、Linux/POSIX条件路径及live DWS未验，均保留为边界，不伪称已通过。所有已知本地失败已有修后定向终态；实现、必要本地验证、独立审查及PR交付完成，未合并/部署/真实发送/触发CI。

### Git交付与恢复

- 仓库 `zzusp/night-bot`；实现提交 `d38b6a795d4b3e8639ca8c5712de31f67b432a94`，75文件、3693新增/2698删除。Lead独立从该commit读取round-3的17项受验文件blob，SHA逐项精确一致；之后仅本文回填交付事实，不改业务源码或重跑验证。
- [PR #2](https://github.com/zzusp/night-bot/pull/2)：`refactor: 以常驻 Router 直连事项并保留依赖与恢复边界`；base `refactor/pi-native-retirement` ← head `worktree-resident-conversation-routing`。本轮真实gh回查为`number=2 / state=OPEN / mergeable=MERGEABLE`，正文已自包含代码、证据和未验边界；远端分支与实现提交一致。最终仅交付文档提交的head以PR及交付回报为准，不循环写入文档自身SHA。
- push/PR前已查准确分支PR状态、workflow=0/hooks=0、无本地非sample hook；创建后`gh run list --branch worktree-resident-conversation-routing`返回`[]`。未CI/合并/部署/真实外发。
- 本地/Git可独立工作已完成，仅余外部凭据输入；本任务30分钟cron `d9df3c5c`已撤销并独立CronList确认无任务，避免无进展轮询。未关闭成员会话或修改其它项目。恢复时先读本文和最新round-3/review；没有业务源码变化就复用已有证据。


### 当前源码及在途操作

- 最后实际源码：store `d1c165197602825c0b6f800160c4327dbc163b6c89da9745c7cc6b3dfd2526db`，service `da4f819d`、business `82e3fa26`、group-notification `1f7cc8fa`、platform-notification `9c662dfb`；生产/测试身份以 [round-3.md](round-3.md#最后定向的起止-sha-256) 为准，不能用验收基线HEAD替代受验工作树。Lead独立确认报告17项SHA全匹配当前工作树，54行matrix前45行重建round1/2精确得原`d319d8c3`。
- S6阶段交付已核：round-3 `9749773eaeac484cd5e122b24f8761538798d2713887b68e23e0c15c0c400526`；matrix `b7feb242fd26ef8c8c2829e3727d43abfed1d1869b7fdef78a5ecb170ba70f6f`。`b0ygn56vz`受影响runtime12/12、465.94s、聚合`3e952ffb…`起止同；`beilfcapo`受影响default10/10、50.68s、15项起止/当前SHA相同，均自然exit0。当前无测试在途，源码/测试冻结并已提交。
- Lead已读最后`bcxuy7xnh`原输出：post-default `pnpm check`自然exit0，194 retained/53 adapted、404生产与runtime JS/190 imports、0 external SDK/旧编排定义。manifest已保留上游原始hash并登记d1适配，guard未放宽。
- 原完整串行`bui9nxa82`：routing59PASS且cf6稳定；runtime139PASS/9FAIL/2CANCEL/12SKIP、cf6→d1漂移；default1172PASS/4FAIL/2CANCEL/26SKIP，原wrapper exit1。准确worker86068强停/端口消失/父runner自行退出及`bku4phlr9`保留原错自然exit1均见round-3，不改写为原全量通过。旧模型不处理Router settle是关闭最深cause；补合法模型合同与完整cleanup，生产drain/授权/归档守卫未放宽。
- review最后增量及综合审查已完成，Lead独立读review.md:206–228并核SHA `a06a7bdf35d5500c209e4ef54826faa4929244444b98e24a9bb8e008542e8e8d`。未确认残留阻断问题，可继续Git交付；真实模型/平台跳过/新全量未重跑等盲点完整保留，不新增重复门槛。
- 首次暂存纳入新文件后发现三文件混合行尾；原负责人仅规范review.md、pi-resident-router-flow.test.js、pi-resident-router.test.js的CRLF→LF。Lead逐字节确认新内容等于原index仅替换CRLF，正文/代码/断言未变；round-3的17项受验指纹未受影响，不新增业务运行。
- Git前置已fetch核对：验收基线HEAD...origin/refactor/pi-native-retirement为0/0，准确当前worktree分支无PR且无双重前缀；远端workflow=0/hooks=0、仓库无.github文件、本地无非sample hook。75候选无越界/运行数据/大binary，有限常见密钥格式扫描未命中；diff --check、PR正文结构及goal结构检查通过。实现已commit/push并开PR，真实状态见上方Git交付与恢复。
- 真实模型仍为BLOCKED_MISSING_CREDENTIAL：已授权配置只有apiKeyEnv引用，tests执行环境缺对应值；未请求端点、输出标量/密钥、改秘密文件或取旁路凭据。恢复需用户配置该执行环境对应凭据，或真人另授准确来源；已告知用户，不阻断独立本地交付。
- 原30分钟续跑已停止，当前无测试/审查在途；仅等待上述凭据输入。没有新增成员/测试/workflow，未CI/真实发送/合并/部署。

### 已归档阶段证据与复用边界

- 最新第3轮见 [round-3.md](round-3.md)，此前 [round-1.md](round-1.md) / [round-2.md](round-2.md) 保留；唯一总表为 [matrix.csv](matrix.csv)。历史失败、停止、skip和源码漂移不改写，报告自包含最终证据，无待清理旧binary附件；未建立全绿report.md。
- 第二轮已独立读回 report `fd31c983` / matrix `d319d8c3`，保留 round_1/round_2 共45行。C1 新版来源发送门闩定向3/3通过；R12 schema/真实多受众/父子冻结受众、媒体换版撤旧分诊、父子扫描根因均已修。最后5条原链路5 PASS/0 FAIL/0 SKIP、123.14s，但 store2658→cf6且group未登记起点，仅为分批证据；不再标为待修，也不冒充统一版本验收。
- domain391/391及受影响通知/文件11/11补验已通过，计数重叠不相加；containment5 PASS/17 Linux条件SKIP，非22/22、不声明Linux内核隔离通过。未受影响部分不重跑。旧默认/runtime停止组和64 PASS/3 FAIL/6 CANCEL/11 SKIP诊断组均不是整组通过，详细边界见 round-2。
- R1–R12、独立冷恢复、arrange版本/权限/环/排空/回滚及最终增量见 review.md。A1→continue→原session A2→satisfied→B completed/drained、三类非法摘要保留原代、人工事实/来源权限6例、Windows原超时7例、旧冻结fixed reply两格式均有分批证据；不重复旧专项。
- Lead 的B清依赖后单任务导出/全新库恢复实跑：旧dep/eval审计各1，无A正文/结果或Router会话，恢复paused/reviewRequired、无Router/triage重放。升级外部channels junction父链拒绝、正常缺省context允许已实跑并被正式升级3例承接。Web原requestId失败保留，修后 `bh9tugpzy` 1 PASS/34s/四源起止相同，重放不增lease/模型/request，req只到2且不同内容拒绝；此为分批证据，不冒充旧原生组全绿。

文档与成员通信只在阶段成果、真实阻断及交接时集中更新；不因普通通知刷新，不把文档或成员 idle 当工程完成。
