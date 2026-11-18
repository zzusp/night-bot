# 记忆与技能周期复盘

> 状态：COMPLETED
> Goal ID：memory-skill-periodic-review
> 最近维护：2026-11-18T10:14:08+08:00
> 权威目标：goal.md

## 总目标

落实用户确认的记忆与 Skill 准入规则，实现事件局部维护与可配置的每周集中复盘，能依证据清理、合并、拆分和更新。Skill 提供事项、目标、主要环节、信息来源和正反例，保留 Agent 现场判断空间，不用细步骤或补丁脚本限制执行。

## 完成条件

- 主对话、候选、任务复盘和维护复用准入规则；新 hypothesis 不持久化，无证据/范围技能不保存，正文采用自由 Markdown guidance。
- 默认 Host 接入受控周期维护，覆盖四类动作、显式启用、冷启动、取消排空、来源版本与原子提交；不改写正式安装 Skill、不重放业务、不晋升候选、不删除在用文件。
- 相关本地实跑、源码守卫通过；文档与部署说明同步，绑定实际受验工作树；完成提交、PR 及获授权合并，明确未部署及真实模型未验边界。

## 范围与约束

- 保留原检出其他任务修改，本轮只在 worktree-memory-skill-periodic-review 隔离分支提交。用户已要求继续完成 PR/合并；不部署、不手动触发 CI、不真实渠道外发，不修改真实 memory/Skills/安装配置。
- Node 24 / pnpm、官方 Pi 工具外推理与原 memory journal；未引入新依赖或平行执行底座。
- 方案快照：`../../spec/memory-skill-periodic-review.md`。详细证据集中维护在本目录各轮 round 报告；最新主线证据为 `round-2.md`，旧基线保留于 `round-1.md`，用例状态见 `matrix.csv`。

## sub goal matrix

| ID | 子目标 | 完成判据 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| SG1 | 记忆与 Skill 准入 | 共享筛选、hypothesis 不落盘、自由 guidance、原 key 更新 | PASS | round-2.md；matrix.csv MEM/SKL |
| SG2 | 周期维护 | 默认 Host、四类动作、显式启用、来源版本与恢复保护 | PASS | round-2.md；matrix.csv MNT |
| SG3 | 验证与交付 | 相关用例及 guard 通过，文档同步和实际边界明确 | PASS | round-2.md；PR #180 MERGED，主线 e893bf3 |

## 当前检查点

- 当前子目标：SG3
- 已完成：主线整合、统一准入、指引式 Skill、受控事件/周期维护、18 文件 168 项相关用例、pnpm check、证据归档及 PR #180 合并。来源、主体、creator、幂等、墓碑与并发保护保留。
- 唯一下一步：无；本目标完成。后续部署与真实历史完整复盘不属于本任务，不据默认启用或定时器宣称已完成。
- 未闭环项：本任务无。未验证的真实模型质量、跨平台/全仓全套、UAT/生产升级及真实数据整理明确留在 round-2 的边界，不宣称通过。
- 交付：功能 c0920e0；PR #180=https://github.com/zzusp/night-bot/pull/180，MERGED，主线合并提交 e893bf33e2835e41a0b280a94acf0cec3322060f。详细 ground truth 只维护于 round-2.md。

## 重大决策

- 事件局部维护与默认每 168 小时集中复盘结合；升级不构成清理授权，须可信安装操作者显式启用。
- 新 Skill 是可调整的目标与场景指引；修复应完善情况、场景和正反例。旧 steps 保留为历史参考，正式安装 Skill 不自动修改。
- 模型判断语义价值，Host 校验来源、权限、引用、版本与事务；不将证据 ID 或 evidenceBacked 当作独立事实证明。

## 后续整合基线

2026-11-18 只读核实 origin/main 已为 c1a5796af6a637d7378497482c527a52a0517af9，显著领先本轮 b9a7bd2 未提交检出。本轮完成和 round-1 证据只绑定其记录的工作树，不是主线或未来升级版本的能力结论。

主线已有 Router 的结构化记忆/长期指令维护、forget、resident_skill_query/mutate 和 memory_index；Router 来源 Skill 可独立于 experience 成立，并有实际内置 skill-creator 生成、幂等回执、墓碑单调版本和派生正文回读。此前基于旧检出作出的入口缺失/逐字写入/索引固定窗口判断不得用于主线。后续如获授权整合，必须依主线这些合同叠加本轮增量，不能原样覆盖其 store、支持判定、正文生成或权限机制。

一次性完整历史复盘是否可达，仍须依据最终整合并合并的 SHA 核对全量枚举、候选/失效状态覆盖和逐项业务终态。当前未整合、提交或执行真实整理，不据现有旧分支结论批准部署。

## 本次整合决定

- 保留主线结构化记忆、长期指令主体范围、完整 Markdown 索引、Router 独立认证来源 Skill、实际 skill-creator、版本墓碑及并发发布保护。新 Skill 的候选使用 guidance；Router 现有 steps 参数保留为主要环节候选，不作为机械执行正文。
- 周期计划推理不持有 evolution 发布锁；用记忆 revision 与完整 evolution 指纹在短提交锁下复核，防止覆盖 Router 或并发复盘。复用分层 store 的严格 journal，追加受控 evolution 文件，不恢复旧版 store。
- 周期维护 preserve 来源、结构化正文、主体范围、previous 与墓碑。正式安装 Skill 不改；撤销仅移出有效 state，不删除在用旧文件。显式启用默认168小时，不新增面向渠道的手动维护 API。
- 本次交付目标为最新主线整合、实跑、提交和 PR；用户在要求提交PR合并后指示继续，合并按仓库实际检查与明确授权范围核对，不部署。
