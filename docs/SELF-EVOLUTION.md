# Scoped autonomous learning

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
same-task evidence references, scoped ownership, bounded Markdown, deduplication
and traceable revisions. They do not prove the model's assessment. Repeated events
cannot inflate evidence or rewrite formal templates. Changed steps retain their
review provenance. A scope can have at most 20 active learned skills; this is a
catalog size limit, not a requirement to manufacture more experiences. No
executable scripts are generated.

Learned Markdown lives under
`data/memory/v1/<personal|group|project>/<scope-hash>/evolution/skills/<name>/SKILL.md`.
The scoped `learned` provider makes active skills available through the existing
`skills` catalog and `skill` tool. It rechecks the live principal on lookup and
avoids cross-principal catalog caching. Personal skills are unavailable in group
sessions; group and project reads follow memory grants. Task reviews currently
learn in the task's group scope, or personal scope when the ledger has no group;
project-specific automatic task-review routing is not inferred.

Only these managed learned skills are created/updated automatically. Generic
loading/isolation contracts and no-body configuration may be versioned with the
code; private source skill bodies and user-maintained `data/config/skills` are not
written into the repository or overwritten by learning. This avoids turning every
task into a new formal skill or silently rewriting a user's instructions. Learned
skill files, reports, business artifacts and private skill packages are runtime data
and are ignored; their `scripts`, `references` and `assets` stay beside the skill in
the private installation directory.

## Durability, failures and forgetting

Per-scope evolution leases serialize review updates. Memory uses its own atomic
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
cleanup. Native learned-skill lookup requires current retained supporting experience.
Previously loaded memory/learned-skill bodies are revoked in subsequent model
requests when scope or memory revision changes. Raw task receipts and Pi history
are retained, as are separately created offline backups; forgetting is not secure
erasure of those sources or vendor records.

Back up `data/memory` together with stopped `data/state`, workspaces, attachment
originals and configuration through the layout-aware snapshot tool. Secrets are
excluded by default. No vector database, graph store, plugin historical-data import,
real business deployment or automatic external notification is involved.

Each task also retains its own review report and scoped destination identifiers
in task `reviews/`. Archive restore preserves those records without importing
shared memory/skill collections or automatically re-running the old review.
See [TASK-ARCHIVE](TASK-ARCHIVE.md).
