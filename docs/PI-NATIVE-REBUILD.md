# Pi native rebuild: first removal stage

Base: `feat/pi-headless-runtime` / `47a59ae318bf50ec85caa3b0af0ecd9a9a9841d6`.
This is a partial migration, not completion of DSH independence. This branch does
not contain the parallel channel/task changes and must be integrated with them.

## Verified Pi interface and current call graph

The installed, lock-pinned `@earendil-works/pi-{agent-core,ai,coding-agent}` are
1.5.0. The public declarations and implementation in the installed packages were
read directly. No assumption about a newer upstream version was used.

- `runAgentLoop(prompts, context, config, emit, signal, streamFn)` owns model/tool
  iteration. `getSteeringMessages`, `getFollowUpMessages`, `prepareRequest`,
  `prepareNextTurn`, and `finishTurn` are available. Steering polls after current
  tool calls finish; it does not cancel those calls. Hook contracts require safe
  results rather than thrown failures; application failures must explicitly fence
  subsequent admission and keep unacknowledged inbox records.
- `SessionManager.inMemory`, `newSession`, `setSessionFile`, `appendMessage`,
  `appendCustomEntry`, `appendCustomMessageEntry`, and `buildSessionContext` are
  used today. Pi also exports `appendContextEdit` and `appendCompaction`.
  A context edit changes content or omits one entry, not its role or source
  identity; it cannot blindly replace an arbitrary application event range.
- Pi file tools expose `ReadOperations`, `WriteOperations`, `EditOperations`,
  and `BashOperations` injection. Default local file/shell operations alone do not
  establish Night Bot workspace, symlink, secret, or process-containment policy.
  Replacement tools must use guarded operations and the actual OS sandbox.

Current default flow is application -> Host -> source-derived PiLoopAgent -> Pi
`runAgentLoop`; persistence -> Pi SessionManager -> piAuthority. Model history
is still projected back into an application/DSH-shaped message surface before
request preparation. This double translation and the old Session event facade
remain work, despite Pi already owning inference and durable context.

## Implemented

1. Removed DSH directory discovery, JSONL import, lazy legacy Context/backend,
   legacy writer fences and source-divergence handling from Pi persistence.
   Old directories are ignored, never converted, renamed or deleted. A missing
   Pi session stays missing. Former DSH-imported Pi journals explicitly fail
   `PI_SESSION_IMPORT_UNSUPPORTED` without modifying evidence. Night Bot's own
   Pi journal writes, checksums, branches, ownership, fsync, torn-tail recovery,
   portable backup and restoration remain in place.
2. Deleted local v0–v4 format converters/catalog, JSONL backend/verification worker,
   original bundled test reference and released plain/zstd differential fixtures.
   Deleted the two historical alias packages and overrides. Source guard retains
   hashes of retired files and rejects their reintroduction; surviving Windows
   and image-projection hashes remain enforced. Read-only session query imports
   the retained image projection directly instead of a historical format catalog.
3. DSH peer declarations are unsupported before plugin evaluation, including `*`
   and formerly matching versions. No historical compatibility.json exemption is
   read. Nested groups and patched Includes remain checked; Include files are
   not rewritten. Ordinary trusted application plugins are still admitted.
4. Removed six direct format-related DSH devDependencies and unused production
   semver. Removed the two standalone JSONL/catalog notices only after deleting
   their local source/test copies, plus directory-local notices with their
   deleted code. Other DSH notices remain because attributed code remains.

Historical harness tests that previously imported the removed local JSONL alias
now explicitly import their existing registry development package. They are
historical regression evidence, not proof of the new Pi default composition.
There are still **149 direct DSH devDependencies**, zero direct production DSH
dependencies, and 15 historical namespace overrides. Their complete removal has
not been achieved in this stage. Removing an override now exposes the existing
registry package to these historical tests; it does not add a production import.

## Remaining implementation sequence

1. Replace the DSH-shaped Session/message/inbox facade and derived loop lifecycle
   with Pi messages plus application-owned durable inbox, one task/session owner,
   delivery receipts, commit fences and audit records. Preserve lease/epoch checks,
   unknown-effect reconciliation and no replay. Port runtime/routing test hosts to
   the actual Pi Host so they no longer resolve `dsh-base` or original AgentLoop.
2. Replace DSH tool protocol/schema/RPC transport with Pi `AgentTool` definitions
   and narrowly scoped application services. Preserve pre-dispatch admission,
   cancellation/drain and side-effect receipts. Replace filesystem and shell
   backends using guarded Pi operations or independent implementations.
3. Replace managed process/Windows ACL/FFI and image/skill/credential algorithms
   only after independent behavior and kernel tests exist. Linux success does not
   accept Windows/macOS. `readNativeHistory` in `native-maintenance-drain.js`
   currently parses legacy v4 physical logs, not Pi journals; it must be replaced
   with a strict Pi-aware evidence reader before claiming Pi maintenance recovery.
   Do not loosen evidence matching or accept raw uncommitted journal tails.
4. Retire differential-only tests and reference fixtures after replacing useful
   behavioral coverage. Remove remaining DSH devDependencies, namespace packages,
   overrides and notices according to actual retained provenance. Source renaming
   does not count as a rewrite.
5. Integrate the independent task archive and channel branches. In particular,
   preserve channel commit `066f334121cf18442863e70059a7bf6ff216b6bc` capabilities:
   plugin discovery, authenticated DWS metadata, current Windows system account,
   and per-room/per-peer subscription scope. That commit is not assumed local.

## Validation boundaries

Tests use isolated directories, scripted/loopback models and fake channels.
Default Pi tests exercise actual Pi HTTP and tools; historical adapter tests do
not prove Pi-native architecture. No sandbox, symlink guard, secret guard or
process cancellation implementation was removed. No new kernel acceptance is
claimed because this stage does not replace those implementations. Live vendor
models/channels, business writes and Windows/macOS kernel behavior remain
unverified. No push, merge, CI trigger or deployment is authorized/performed.

Final default Pi group: **584 pass, 0 fail, 0 skip**. Eight retained historical
adapter files: **278 pass, 0 fail, 1 live-model skip**. These groups are disjoint.
All three source/import/provenance checks pass; frozen install passes with scripts
disabled. The historical resource-registration test initially failed because its
assertion matched only the old `already registered` wording; it now also accepts
the native `Duplicate tool` error while still requiring a thrown rejection, zero
write effects and a successful Host-bound read. No permission assertion was removed.

Evidence and hashes: [pi-native-rebuild-validation.json](pi-native-rebuild-validation.json).
