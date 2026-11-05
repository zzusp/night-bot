# Skill roots cleanup (2026-11-05)

Skill discovery no longer reads implicit project/user `.dsh/skills` or roots from
`DSH_HOME`, `DSH_AGENTS_HOME`, `DSH_BUNDLED_SKILL_DIR`. It no longer imports the
legacy home resolver. Standard `.agents` and explicitly configured custom/bundled
roots remain; portable Host retains its installation-owned configured skill
folders. Existing Night Bot skill bytes and backup paths are preserved. No
external DSH files are migrated, rewritten or deleted. Scoped reads, bounded
watching, invalidation and cancellation remain enforced. The watcher source fork
still needs its notice. Its differential-only direct package is removed:
**78 direct DSH dev dependencies remain**.

Validation: **629 default pass**, focused **11** overlap default, native task
skills/service **58 pass**. Tests verify ignored DSH environment roots, unchanged
old file bytes, explicit precedence/invocation metadata and existing watcher/
permission behavior. Frozen install (`--ignore-scripts`) and source/import/Pi
license/diff checks pass. See [skill roots evidence](pi-native-skill-roots-validation.json).
Instruction discovery, shell environment and general environment home resolution
still have separate DSH root contracts and remain subsequent work.

---

# Tool comparison cleanup (2026-11-05)

The 3,712-line differential ToolRuntime fixture and unused content-tool fixture
builder are removed. All three execution reference copies (subagent, LLM, tools)
are now absent and guarded against reintroduction. Direct tool tests verify
scope-visible schemas, known-but-denied tools, body-entry fencing, invalid output,
pre-dispatch cancellation and constrained SDK declarations. Existing actual Pi
code-worker tests continue to validate dispatch and containment. Retained schema,
SDK and error algorithms still require the DSH tools notice; **79 direct DSH dev
dependencies remain**.

Validation: **629 default pass**, focused **6** overlap default, actual Linux
containment **19 pass / 1 Windows-only skip**. Source/import and diff checks pass.
See [tool cleanup evidence](pi-native-tools-cleanup-validation.json). No push,
deployment or claim of Windows kernel validation.

---

# Native model contract cleanup (2026-11-05)

The 2,397-line differential LLM fixture and unused DSH retry schema/resolver are
removed. Active request recovery continues through the owned Pi retry policy.
Tests assert immutable messages, exact-object request ownership, stream packing,
prepared-call adapter binding and failure facts directly. Provider catalog tests
now validate **41 providers / 1,592 models** against the pinned Pi SDK without
network model requests. The old DSH provider comparison dependency is removed;
**79 direct DSH dev dependencies remain**. Message/stream/error and provider
source derivations remain attributed, so their notices are retained.

Validation: **629 default pass**, focused **31** overlap default; native task
model/provider **17 pass**. Frozen install (`--ignore-scripts`), source/import
checks and diff checks pass. See [model cleanup evidence](pi-native-model-cleanup-validation.json).
This phase removes unused compatibility code; it does not claim the remaining
application message/audit/tool facades are all independently rewritten.

---

# Owned child catalog checkpoint (2026-11-05)

`src/runtime/child-catalog.js` replaces the recursive DSH chunk-list storage with
an application-owned flat page directory. Sealed 128-entry pages are shared;
appends copy only the pending page except at sealing boundaries. Checkpoint
schema version 7 validates full page sizes and bounded pending entries. Existing
Night Bot version 6 checkpoints rebuild from complete Pi audit history; missing
history refuses restoration. No DSH data importer is added. Inherited parent
catalog events remain excluded, and malformed own events cannot mutate state.

The 3,333-line subagent comparison fixture is removed. Direct behavioral tests
cover persisted depth floors, invalid/overflowing depth, current route/effort
inheritance, live preset metadata and immutable first-descriptor authority.
The namespace test no longer requires every old DSH export as a product ABI.
The dedicated chunk-list source and all test copies are gone, so its notice is
removed; notices for remaining source forks, including time-zone handling, stay.
Two differential-only direct dependencies were removed: **80 DSH dev packages
remain**. This is not complete removal of the subagent interface or event facade.

Validation: **628 default tests pass**; focused **13** and earlier control **18**
overlap default. Task archive/channel/provider-recovery integration **31 pass**
(overlaps documented). Actual cold Pi discovery retains 260 entries across page
boundaries without starting child agents or model requests. Guards, frozen
install with `--ignore-scripts` and diff checks pass. The first full run found a
dynamic obsolete-fixture import in an old export-compatibility test; the test was
updated to owned entrypoint/capability assertions, then the full suite passed.
See [catalog evidence](pi-native-catalog-validation.json). No push or deployment.

---

# Pi native integration checkpoint (2026-11-05)

Task archive `8fa47a255cfc8044b470bd8f104f89ed3211cc83` and channel
`066f334121cf18442863e70059a7bf6ff216b6bc` were fetched and verified against
explicit remote tracking refs. Local merge commits are `e2ea36d` and `7933b65`.
Archive merge conflicts in Host, Pi persistence, source provenance, coverage and
validation documentation were resolved around the shared strict Pi decoder and
Host-owned task routes. Channel conflicts in Host, provenance and coverage retain
discovery plus pre-evaluation DSH ABI rejection. No push/main merge/deployment.

Task journals publish temporary files and fsync in their actual routed directory;
route changes cannot redirect an admitted commit. Offline archive validation
requires complete physical commits. Maintenance resolves the protected task
ownership marker, verifies task/session identity and uses the same decoder without
historical DSH format discovery. Four added regressions exercise these boundaries.

The integrated default suite passes **623 tests**; runtime **142**, routing **47**
and domain **390** pass. Actual Linux containment passes **19**, with one Windows-only skip.
A former differential retry test now directly verifies bounded admissions,
chain identity, exponential delay, durable started records and budget reset.
Its seven cases pass after removal of its dedicated direct DSH dependency;
**82 direct DSH dev dependencies remain**. Attributed retry/process/protocol
sources remain and their notices are retained. Source/import guards and frozen
install (`--ignore-scripts`) pass; this is not fresh native-build acceptance.
Runtime long-suite completed with zero failures; exact logs and hashes are recorded
in the linked evidence manifest.

See [integrated validation](pi-native-integrated-validation.json). This remains an
incremental rebuild: event/message/tool facades, process/platform implementations,
legacy test-profile/release references and other differential tests still require
work. Actual Windows kernel/ACL and vendor CLI acceptance remain unverified.
No download, permission or Git blocker remains for the local integration.

---

# Pi native rebuild: owned job journal stage

Model-facing bash and PowerShell now admit jobs through an application-owned,
versioned journal. Registration is flushed before invoking the producer, and its
identity binds the exact live NativeTools execution and owning session. Random
job IDs avoid restart collisions. Pending asynchronous admissions reserve capacity.
Only an actual producer outcome may set `producerReported`; teardown cancellation
errors remain explicitly uncertain. Terminal persistence failure neither emits a
successful completion notification nor releases a successful wait. Journal/start
uncertainty never falls back to an unjournaled foreground command.

Cold Pi activation and single-task continuation refuse unresolved owned job
receipts. Physical committed evidence is inspected without recreating jobs or
replaying producers. Task side-effect intents also retain new journal uncertainty
codes. These fences do not supply a generic operator reconciliation API: missing
proof remains a block. Trusted in-process `jobs.start()` remains ephemeral; model
shell tools use `startDurable()` and do not borrow that API's lack of receipts.

Recovery consumers now accept the application `plugin:night-bot/job-*` namespace,
with version and original binding checks, rather than DSH producer event types.
The existing process-tree/source exclusion, ledger/digest, partial-effect and
no-replay requirements remain. Windows tests use the current application provider;
Linux does not claim validation of Windows process/ACL behavior.

Validation before integration: **602 default tests pass**; real isolated Linux
bash background/promotion/environment tests **3 pass**, checking one actual effect
and committed producer receipts. Recovery supplement **79 pass, 2 platform skips**.
Additional focused runs overlap these groups. Source/import guards and frozen
install pass. See [pi-native-stage3-validation.json](pi-native-stage3-validation.json).
One differential-only jobs package declaration was removed; **83 direct DSH dev
packages remain**. Existing attributed shell/process/schema code still needs its
notices. This stage is not a claim of complete DSH removal.

The two integration refs have now been fetched and verified through Git:
`origin/feat/task-archive-portability` -> `8fa47a2`,
`origin/fix/channel-plugin-runtime` -> `066f334`. The earlier Library download
blocker remains an historical fact; it is no longer blocking local integration.
No remote push, main merge, deployment or CI trigger is part of this work.

---

# Pi native rebuild: maintenance and publication stage

This stage continues `d2e148e`; full DSH independence remains unfinished.

- Live persistence and offline maintenance share `runtime/pi-journal.js`. Offline
  evidence reads exactly the task router's Pi filename and location; it never
  discovers v4 logs or repairs tails. It validates Pi identity, tree, provenance,
  event sequence, each commit checksum/count, complete physical bytes and stable
  file identity. Both ancestor links and file symlink/hardlink aliases are refused.
  Process identity, original ledger/binding/operation digests and no-replay checks
  remain. The reader uses the router's exported path helper so task-layout changes
  can be integrated without another hardcoded storage layout.
- Portable path decoding is an explicit argument shared with live inspection.
  Missing decoding refuses the proof; relocation does not rewrite user text or
  opaque effect receipts. The task service passes its installed path codec;
  offline inspectors accept that same explicit codec.
- Local session publication is now a private application capability. Foreign or
  prototype-forged Session facades cannot attach. Public method overrides cannot
  redirect accepted events, and committing an accepted event is private. Detach,
  reentrancy rejection, observer containment, sealed instances and flush/drain
  behavior remain tested. The Session event/folding protocol is still derived
  code, not a completed rewrite; its MIT notice remains.
- Removed the independent original Session fixture and dead original code-tool /
  tool-result pipeline implementations. The active application code transport,
  schema validation, tool admissions, durable dispatch barriers and cancellation
  were retained and tested, including real isolated Node worker execution.
- Main runtime/routing test hosts now mount local filesystem, shell, job, skill,
  policy and Pi modules. They do not resolve a DSH profile. Historical Windows
  rc2 substitution was removed. Windows producer-bound durable job evidence is
  still absent in NativeJobs; the Windows acceptance cases explicitly remain
  blocked, rather than substituting a different provider to claim support.
- Default Host plugin rows now pass the same manifest/Include preflight as agent
  presets. DSH package identities are refused even without declared peers. An
  actual Host test proves rejected plugin code never evaluates.
- Removed **65 more direct DSH development declarations**, leaving **84**. This is
  declaration cleanup, not removal of all transitive development packages. The
  installed production graph has 278 visited nodes and zero registry DSH packages.
  Spawn/fork tests now assert application behavior directly instead of loading
  removed original provider packages solely for parity. Source-derived algorithms
  and corresponding notices still remain elsewhere.

Validation: **591 default, 142 runtime, 47 routing and 17 Linux containment pass**.
The containment group has one Windows-only skip. Maintenance regressions add
33 passes and one platform skip, but include six cases already in the default
count; focused repeats are not additional coverage. Actual Pi cold maintenance
recovery also passes without a further model/tool run. Frozen install, source
accounting/import/provenance guards and diff checks pass.
Evidence: [pi-native-stage2-validation.json](pi-native-stage2-validation.json).

Integration remains blocked: Library metadata resolved both requested bundles,
but the current supported Library download helper failed before transferring any
bytes with `hosted apps tools/list request failed with HTTP status 401`. No raw
URL fallback was used, no bundle hash/validity is claimed and no merge was attempted.
The required task/channel commits remain `8fa47a2` and `066f334` from baseline
`47a59ae`. Their product behaviors still need joint regression after retrieval.

Next work remains removal of the DSH-shaped message/event facade and LLM adapters,
Pi AgentTool-native definitions, remaining historical test hosts and namespace
aliases, then independent process/platform/ACL implementations with real kernel
proofs. In particular, current NativeJobs does not provide producer-bound durable
job evidence for the reviewed Windows probe. It must continue to fail closed.
No live vendor/channel acceptance, push, merge, CI or deployment was performed.

---

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
