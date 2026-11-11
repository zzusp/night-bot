# Bot-shared autonomous learning

Night Bot is a personal-assistant Agent initialization kit. It learns reusable
reference material through conversation memory and post-completion task reviews;
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

Router 是 Bot 的语义决策核心，依据当前认证消息判断记忆或学习 Skill 的增改删并直接执行短维护。Host 不用话术正则再次判断授权，也不增加授权模型、空任务或先写 experience 的门槛。普通对话候选与无工具任务复盘保持独立；它们不获得 Router 专用写权限。记忆从上下文提炼，复用 Model observation、Hypothesis (not fact)、Possible direct path (not permission)、Evidence 四维；假设和行动建议可省略，原话保留在证据中。个人偏好按原提出者判断适用性，项目背景按当前场景判断，不把来源作者等同于适用对象。来源、权限与失败合同见 [MEMORY](MEMORY.md#渠道长期偏好)。

The real task service attaches reflection to the durable SQLite `task.completed`
event stream, requests a scan after a committed completion and on normal recovery,
and scans existing completion events at startup. A review is separate background
work, after task completion has committed. It cannot undo that state, block the
completion receipt or execute tools. A channel installation is not a prerequisite.
The task service binds task execution sessions to ledger actor/group principals;
other conversational integrations require explicit authenticated bindings. Router
result assessment is separate from this tool-free retrospective: learning neither
releases dependencies nor creates authority for a follow-up task.

Each review receives bounded completion, execution and operation facts with stable
IDs, not entire chats or raw command bodies. The configured model proposes at most
three observations, possible pitfalls/detours and more direct approaches. Each must
cite an ID from that task's supplied facts. Experience Markdown explicitly labels
model observations, hypotheses and suggested paths; the original task evidence
remains authoritative. Valid IDs do not prove that a model's interpretation follows
from them. Semantic validity, relevance and whether a shortcut is safe remain model
judgments requiring current facts and user instructions.

## Managed skills and evidence

A useful procedural lesson may propose steps, a reason, an evidence-backed
assessment and bounded applicability. The model decides whether that experience
justifies creating/updating a skill; a single well-evidenced reusable lesson can
qualify. There is no fixed repetition threshold. Program checks require valid
same-task evidence references, authenticated ownership, bounded Markdown, deduplication
and traceable revisions. They do not prove the model's assessment. Repeated events
cannot inflate evidence or rewrite formal templates. Changed steps retain their
review provenance. The task-review producer admits at most 20 active learned skills; this is its
catalog admission limit, not a repetition threshold or a Router maintenance gate. No
executable scripts are generated.

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

## Router 直接维护 Skill

`resident_skill_query` 读取共享 learned Skill 的版本、来源和适用性；指定 key 时返回步骤和理由。`resident_skill_mutate` 通过 upsert/delete 执行短维护，必须绑定本批完整原话、作者和消息版本，使用稳定 operationId，更新或删除前应提供读回的 expectedRevision。步骤、理由和适用性继续拒绝已知秘密；key 只能是受管名称，不接受路径，也不覆盖用户安装模板。Router 记录的当前认证消息作为独立来源，不要求制造任务/experience；任务复盘产生的 Skill 仍必须有保留的任务经验支持。

复用 evolution 共享锁、state.json、previous 快照、learned provider 和冷启重建。状态与幂等回执先原子提交，再发布并回读派生 SKILL.md；派生失败返回 `REFLECTION_WRITE_UNCONFIRMED, committed:true`，重试仍失败时不能声称保存。重试只重建当前版本的派生文件，不重放旧创建或删除操作。删除保留单调版本，重建同名 Skill 不重置为版本 1；查询已删除 key 可获得当前墓碑版本。operationId 重用不同输入或 expectedRevision 过期均明确拒绝。

写入在等待共享锁后重新核对来源和权限。更新或删除推进共享记忆代次，后续模型请求撤销旧加载的学习正文，Pi 审计历史不改写。Skill 方法是模型指导和来源陈述，不是已验证业务事实、执行权限或放松沙箱的依据。

## Durability, failures and forgetting

The Bot evolution lease serialize review updates. Memory uses its own atomic
journal and source deduplication. Review state keyed by the durable event ID,
evidence reports and skill revisions are atomically written. Repeating a scan or
cold restart skips completed reviews; a crash before state publication retries
idempotent memory writes. Invalid/unknown evidence, oversized/incomplete model
output, known secrets or model failures produce a maintenance failure record.
Retries wait at least 30 seconds and stop after three recorded attempts per event;
the status is visible through `memory_status`. Model work has a 30-second deadline,
shutdown aborts/drains it, and failures never reverse a completed task. This does
not promise exactly one vendor request across an unrecorded hard crash.

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
