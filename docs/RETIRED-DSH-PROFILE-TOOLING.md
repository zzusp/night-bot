# Retired DSH profile tooling

Night Bot uses the official Pi runtime and its own installation/configuration
entry points. The following old operational entry points are no longer supported:

- `bootstrap-workflow-maintenance.mjs`
- `check-cutover.ps1`
- `configure-agent-query-resources.mjs`
- `configure-project-local-acceptance.mjs`
- `configure-release-targets.mjs`
- `configure-uat-schema-target.mjs`
- `reconcile-data-change-approval.mjs`
- `repair-release-target-policy.mjs`

These scripts configured the retired DSH resident/platform-host profiles, rather
than the current Night Bot CLI. No production source, package command or CI entry
imports them. Their private tests are retired, not reported as passing tests.
Seven dedicated suites (45 top-level test registrations) are retired, together
with two profile-writer cases in mixed suites. Mixed business suites keep their
independent policy/schema behavior tests; only
old profile-writer cases are removed. The unconsumed profile planning helper in
`deployment-integrity.mjs` is removed; artifact closure, backup validation and
other independent integrity helpers remain.

Historical acceptance snapshots and their source identities remain historical
evidence. They are not executable setup instructions for a current installation.
No existing installation data is migrated, deleted or changed by this cleanup.

## What remains, and why

- DWS is a current optional channel plugin, not the retired DSH runtime.
- Generic Cordis, schema and platform-addon dependencies still have consumers.
  They are not `@deepseek-ai/dsh-*` packages.
- Retained source-derived filesystem, network, credential, schedule and process
  adapters still serve current behavior. Their MIT notices and source manifests
  remain required. Removing attribution does not remove an implementation.
- Source-contract manifests, historical acceptance receipts and absence guards
  deliberately retain DSH names so that provenance and regression checks remain
  auditable. They must not be mistaken for installed runtime dependencies.

This cleanup does not claim replacement or retirement of every derived algorithm,
nor Windows, real-channel or deployment validation. Current Pi session/context
ownership and task cancellation, recovery, isolation and no-replay boundaries are
unchanged.
