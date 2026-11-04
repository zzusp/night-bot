# Night Bot

Use Node.js 24+ and pnpm. Install with `pnpm install --frozen-lockfile`.
Read `docs/MIGRATION.md` and `docs/VALIDATION.md` before changing runtime boundaries.
Pi core owns inference/tool iteration; Pi SessionManager owns durable history and
model context. The application owns authorization and side-effect receipts. Local LLM routing, live-agent ownership and tool execution are application-owned.
Retained session facades, permission/filesystem wrappers, platform ACL,
credentials/attachments, skills and workspace interfaces still require migration: preserve their
guards, audit, cancellation/drain and no-replay contracts when replacing them.
Do not bypass dispatch policy or relax sandbox checks to make a test pass.
The cloud executor wrapper makes nested UID maps read-only; containment tests may
run with approved executor sandbox escalation so their own bubblewrap works. This
is not permission to disable the application sandbox.
Preserve existing target files and never copy credentials or live business data.
Tests use isolated directories, scripted/local model endpoints and fake DingTalk.
Do not send real messages, deploy, merge, or trigger CI without explicit authorization.
Use `pnpm test`, `pnpm test:runtime`, `pnpm test:routing`, and `pnpm test:containment`
as appropriate. Report skipped/blocked checks separately from passing checks.
