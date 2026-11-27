# Bot-shared autonomous learning

Night Bot is a personal-assistant Agent initialization kit. It learns reusable
reference material through conversation memory and Router-selected periodic checks;
learning is not permission to change the user's objective or execute new actions.
No developer identity, credential or private business policy is built into it.

## Actual automatic wiring

The default Host mounts memory and reflection. At a completed ordinary conversation
turn, memory can extract bounded literal durable-fact candidates using the current
model without tools. Candidates remain separate until explicitly accepted; an
inference cannot silently become a personal preference. The model decides when to
read relevant accepted topics via `memory_read` or literal `memory_search`; only a
short index is injected automatically. This is on-demand retrieval, not semantic
recall or proof that the model will always choose the right note.

Router 是 Bot 的语义决策核心，依据当前认证消息判断记忆或学习 Skill 的增改删并直接执行短维护。Host 不用话术正则再次判断授权，也不增加授权模型、空任务或先写 experience 的门槛。普通对话候选与无工具任务复盘保持独立；它们不获得 Router 专用写权限。记忆从上下文提炼，正文固定为 Summary、Why、How to apply，三项必填且不写推测；原因必须有来源支持，原话留在证据元数据中。个人偏好按原提出者判断适用性，项目背景按当前场景判断，不把来源作者等同于适用对象。来源、权限与失败合同见 [MEMORY](MEMORY.md#渠道长期偏好)。

默认任务服务不在任务结束时触发自动复盘，也不在开机补扫全部完成事件。SQLite 持久保存自检水位，每两个小时通知同一个 Router 检查各渠道仍在执行或最近完成的任务。Router 可把核对现状派给异步只读会话；已接纳不等于已查证。收到核查结果后，只在当前版本与原授权仍有效时纠正、继续或反馈。只有确有可复用的证据，才用自检工具选择记忆/Skill 复盘，或把可独立使用的说明写进共享知识库。复盘不改变任务状态或授予新权限。

每次复盘仅接收有稳定 ID 的完成、执行和操作证据，不传整段聊天或原始命令正文。模型最多提出三条有复用价值的经验，每条必须包含 summary、why、howToApply 和本任务有效 evidenceIds；没有合适经验时返回空列表。三段正文直接写结论、有依据的原因与具体用法，不保存假设或推测，不写任务流水。原因未说明时如实标明，不将用户陈述当作独立验证。证据 ID 留在既有 review 和来源元数据中，不重复铺入经验正文；合法 ID 不证明模型解释在语义上成立，当前事实和明确要求仍须重新核对。

复盘新增记忆和 Skill 时，机器标识 key 只用小写英文字母、数字及分隔用连字符，限 1–60 字符；更新使用读到的原 key 和版本。正文仍可用中文。无效名称与缺失或越界的证据引用分别记录，均在生成或写入之前拒绝。无工具推理使用 Pi 模型路由的传输限制和流空闲超时，不额外按总耗时 30 秒中断；Host 关闭仍取消并等待流排空。复盘收到原生 `TimeoutError` 时记录 `REFLECTION_MODEL_TIMEOUT`，不写 Node 的数字异常码。

复盘按模型输入和输出空间逐页查索引。模型用同一套短编号选择记忆、学习 Skill 和安装 Skill；长条目拆开的片段保留同一编号。Host 拒绝重复、非本页或不合法的编号，仍按原标识与版本读取正文；选错一页不算覆盖检查完成。

## 内置 creator 生成阶段

自动复盘仍是无工具调用，只提出证据和技能候选。首次发布及正文更新另经 Pi 原生 Agent 的短生成阶段：模型必须实际调用唯一的 `skill` 工具加载本发行内置 `skill-creator`，据候选、原始证据引用和旧版正文生成新的 description 与 Markdown。生成阶段不是业务执行会话，无文件写入、shell、任务或渠道工具；不启动子代理。安装的同名技能不覆盖此内置来源，内置文件只读。

Host 在共享锁外生成，发布前重核来源、权限、CAS 版本及遗忘代次。技能版本保存生成正文、creator 名称/来源/字节 SHA-256、实际工具调用 ID、模型身份、输入/输出摘要和生成时间；自动复盘报告与 Router 受管回执链接相同生成证据。返回草稿不等于发布，只有受管状态提交及派生文件读回才返回 persisted。加载缺失、模型失败、未调用 creator 或无效输出均显式失败，不回退旧步骤拼装。原业务完成不回滚，失败可在复盘报告或 generationFailures 查证。

旧技能保持原样，不补造 creator 收据、不批量再生成。冷启动/重复操作只恢复已提交当前正文，删除不调用 creator。生成过程未执行独立试用或 benchmark，不能声称质量基准已通过。

## Managed skills and evidence

A useful procedural lesson may propose adaptable Markdown guidance, a reason, an evidence-backed
assessment and bounded applicability. The model decides whether that experience
justifies creating/updating a skill; a single well-evidenced reusable lesson can
qualify. There is no fixed repetition threshold. Program checks require valid
same-task evidence references, authenticated ownership, bounded Markdown, deduplication
and traceable revisions. They do not prove the model's assessment. Repeated events
cannot inflate evidence or rewrite formal templates. Changed guidance retains its
review provenance. The task-review producer admits at most 20 active learned skills; this is its
catalog admission limit, not a repetition threshold or a Router maintenance gate. No
executable scripts are generated.

复盘用已核对的触发场景和区分这项经验的具体动作生成记忆索引及 Skill description，不再让正文生成阶段把复盘已选中的可查线索替换成空泛提示。目录只显示短提示；同类任务按直接链接读取记忆、按 description 加载 Skill，再核对适用边界和当前事实。creator 仍生成可独立使用的正文；发布时保留复盘已选定的触发条件、动作和必要边界，避免生成正文时遗漏。Router 直接维护时由 Router 提供具体触发词和动作。任务来源、Skill 版本和支持关系仍保留在 Host 元数据中。既有历史条目不自动重写；没有增加检索模型或额外审批。

Learned Markdown lives under `data/memory/v2/bot/evolution/skills/<name>/SKILL.md`.
The common `learned` provider rechecks the live bound actor but selects the same Bot
memory/skill namespace for every channel. Source conversation/task metadata remains
traceable; it grants neither external writes nor access to original private transcripts.
Bot-owned installed skills remain in configured installation roots and are shared by
the default presets; learning does not overwrite these user-maintained resources.
See MEMORY.md for copy-only v1 migration, conflict candidates, telemetry and limitations.

Only these managed learned skills are created/updated automatically. Generic
loading/isolation contracts and no-body configuration may be versioned with the
code; private source skill bodies and user-maintained `data/config/skills` are not
written into the repository or overwritten by learning. This avoids turning every
task into a new formal skill or silently rewriting a user's instructions. Learned
skill files, reports, business artifacts and private skill packages are runtime data
and are ignored; their `scripts`, `references` and `assets` stay beside the skill in
the private installation directory.

## 查看和更新已有条目

在 Web 控制台左侧打开「自进化」，选择「记忆」或「Skills」，点击条目查看获准读取的内容；有上次版本时可打开「最近差异」。这个页面只读，不提供编辑按钮。

要修改内容，可在与 Router 的对话中指明条目和要改的部分。例如「把『接口发布检查』这条记忆改名为『API 上线前检查』，正文不变」，或「把『排查服务日志』这个学习技能的适用说明改成仅适用于发布后报错」。Router 可以维护 Bot 管理的记忆和学习技能，不会改写你安装的技能。只有收到确认保存的回执，才算更新成功。

## Router 直接维护 Skill

`resident_skill_query` 读取共享 learned Skill 的版本、来源和适用性；指定 key 时返回步骤和理由。`resident_skill_mutate` 通过 upsert/delete 执行短维护，必须绑定本批完整原话、作者和消息版本，使用稳定 operationId，更新或删除前应提供读回的 expectedRevision。步骤、理由和适用性继续拒绝已知秘密；key 只能是受管名称，不接受路径，也不覆盖用户安装模板。Router 记录的当前认证消息作为独立来源，不要求制造任务/experience；任务复盘产生的 Skill 仍必须有保留的任务经验支持。

复用 evolution 共享锁、state.json、previous 快照、learned provider 和冷启重建。状态与幂等回执先原子提交，再发布并回读派生 SKILL.md；派生失败返回 `REFLECTION_WRITE_UNCONFIRMED, committed:true`，重试仍失败时不能声称保存。重试只重建当前版本的派生文件，不重放旧创建或删除操作。删除保留单调版本，重建同名 Skill 不重置为版本 1；查询已删除 key 可获得当前墓碑版本。operationId 重用不同输入或 expectedRevision 过期均明确拒绝。

更新前按适用场景和目标比对已有 Skill，语义一致时按已有 key 和版本更新，不换名称重复创建。写入在等待共享锁后重新核对来源和权限。更新或删除推进共享记忆代次，后续模型请求撤销旧加载的学习正文，Pi 审计历史不改写。Skill 方法是模型指导和来源陈述，不是已验证业务事实、执行权限或放松沙箱的依据。

## 指引式 Skill

Skill 说明何时适用、要达到什么目标、主要环节、遇到不同情况怎么分支，以及如何验证结果。说明需要的资料及可靠来源，并提供正向与反向场景示例，使下次不用翻原任务也能开始。正文用自由 Markdown，不要求固定标题、顺序、过细执行步骤、专用补丁脚本、严格夹具、固定命令序列或逐字断言。Agent 根据实际信息、权限和现场情况选择做法。遇错优先阐明情况、完善适用场景与正反例，不不断追加特判。

同一事实有稳定权威入口时，保留可用的查询指针；旧聊天、过程文件和工具输出只是证据，并非权威入口。不要把一次性执行流程、业务快照或临时流水写成 Skill；业务快照若有追溯价值或用户明确要求，应单独保存为有时间和范围的历史记录。猜测的方法、未经验证的绕过、秘密和一次授权不沉淀。新任务候选使用 guidance，正文仍必须经实际 creator 生成；Router 现有 steps 参数代表主要环节候选，不是机械执行清单。既有持久化重试和历史 Skill 不被批量改写，无证据判断或适用性缺失的新 Skill 在生成前省略。

已有受管 Skill 可通过同一个 `resident_skill_mutate` upsert 更新：`newKey` 改调用名称，`description` 改索引中的触发说明，`body` 提供希望修订的 Markdown 正文。字段可以独立传入，须指定当前 `key`、`expectedRevision` 和稳定的 `operationId`。只改名称或说明时不重新生成正文；改正文仍须实际加载内置 creator 并校验生成结果。改名时不覆盖已有目标；旧名称与加载结果失效，重启以当前已提交版本修复派生文件。安装 Skill 不受此工具写入。

## 事件与周期维护

默认 Host 提供维护服务，但自动整理默认关闭。须由可信安装操作者在私有配置中显式设置，再按运维流程正常重启：

```json
{"reflection":{"maintenance":{"enabled":true,"intervalHours":168}}}
```

首次启用只建立水位，不立即整理全部历史；正常回合完成并确认保存后触发相关主题局部检查，任务经验和候选实际持久化后也通知。默认每 168 小时集中检查，冷启动补查到期或水位变化。intervalHours 必须是正数且能表示安全毫秒；关闭时不启动定时器或维护推理。它不是用户业务 schedule，不创建任务、不发消息、不投递结果、不执行维护材料里的指令。

维护先向无工具模型提供索引、版本和计数/时间白名单，模型随后只收到选中的相关组正文及必要经验。已知凭据格式和显式过期条目本地处理，不把其正文或 usage provenance 发给模型。模型可提出 delete、merge、split、update 或 deferred；无充分证据可不改，不以长期未用为删除理由。这里只管理共享记忆、候选和受管 learned Skill，不改用户安装模板。

慢推理和实际 creator 生成不占 evolution 共享发布锁。提交时复核完整 evolution 指纹与记忆 revision；并发 Router、复盘或遗忘变化使旧计划整批拒绝。记忆、技能状态/派生文件、review 与维护水位/收据复用严格 redo journal 原子提交；中断后先恢复，不重新执行已提交计划。无业务变化的水位更新不增加记忆 revision。结构化正文保留主体及证据；候选不晋升，普通记忆不变为长期指令，不跨主体合并，长期指令不能由维护模型改写或丢失原条件。

撤销推进 Skill 墓碑版本；保留原来源、previous 与生成收据，旧幂等操作不能复活被替换版本。维护撤销经验时，如果派生 Skill 因此失去最后的有效支持，同一份维护回执分别记录撤销的经验和 Skill，并用经验条目 ID 串联；仍有有效支持的 Skill 保留。经验撤销使用实际 reflection memoryKey 并推进遗忘代次，档案回调失败进入现有 archivePending。旧技能文件不物理删除，以免影响运行中工作；有效状态和历史加载授权以当前 state 为准。秘密来源的原始审计、Pi 历史、已有离线备份不承诺安全擦除。

`memory_status.review` 显示 enabled、running、nextDueAt、lastRunId、status、code、deferredCount。持久水位位于 evolution/maintenance.json，每次收据位于 evolution/maintenance/<runId>.json，保留动作、来源版本和前后 hash，不重复保存正文。维护推理沿用 Pi 路由的传输限制和流空闲超时。索引和计划的 `deferred` 均为简短原因字符串数组；不合规的 JSON 或结构分别记为 `MEMORY_MAINTENANCE_INDEX_INVALID`、`MEMORY_MAINTENANCE_PLAN_INVALID`，整批不应用，不在回执中保存模型原文。失败、取消和提交不确定分别报告；Host 关闭取消并排空维护。开启定时器或读取索引不等于完成一次现有数据的完整实质复盘；本变更不增加渠道手动维护 API，也未执行真实 Bot 历史清理。

## Durability, failures and forgetting

The Bot evolution lease serialize review updates. Memory uses its own atomic
journal and source deduplication. Review state keyed by the durable event ID,
evidence reports and skill revisions are atomically written. Repeating a scan or
cold restart skips completed reviews; a crash before state publication retries
idempotent memory writes. Invalid/unknown evidence, oversized/incomplete model
output, known secrets or model failures produce a maintenance failure record.
Retries wait at least 30 seconds and stop after three recorded attempts per event;
the status is visible through `memory_status`. The wait is a retry interval, not an
inference deadline. Tool-free reviews follow Pi's model-route transport and
stream-idle timeouts. Creator drafting follows provider limits and caller/Host
cancellation. Host shutdown cancels and drains in-flight calls; learning failures
never reverse a completed task. This does not promise exactly one vendor request
across an unrecorded hard crash.

共享记忆或学习 Skill 在复盘期间被其他操作更新时，只有确认旧计划无任何已发生或不明的效果、且遗忘代次未变，才在下一次扫描用当前索引重新判断。已提交、结果未知或部分写入的计划继续用原标识和原回执。没有代次的历史计划不扩大补偿范围；已耗尽的复盘不因升级或重启重跑。Router 首次新增经验通常只改变目录版本；若重建同名经验时发现未清完的旧派生记录，仍将其撤销。更正经验正文或显式删除仍阻止跨遗忘重试。

`REFLECTION_MODEL_INCOMPLETE` 表示 Pi 未返回可用的完整输出；`REFLECTION_WRITE_PENDING` 表示写入前已保存计划检查点，不能仅凭该码判定效果，需核对其中的逐条状态和原回执。历史 `REFLECTION_INCOMPLETE` 可能来自任一阶段，保留原样。

Correcting or forgetting an `experience` entry removes corresponding derived skill
state and review lesson bodies. If derived cleanup fails after memory committed,
the caller receives `MEMORY_DERIVED_CLEANUP_UNCERTAIN`; repeat the forget to finish
cleanup. Task-derived learned-skill lookup requires current retained supporting experience;
Router-derived skills instead require their Host-bound authenticated source receipt.
Previously loaded memory/learned-skill bodies are revoked in subsequent model
requests when scope or memory revision changes. Raw task receipts and Pi history
are retained, as are separately created offline backups; forgetting is not secure
erasure of those sources or vendor records.

Back up `data/memory` together with stopped `data/state`, workspaces, attachment
originals and configuration through the layout-aware snapshot tool. Secrets are
excluded by default. No vector database, graph store, plugin historical-data import,
real business deployment or automatic external notification is involved.

Each task also retains its own review report and Bot destination identifiers
in task `reviews/`. Archive restore preserves those records without importing
shared memory/skill collections or automatically re-running the old review.
See [TASK-ARCHIVE](TASK-ARCHIVE.md).

## Evidence completeness in task retrospectives

Completed single-session tasks often have no historical `execution.list` records.
Retrospectives therefore preserve the committed completion summary, evidence and
limitations instead of treating a missing execution list as missing task evidence.
Request/objective context is included only when the completion's requirement, context,
control and run versions match; a later reopened objective cannot be borrowed for an
older review. Input records retain their ledger IDs and are described as recorded
results, not independent verification. Field/item budgets and omissions are explicit.

Summary, Why and How to apply remain the three content sections. Include supported
objects, outcomes, reasons, conditions, steps, commands and verification limits as
needed for standalone reuse. Missing reasons remain unspecified. Each section keeps
its 2048-character bound; validated structured lesson bodies can exceed 2048 characters
in aggregate under the existing 64 KiB ceiling. Generic literal-memory limits remain
unchanged. Historical records are migrated losslessly, never embellished by guesswork.
