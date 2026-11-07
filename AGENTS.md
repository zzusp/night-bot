# Night Bot

UI/UE 的唯一指导性文档是 [DESIGN.md](docs/acceptance/web-console/DESIGN.md)。修改界面前先读该文档；视觉、交互、状态、文案和可访问性规则统一在其中维护，不另建平行的 UX 合同或设计规范。CSS 与组件是实现，操作/运维手册和历史验收记录不替代设计规范。

Night Bot is a generic personal-assistant Agent initialization kit. Anyone should
be able to initialize their own assistant without another person's identities,
credentials, private paths or business assumptions. Channels are optional adapters and support exactly the core `chat`/`chat-room`
conversation abstractions, with authenticated sender/conversation isolation.
DingTalk DWS CLI belongs in the optional channel plugin, never default core
composition, startup probes or core acceptance prerequisites. Preserve plugin
capabilities and report live vendor integration separately. Public tools, prompts
and DTOs use channel-neutral actor, conversation and recipient fields; vendor
authentication/protocol, native IDs, quotes and resource mapping stay in the
optional plugin. Historical audit and receipts remain traceable to source/vendor
fields and are not mechanically renamed or migrated; retained compatibility
helpers for historical message/receipt formatting do not mean DWS is loaded or
running, and other static-loading claims require test evidence.
Each task has one execution session; no separate task Owner/coordinator or split
execution team. First-tier triage only decides per-source handling and optional
short replies; it never splits, creates or controls tasks. Each authenticated
conversation has one durable Router identity for task arrangement and result
assessment, separate from task execution and tool-free retrospectives. Keep both
triage and Router user-message batches at most 15; overflow queues. Preserve
same-session steer, direct source/version/actor links, durable delivery
deduplication and unknown-send readback. Task dependencies are Host-enforced;
completion alone grants neither authorization nor dependent-task execution.
Router handoff is tool-free; Pi generation rotation must preserve committed
history, one business owner and durable pending inputs. Topic is historical audit,
not an active routing entity. See docs/CHANNELS.md.
Do not turn repetition counts into a universal gate for skill creation: the model
assesses evidence/value/applicability, including strong single-task lessons; program
code enforces scope, permissions, deduplication and traceability.

Use Node.js 24+ and pnpm. Install with `pnpm install --frozen-lockfile`.
Read `docs/MIGRATION.md` and `docs/VALIDATION.md` before changing runtime boundaries.
Pi core owns inference/tool iteration; Pi SessionManager owns durable history and
model context. The application owns authorization and side-effect receipts. Local LLM routing, live-agent ownership and tool execution are application-owned.
Production dependency graphs must contain no external registry DSH packages.
Attributed audit/event/ACL implementations remain temporary migration work; Pi is
current context/history and inference authority. Do not add DSH data import or
plugin ABI compatibility. Application session publication rejects foreign facades.
Runtime and offline maintenance must share strict Pi journal decoding; maintenance
proofs reject uncommitted tails and require explicit portable-path decoding. Preserve its guards, audit,
cancellation/drain, ownership and no-replay contracts. Historical namespace
aliases and pnpm-workspace.yaml are part of the runtime artifact. Run the native
source/hash/import guard after changing compatibility code.
Do not bypass dispatch policy or relax sandbox checks to make a test pass.
The cloud executor wrapper makes nested UID maps read-only; containment tests may
run with approved executor sandbox escalation so their own bubblewrap works. This
is not permission to disable the application sandbox.
Preserve existing target files and never copy credentials or live business data.
Application-owned data belongs in `data/` beneath the installation root,
separate from code and separated by purpose: durable state/sessions/tasks,
Markdown memory, workspaces and attachments; private configuration/credentials;
rebuildable caches; diagnostic logs; transient runtime metadata and a separate `data/temp` directory. Keep working
artifacts in `data/workspaces`, credentials/accounts in `data/secrets` and logs in
`data/logs`; exclude them from Git and exclude log/temp/cache from ordinary backups.
Never evict files still used by running work. Do not hardcode
personal paths. Upgrades must preserve data, and backup/restore must state their
consistency and privacy boundaries, exclude secrets by default, and validate
typed controlled paths before relocation. This is a new project: do not add DSH
plugin historical-data import or legacy path conversion. Night Bot's own future
backup/copy restore is a separate required capability. Business work and all
artifacts stay in `data/workspaces/`; model file/process tools must enforce that
write boundary, including relative paths and symlinks. System binaries/libraries
and ephemeral OS mechanisms are dependencies, not external business workspaces.
Runtime data, memories, credentials, backups and business artifacts must never be
committed to Git. Version code, tests, rules, generic skill loading/isolation
mechanisms and no-body configuration contracts only. Private skill bodies, scripts,
references and assets stay in ignored installation data and are never staged,
committed or pushed. When migrating them, use an existing installation pointer within this task's
authorized reuse scope as source, and never copy stale node_modules, worktrees,
accounts or credentials. If cleanup or relocation is needed, touch only materials
introduced by this task; never overwrite or move another session's existing skills.
Run git check-ignore before and after copying, and inspect git diff --cached and
git ls-files for skill paths before delivery.
Autonomous learning uses scoped, evidence-linked memory and task retrospectives;
model inferences are not facts or authorization. Learning failures must not undo
completed delivery; retain audit, restart idempotence and forgetting behavior.
Do not add private owner identities, fixed ingress times or personal business policy;
never silently move existing data, fall back to an external home after a permission
failure, or claim external tools/platform paths have been unified. Document actual
exceptions and test default wiring, not only injected substitutes.
Tests use isolated directories, scripted/local model endpoints and fake DingTalk.
Do not send real messages, deploy, merge, or trigger CI without explicit authorization.
Use `pnpm test`, `pnpm test:runtime`, `pnpm test:routing`, and `pnpm test:containment`
as appropriate. Report skipped/blocked checks separately from passing checks.

Each portable task directory is a complete task archive: task.json is a derived
transactional ledger snapshot, with materials (including required attachment
copies and retained output), editable work, frozen outputs/descriptors, task Pi
sessions, task-only reviews/destination references and disposable tmp. SQLite
remains runtime authority. Never replay JSON snapshots as commands or copy whole
shared memory/skill scopes. Require offline seals for portable backup, verify
source/session/artifact identity and hashes, and restore with held effects,
operator review and no automatic delivery. Task model tools/processes may write
only work and tmp; metadata, materials, outputs, sessions and reviews are Host-owned.
Do not claim cwd isolates trusted arbitrary plugins. See docs/TASK-ARCHIVE.md.
