# Night Bot

Night Bot is a generic personal-assistant Agent initialization kit. Anyone should
be able to initialize their own assistant without another person's identities,
credentials, private paths or business assumptions. Channels are optional adapters and support exactly the core `chat`/`chat-room`
conversation abstractions, with authenticated sender/conversation isolation.
DingTalk DWS CLI belongs in the optional channel plugin, never default core
composition, startup probes or core acceptance prerequisites. Preserve plugin
capabilities and report live vendor integration separately.
Each task has one execution session; no separate task Owner/coordinator or split
execution team. Topic dialogue and tool-free retrospectives are separate roles.
First-tier triage owns tentative quoted feedback and same-session steer intake,
with at most 15 messages per batch; overflow queues. Keep source/version links,
durable delivery deduplication and unknown-send readback.
Do not turn repetition counts into a universal gate for skill creation: the model
assesses evidence/value/applicability, including strong single-task lessons; program
code enforces scope, permissions, deduplication and traceability.

Use Node.js 24+ and pnpm. Install with `pnpm install --frozen-lockfile`.
Read `docs/MIGRATION.md` and `docs/VALIDATION.md` before changing runtime boundaries.
Pi core owns inference/tool iteration; Pi SessionManager owns durable history and
model context. The application owns authorization and side-effect receipts. Local LLM routing, live-agent ownership and tool execution are application-owned.
Production dependency graphs must contain no external registry DSH packages.
Local attributed audit/event/format/ACL compatibility is intentional; Pi remains
current context/history and inference authority. Preserve its guards, audit,
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
committed to Git. Version code, tests, rules and deliberate formal skill templates.
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
