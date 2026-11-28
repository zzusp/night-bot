# Markdown memory

Memory is application-owned reference data. Pi remains the authority for original
conversation history and inference; a remembered fact never grants permission or
overrides a current instruction. No graph, embeddings, vector database or semantic
recall is used. Search is case-insensitive literal substring matching, with all
whitespace-separated terms required, and at most 20 results. Default search reads
only titles, one-line summaries and applicability descriptors. Explicit `mode:
"fulltext"` scans bodies; it is a deliberate more expensive fallback, not semantic recall.

## Code and runtime boundaries

`src/memory/` contains `scope.js` (authorization), `commands.js` (explicit command
grammar), `format.js` (Markdown envelope and secret checks), `store.js` (transactions),
`service.js` (Host/session lifecycle, candidates and stale recall revocation) and
`tools.js` (model interface). Runtime path/lease/backup code lives in `src/runtime/`.
Existing flat runtime modules are retained; this change does not move their source
or change the historical core module accounting.

The portable default is `<install>/data/memory/`:

```text
memory/
  bindings.json                 # trusted session-to-principal grants, private
  v2/bot/                       # one common namespace for this Bot
    index.md                    # every link directly targets an accepted memory file
    categories/<topic>/
      entries/<key>.md          # one accepted memory per Markdown file
    sources/<entry-id>.md        # saved evidence excerpts, opened on demand
    candidates.md               # unapproved; absent when empty
    scope.json                  # layoutVersion 4, transaction descriptors and dedup/forget receipts
    pending.json                # redo transaction; normally absent
    layout-migration.json       # explicit offline layout-upgrade receipt
    usage.json                  # observed memory read/search and entry returns
    evolution/                  # shared task reviews and learned skills
    migration.json              # copy/import result and conflict count
  v1/                           # retained legacy originals; not active stores
```

The root index is plain Markdown, not a JSON envelope. Each line follows
`- [Title](relative-memory-file.md) — applicability and key conclusion` and links
directly to an individual memory body. Headings may group entries; there is no
intermediate category-index lookup. Every entry is available to the session index;
this change introduces no automatic filtering, ranking or index-size truncation.
Machine transaction descriptors remain in `scope.json`, not in the index or model
prompt. Individual memory/source files retain their existing validated envelope
with format/scope/revision, identity, source IDs, hashes and timestamps. Fact text
lives in the entry Markdown body; the index contains only title, link and short summary.
Category/key path components are portably escaped, including case-insensitive
filesystems and Windows reserved names. Long names use a bounded prefix plus a hash
suffix; their original full labels remain in metadata. Standard Markdown links URL-escape
those literal filenames. Source excerpts are separate
Markdown files linked by identity and checksum; they are not loaded for ordinary recall. Corrections replace the old value;
they preserve identity/creation time and increment the entry revision. Candidate
promotion preserves its original source separately from the approval source.
The envelope and content hash are validated. Direct edits which invalidate hashes
are refused, rather than silently imported as trusted memory. Use the guarded
commands/tools to modify records. Directory names do not expose raw actor/group IDs.

Task retrospectives use the lesson's semantic key, such as
`experience/audit-unattributed-scaling`. A conflicting key receives a numeric
suffix (`-2`, `-3`, ...); it never overwrites another memory. The selected key is
saved in the review before writes, so interrupted retries keep the same identity.
Task/event/session provenance remains in record metadata, review destinations and
learned-skill support references, not a mandatory `task-<hash>-` name prefix.
Task learning views and forgetting follow those explicit references. No legacy
prefix reconstruction or automatic data migration is provided. Each logical topic/key maps to its own Markdown file, while task and source IDs
remain provenance rather than mandatory filename prefixes.
Retained reviews can still expose their saved explicit destination references;
missing or unsupported historical associations do not block new retrospectives.
Historical failed reviews without the semantic-key retry protocol are audit-only:
they are not inferred or replayed again, even after memory is cleared. New reviews
persist `memoryKeyVersion: 1` before effects (and on pre-effect failure) so retries
can distinguish their durable key/write receipts from historical unknown effects.

## Identity is a Host responsibility

Memory is mounted by the default Host but fails closed until a trusted adapter binds
an authenticated session. Models cannot set an actor, group, filesystem root or
arbitrary scope ID. A trusted application can call:

```js
await host.ctx.memory.bindSession(sessionId, {
  actorId: authenticatedActorId,
  // groupId: authenticatedGroupId,  // identity/provenance, not a memory partition
  // groupWrite: true,             // only if the caller may change shared memory
})
```

The same declarations can be supplied in trusted `memory.bindings` configuration,
keyed by the exact session ID. Bindings survive restart. A session cannot be
reassigned to another principal/group; create a new session for that identity.
Do not bind an aggregate multi-person coordinator as one private user. No identity
is inferred from free text, model output, or a guessed DingTalk ID. The task service binds task execution sessions from trusted ledger actor/group identities before model work. Conversational roles, including Router generations, require their own authenticated bindings; a handoff summary cannot select a new principal. This is independent of DWS and does not restore a task Owner role.

All authenticated, bound Bot conversations read the same `bot` namespace. Channels,
private/room types, sender identity and tasks are provenance, not memory partitions.
The historical personal/group/project selectors are aliases to this shared store;
new tools advertise `bot`. Read-only presets still cannot write, a group binding
without `groupWrite` still cannot mutate, and explicit human source/quote checks
remain mandatory. A binding does not grant task control or another conversation's
raw transcript. Unbound sessions receive failure feedback. Generic model file tools cannot read raw application state; Linux model processes mask it in a mount namespace. Trusted plugins and administrative programs retain service-account authority. Non-Linux model processes fail closed until equivalent privacy enforcement is implemented. See DATA-LAYOUT.md for dependency and temporary-path boundaries.

## Remember, correct and forget

These unambiguous commands are executed before inference in the current turn:

```text
记住 公共 preferences/style：简短回答
修改记忆 preferences/style：详细回答
忘记 preferences/style
记住 本群 facts/name：本群用于项目协作
记住 项目[authorized-project] facts/version：v2
记住候选 preferences/format
```

English `remember`, `update memory` and `forget` use the same `topic/key: value`
shape. Flexible requests can use `memory_index`, `memory_read`, `memory_search`, `memory_remember`,
`memory_forget`, `memory_candidates`, `memory_promote` and `memory_status` in the
same model turn. Mutations require the current human message ID, an exact source
quote, and an authorized target; a source found in historical/tool/coordinator
content does not grant write consent. Fact text must be a literal short quote,
not an invented summary. Ambiguous targets need clarification. Optimistic
`expectedRevision` prevents a stale correction overwriting a newer one.

“This time/today/for now” preferences remain in the current conversation. Explicit
expiry can be supplied by a guarded tool only with the exact ISO instant in the
current user source. Expired facts are excluded from reads/index/search. Known
credential labels, API token patterns, private keys, bearer tokens and credential
URLs are refused; do not use memory as a secret vault. Pattern checks cannot prove
that arbitrary unlabeled prose is non-sensitive.

At a completed turn's idle boundary, enabled background extraction sends at most
three bounded human messages to the existing configured model without tools. It
accepts at most three literal durable-fact quotes, excludes temporary/explicit
memory commands and known secrets, and stores only **unapproved candidates**.
Candidates are not recalled as accepted facts. They require a current explicit
approval. Disable this work with `memory.background: false`. A scope revision check
discards an extraction racing a correction/forget; forget fingerprints also suppress
stale candidates. `memory_status` and the next prompt expose maintenance error codes.
No automatic external notification is sent on a background error.

## 长期记忆准入

候选提取、主对话、Router、任务复盘与周期维护先区分可回查事实、可复用经验和有价值的历史快照：

- 同一事实能从稳定的权威来源可靠复查时，优先保存来源、对象、版本和查询入口，使用时回查。聊天、过程文件、旧任务记录和工具输出可以作为证据，不能仅因还能找到它们就认定有权威入口。
- 未验证的猜想、猜测、推断和结论不保存；标注“可能”“待确认”也不例外。线索留在当前任务。
- 不复制临时状态、进度、原始输出、一次性报错与执行流水。可复用经验要写清适用场景、已验证结论、下次应做什么及其边界，让接手者不用翻旧任务也能用。
- 有比较、追溯价值，或当前用户明确要求保留的已核实历史记录，可单独保存为带日期、范围和来源的快照。它不表示当前事实，不升级为长期偏好，也不与可复用经验混存。
- 重复、过期、被纠正或替代的信息不新增为有效结论；在授权范围内修订或撤销。
- 凭据与不必要的敏感原文不保存，不复制整段聊天、文档或身份信息。
- 一次性要求不升级为长期偏好，一次批准不升级为持续授权。明确的长期要求保留完整条件与主体范围。

这些是模型的语义筛选责任；Host 仍验证来源、同意、秘密、版本和路径，合法 evidenceIds 或 evidenceBacked 并不证明内容真实。候选不能由维护自动晋升。正式 Bot 的[两小时自检](SELF-EVOLUTION.md#事件与周期维护)在后台清理、合并、拆分或更新受管条目；保留原始来源、主体、长期指令作用域和安全 previous，不把维护推理变成新授权。

## 渠道长期偏好

已认证渠道中，Router 依据完整语境判断哪些事实、偏好或方法值得保留、需要纠正或应当删除。渠道消息直接进入 Router；Host 不再通过固定句首、授权关键词或临时性词表重复判定 Router 的语义决定。背景之后才出现“请你记住”、没有特定请求句式的可复用事实，均可由 Router 决定保存。当前用户明确要求保留已核实的日期快照时，不因聊天中曾经出现就拒绝；快照以原始证据界定时间、对象和范围。用户说法不自动成为独立核验，引用、任务结果和交接也不能冒充当前认证人类来源。

Router 用 `resident_memory_remember` 新增或更新，使用 `resident_memory_forget` 删除。两者都必须提供当前 sourceId/messageVersion、topic/key 及完整准确的 sourceQuote；删除原话不必包含内部 key。更新、删除前按需读回并传 expectedRevision，版本不匹配失败。新增/更新提供结构化 `memory`，不再传入逐字原话作为 text。Router 结合当前消息、引用及必要的同会话背景消解指代，保留对象、条件、链接、限制及时间范围，围绕一个可复用主题直接写清结论、决定或偏好，以及有证据的原因、适用办法与边界；不把“让我记住”的会话过程、承诺或任务流水当记忆，也不补造原因。提炼后的内容应当脱离原会话也能理解。Host 将正文渲染为三段，三项都必须提供：

- **Summary**（summary）：写同类任务认得出的场景和具体结论、动作或偏好，消解指代，保留必要对象与链接。
- **Why**（why）：仅写来源支持的原因；没有说明原因就如实写未说明，不编造解释或推测。
- **How to apply**（howToApply）：写未来何时、如何使用，以及必要条件与范围，不堆通用免责声明。

不再展开 Model observation、Hypothesis、Possible direct path、Evidence 四个正文标题，也不保存新的推测字段。证据仍由 evidence 提供 id、source（message/quote）、承载消息 sourceId/messageVersion 与逐字 quote；Host 回查同会话来源，绑定原生消息 ID、可取得的作者和摘录哈希。必须有一项 message 证据保留当前完整原话；历史和引用仅作背景，不成为维护授权。证据保存在 context 元数据中，不在正文重复展示原话或内部 ID。

新 Router 结构保存为 context.version=3，与三段正文共同校验。单字段继续受既有 2048 字符校验，结构化正文保留已有 64 KiB 存储边界；不截断证据来压缩正文，通用逐字记忆限制不变。正文、适用说明和证据均拒绝已知秘密。v1、v2 及无 context 的旧条目原样读取，不自动改写历史；旧四维中的推测只作为历史内容保留，不作为新写入格式。来源存在不能证明陈述属实或摘要正确。任务复盘的新经验也采用三段，证据 ID 保留在任务 review 中，见 [SELF-EVOLUTION](SELF-EVOLUTION.md)。

此权限只属于当前来源绑定的 Router 端口；普通 task/generic 记忆工具仍执行既有明确授权、临时内容和候选接受规则，不整体放开群组写权限。结构化命令保持不变。

共享可读性、来源作者与适用对象分开：Router 在 memory.appliesTo 指明 actor（个人偏好）或 context（项目/业务场景）及 description。actor 的身份由 Host 绑定原提出者，不能由模型指定；召回返回 matching-subject 或 reference-only。context 不绑定为作者个人偏好，召回返回 context-dependent，由模型匹配当前任务与场景，不自动成为全 Bot 默认或项目权限。Router 按当前接纳来源、原作者及版本生成适用的 sourceMessageIds，多人批次不能整批套用。同一 Router 后续换发送者，即使记忆版本没变，旧工具结果也重新投影。没有主体/场景的历史原话只作参考，不能默认为所有人的行为规则。当前明确交付要求优先；“未要求不额外附报告”不能扩成禁止成果文件、其他附件或内部验收证据。

Host 只允许当前已接纳且未结清批次中的原来源，回查当前版本、已认证参与者和渠道消息事实；写入归因于原发送者，不能自选 actor/scope/path，不整体放开群 Router 的 `groupWrite`。只读执行权限仍拒绝写入。事务提交后回读核对正文、结构化内容、作者及原消息；重复来源也必须确认当前结构与本次请求一致，不能把旧记录冒充已更新的适用范围。只有 `ok:true,persisted:true` 才能答复已经保存；失败不伪装成功。保存的 accepted 条目进入 Bot 共享记忆，其他已认证会话可按需读取，冷启动不依赖原 Router 摘要。

普通记忆可通过 `resident_memory_remember` 单独修改 `title`（名称）或 `indexSummary`（一行适用场景和结论），也可与完整 `memory` 正文同次更新；改索引时须提供读到的条目 `expectedRevision`（新建为 0）。仅改索引不重写正文或撤销已有学习 Skill，条目 ID、内部 key 和直接链接不变。`resident_memory_reconcile` 的 update 同样支持改索引，并保留真实完成事件的来源边界。索引文案只写入 Markdown 索引，不在事务元数据中另存一份。

这是 Router 决策驱动的短维护，不触发空任务，不强制同时创建记忆与 Skill，也不把整个 Router JSON 包转换为真人输入。Skill 由 `resident_skill_query` 读取目标/版本，经 `resident_skill_mutate` 新增、更新或删除，只操作受管共享 learned 命名空间；无需先写 experience 或等待任务复盘，详见 [SELF-EVOLUTION](SELF-EVOLUTION.md)。历史已消费消息不自动回填、回复不自动重放。升级须按安装运维流程排空并重启，不直接编辑 Markdown、SQLite 或 Pi journal。 upsert 的步骤、理由及适用范围是候选输入，Host 必须经内置 `skill-creator` 的实际加载与模型生成后才能发布；生成证据与正式版本一并保存，失败不走旧直接拼装。

## 独立长期行为指令

明确持续调整 Bot 行为的要求使用现有共享 MarkdownMemoryStore 的预留 topic `standing-instructions`，与普通三段记忆区分。Router 仍自行作语义判断，不增加关键词门槛、另一个授权模型或任务。`resident_memory_remember` 在此 topic 使用 `instruction: {text}`，不同时传普通 `memory`；正文必须是本批当前原消息的逐字片段，并保留适用条件。新增提供 `expectedRevision: 0`，更新和 `resident_memory_forget` 提供当前条目版本。sourceId/messageVersion/sourceQuote、当前 Router generation、写权限和秘密校验不变。

聊天入口仅维护当前原作者个人规则：Host 从认证来源绑定 actor hash，模型不能指定其他作者、会话级或 Bot 级 scope，不能改删他人的条目。安装级规则继续使用现有受信 AGENTS/instruction 资源，会话职责继续通过认证渠道配置维护；本轮不新增群聊提升全局规则的管理入口。存储 scope 元数据可表示 actor/conversation/bot，不代表普通渠道或任务获得了这些写权限。旧偏好和历史摘要不自动转成指令，普通记忆工具、候选提取和任务复盘不能写此预留分类。

两角色每次模型请求前加载当前适用正文，输出条目 ID、revision 和准确 `appliesToSourceIds`；同轮 steer 加入的新作者也刷新，不能把个人规则套给整批。改删后以当前列表为准，一次性例外不自动修改规则。分诊只附当前主体的普通偏好导航；Router 保持普通目录及按需 `memory_read`。记忆只经官方 `night_memory_index` 注入一次，不再叠加另一个相同系统贡献。读取只刷新提示，不重放结构化记忆命令。

条目仍使用既有 Markdown envelope、scope/hash、修订、事务与防重放；不建立新存储或迁移既有运行数据。新元数据写入后不能让不认识它的旧程序继续改写同一记忆目录；升级、回滚保持代码与离线数据匹配。摘要只保存指令 ID/版本引用，不能恢复已删规则或授予工具/跨会话权限。

## Persistence, forgetting and failures

Writers acquire the Bot memory cross-process lease, reload current Markdown, and use
private temporary files, fsync and atomic rename. A redo journal commits changed records, sources, the direct Markdown index,
candidates and revision as one logical operation. Every normal reader holds the same
lease and completes a committed redo before observing its selected files. A failed post-journal write
reports `MEMORY_COMMIT_UNCERTAIN`; the next locked access finishes recovery. Read
current state before retrying an uncertain mutation. A live lock is never stolen
on a timeout. Linux reads use anchored no-follow traversal for every ancestor;
non-Linux reads use conservative before/after identity checks. Mutation paths reject
unsafe ancestors before applying redo, but pathname-based writes are not a sandbox
against a hostile concurrent OS-account filesystem mutator. The memory lease serializes
cooperating Bot writers. Individual files and a pending transaction are bounded at
64 MiB; an oversized transaction is rejected before its redo journal is committed. Dead Linux owners are checked with PID/start/boot identity; an uncertain
owner remains blocked for operator review.

Forget removes the current fact, matching candidates and derived index entries;
deleted entry/source files disappear. It leaves only bounded non-plaintext fingerprints and
dedup metadata. Stale memory tool bodies are revoked in subsequent model requests,
including inherited context lacking the necessary grants. The raw Pi conversation
and its historical tool records are intentionally retained. Forgetting memory is
not a claim to erase original chats, backups, vendor logs, or manually copied files.

### Progressive recall and actual I/O

1. At prompt preparation, read the complete plain Markdown root index plus private
   transaction descriptors, never every body or candidates file. Every link points
   directly to a specific memory, including entries after the first three of a topic.
   There is no classification-index navigation or automatic retrieval/filtering layer.
2. `memory_index()` lists direct entry links and summaries. A topic argument narrows
   this same index; it does not open a second index file.
3. `memory_read({path})` accepts the exact relative link target copied from the index,
   including encoded names; it resolves only against current scoped index entries,
   never arbitrary filesystem paths. `memory_read({topic,key})` is also supported.
   Both open only the selected entry after checking its private
   transaction descriptor and own content hashes. It retains conditions and current
   applicability, but does not open the separate saved-source file.
4. `memory_read({topic,key,includeSources:true})` also opens that entry's saved evidence.
   These are recorded excerpts and source references, not access to another conversation's
   original transcript. Pi remains the authority for original committed conversation history.

Pi invokes the registered `memory_read` tool for normal on-demand recall. Direct
native `read` of a linked file is available only when the existing full-access file
policy permits it; ask/read-only file privacy remains unchanged. A raw file read
does not get the memory service's applicability projection or revision-revocation
metadata, so the prompt prefers `memory_read` rather than bypassing that service.

`memory_search` keeps the existing literal descriptor search; use `mode:"fulltext"`
explicitly when a detail missing from the summary matters. This change does not add
semantic retrieval or automatic candidate selection. Expired rows are excluded from
ordinary recall using private expiry metadata without reading every body. Unapproved
candidates remain separate. Index reads do not increment per-entry body-read counters.
Skill catalog support checks use index keys, not memory bodies. Host maintenance,
write transactions and explicit full-text scans may read a broader snapshot; the
on-demand guarantee applies to normal recall, not those deliberate operations.

Old v2-context bodies already containing an Evidence section remain byte-for-byte
historical content; the source opt-in does not rewrite or redact quotations already
embedded in such an old body. New v3-context content stores evidence separately.
This is intended for a modest Markdown library, not a large document search engine.

Task experience and managed learned skills are documented in [SELF-EVOLUTION](SELF-EVOLUTION.md). Forgetting an experience removes its derived learned skill and review lesson; raw task facts and Pi history remain evidence.


## Source, migration and observation

New facts/candidates retain Host-verified channel ID, chat/chat-room type, conversation
ID/name at write time, and task ID/title when supplied by the real task ledger.
The latest source and up to 32 distinct origin descriptors survive corrections;
metadata is never accepted from model-supplied memory arguments. Unknown historical
origins remain unknown. Read/search responses retain that provenance. Observed
per-entry returns/hits and the last access source are counted separately from writes
or semantic adoption; dashboard/index reads do not increment them.

On portable startup, the installation Host lease excludes old writers. The service
copies old v1 stores into v2/bot before serving actors: same key/body is deduplicated,
differing same-key bodies become named candidates, old sources remain intact, and
per-source migration receipts prevent repeats or resurrecting a subsequently forgotten
fact. Legacy counters import once; they are not reconstructed calls. Differing learned
skill names are qualified instead of overwritten. Original v1 files remain as an offline
backup; review collisions are retained in the migration state. Unsafe links, corruption
and incomplete writes fail closed. For legacy non-portable layouts, stop every old
writer before upgrading; do not run old and new binaries against the same memory root.
Do not delete retained originals until their backup and import result have been reviewed.
The copy is an intentional Bot-memory upgrade, not arbitrary SDK/plugin history import.

The Web self-evolution page inventories all SKILL.md resources beneath Bot-owned
skills/configured roots (including invalid, shadowed, disabled or undiscovered files)
and shared learned state. Current file hash/mtime is not a full change history.
Successful native `skill` results are paired with actual official Pi results; authenticated
`/skill:name` references are counted only after Pi admission commits; actual reads of
an exact skill file are tracked separately. Resource preparation/catalog work is never
counted as invocation, nor does reading prove adoption or successful script execution.
Tracking begins at the stated timestamp, is not a complete pre-upgrade call history,
and cannot prove semantic use. Failed/revoked calls do not become successful counts.

## Explicit layout upgrade

Existing topic-aggregate Bot stores are never silently rewritten by startup. Stop all
writers and use the read-only check followed by explicit apply in
[the migration guide](MEMORY-MIGRATION.md). The script preserves old originals,
source metadata and forgetting receipts, backs up before writing by default (explicit local
`--no-backup` is limited to v3→v4 metadata with a forward-only redo journal), validates interrupted
work before resuming, and never infers missing content. No real installation is
modified by the implementation or its isolated tests.

### 技能统计存储

技能使用统计由 Web 解析保留的 Pi 会话记录派生，不再创建、维护或读取 `skill-usage.sqlite`。升级保留旧数据库及其 `-wal`、`-shm`、`-journal` 文件原位，不打开、迁移或自动删除；旧文件不参与统计，也不阻塞记忆结构迁移。实际技能加载与版本变化检测不依赖该数据库。

## Pi 上下文与文档记录的准入

记忆与 Skill 的准入原则同样约束 Pi 压缩摘要、接续笔记和长期文档：能从稳定权威来源可靠复核的同一事实保留来源/对象/版本指针，不复制成第二份事实来源；不沉淀未经验证的猜测、临时流水、重复失效内容、凭据或不必要敏感原文，一次要求或批准不能升级为长期偏好或持续授权。

当前任务所需的输入、工具结果和临时上下文仍可按需使用。跨轮压缩时，保留当前目标、有效约束、有证据的决定及限制和必要产物路径；关键未决假设、阻塞与待验证问题可明确标为“未验证”，同时保留证据引用、下一步核验与解除条件，以支持接续，不能晋升为长期事实或 Skill。授权引用必须带原始范围、条件与有效期，执行前由当前权限/回执机制核验，摘要不授予权限或允许重放。

共同规则进入正式会话每次启动的系统提示；分诊、Router 和任务执行均通过同一 Pi 原生压缩扩展应用，前台和后台候选共享规则。它是模型的语义筛选指令，不是能够证明摘要事实正确或秘密已擦除的确定性过滤器。不会清洗或删除原始 Pi journal、不可变来源、调用回执或安全审计，既有保留/备份边界不变。用户要求的交付报告仍可包含目标所需的已核验事实与证据，区别于长期沉淀；该报告不成为新的授权来源。本改动不自动重写既有文档或旧摘要。

每日工作日志是另一个独立的派生文档入口：其无工具归纳请求同样携带准入规则，进展与计划不接受 `inferred` 项，只有接续关键的未验证阻塞可以明确标识后保留。新生成日志的来源索引仅保存记录 ID、类别和当时时间，不复制聊天正文、工具输出或摘要输入全文；模型不可用/校验失败时也仅写来源索引，不退回原文流水。原始任务账本、Pi 日志和来源仍是回查权威，日志不声称已核验所有模型归纳。既有日期文件、原始会话与审计不重写；原有日报触发、去重、备份和冻结机制保持不变。

## 自动任务复盘的写入前准入

新完成事件先读取现有 Markdown 索引描述、受管 learned Skill 的索引，以及安装 Skill 的名称/描述，不先把库正文发给模型。无工具索引选择请求逐批筛出相关项，再按已知身份读取正文；随后同一任务证据与选中的内容进入准入推理，记忆与 Skill 分别选择 skip / update / new，新增与更新都须说明适用类别、触发条件、改变的判断/动作、必要边界以及证据上的必要性，沉淀到证据支持的一类事项，而非改写本次任务名称、专用 ID/路径或临时结论；没有可迁移结论就跳过，也不能泛化成无证据的通用规则。已有内容覆盖、仅是流水或证据不足时不新增；同一事实有稳定权威入口时优先保存查询入口，不重复抄录事实。这不影响提炼经验或单独保存符合条件的历史快照。如果一句结论就足够，不另外生成 Skill。单次充分证据可准入，不设次数门槛。

索引与相关详情不设本功能的固定条数或字节门槛。全部索引描述逐项扫描，按实际解析出的模型 contextWindow、Pi 原生 token 估计和既有输出预留自适应分批；长描述按连续片段完整扫描，不直接取最前 N 条，不静默丢弃长条目。每批疑似相关项取并集，不做固定候选截断，晚位置与超过 7 条的相关项同样可读。详情可一次容纳时直接准入，否则逐批归纳覆盖、身份/版本、可写性、原实质、条件与边界，再按同一模型容量分批合并，最终判断跳过/更新/新增。归纳必须保留影响决定的信息；明确不确定、归纳不能继续收敛或最小输入无法适配模型时失败关闭，这是当前模型无法可靠判断而非库总量拒绝。中间归纳不是独立事实证据，Host 仍以实际读取的条目验证目标。每次无工具请求分别使用既有 30 秒超时与关闭信号，不把多批扫描压进单次请求的总期限。既有通用输出、文件读取、安全和重试限制不变。

类别、触发条件、改变的判断/动作与边界是准入必填项；它们保留在既有复盘计划中，并补入记忆的 howToApply 或 Skill 候选指引中未包含的部分，不覆盖原结论和证据支持的实质。模型负责把它们适当地迁移到一类场景；Host 不把这些声明当作独立事实验证。Skill 只有真正准入后才调用既有 creator，无有效候选不调用 creator。目录不完整、无法可靠保留必要信息、未知引用或版本变化仍失败关闭，沿既有有界重试处理，不通过换名绕过。

Host 核对目标身份、预期 revision、真实任务完成证据 ID、作用域版本、遗忘代次和 Skill 目录快照。只允许更新由既有复盘回执证明关联的 experience 条目（不含主体 context），以及任务来源 learned Skill；其他主题、长期指令、Router 来源和安装 Skill 仅供覆盖判断，不能被该端口覆盖。新写入不自动追加数字后缀，重试不改保留名称；不能以名称不同作为语义新颖性的证明。更新沿用 ID/key、原始来源引用、provenance origins、前一版正文与既有 Skill 支持关系。

现有 learned 生命周期要求有效 experience 支持。本轮不创建“仅为凑 Skill 支持”的记忆：记忆决定 skip 时整组不写，Skill-only 改动不自动落地；这也是独立准入的明确限制，未改变原支持/撤销契约。旧 in-flight 直接恢复已保存计划，不重新生成准入决策或换名重放；新计划恢复只核对原写入身份的持久回执、原正文和单调版本增量，无法证明没有并发变化则保持失败，不绕过冲突。已应用的技能仅修复当前派生文件，不用旧计划覆盖后来的 Router 修改。

模型负责语义相关性、实际价值和证据充分性的判断，Host 不能证明这些判断真实；`evidenceBacked` 与有效引用不是独立验证。没有新增存储布局、索引格式、使用统计或历史清理迁移，自动维护开关不变。此规则只用于新的自动任务复盘，不批量重写现有条目。
