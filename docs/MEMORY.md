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
    index.md                    # category titles, relative links and summaries
    categories/<topic>/
      index.md                  # entry titles, relative links and summaries
      entries/<key>.md          # one accepted memory per Markdown file
    sources/<entry-id>.md        # saved evidence excerpts, opened on demand
    candidates.md               # unapproved; absent when empty
    scope.json                  # layoutVersion 3, revision, dedup/forget receipts
    pending.json                # redo transaction; normally absent
    layout-migration.json       # explicit offline layout-upgrade receipt
    usage.json                  # observed memory read/search and entry returns
    skill-usage.sqlite          # verified skill tool/command/file-read events
    evolution/                  # shared task reviews and learned skills
    migration.json              # copy/import result and conflict count
  v1/                           # retained legacy originals; not active stores
```

Markdown has a JSON-compatible YAML front matter envelope with format/scope/
revision, entry identity, source message/session IDs, source hash and timestamps.
Fact text lives in its entry Markdown body; indices retain only a short summary.
Each index line follows `- [Title](relative-file.md) — one-line summary`.
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

## 渠道长期偏好

已认证渠道中，Router 依据完整语境判断哪些事实、偏好或方法值得保留、需要纠正或应当删除。一级分诊将这类需处理的消息交 Router；Host 不再通过固定句首、授权关键词或临时性词表重复判定 Router 的语义决定。背景之后才出现“请你记住”、没有特定请求句式的可复用事实，均可由 Router 决定保存。临时要求是否应保留、用户说法是否已验证、引用指令是否适用由 Router 判断；引用、任务结果和交接不能冒充当前认证人类来源。

Router 用 `resident_memory_remember` 新增或更新，使用 `resident_memory_forget` 删除。两者都必须提供当前 sourceId/messageVersion、topic/key 及完整准确的 sourceQuote；删除原话不必包含内部 key。更新、删除前按需读回并传 expectedRevision，版本不匹配失败。新增/更新提供结构化 `memory`，不再传入逐字原话作为 text。Router 结合当前消息、引用及必要的同会话背景消解指代，保留对象、条件、链接、限制及时间范围，围绕一个可复用主题直接写清结论、决定或偏好，以及有证据的原因、适用办法与边界；不把“让我记住”的会话过程、承诺或任务流水当记忆，也不补造原因。提炼后的内容应当脱离原会话也能理解。Host 将正文渲染为三段，三项都必须提供：

- **Summary**（summary）：直接说明具体结论、决定或偏好，消解指代，保留必要对象与链接。
- **Why**（why）：仅写来源支持的原因；没有说明原因就如实写未说明，不编造解释或推测。
- **How to apply**（howToApply）：写未来何时、如何使用，以及必要条件与范围，不堆通用免责声明。

不再展开 Model observation、Hypothesis、Possible direct path、Evidence 四个正文标题，也不保存新的推测字段。证据仍由 evidence 提供 id、source（message/quote）、承载消息 sourceId/messageVersion 与逐字 quote；Host 回查同会话来源，绑定原生消息 ID、可取得的作者和摘录哈希。必须有一项 message 证据保留当前完整原话；历史和引用仅作背景，不成为维护授权。证据保存在 context 元数据中，不在正文重复展示原话或内部 ID。

新 Router 结构保存为 context.version=3，与三段正文共同校验。单字段继续受既有 2048 字符校验，结构化正文保留已有 64 KiB 存储边界；不截断证据来压缩正文，通用逐字记忆限制不变。正文、适用说明和证据均拒绝已知秘密。v1、v2 及无 context 的旧条目原样读取，不自动改写历史；旧四维中的推测只作为历史内容保留，不作为新写入格式。来源存在不能证明陈述属实或摘要正确。任务复盘的新经验也采用三段，证据 ID 保留在任务 review 中，见 [SELF-EVOLUTION](SELF-EVOLUTION.md)。

此权限只属于当前来源绑定的 Router 端口；普通 task/generic 记忆工具仍执行既有明确授权、临时内容和候选接受规则，不整体放开群组写权限。结构化命令保持不变。

共享可读性、来源作者与适用对象分开：Router 在 memory.appliesTo 指明 actor（个人偏好）或 context（项目/业务场景）及 description。actor 的身份由 Host 绑定原提出者，不能由模型指定；召回返回 matching-subject 或 reference-only。context 不绑定为作者个人偏好，召回返回 context-dependent，由模型匹配当前任务与场景，不自动成为全 Bot 默认或项目权限。Router 按当前接纳来源、原作者及版本生成适用的 sourceMessageIds，多人批次不能整批套用。同一 Router 后续换发送者，即使记忆版本没变，旧工具结果也重新投影。没有主体/场景的历史原话只作参考，不能默认为所有人的行为规则。当前明确交付要求优先；“未要求不额外附报告”不能扩成禁止成果文件、其他附件或内部验收证据。

Host 只允许当前已接纳且未结清批次中的原来源，回查当前版本、已认证参与者和渠道消息事实；写入归因于原发送者，不能自选 actor/scope/path，不整体放开群 Router 的 `groupWrite`。只读执行权限仍拒绝写入。事务提交后回读核对正文、结构化内容、作者及原消息；重复来源也必须确认当前结构与本次请求一致，不能把旧记录冒充已更新的适用范围。只有 `ok:true,persisted:true` 才能答复已经保存；失败不伪装成功。保存的 accepted 条目进入 Bot 共享记忆，其他已认证会话可按需读取，冷启动不依赖原 Router 摘要。

这是 Router 决策驱动的短维护，不触发空任务，不强制同时创建记忆与 Skill，也不把整个 Router JSON 包转换为真人输入。Skill 由 `resident_skill_query` 读取目标/版本，经 `resident_skill_mutate` 新增、更新或删除，只操作受管共享 learned 命名空间；无需先写 experience 或等待任务复盘，详见 [SELF-EVOLUTION](SELF-EVOLUTION.md)。历史已消费消息不自动回填、回复不自动重放。升级须按安装运维流程排空并重启，不直接编辑 Markdown、SQLite 或 Pi journal。

## Persistence, forgetting and failures

Writers acquire the Bot memory cross-process lease, reload current Markdown, and use
private temporary files, fsync and atomic rename. A redo journal commits changed records, sources, category/root indices,
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
empty category indices and deleted entry/source files disappear. It leaves only bounded non-plaintext fingerprints and
dedup metadata. Stale memory tool bodies are revoked in subsequent model requests,
including inherited context lacking the necessary grants. The raw Pi conversation
and its historical tool records are intentionally retained. Forgetting memory is
not a claim to erase original chats, backups, vendor logs, or manually copied files.

### Progressive recall and actual I/O

1. At prompt preparation, read only the root index and revision, never every body or
   candidates file. All categories remain discoverable; there is no silent 40-topic cutoff.
2. `memory_index({topic})` or `memory_read({topic})` reads that category index only.
   It returns titles, summaries, topic/key and applicability descriptors, not bodies.
3. `memory_read({topic,key})` opens just the selected entry after validating the
   root/category checksums. It retains conditions and current applicability, but
   does not open the separate saved-source file.
4. `memory_read({topic,key,includeSources:true})` also opens that entry's saved evidence.
   These are recorded excerpts and source references, not access to another conversation's
   original transcript. Pi remains the authority for original committed conversation history.

`memory_search` defaults to index descriptors; use `mode:"fulltext"` explicitly
when a detail missing from the summary matters. An optional topic narrows the scan.
Search stops once its result limit is reached. Expired rows are filtered from
indices, search and ordinary reads without opening their bodies. Unapproved candidates
remain separate. Root/category reads do not increment per-entry body-read counters.
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
source metadata and forgetting receipts, backs up before writing, validates interrupted
work before resuming, and never infers missing content. No real installation is
modified by the implementation or its isolated tests.
