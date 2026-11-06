# 常驻 Router 与事项直连

> 状态：ACTIVE
> Goal ID：resident-conversation-routing
> 最近维护：2026-11-07T04:23:18+08:00
> 权威目标：goal.md

## 总目标

按 `docs/spec/resident-conversation-task-routing.md` 完成去 Topic 重构：一级分诊只作处理/短回复/静默决定；每个已认证 chat/chat-room 有持久 Router；每事项唯一执行 session；A→B 依赖经当前授权、版本与证据评估释放；空闲时无工具交接并安全换 Pi generation；来源、通知、归档、恢复和特殊入口合同不丢失。

## 本次追加：钉钉产品闭环

- 2026-11-07由主控转达新产品目标：接入指定测试群，承接真实监听消息，经分诊/Router/事项执行完成群内结果与附件交付，并形成有依据的无工具任务复盘；支持可传入的渠道prompt（职责、设定、规范），贯穿相关模型角色且不改变会话隔离或权限。
- 复用原六成员、工作目录和PR #2，不新建会话/定时器；不跑全量、不以修复所有旧case替代产品交付。仅处理本链路必要问题，相关旧case按当前合同修改，不扩展测试工程。
- 指定群与账号信息已通过主控交接到Lead/tests，具体标识只进私有运行配置，不入Git。本会话真人已明确选择“授权指定群真实验收”，允许原Tests仅用指定现有profile核实身份与权限、监听及有限请求/结果/附件发送、回读、复盘和冷恢复；不含其它群/私聊、全局账号变更、生产部署、合并或CI。主控已直接串行交接原Tests唯一执行权，无需再次授权或等待临时pipe；ENOINBOX只是通信失效，没有实际DWS/API/实例动作的宿主拒绝。
- 本轮主控night-bot-94明确转达真人新增授权“停用旧事项，独立完成交付”：保留旧失败与unknown，经正式入口停用旧事项，在同一原安装/指定群创建独立事项完成原文件交付；先核重启不重放，不直接改DB、不伪造producer证明、不将旧事项改成功。沿原Lead/Core/Tests分工，原Tests唯一现场执行；本授权不扩展其它群、生产部署、合并或CI。已知启动可先claim/写技术blocked，不承诺零SQL变化；旧unknown仍在新actor/模型/工具前拒绝。
- 允许本机专用隔离实例及上述指定群真实验收；不替换其它安装、不改全局账号、不合并/部署生产，不向其它群或私聊发送。模型秘密边界和原Tests唯一执行权不变；不得另建实例、自发自收或注入冒充真人消息。

## 完成条件

- 原SG1–SG7交付保持历史事实；追加闭环完成条件为：配置prompt实际贯通分诊/Router/执行/复盘，指定群真实监听而非注入、实际事项完成、群内可回读交付及持久复盘均有证据，必要定向检查与中文接入文档/原PR更新完成。授权或账号限制须明确报告，不以准备/监听就绪或fake通过冒充真实终态。
- 验证绑定实际源码与未提交工作树，失败、停止、漂移、跳过和未验边界分别保留；真实模型与脚本模型分报。真实外发仅限上述指定群范围；合并、生产部署和触发CI仍未授权，不由push/PR推导授权。

## 范围与约束

- 工作目录为本 worktree `resident-conversation-plan/night-bot`，不修改主检出。实施分支 `worktree-resident-conversation-routing`；PR base 为保留的 `refactor/pi-native-retirement`，不是初始 main。
- 任务起始版本为 `eca0df5ed127d8b043ba087291bfb1426d0ca5d6`，起始工作树 clean；本轮真实增量基于 HEAD `82a5ae59951034f65054da8fa4e71452809a6225` 加明确 SHA 的共享工作树。最终交付前已 fetch，目标线无 incoming（HEAD...base 为 3/0）；受验代码版本与最终文档提交分别记录。
- Node 24.19.0 / pnpm 11.25.0。`pnpm install --frozen-lockfile` 已完成（bnq767sur，exit 0，354 包），锁文件未改。
- 用户另授本任务必要真实模型验证：只读 `D:/baibu-agent/.secrets/ai_api.yml` 所需连接与密钥字段；不修改、打印或写入日志/消息/代码/验收/Git。tests 为唯一真实模型执行者，此授权不包含邻接私有文件或从其它会话搬凭据。
- 首次Git前置核对：仓库 `zzusp/night-bot`，ADMIN，远端 workflows=0、webhooks=[]，当时准确分支无PR，随后已交付PR #2（见下方Git事实）；验收HEAD无 `.github/workflows`。push 前仍复核 CI 入口、PR state 与目标线，不用 skip CI 配置绕过禁令。
- 本文为唯一总目标，由Lead单写；以下授权文件变动属于预期协作。成员不自行切分支、commit、push、merge、deploy、CI或修改权限配置；仅原Tests执行已明确授权的指定群真实发送。

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
| SG7 | 提交、push/PR 与最终核验 | 合理提交、无CI触发、正确base/head、gh独立回查 | 原范围完成；实现9f93e0d和文档head d273509已交付PR #2 | Git事实 |
| SG8 | 指定渠道职责配置与完整产品链 | 明确配置入口、职责贯通全部相关角色、群隔离与可操作接入文档 | 本地阶段完成；原受验九文件、定向1PASS、guard、活文档和独立Review均已核；不等于真实闭环完成 | round-5.md、matrix.csv、review.md的SG8节、原spec补充 |
| SG9 | 指定群真实终态与原PR更新 | 真实监听→事项→群内交付→复盘，读回证据并更新原PR | 等待新真人SDK事项输入：旧事项已正式取消且冷恢复不重放；精确回声修复、本地回归与真实补读就绪；旧unknown保留，新独立交付未完成 | 本文检查点、round-6.md冻结历史；round-7.md、matrix.csv及review.md:369的R7窄审已独立接回 |

## 本次单写增量

原分工不变，以下为本次明确补充/交接：Core独占task-session-service、resident-router-business、single-session及memory/reflection*的业务职责传播；SG9因首次native find真实阻断，Lead已明确交Core本轮独占src/native-tool-fs-search.js及src/tasks/effect-scope.js必要修复，并交package.json/pnpm-lock.yaml仅将现已锁定的minimatch@11.0.3列为直接生产依赖，避免Node原生glob的dot:false回退现有隐藏文件匹配；不绕进程privacy、不升级其它依赖，未分配其它写者；Platform独占config.example.json、src/config.js、channels/service、channels/plugins及直接配置绑定边界（channels/service由原Core职责显式交给Platform，本轮Core不写）；Tests独占test与本目录验收脚本/后续轮次、私有实例及真实执行权；Docs独占活文档/接入runbook；Review仍仅写review.md。Lead独占goal、原spec决策补充、manifest整合与Git。各自先读真实调用链，接口直接互通；新增交叉文件先交接。 首次正式重启发现默认组合piAuthority未inject，Lead另将src/application.js仅相关依赖声明修复交Core单写；不新增维护模式、不改unknown/drain策略，其余文件仍沿原分工。

## 当前检查点

- 当前子目标：SG9
- SG8收口：Lead已读原bf1t75804失败及bec06vy3v复验输出、第五轮报告和最终SG8 Review；复验1PASS/0FAIL、自然exit0、10项起止同，修正的是不存在的executionState测试断言，首轮失败保留。两群实际角色职责、唯一执行session、completed/drained、文本模拟收据和同task/event持久合法skipped均已核；活文档及pnpm check证据复用，不重跑。完整指纹与边界集中见round-5/review；SG8 review末尾待授权/未启动是其写入时快照，不覆盖本节后续事实。
- R6本地收口（冻结历史）：完整指定群产品交付仍由Lead负责，不能以本地修复、SG9 BLOCKED或提交PR作为完成。Tests已集中交round-6（217eaa81）/matrix（c14cd39f），Review已追加并冻结:324–366（d8bc189d）；Lead已全文读报告/审查及五次原输出，核两轮17项文件指纹、旧62行/五轮矩阵逐字可重建及旧review前缀未变。最小五文件修复完成；最终真实actor marker/native find独立case PASS8490.043ms，SingleTask btgj3dwfz自然0/1PASS，业务16649.6467ms，严格completed/drained、仅write一对效果收据、实际文件读回。首版marker FAIL、固定轮询超时和旧30000ms CANCEL完整保留，不拼成同版整批全绿。
- R6 guard（历史版本）：Lead的bu0ci3mxz自然exit0，十三项生产/配置/依赖指纹起止同、whitespace0；194 retained/53 adapted、404生产/runtime、191 bare imports、0 externalSDK/旧编排，source verified5/旧格式removed9，绑定最终native-search729f6336。先前bcxh7bfdl只覆盖111696首版，不能替代；不重跑已通过业务/旧组。完整版本及guard记录见round-6，来源清单无新映射或放宽。
- 现场执行前权威基线：Lead已独立读Tests两份immutable SQLite原工具回执call_8805741b608b41f393c5ec309c4c54aa/call_5e38bb2c23414b8687826992b297d0fb。旧sg9-live-20261107-01/session405bdad6为active/control active/drained=false、req/control/lease/run均1、无取消/reconciliation，唯一created wake claimed；原source v1 routed、triage committed，唯一Router source.message已consumed、无pending。主DB684032字节/SHA7fbf0777，空WAL核实后immutable/query_only读取前后DB及旁车指纹一致。首Node只读尝试曾创建空WAL/SHM并触发守卫失败，未声明零副作用、未删旁车或改业务账；详细事实交Tests后续轮次集中保留。原45111字节Pi journal/SHA ad7062f5仅identity/find intent，无result/owner-drained；unknown未关闭；此为正式停用前的历史基线，后续取消与冷恢复已按R7回读，新事项仍待输入，不能从进程/PID或派生task.json推断。
- 旧调用恢复边界：Core与Review对原live handles、冷recover/新进程内registry和offline维护三路已独立反证，现有合同不能补旧producer证明。不要求真人补造owner-drain、不用新marker追认旧intent、不重发原测试消息/复制任务冒充原任务成功。旧scope映射冲突已证，首次find底层cause及shutdown最深错误仍未收敛；新fixture真实join/inspect成功不能倒填原现场。
- 当前真实运行阶段：WAITING_INPUT，完整产品目标仍ACTIVE。首启bnsc8k1u2自然1/getter错误后，application仅补既有piAuthority依赖cc9f8b30；原正式cancel POST/GET及b9babylpk正常IPC自然0后，b095xqafp冷启旧task保持cancelled/controlRevision2/lease2/run1，旧45111字节journal/ad7062与assistant2/identity+intent不变，未伪造result/reconciled/owner-drain。补读自回声flags差异已按精确own receipt登记前过滤修复（plugin101c7010），service仍原bdb1七项hash/authorizeInput，不迁移或重算旧fact；未上现场的六项hash方案已静态拦截，fixture疑点已撤回，不能记成测试FAIL。Lead已独立读bj02xs18s 1PASS/自然0/10项stable（业务23685.7385ms/总37484.4968ms，test0f28cf）；最终guard b3r3usfxq自然0/14项stable/whitespace0，194/53、404、191imports、0外部SDK/旧编排。Lead已独立读b6kvdjing实际就绪回执（2026-11-06T19:56:41.722Z，即北京时间03:56）：health ok/recoveryIssue0、listener ready及旧task cancelled/controlRevision2/lease2/run1与原session一致；最终原安装bmpv0tlos真实backfill连续ok与旧journal未变已集中记入R7并经Review原回执独立核验；实例保持唯一真实监听，Monitor b8ouup508为工具/错误通知入口，到期由Tests接回。真实配置/epoch未改，live入口已将application纳入15项源守卫（入口2e340e7b）。Lead已完整接回round-7（a0f859e0）、matrix（09108d88）与R7窄审（review:369–408/ec0cda4f），独立核16项报告指纹和19项受验文件工作树/暂存字节一致、88用例/9列及原74行8列精确重建R6全文件c14cd39f、原78243字节review前缀d8bc189d和round-6未变。窄增量未发现新的确认缺陷，不把监听就绪或原unknown不重放当新业务完成；当前bmpv0tlos未退出，不填最终exit0/sourceStable证明。
- 唯一下一步：等待真人在原Night Bot Test群发送一次明确的新独立事项请求；Lead已给SG9-INDEPENDENT-20261107-02文案，要求新work/sg9-live-check.txt两行原目标内容、读回、本群中文说明与附件，不续办/重开/依赖已取消旧task。不是重新索授权，不用Tests自发自收/Web/注入伪造SDK source，也不以新成功改写旧unknown。Tests沿原唯一实例/既有Monitor接真实SDK后，核新source/task/session/workspace独立及无旧依赖，继续实际文件/冻结/文本附件回读收据/同task-event无工具复盘/精确回声/正常排空及必要冷恢复直到业务终态。等待期间Lead继续接本阶段集中报告/Review、核冻结字节并完成原PR交付；不另开实例/会话/定时器，不重复已通过用例。
- 未闭环项：一条新的真人SDK事项来源及其独立task/session、实际文件生成/读回/冻结、指定群文本/附件readback与持久receipt、同task/event复盘、精确回声及正常排空/必要冷恢复、本轮原PR更新；本阶段R7证据与Review已独立接回。总目标保持ACTIVE/SG9 WAITING_INPUT，不记PASS；round-6旧BLOCKED与unknown不被新阶段覆盖。原PR #2 OPEN/MERGEABLE、base refactor/pi-native-retirement，当前HEAD仍d273509加共享dirty/部分暂存；未提交/push/更新PR。最终交付前仍核目标线、PR state/CI入口与受验源码；CI/GitHub PR合并/生产部署仍禁止。
- Git整合检查点：发现本地d273509相对远端落后4个提交后暂停Git写入；真人明确选择“核对后安全整合”。独立fetch及gh核明PR #3已合入本任务远端分支（5f8dd1e），新增独立可选Web控制台；原PR #2仍OPEN/MERGEABLE，base不变。远端62文件仅README与本轮30文件重叠，16项R7受验文件均不在incoming集合；选择先保存本轮已验增量，再正常本地合并远端，不rebase/临时checkout受验源码，不force-push、不合并GitHub PR。Tests已确认README不在运行中15项守卫内，原实例/Monitor保持；若整合需改冻结源码先协调正常停机。当前远端比目标base为10/0，无base incoming；workflowCount=0、hooks=[]、无本地active hooks，本会话未执行远端那4个提交或PR #3合并。

### 原SG1–SG7 Git交付与恢复

- 仓库 `zzusp/night-bot`。前一实现提交 `d38b6a795d4b3e8639ca8c5712de31f67b432a94`，round-3的17项受验文件SHA与该提交blob逐一精确一致；本轮必要增量提交 `9f93e0d0bb46763560082243fd1a7dcbebd28486`，15文件、1129新增/106删除。Lead独立核暂存源码/测试/入口/报告/矩阵/最终JSON及实际工作树字节，再提交并独立核Git记录；实际运行入口与LF提交版的区别见下方及round-4。
- [PR #2](https://github.com/zzusp/night-bot/pull/2)：`refactor: 以常驻 Router 直连事项并保留依赖与恢复边界`；base `refactor/pi-native-retirement` ← head `worktree-resident-conversation-routing`。本轮更新后真实gh回查：`number=2 / state=OPEN / mergeable=MERGEABLE / headRefOid=9f93e0d0bb46763560082243fd1a7dcbebd28486`，与独立ls-remote和本地HEAD一致；body与经过write-pr检查的同一UTF-8文件逐字相同（SHA256 6d54b8c7fac4010c5579428efb75ae0609b209c6a3985288ec0e38f37892558e）。最终仅交付文档提交的head以PR及最终回报为准，不循环写文档自身SHA。
- push前已准确执行`gh pr view --json state,mergedAt`，为OPEN/null；fetch无incoming，workflowCount=0/hooks=[]、无本地非sample hook，HEAD无.github工作流。更新后`gh run list --branch worktree-resident-conversation-routing`返回`[]`。没有CI、合并、部署或真实外发。
- 已按`--check`精确删除本次已发布且哈希一致的忽略PR草稿，并独立核不存在。唯一监管cron090a304c已撤销，CronList独立回查无任务；未关闭原成员窗口、未新建副本、未改其它项目。第1–4轮报告/矩阵历史及最后两份安全JSON保留。

### 原SG1–SG7证据及复用边界

- 最新集中记录：[round-4.md](round-4.md)、[matrix.csv](matrix.csv)、[review.md](review.md)。六批真实操作的版本、失败、两次本地断言误差及必要修复均在第4轮自包含保留；不在本文复制完整历史。第1–3轮报告与矩阵历史不改写，未建全绿report.md。
- Router bcfyu5fir：业务子例221114.6355ms PASS，Node父/子2PASS、0FAIL/CANCEL/SKIP、自然exit0；7项起止同。成功评估seq27早于B首工具开始28；A/B均completed/drained、各唯一session；两文件6/69字节的当前descriptor/send/readback/持久ack/receipt完全对齐，4notice delivered，generation4/pending0；冷恢复不增journal/assistant29/工具/交付，cleanup完整。
- Web bnl1z3gp9中的独立case68878.1696ms PASS：原session真实write/read/wait→认证preserve→保留BASE追加NEXT→complete/drained；零渠道外发。冷重投不增journal/assistant7/工具/交付，cleanup完整。该次整体wrapper因Router失败exit1，不能拼成同版并发全绿；后续Web未重跑。
- 原SG1–SG7受验生产service e319fdcf、lifecycle69d3f2b1，完整指纹见round-4。真实Router实际执行入口503d94b5为CRLF；提交版仅CRLF→LF，Lead已独立核其指纹3c466e00d549a7b00d02e4e2a9475759a47c034713d09b93cdf423041985a57a，逆转换精确重建503d，不重跑API或业务。原tests/review已结束写入；最终报告98b60062、review4664f51f已独立核落盘。
- 最终guard是2026-11-06T15:05:04.684Z前台工具call_cbb9a15357e24c5da760af44f5ea5a2c；原set-e命令核69d3后pnpm check/diff --check成功，194 retained/53 adapted、404生产/runtime、190imports、0外部SDK/旧编排。manifest保留上游sourceSha256，只更新当前适配hash；后续未改生产，复用该证据。
- 最终两JSON：Router verified-6 SHA a5879141ccdcdfbad70627f56a69ce24dd16e1ef1419338dffede7d803affe7e；Web verified-3 SHA fe9802aa4e669aba740f90d213145bd4e22eb2638a4ed6896ff0e10a9211f72e。7份中间失败JSON已按精确清单--check/删除并独立核只余这两份，不保留数据库/journal/业务文件或凭据。
- 前一脚本阶段见round-3：routing59通过、runtime受影响12通过、default受影响10通过；原完整runtime139/9/2/12、default1172/4/2/26及准确worker强停/清理/漂移不抹除，不称新全量通过。round-2的domain391、ledger/升级25及containment5PASS/17Linux条件SKIP等既有证据复用、不相加或重跑。特殊入口、归档、依赖重安排/清空与held恢复边界见原review/round-2/3。

文档与成员通信只在阶段成果、真实阻断及交接时集中更新；不因普通通知刷新，不把文档或成员idle当工程完成。
