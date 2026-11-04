# Night Bot

Use Node.js 24+ and pnpm. Install with `pnpm install --frozen-lockfile`.
Read `docs/MIGRATION.md` and `docs/VALIDATION.md` before changing runtime boundaries.
The Pi loop owns inference/tool iteration. The retained Host owns authorization,
side-effect receipts, session format, cancellation/drain and recovery. Do not bypass
Host tool dispatch or relax sandbox checks to make a test pass.
Preserve existing target files and never copy credentials or live business data.
Tests use isolated directories, scripted/local model endpoints and fake DingTalk.
Do not send real messages, deploy, merge, or trigger CI without explicit authorization.
Use `pnpm test`, `pnpm test:runtime`, `pnpm test:routing`, and `pnpm test:containment`
as appropriate. Report skipped/blocked checks separately from passing checks.
