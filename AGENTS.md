# Night Bot

UI/UE 的唯一指导性文档是仓库根目录的 [DESIGN.md](DESIGN.md)。修改界面前先读该文档；视觉、交互、状态、文案和可访问性规则统一在其中维护，不另建平行的 UX 合同或设计规范。CSS 与组件是实现，操作/运维手册和历史验收记录不替代设计规范。

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
Each execution unit has one Work session. Router can split a complex request into
a group of cooperating Work sessions and nominate the session responsible for the
final result. Work sessions discover and message their assigned peers directly;
Router alone owns external replies and Work lifecycle. Authenticated inputs from
all channels go to one durable Router; no channel-specific prompt, first-tier model
or automatic acknowledgement runs. Each Router turn is scoped to its authenticated
conversation; historical conversation Router and triage records remain read-only.
Completion does not automatically trigger self-evolution. A two-hour Router
self-check can delegate inspection and curate durable knowledge when warranted.
Router is
Bot's semantic decision-maker and directly maintains shared memory and managed
learned Skills through short Host tools. Do not gate Router decisions by natural-
language authorization prefixes or add a separate authorization model/task. The
trusted Router has complete execution-session scheduling authority: create, start,
stop, resume and reopen, including waiting, cancelled, completed and locally
archived tasks. Do not gate scheduling on source authors or fresh human replies.
Sources remain provenance; an omitted action source reuses the original task
source. Closing a prior unknown effect must not impose any new-action grant on
later independent calls or completion. Preserve exact old-call no-replay. Host
still enforces authenticated conversation/Router identity, live generation,
permissions, secrets, controlled paths, revisions and durable no-replay. Generic
task memory tools do not inherit this Router-only write authority. Keep Router
user-message batches at most 15; overflow queues. Preserve
same-session steer, direct source/version/actor links, durable delivery
deduplication and unknown-send readback. Task dependencies are Host-enforced;
completion alone grants neither authorization nor dependent-task execution.
Router retains its Pi session across idle periods; Pi native compaction owns context
reduction with a 472,000-token target and 60%/80% waterlines.
Small model windows retain native output headroom and may compact earlier. Retained pre-upgrade generation
recovery must preserve committed history, one business owner and durable pending inputs. Topic is historical audit,
not an active routing entity. See docs/CHANNELS.md.
Do not turn repetition counts into a universal gate for skill creation: the model
assesses evidence/value/applicability, including strong single-task lessons; program
code enforces scope, permissions, deduplication and traceability.

## 模型与程序的分工

- **业务语义由模型判断。** 把相关原文、当前状态、结果和回执交给模型，由它判断用户意图、下一步、是否回复和怎么回复。不要用关键词、流程阶段、历史分支或多层规则树替代模型判断，也不要为同一个判断再加审批模型或重试流程。
- **模型接口保持简单、单一。** 同一种业务动作走同一工具、同一套输入和回执；不让模型选择内部实现、历史版本或运行代际。兼容旧数据和旧回执由 Host 处理，不把历史分支转嫁给模型。修故障先删掉错误门槛或统一入口，不给每种现场症状加特判。
- **Host 只强制可核验的边界。** 认证、权限、来源和版本、并发、幂等以及真实副作用回执仍由程序保证。按实际动作的持久身份去重；旧效果未知只回查原回执，不把不确定性扩成新动作的授权门槛。无法执行就返回具体事实；不要把模型的正常判断变成额外的流程关卡。

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
cancellation/drain, ownership and no-replay contracts. Historical DSH namespace
aliases and package facades are cleanup targets, not a required runtime ABI.
Retire their real consumer/import/lock references together; do not restore them
for obsolete tests. Preserve pnpm-workspace.yaml's allowBuilds policy when retiring
overrides. Run the native source/hash/import guard after compatibility changes;
retained derived implementations still require their original notices.
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
backup/copy restore is a separate required capability. Business work and retained artifacts default to `data/workspaces/`.
Night Bot runs tools with the current OS account, without elevation, per-call
human/model approvals or a configurable permission mode. Legacy permission
configuration and historical approval records remain on disk for rollback or
audit only. Preserve separate trusted actor/call/argument boundaries, scoped
internal services, cancellation and no-replay. Keep using dedicated runner
accounts or external deployment isolation where access must be limited.
Use DSH behavior only as a reference: implement these permissions through Pi and
Night Bot's own execution host, without DSH packages, ABI compatibility or old
execution chains. Explicit full mode is not a workaround for failing default-mode
containment tests. System binaries/libraries
and ephemeral OS mechanisms are dependencies, not external business workspaces.
Runtime data, memories, credentials, backups and business artifacts must never be
committed to Git. Version code, tests, rules, generic skill loading/isolation
mechanisms and no-body configuration contracts only, except the explicitly
versioned generic `skills/work-log-writing/` and its sanitized example, plus
`skills/skill-creator/` imported from the explicitly authorized official plugin
with its original license and Night Bot adaptation. This
exception does not include installed/learned skills or real business logs. Private skill bodies, scripts,
references and assets stay in ignored installation data and are never staged,
committed or pushed. When migrating them, use an existing installation pointer within this task's
authorized reuse scope as source, and never copy stale node_modules, worktrees,
accounts or credentials. If cleanup or relocation is needed, touch only materials
introduced by this task; never overwrite or move another session's existing skills.
Run git check-ignore before and after copying, and inspect git diff --cached and
git ls-files for skill paths before delivery.
Autonomous learning uses one Bot-shared, evidence-linked memory/Skills namespace;
channels/conversations/tasks are provenance, not separate memory stores. Actor
authentication, read-only/write consent, transcript isolation and secret/file fences
remain enforced. Retain original v1 data and explicit migration receipts/conflicts.
Autonomous learning uses task retrospectives;
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
operator review and no automatic delivery. Within a task archive, work and tmp
are model work areas; metadata, materials, outputs, sessions and reviews are
Host-owned and must not be fabricated through model tools. External business
targets follow the permission modes above. State the actual OS protection of
each mode separately from application ownership, especially for full access.
Do not claim cwd isolates trusted arbitrary plugins. See docs/TASK-ARCHIVE.md.
