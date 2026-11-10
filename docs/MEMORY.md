# Markdown memory

Memory is application-owned reference data. Pi remains the authority for original
conversation history and inference; a remembered fact never grants permission or
overrides a current instruction. No graph, embeddings, vector database or semantic
recall is used. Search is case-insensitive literal substring matching, with all
whitespace-separated terms required, and at most 20 results.

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
    index.md                    # short topic links/counts, no fact bodies
    topics/<topic-sha256>.md     # current facts, with source metadata
    candidates.md               # unapproved; absent when empty
    scope.json                  # revision, dedup/forget and migration receipts
    pending.json                # redo transaction; normally absent
    usage.json                  # observed memory read/search and entry returns
    skill-usage.sqlite          # verified skill tool/command/file-read events
    evolution/                  # shared task reviews and learned skills
    migration.json              # copy/import result and conflict count
  v1/                           # retained legacy originals; not active stores
```

Markdown has a JSON-compatible YAML front matter envelope with format/scope/
revision, entry identity, source message/session IDs, source hash and timestamps.
Fact text lives only in its Markdown body. Corrections replace the old value;
they preserve identity/creation time and increment the entry revision. Candidate
promotion preserves its original source separately from the approval source.
The envelope and content hash are validated. Direct edits which invalidate hashes
are refused, rather than silently imported as trusted memory. Use the guarded
commands/tools to modify records. Directory names do not expose raw actor/group IDs.

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
shape. Flexible requests can use `memory_read`, `memory_search`, `memory_remember`,
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

已认证渠道的直接原消息明确要求记住，或以“以后／今后／from now on”等表达长期行为要求时，一级分诊转交 Router，不只发送简短确认。Router 调用 `resident_memory_remember`，提供当前来源及版本、记忆 topic/key 和完整准确原话；长期行为条件不能截短或改写。普通将来陈述、疑问、引用、任务结果和交接摘要不授权写入。临时限定继续不持久化，普通对话提取的候选仍须另行接受。

Host 只允许当前已接纳且未结清批次中的原来源，回查当前版本、已认证参与者和渠道消息事实；写入归因于原发送者，不能自选 actor/scope/path，不整体放开群 Router 的 `groupWrite`。只读执行权限仍拒绝写入。事务提交后回读核对内容、作者及原消息，只有 `ok:true,persisted:true` 才能答复已经保存；失败不伪装成功。保存的 accepted 条目进入 Bot 共享记忆，其他已认证会话可按需读取，冷启动不依赖原 Router 摘要。

这是明确请求驱动的记忆写入，不触发空任务，不强制生成 Skill，也不把整个 Router JSON 包转换为真人输入。此修复不自动回填已经消费的历史消息，不自动重放旧回复；既有漏存需按当前授权经受控入口另行保存。更新代码后须按安装运维流程正常排空与重启才作用于运行中的进程，不直接编辑 Markdown、SQLite 或 Pi journal。

## Persistence, forgetting and failures

Writers acquire the Bot memory cross-process lease, reload current Markdown, and use
private temporary files, fsync and atomic rename. A redo journal commits topics,
candidates, index and revision as one logical operation. A failed post-journal write
reports `MEMORY_COMMIT_UNCERTAIN`; the next locked access finishes recovery. Read
current state before retrying an uncertain mutation. A live lock is never stolen
on a timeout. Dead Linux owners are checked with PID/start/boot identity; an uncertain
owner remains blocked for operator review.

Forget removes the current fact, matching candidates and derived index entries;
empty topic files disappear. It leaves only bounded non-plaintext fingerprints and
dedup metadata. Stale memory tool bodies are revoked in subsequent model requests,
including inherited context lacking the necessary grants. The raw Pi conversation
and its historical tool records are intentionally retained. Forgetting memory is
not a claim to erase original chats, backups, vendor logs, or manually copied files.

The index is bounded to 40 topics and carries no fact bodies. Reads are on demand;
keyword search scans current scoped topics. This implementation is intended for
modest personal/group/project notes, not a large document search engine. Real model
extraction quality, all natural-language intent variations and channel-specific
identity integration require their own acceptance.

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
