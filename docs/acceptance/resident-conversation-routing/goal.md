# 常驻 Router 与事项直连

> 状态：COMPLETED
> Goal ID：resident-conversation-routing
> 最近维护：2026-11-07T00:15:28+08:00
> 权威目标：goal.md

## 总目标

按 `docs/spec/resident-conversation-task-routing.md` 完成去 Topic 重构：一级分诊只作处理/短回复/静默决定；每个已认证 chat/chat-room 有持久 Router；每事项唯一执行 session；A→B 依赖经当前授权、版本与证据评估释放；空闲时无工具交接并安全换 Pi generation；来源、通知、归档、恢复和特殊入口合同不丢失。

## 完成条件

- 默认接线实跑、相应回归、独立审查问题修复、来源/导入/hash guard、中文文档、提交与 push/PR 的真实状态核验均完成；异步路径以业务终态为准。
- 验证绑定实际源码与未提交工作树，失败、停止、漂移、跳过和未验边界分别保留；真实模型与脚本模型分报。合并、部署、真实外发和触发 CI 未授权，不由 push/PR 推导授权。

## 范围与约束

- 工作目录为本 worktree `resident-conversation-plan/night-bot`，不修改主检出。实施分支 `worktree-resident-conversation-routing`；PR base 为保留的 `refactor/pi-native-retirement`，不是初始 main。
- 任务起始版本为 `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`，起始工作树 clean；本轮真实增量基于 HEAD `82a5ae59951034f65054da8fa4e71452809a6225` 加明确 SHA 的共享工作树。最终交付前已 fetch，目标线无 incoming（HEAD...base 为 3/0）；受验代码版本与最终文档提交分别记录。
- Node 24.19.0 / pnpm 11.25.0。`pnpm install --frozen-lockfile` 已完成（bnq767sur，exit 0，354 包），锁文件未改。
- 用户另授本任务必要真实模型验证：只读 `D:/baibu-agent/.secrets/ai_api.yml` 所需连接与密钥字段；不修改、打印或写入日志/消息/代码/验收/Git。tests 为唯一真实模型执行者，此授权不包含邻接私有文件或从其它会话搬凭据。
- 首次Git前置核对：仓库 `zzusp/night-bot`，ADMIN，远端 workflows=0、webhooks=[]，当时准确分支无PR，随后已交付PR #2（见下方Git事实）；验收HEAD无 `.github/workflows`。push 前仍复核 CI 入口、PR state 与目标线，不用 skip CI 配置绕过禁令。
- 本文为唯一总目标，由 Lead 单写；以下授权文件变动属于预期协作。成员不自行切分支、commit、push、merge、deploy、真实发送、CI 或修改权限配置。

## 分工与写入权限

| 工作项 | 负责人 / 准确通信地址 | 唯一可写范围 | 依赖与完成判据 |
| --- | --- | --- | --- |
| 总体整合、归档/升级与交付 | night-router-lead [969341] | 本文；`src/tasks/ledger-archive.js`、`src/tasks/archive.js`、`packages/dingtalk-core/task-archive.js` 及相关归档校验；离线升级脚本；来源 manifest/兼容记录及必要 guard；Git | 不越成员边界，证据与源码一致后交付 |
| 核心入口与 Router 业务 | night-router-core [12adcc] | task-session-service、coordination-sessions、resident/group/Topic/fixed-topics/http/config/prompt 相关业务；`src/channels/service.js`、`triage.js`、`resident-router-business.js`、platform-schedule/platform-notification；不含平台专属文件；本次增量仅扩至`src/tasks/single-session.js`的任务input序列化 | 默认入口分诊→Router→唯一执行会话，退休活动 Topic 路径 |
| 持久账本与 Pi 生命周期 | night-router-platform [873e10] | dynamic-task-store 及直接 schema/helper；`src/channels/router-*.js`；Pi factory/session-persistence/business-admission 及必要 Pi 边界 | 来源/依赖/事件/轮换 API；调度/claim 双守卫，native handoff/CAS/恢复成立 |
| 测试与回归 | night-router-tests [63ee0b] | `test/**`、`scripts/test-pi.mjs`、本目录 `scripts/real-model-router.mjs`、matrix.csv/round-N.md 及最终证据 | 不改产品/不放宽断言，轮末集中记录真实终态 |
| 独立审查 | night-router-review [6f4329] | 默认全仓只读，仅本目录 review.md 可写 | 独立找反例，核证修复；不以自报代替证据 |
| 活文档 | night-router-docs [81f69c] | README、AGENTS.md、现有运行/迁移/验证/归档/运维文档；不改本文、方案、matrix/round/review/manifest | 按核实实现更新，不虚写通过 |

成员直接沟通依赖，不逐条经 Lead 转发；接口、范围、责任变化同步 Lead。同文件单写，写入权变化先交接；不新开副本或恢复仍活成员。

## sub goal matrix

SG1–SG7 对应原 S1–S7，工作范围和负责人不变。

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 基线、分工、安装与 API 对齐 | 目录/分支/授权和依赖确认 | 完成 | 本文及安装终态 |
| SG2 | 直接来源、依赖及完成评估账本 | 当前来源/权限/CAS、调度/claim 双守卫、重安排/归档实跑 | 完成；ledger22/升级3分批通过，当前guard与最终独立审查均已核 | round-1.md、round-2.md、review.md |
| SG3 | 分诊与常驻 Router 默认接线 | 四处置/隔离/≤15/溢出、A返工后释放B实际终态 | 完成；默认链路与受影响专项分批通过；不宣称新全量全绿 | round-1.md、round-2.md、matrix.csv |
| SG4 | 空闲交接、换代与故障恢复 | native commit/CAS/冷恢复及非法摘要保留原代 | flow6/独立冷恢复2/非法摘要3通过 | round-1.md、round-2.md、review.md |
| SG5 | 去 Topic、特殊入口、归档及升级 | 保留当前平台/文件/媒体合同，单任务归档和离线升级不重放 | 原链路、固定start冷续与默认旧v1归档迁接分批通过，生产守卫未放宽 | round-2.md、review.md |
| SG6 | 回归、独立审查与修复 | 必要组及最后增量真实终态、当前源码guard、综合审查 | 完成；本地回归、两个真实业务及当前guard证据已核，最终review无确认残留阻断 | round-4.md、matrix.csv、review.md |
| SG7 | 提交、push/PR 与最终核验 | 合理提交、无CI触发、正确base/head、gh独立回查 | 完成；实现9f93e0d已提交/push，原PR #2正文与远端头独立核回为OPEN/MERGEABLE；无CI | 当前检查点、Git事实 |

## 当前检查点

- 当前子目标：SG7
- 当前阶段：SG1–SG7约定范围均已完成。脚本模型回归与两个分别受验的真实业务已核，最终review无确认残留阻断；实现/证据9f93e0d已push，原PR #2已更新并独立核回正文、base/head与远端实现SHA一致，OPEN/MERGEABLE，CI列表为空。本文最终提交仅回填交付事实，不改受验业务字节。
- 唯一下一步：无本任务实施待办；后续CI、合并、部署、真实渠道发送或扩大验收范围均需用户另行授权。
- 未闭环项：约定范围内无剩余实施项；保留验收边界：verified-6的两次中间ROUTER_EVIDENCE_REFERENCE_INVALID后第三次成功，不宣称零工具错误；verified-4唯一通知失败原因、verified-5坏引用仍未知，不由本次PASS追认修复。新失败诊断分支未在真实坏ref上动态验收；非统一版本并发/非完整全量全绿，原runtime/default历史失败及Linux/POSIX/live DWS等未验边界保留，不作为已授权交付的新增门槛。
- 并行执行：原tests唯一读取凭据/运行真实API；最初同runner原生concurrency=2，两case独立Host/root/SQLite，链内串行。Web通过后仅补Router；未开副本、dynamic workflow或新增场景。最后操作bcfyu5fir自然exit0，资源完整清理。

### Git交付与恢复

- 仓库 `zzusp/night-bot`。前一实现提交 `d38b6a795d4b3e8639ca8c5712de31f67b432a94`，round-3的17项受验文件SHA与该提交blob逐一精确一致；本轮必要增量提交 `9f93e0d0bb46763560082243fd1a7dcbebd28486`，15文件、1129新增/106删除。Lead独立核暂存源码/测试/入口/报告/矩阵/最终JSON及实际工作树字节，再提交并独立核Git记录；实际运行入口与LF提交版的区别见下方及round-4。
- [PR #2](https://github.com/zzusp/night-bot/pull/2)：`refactor: 以常驻 Router 直连事项并保留依赖与恢复边界`；base `refactor/pi-native-retirement` ← head `worktree-resident-conversation-routing`。本轮更新后真实gh回查：`number=2 / state=OPEN / mergeable=MERGEABLE / headRefOid=9f93e0d0bb46763560082243fd1a7dcbebd28486`，与独立ls-remote和本地HEAD一致；body与经过write-pr检查的同一UTF-8文件逐字相同（SHA256 6d54b8c7fac4010c5579428efb75ae0609b209c6a3985288ec0e38f37892558e）。最终仅交付文档提交的head以PR及最终回报为准，不循环写文档自身SHA。
- push前已准确执行`gh pr view --json state,mergedAt`，为OPEN/null；fetch无incoming，workflowCount=0/hooks=[]、无本地非sample hook，HEAD无.github工作流。更新后`gh run list --branch worktree-resident-conversation-routing`返回`[]`。没有CI、合并、部署或真实外发。
- 已按`--check`精确删除本次已发布且哈希一致的忽略PR草稿，并独立核不存在。唯一监管cron090a304c已撤销，CronList独立回查无任务；未关闭原成员窗口、未新建副本、未改其它项目。第1–4轮报告/矩阵历史及最后两份安全JSON保留。

### 当前证据及复用边界

- 最新集中记录：[round-4.md](round-4.md)、[matrix.csv](matrix.csv)、[review.md](review.md)。六批真实操作的版本、失败、两次本地断言误差及必要修复均在第4轮自包含保留；不在本文复制完整历史。第1–3轮报告与矩阵历史不改写，未建全绿report.md。
- Router bcfyu5fir：业务子例221114.6355ms PASS，Node父/子2PASS、0FAIL/CANCEL/SKIP、自然exit0；7项起止同。成功评估seq27早于B首工具开始28；A/B均completed/drained、各唯一session；两文件6/69字节的当前descriptor/send/readback/持久ack/receipt完全对齐，4notice delivered，generation4/pending0；冷恢复不增journal/assistant29/工具/交付，cleanup完整。
- Web bnl1z3gp9中的独立case68878.1696ms PASS：原session真实write/read/wait→认证preserve→保留BASE追加NEXT→complete/drained；零渠道外发。冷重投不增journal/assistant7/工具/交付，cleanup完整。该次整体wrapper因Router失败exit1，不能拼成同版并发全绿；后续Web未重跑。
- 当前生产service e319fdcf、lifecycle69d3f2b1，完整指纹见round-4。真实Router实际执行入口503d94b5为CRLF；提交版仅CRLF→LF，Lead已独立核其指纹3c466e00d549a7b00d02e4e2a9475759a47c034713d09b93cdf423041985a57a，逆转换精确重建503d，不重跑API或业务。原tests/review已结束写入；最终报告98b60062、review4664f51f已独立核落盘。
- 最终guard是2026-11-06T15:05:04.684Z前台工具call_cbb9a15357e24c5da760af44f5ea5a2c；原set-e命令核69d3后pnpm check/diff --check成功，194 retained/53 adapted、404生产/runtime、190imports、0外部SDK/旧编排。manifest保留上游sourceSha256，只更新当前适配hash；后续未改生产，复用该证据。
- 最终两JSON：Router verified-6 SHA a5879141ccdcdfbad70627f56a69ce24dd16e1ef1419338dffede7d803affe7e；Web verified-3 SHA fe9802aa4e669aba740f90d213145bd4e22eb2638a4ed6896ff0e10a9211f72e。7份中间失败JSON已按精确清单--check/删除并独立核只余这两份，不保留数据库/journal/业务文件或凭据。
- 前一脚本阶段见round-3：routing59通过、runtime受影响12通过、default受影响10通过；原完整runtime139/9/2/12、default1172/4/2/26及准确worker强停/清理/漂移不抹除，不称新全量通过。round-2的domain391、ledger/升级25及containment5PASS/17Linux条件SKIP等既有证据复用、不相加或重跑。特殊入口、归档、依赖重安排/清空与held恢复边界见原review/round-2/3。

文档与成员通信只在阶段成果、真实阻断及交接时集中更新；不因普通通知刷新，不把文档或成员idle当工程完成。
