# Owned file/job tool contracts without original test packages (2026-11-05)

Replaced original-module equality tests with explicit file input schemas, literal
argv/path boundaries, UTF-8 preview vectors and public job state/output/privacy/
cancellation contracts. Existing actual Pi file/job wire, complete grep spill
readback and sandbox checks remain. Removed the three exact root dev declarations
and lock importer blocks for tool-fs, tool-fs-search and tool-jobs. Package/snapshot
bytes and overrides remain unchanged; Acorn parsed **931** files with zero retired
module imports. Tool implementations are unchanged and retain their notices.
**44 direct DSH dev declarations remain**; transitive test peers can still use the
original packages, so this is not full removal of the old development graph.

Standard frozen install with the supported task store passes all **630** supply-
chain checks in **8.3s**, followed by **655 default pass** with original root links
removed by pnpm. Focused **12 overlap** pass; Linux containment **20 pass / 1
Windows skip**, application bubblewrap enabled. Source/import/Pi-license/fork-hash/
diff guards pass. No network/policy changes. Evidence:
`docs/pi-native-owned-tool-contracts-validation.json`.

# Retired assistant-frame lifecycle removed (2026-11-05)

Runtime inventory found no consumer of the old assistant-stream publisher. Removed
its framing class, attempt/revision counters, start/settle/abandon/interruption
methods and start callback requirement. Pi message completion now directly appends
the same assistant audit records. The final Pi journal flush/authority check and
pre-tool commit gates remain. A frozen one-way observation exposes audit/content
facts, no frame publication or commit receipt API. Existing Night Bot compact audit
and backup codecs remain attributed and unchanged; this is not their rewrite.

Validation: **655 default**, **142 runtime**, **390 domain**, **47 routing** pass;
focused **22 overlap** pass; Linux containment **20 pass / 1 Windows skip** with
bubblewrap enabled. Runtime completed in ~321s. Real Pi read continuation checks
one tool result, two persisted assistant steps and actual file bytes in the next
request, with no obsolete frames. Tests also cover detached audit snapshots,
max-token tool suppression/replay alignment, retry, cold recovery and task archives.
Source/import/Pi-license/fork-hash/diff guards pass and reject reintroduced old
frame/stream bridge definitions. **47 DSH direct dev declarations remain**; no
package changes. Evidence: `docs/pi-native-attempt-observation-validation.json`.

# Direct Pi settlement of admitted output (2026-11-05)

Removed the general DSH stream bridge, shadow live observer and empty second
stream-consumption pass. Policy-transformed output is settled directly from the
already admitted application observation into one Pi terminal event. Unmodified
provider output keeps actual Pi events, response identity and signatures; changed
content drops native replay metadata. Failure/abort drops partial tool content.
The pure builder detaches content and accepts no source or dispatch callback.

Validation: **652 default pass**, **19 focused overlap**, **31 provider cold
recovery/archive/channel integration pass** (partly overlapping default). Tests
verify one provider invocation, no observer re-entry, policy delta redaction,
bounded capture, nested token separation and single failed terminal settlement.
Source/import/Pi-license/fork-hash/diff guards pass. No package changes; latest
frozen installation remains successful. **47 direct DSH dev declarations** and
attributed live-audit/message/session codecs remain; this is not full migration.
Evidence: `docs/pi-native-observed-settlement-validation.json`.

# Owned byte-ring process output capture (2026-11-05)

Replaced the inherited chunk-list collector with a private circular byte buffer
and lazy complete-output spooling. Allocation grows only with observed output up
to the byte limit; ingress/snapshots are copied. Cursor offsets describe the full
byte stream independently for each reader. Full files use exclusive owner-only
creation, short-write handling and fsync/seal; budget or I/O failure removes the
advertised full-file path and preserves the bounded tail. Root symlinks and unsafe
POSIX writable directories are refused before opening. The current provider-facing
constructor/method boundary remains internal while launch/termination is migrated.

Updated only the reviewed output module LF/CRLF restart fingerprints and the
corresponding core manifest; no dynamic source blessing or relaxed recovery gate.
The output source moves to historical replacement provenance; five other platform
files remain attributed forks and now have their hashes checked by the source
guard. **47 DSH direct dev declarations remain**; their notices remain. Bare
primitive callers retain a private OS temporary fallback; portable Host keeps its
existing owned spill directory. Ancestor-replacement TOCTOU and OS cleanup failure
limits remain explicit, not claimed eliminated.

Validation: **648 default pass**, focused **39 pass / 5 Windows-PowerShell skip**,
archive/channel/cold-job recovery **34 pass** (overlaps default), Linux containment
**20 pass / 1 Windows skip**, bubblewrap enabled. Independent byte-stream reference
covers 80 appends at six limits, all wraps/cursors, binary bytes and detached
snapshots; real process/PTY/descendant termination and complete-file readback pass.
Source/import/Pi-license/fork-hash/diff guards pass. No package/lock changes here;
latest standard frozen install succeeded in the preceding phase. Evidence:
`docs/pi-native-process-output-validation.json`.

# Owned Unicode output windows replace the retention fork (2026-11-05)

Replaced the 302-line retention fork with application text windows and detached
item snapshots, wired into job notices and grep previews. The implementation
selects whole Unicode scalars with exact UTF-8 omission counts, bounds stored
prefix/suffix contents and avoids iterating huge discarded middles in JavaScript.
Only string input is admitted; binary decoding belongs to each transport. Removed
unused generic formatting APIs, old comparison test, direct dev declaration and
the dedicated notice after removing all local retention implementation copies.
Inherited job/search implementations and their notices remain. **47 DSH direct
dev declarations remain**; this is a concrete helper rewrite, not full migration.

Validation: **642 default pass** both before and after successful frozen install,
**14 focused overlap**, Linux containment **20 pass / 1 Windows skip**, application
bubblewrap enabled. Independent reference selection covers every stream prefix
across 196 budget pairs, malformed surrogate chunks, exact omitted counts,
detached snapshots and a multi-megabyte discarded middle. Real Pi grep spill/read
and tool rendering tests pass. Source/import/Pi-license/diff guards pass. Frozen
installation after removing the dependency passes all **630** supply-chain checks
in **8.5s** with the standard writable store-dir option; no network/policy changes.
Evidence: `docs/pi-native-output-window-validation.json`.

# Frozen installation retry succeeds (2026-11-05)

`pnpm install --frozen-lockfile --store-dir /tmp/night-bot-pnpm-store`
completed successfully in **10.2s** using Node24.19.0/pnpm11.25.0. All **630** lock
entries passed supply-chain policy verification. The prior registry HTTP 503 did
not recur; no network route, proxy, trust, TLS, policy or credential changes were
made. A first bare command failed before verification because its default store
was outside the writable environment; the standard store-dir option selects the
same supported task cache used before. Lockfile and tracked source stayed clean.
This verifies the current workspace installation, not an empty-cache rebuild.
Earlier HTTP 503 records below are historical, no longer the current result.
Evidence: `docs/pi-native-frozen-install-retry-validation.json`.

# Explicit owned spill roots and retired historical discovery (2026-11-05)

Removed prior-default temporary-root discovery/scanning and fallback, plus empty
service/primitive wrappers. Spill now mounts as an ordinary native Cordis service
and requires an explicit absolute application root before publication. Host keeps
the same physical owned path. Root symlinks cannot redirect either writes or age
cleanup. Private modes, hashed session paths, exact UTF-8 bytes, safe encoding,
exclusive writes/fsync and admitted-write shutdown drain remain covered.

Retired the dsh-spill-local root comparison dependency and exact lock importer
block; **48 direct DSH dev declarations remain**. Independent encoding/storage
assertions replace old-service equality. Existing inherited IO/encoding/sweep
algorithms retain both notices; this is not an independent backend rewrite.
Trusted path IO still has an ancestor-replacement TOCTOU limit.

Validation: **638 default pass** with the old package root link absent (restored
in finally), **13 focused overlap**, **34 archive/channel/cold-job integration
pass** (partly overlapping default), Linux containment **20 pass / 1 Windows
skip**, application bubblewrap enabled. Source/import/Pi-license/YAML/diff guards
pass; Acorn parses 926 files with no retired spill-package literals. Package and
snapshot lock bytes are unchanged. No installation retry: known npm HTTP 503
remains. Evidence: `docs/pi-native-owned-spill-validation.json`.

# Six unused root protocol declarations retired (2026-11-05)

Removed root development declarations for jobs, ptc-runtime, spill, storage, fs
and session-persistence. Acorn parsed 926 files (including subpath literals) with
zero references; dynamic dispatch entrypoints were reviewed. Lock package and
snapshot bytes and all non-root-dev fields remain exactly unchanged. Nested
packages, local aliases and attributed source implementations/notices remain.
**49 direct DSH dev declarations remain**; this is root dependency retirement,
not complete removal of the corresponding inherited source protocols.

With all six root links absent: **636 default**, **142 runtime**, **390 domain**,
**47 routing**, **34 additional overlap** pass. Linux containment: **20 pass**,
**1 Windows skip**, application bubblewrap enabled. All links restored in finally.
Runtime suite completed in ~291s; its 32-continuation test passed in ~59s, not a
stuck process. Source/import/Pi-license/YAML/diff guards pass. No frozen install
retry; known npm HTTP 503 remains. Evidence:
`docs/pi-native-retired-protocol-validation.json`.

# Native permission preset test assembly (2026-11-05)

The retained group-session fixture now mounts the local permission preset service.
Explicit assertions cover initial permission facts, alias tie identity, idempotent
selection, custom knobs, live defaults, catalog, projection and command metadata.
Removed the old preset service root dev declaration and exact lock importer block.
**55 DSH direct dev declarations remain**. Implementation/notice and opaque command
identity are retained; no claim of independently rewritten algorithms is made.

Validation: **636 default pass** with the old root package link absent (restored
in finally), **36 focused pass**, **23 approval/authority/human integration pass**
(partly overlapping default). Acorn parsed **926** files with no old preset module
imports. Source/import/Pi-license/YAML/diff guards pass. No installation retry;
known npm HTTP 503 remains. See `docs/pi-native-owned-permission-validation.json`.

# Owned attachment contracts without old service dependencies (2026-11-05)

Replaced old-service differential tests with direct attachment contracts: verified
content digests and durable paths, exact streamed bytes, sanitized bounded names,
normalized dimensions and metadata, independent request variants/cache reads and
unchanged originals. Existing corruption, private modes, symlink refusal, shared
waiter cancellation, stream disposal, batch atomicity and compression bounds
remain covered. Geometry tests include explicit vectors and transpose symmetry.
Encoded-byte targets remain best effort at the smallest supported quality.

Removed the two root attachment development declarations and only their exact
lock importer blocks; snapshots/integrities remain intact. **636 default pass**
with both root package links temporarily absent, restored in finally; **390 domain
pass** and **15 focused overlap**. Acorn scanned **926** files with no attachment
package literals or parser failures. Source/import/Pi-license/YAML/diff guards
pass. **56 DSH direct dev declarations remain**. Existing attachment implementation
and its MIT notice remain; this is test dependency retirement, not a claim of an
independent attachment rewrite or fresh installation success. Known registry
HTTP 503 remains. Evidence: `docs/pi-native-owned-attachment-validation.json`.

# Explicit instruction roots and logical source labels (2026-11-05)

Removed the home-path library expansion and display aliases, including its skill
provider copy. Private instruction/agents roots require absolute native paths;
Host-owned physical locations and the standard `.agents` default are unchanged.
Fresh instruction source labels use `night-bot://` identifiers. Previously stored
Night Bot changes keep their logical scope without parsing old display paths;
context identity version 2 refreshes the model context. Public skillDirs retain
their existing installation-relative handling. This does not import DSH data.

Validation: **636 default pass**, **21 focused overlap**, **7 task-skill pass**,
**41 archive/channel pass** (partly overlapping default). Source/import/hash/Pi
license and diff guards pass. Historical instruction replay is covered using a
generated old-shaped audit fixture, not a cold external DSH archive. No fresh
install or new platform validation; the known npm HTTP 503 remains unresolved.
Removed only the home-path notice after removing its local implementations;
retained instruction discovery/rendering/reconciliation and watcher attribution.
Direct DSH dev declarations remain **58**. Evidence:
`docs/pi-native-home-protocol-validation.json`.

# Primitive identity shim removal (2026-11-05)

The nominal primitive-brand module consisted only of functions returning their
argument; it owned no runtime state, validation or authority. Inlined **20** such
calls while preserving argument evaluation and values. Removed the standalone
module, an embedded skill-tool copy and the fixture support import. Kept the
skill event-position safe-integer guard, actual private session publication and
live execution ownership checks. Per-domain data constructors remain unchanged
in value. The workspace reference fixture hash records this support-only change.
No source/test copy of the identity shim remains, so its dedicated notice is
removed; the remaining data/validation/controller source notices remain.

Validation: **634 default pass**, focused **52** overlap (session publication,
Pi authority/journals, owned job admission and workspace contracts). Source/import/
Pi-license/diff guards pass; scans find no primitive helper implementation/import.
See [primitive shim evidence](pi-native-primitive-brands-validation.json).
**58 DSH dev declarations remain**; no package changes or install attempts in this
phase. Registry HTTP 503 still blocks fresh package-policy verification. No new
platform claim or weakening of actual object/provenance checks.

---

# Ordinary application control services (2026-11-05)

The default Host never mounted a Typert Gateway, and production code did not
consume generic RPC owned-value/JSON carriers. Removed that unused protocol:
global structural DSH error/owned-value tags, method descriptors, invocation
accessor, Gateway bindings and optional agent lookup/context registration.
Preset, permission, model and subagent controllers inherit Cordis Service
with their existing ordinary control methods and machine codes. The independent
`ControlError` helper snapshots/freeze diagnostic data, preserves the original
cause and adds no transport/authority marker. Task/session/process ownership
continues through the existing private execution and journal mechanisms.

The 279-line source module and old RPC differential tests are gone; source and
retained-fixture scans find no remaining protocol implementation/copy. Removed
its dedicated notice only at that point; controller/prompt source notices remain.
**58 direct DSH dev declarations remain**. This does not claim the remaining
controller or platform algorithms are independently rewritten.

With the old RPC root link absent: **634 default +142 runtime +47 routing +390
domain +20 Linux containment pass**, one Windows-only skip. Focused **31**, error/
prompt **6** overlap default. Restored the temporary link afterward; no downloads,
package installation or policy bypass. Source/import/Pi-license/diff guards pass.
See [control-service evidence](pi-native-control-services-validation.json).
Fresh frozen installation remains blocked by registry metadata/attestation 503;
actual Windows kernel/ACL acceptance remains unverified. No push or deployment.

---

# Retired direct development declarations (2026-11-05)

Twelve further DSH declarations had only source-attribution comments rather than
complete package-name references in parsed JS/MJS/CJS. After inspecting dynamic
resolution, temporarily removed their root symlinks, ran regression with those
links absent, verified they were still absent, then restored every temporary
link. No dependency package contents or nested peers changed; no downloads or
policy bypass were used. Only root declarations/importers are removed; canonical
workspace overrides and retained peer snapshots stay. **59 DSH dev declarations
remain**. Source-derived implementations and their notices remain attributed.

With root links absent: **634 default +142 runtime +47 routing +390 domain +20
Linux containment pass**, one Windows-only skip. The first runtime run found two
failures from a test-host attachment row still using the retired home option;
changed that fixture to its explicit owned root and repeated all 142 runtime
cases successfully. Source/import/Pi-license/diff guards pass. See [dependency
evidence](pi-native-retired-deps-validation.json).

This is local negative dependency visibility verification, not fresh installation
acceptance. Registry metadata/attestation HTTP 503 still blocks successful frozen
package-policy verification. Actual Windows kernel/ACL acceptance remains open.

---

# Explicit storage and credential import removal (2026-11-05)

Credentials require an explicit `path`; attachments require `storageRoot`.
Portable/explicit-root Host supplies the same owned physical paths as before.
Missing paths fail before publishing a service; deprecated `dshHome` cannot select
storage. The generic DSH home resolver is removed. Flat credential documents are
refused without migration, lock creation or byte changes. Official Night Bot v1
refs/grants and backup paths remain supported. Two application credential writers
now verify concurrent refresh; workflow configuration/query tests use the real
application provider instead of the DSH provider. One direct declaration is
removed: **71 DSH dev declarations remain**. Remaining source/lock/normalization
attribution is retained; removing a default does not imply an independent rewrite.

Validation: **634 default pass**, focused **16**, earlier format/workflow **42**
(overlap recorded), domain **390 pass**, maintenance backup/configuration **36
pass**. Root refusal and unchanged foreign bytes, v1 grants, mutable-input
isolation, process serialization, comment retention, watcher replacement/deletion,
write ownership and cancellation pass. The new refusal test initially passed a
Cordis thenable directly to `assert.rejects`; wrapped it in an async function,
then the targeted and full runs passed. Source/import/Pi-license/diff guards pass.
See [storage evidence](pi-native-storage-roots-validation.json). The known registry
HTTP 503 package-policy blocker still prevents fresh frozen-install verification;
only the removed importer changed, with no new package version or integrity.

---

# Explicit dotenv directory (2026-11-05)

Environment loading no longer selects a user `.env` from `DSH_HOME` or `~/.dsh`.
It reads inherited/project layers and only an explicitly supplied user directory;
portable Host continues to pass its owned secrets directory. Omitting that
user directory does not turn the project into a privileged proxy/CA source.
Precedence, provenance, intentional empty values, immutable snapshots and
bootstrap rejection remain. No files or secrets are moved or materialized.
The differential launch-environment declaration is removed: **72 direct DSH dev
declarations remain**. Storage services still have separate legacy defaults.

Validation: **632 default pass**, focused **9** overlap; source/import/Pi-license/
diff checks pass. Lockfile syntax and the retired importer were checked; only
three importer lines were removed, with no new versions/integrity entries.
The known registry metadata/attestation HTTP 503 blocker prevents fresh frozen
installation verification; no policy bypass or alternative install route used.
See [environment evidence](pi-native-environment-roots-validation.json).

---

# Native-only restart plans (2026-11-05)

Restart isolation plans no longer select old DSH `profiles/web/node_modules`
providers or their rc.2 fingerprints. An explicit `dshHome` is refused rather
than silently converted to a native target. Maintenance proposals using that
field are rejected before reading history or running a probe; native proposals
use `runtimeRoot`. Native reviewed source identities, host identity/digests,
original-source exclusion and unknown-effect/no-replay requirements remain.
The native backend still contains attributed platform forks, which stay licensed.

Validation: focused **50 pass / 1 Windows-wrapper skip**; combined default,
restart HTTP and maintenance-backup regression **654 pass / 1 platform skip**,
with overlap documented. The new refusal test proves zero history/probe calls
and unchanged unknown ledger data for a legacy proposal. Source/import/license/
diff guards pass. See [native restart evidence](pi-native-restart-only-validation.json).
No actual Windows kernel acceptance or production probe execution is claimed.
No package changes in this phase; the registry HTTP 503 frozen-install blocker
from the preceding phase remains. **73 direct DSH dev declarations remain**.

---

# Execution facts cleanup (2026-11-05)

Shell metadata now publishes only `NIGHT_BOT_SHELL` and `NIGHT_BOT_SESSION_ID`
as built-ins, with `NIGHT_BOT_` declared extensions. DSH home/profile facts,
launch-home resolution and plugin-profile coupling are removed from the registry.
Bash/PowerShell pass `executionEnv` rather than a DSH-specific request field.
Ambient application and DSH namespaces are scrubbed from ordinary child inheritance.
Portable privacy admits standard facts only when explicitly supplied; arbitrary
extensions stay filtered. Facts are metadata, never job/session authorization.
Managed process cancellation, job receipts and sandbox enforcement are unchanged.
Four comparison-only direct dependency declarations are removed: **73 DSH dev
packages remain**. Retained shell/registry/process source attribution stays.

Validation: **631 default pass**, interface **15**, job **18**, fingerprint **11**
overlap default. Actual Linux containment **20 pass / 1 Windows-only skip**,
including both portable/explicit-root execution facts, background jobs, privacy
and code-worker confinement. An initial full run caught the process-contract
fingerprint change; reviewed the stronger ambient namespace scrub and pinned the
exact updated LF/CRLF source bytes, then repeated the full suite successfully.
Source/import/Pi-license/diff checks pass. Actual Windows acceptance remains open.

Frozen install **failed** with `ERR_PNPM_FETCH_503`: npm registry metadata/
attestation requests returned HTTP 503 and package-policy verification could
not complete. No policy was bypassed; tests used already installed dependencies.
Independent source checks do not substitute for a successful fresh install. See [execution facts evidence](pi-native-shell-facts-validation.json).
No push or deployment. General storage/environment default paths and the explicit
legacy restart-provider branch remain subsequent work.

---

# Instruction roots cleanup (2026-11-05)

Instruction discovery now uses explicit `instructionHome`, standard/explicit
`agentsHome` and project files. It no longer consults DSH environment variables
or implicitly reads `.dsh/AGENTS.md`. Portable Host supplies its existing owned
harness/agents folders, preserving Night Bot backup bytes and configured paths.
The global root is optional. Disabled reserved scopes never fall back to a
project-relative lookalike. Root identities participate in baseline identity,
so changing/removing roots refreshes the Pi context without rewriting history.
Old display labels are decoded only for prior Night Bot audit reconciliation;
they cannot select filesystem roots. The source remains an attributed fork.
Its differential-only direct dependency is removed: **77 DSH dev packages remain**.

Validation: **631 default + project-root cases pass** (630 pi-* plus one root
case); focused **9** overlap; archive/channel/task-skill integration **27 pass**.
The actual portable Pi wire loads owned global/project/nested instructions and
rejects external DSH environment roots, while retaining update/removal/cwd
reconciliation. The first full run identified an obsolete wire expectation that
DSH environment roots should load; replaced it with owned-positive and external-
negative checks, then repeated the full suite. Frozen install (`--ignore-scripts`),
source/import/Pi license and diff checks pass. See [instruction root evidence](pi-native-instruction-roots-validation.json).
General environment and shell facts still contain separate DSH home/namespace
contracts; no process/platform independence is claimed by this stage.

---

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

# Owned job journal stage (2026-11-05)

Pre-integration default tests: **602 pass, 0 failures**. Owned journal intent,
terminal persistence, cancellation, forged execution, capacity and cold no-replay
cases pass. Actual confined Linux shell background/promotion/environment: **3 pass**.
Recovery supplement: **79 pass, 2 skips**. See [stage evidence](pi-native-stage3-validation.json).
The application job namespace replaces DSH producer receipts; process/platform
proof requirements are retained. Frozen install and source guards pass. **83 DSH
direct development packages remain**. Windows kernel acceptance remains unverified.

Both task/channel Git refs are now fetched and hash-verified. Integration and joint regression are recorded in the newer checkpoint above;
older materialization failures below do not describe current Git availability. No push, deployment, main merge or CI.

# Pi native maintenance/publication stage (2026-11-05)

Current validation: **591 default +142 runtime +47 routing +17 Linux containment
passes**. One containment Windows-only case is skipped. Maintenance reader tests
and actual Pi cold recovery pass; focused repeats and overlap are recorded in
[pi-native-stage2-validation.json](pi-native-stage2-validation.json), not added to
these counts. Frozen install, source/import/provenance and diff checks pass.

This stage fixes offline maintenance Pi decoding, removes the foreign Session
publication bridge, ports runtime/routing test providers to local modules and
removes 65 unused direct DSH dev declarations. **84 remain**; full DSH independence
is unfinished. Windows producer-bound durable job evidence remains an explicit
implementation blocker. No application containment check was disabled.

The task/channel bundles were found in Library but supported materialization
failed before byte transfer with HTTP 401. They have not been hash-verified or
merged, and no joint integration success is claimed. No push/deploy/merge/CI.
See [PI-NATIVE-REBUILD.md](PI-NATIVE-REBUILD.md). Earlier entries below are historical.

# Pi native rebuild removal stage (2026-11-05)

Current removal-stage validation: 584 default Pi tests passed; 278 retained
historical adapter tests passed, one live-model case skipped. Source/import and
retired-code guards pass; frozen install with scripts disabled passes. This does
not establish full DSH independence: 149 direct DSH development dependencies and
source-derived runtime protocols/backends remain. See [PI-NATIVE-REBUILD.md](PI-NATIVE-REBUILD.md)
and [evidence manifest](pi-native-rebuild-validation.json). Older entries below
are prior-stage evidence, not results for this change. No push/merge/deploy/CI.

# Complete task archive acceptance (2026-11-05)

Baseline:47a59ae. Portable tasks now retain their transactional task snapshot,
materials and original attachment copies, editable work, frozen delivery files,
Pi execution session, own review/destination records and disposable tmp beneath
one task directory. SQLite stays runtime authority; archives are never command
inputs during ordinary startup. See [TASK-ARCHIVE](TASK-ARCHIVE.md).

Primary groups passed **599 own +142 runtime +47 routing +388 domain +19 Linux
containment =1195 distinct cases**, zero failures. One Windows-only containment
case is skipped. The final portable snapshot-maintenance/chronology changes were
followed by a full own-suite repeat and production repeat. The final paginated
API session-path correction repeated all9 task-archive cases and all55 production
cases. Reference groups still
exercise retained historical APIs; they do not imply the portable kit creates old
Owner/team sessions. Repeated focused cases are not counted again.

In the isolated, unchanged frozen production-only dependency installation,
current sources pass **55 cases**. **443 runtime/config files** match this tree
byte-for-byte; production graph audit finds zero external registry DSH packages.
No dependency or lockfile changes were required. Source guards:200 retained,
3 UI exclusions,31 explicit adaptations;380 JS files and175 declared bare imports;
zero external SDK imports/old orchestrator definitions; compatibility hashes verify.

New default-composition tests cover concurrent independent tasks, real native file
writes and frozen artifact descriptors, local Pi journal routing/commit validation,
review destinations, a real offline CLI check, exclusive/concurrent restore,
A-to-B restoration without shared attachment/memory stores, immutable originals,
corrupt bytes and link refusal, explicit lost-index reconstruction, paired index/
initialization-marker crash recovery, repeat recovery, operator acknowledgment and
explicit reopening in the same session without rewriting old effects or repeating
old reviews. Restored source messages, Topic facts and notifications cannot re-enter
live routing/send preparation. A filesystem fault in task.json proves completion
remains committed and archive maintenance retries after repair. Decision chronology
is preserved independently of command-ID lexical order.

Real Linux kernel tests enforce absolute-path and symlink/task boundaries, private
journals, Host-owned metadata/frozen output, task-local temp and capped-grep output
recovery inside the task archive. Namespace checks were not disabled; executor
escalation only allowed the project's own nested sandbox to run. File tools also
refuse forged output while permitting legitimate work artifacts. Startup does not
silently shadow existing central Night Bot task journals; explicit offline packing
validates owned single-task Pi bytes. No legacy plugin data import was added.

Task archives are offline exports of drained regular-file trees. They do not move
live processes, infer absent external-resource bytes, rebuild shared channel/Topic
runtime, restore whole shared memory/skill catalogs or reconcile unknown external
effects. Archived shared destination references can be absent in the new install.
Restore is paused and old deliveries remain held; operator attestation does not
prove business facts. Trusted plugin code is outside the model tool/process fence.
Archives contain private task/audit data even though the global credential vault is
not included. Windows/macOS equivalent process privacy and real vendor/channel
integration remain unverified.

Evidence/digests: [task-archive-validation.json](task-archive-validation.json) and
`evidence/task-archive-*`. No push, merge, deployment or real external message was
performed in this change. The separately reported channel commit c423629 is not
merged here. Earlier checkpoints below describe their own versions and evidence.

# Portable personal-assistant kit acceptance (2026-11-05)

Current application changes add the installation data layout, scoped Markdown
memory and task retrospectives, one execution session per task, typed `chat` /
`chat-room` ingress, first-tier tentative feedback and an optional DWS channel
plugin. The standard CLI now composes the channel-neutral application; it does not
construct the old DWS resident or require a DWS executable/account.

The full primary suites passed **590 own +142 runtime +47 routing +388 domain
+17 Linux containment =1184 distinct cases**, zero failures. One Windows-only
containment case is skipped. Historical runtime/domain contracts still exercise
retained reference APIs (including old execution-team APIs); they do not mean that
the portable kit creates those sessions. Portable Host/Pi/SQLite tests separately
prove the new default composition and single-session task behavior. After the full
run, a final custom-skill path fence was added; its affected layout/skill regression
repeated **11 cases**, all passing. These repeats are not added to the total.

The isolated production-only frozen install successfully built its known native
lifecycle dependencies. Build permission was scoped to that copy, with no root
lockfile/dependency/policy changes. Its actual production Host/Pi/SQLite/CLI repeats
**68 cases**, all passing. **439 runtime/config files** match this tree byte for
byte; the installed graph has zero registry DSH runtime dependencies. Source guards
verify200 retained modules/3 UI exclusions/29 recorded adaptations;376 runtime JS
files/175 declared bare imports;0 external SDK imports/0 old orchestrator definitions.

Key new evidence uses actual Pi HTTP requests to loopback scripted model endpoints,
not replacement task/memory/scheduler services:

- Markdown explicit remember/correct/forget, temporary preference refusal, literal
  retrieval, candidate extraction, concurrent writers, scoped grants, restart and
  derived-skill revocation. Model interpretation remains a judgment, not a fact.
- Durable completed-task review, valid evidence references, invalid-output failure
  isolation, replay deduplication and scoped skill creation without a two-task gate.
- One direct task session, local write/result, cold continuation, exact-effect replay
  refusal, cancellation/drain, personal/room scope and frozen reported-file delivery.
- Active first-tier arrivals steer the original session;15 messages admitted and16th
  queued; separately quoted Topic replies precede a deliberately held second tier.
  Cold continuation and lost send acknowledgment use readback without another send.
  Fixture timing demonstrates ordering, not real vendor latency.
- Private vault/environment loading, POSIX ownership/mode/link checks, actual model
  process/file privacy, three permission modes, own spill recovery and foreign-spill
  refusal. No sandbox check was disabled. Executor escalation was used only so the
  application's own nested Linux namespace runner could execute.
- A-to-B installation restore: Pi history/cwd, task workspace/artifacts, schedules,
  attachments and memory remain usable. Backup is offline, hash-checked, excludes
  secrets/cache/log/temp by default, and interrupted restores block startup.
- Disabled DWS does not register/probe anything. The optional plugin preserves
  authenticated sender, timestamp and source quote, and scopes its account paths.
  Standard application startup/task completion succeeds without any channel.

Unverified: real DWS login/subscriptions/reconnect/upload/download/operator routing,
live vendor-model judgment, business systems, Windows/macOS equivalent privacy and
long-running load. External-effect uncertainty deliberately stops replay and needs
operator readback; there is no general automatic reconciliation API. Secret detection
in arbitrary prose and semantic correctness of model reviews/replies are not
program guarantees. Logs/temp have explicit offline cleanup instructions, not an
automatic eviction policy. Direct raw CLI invocation retains the caller's OS temp;
the managed launcher scopes it. Trusted extensions retain service-account authority.

No old plugin-data import was introduced; this is a new project. Runtime data,
credentials and business artifacts are Git ignored. No real messages, deployment,
merge or new remote push was performed for this change. Only a local commit is
requested. No applicable repository `.agents/skills` skill was present.

Evidence and per-log digests: [portable-assistant-validation.json](portable-assistant-validation.json),
`evidence/portable-assistant-*`. Older checkpoints below are historical, not current
remote-write status or additional non-overlapping test counts.

# Default Host schedule acceptance (2026-11-05)

The default durable scheduler, ordinary cold-session controller and four model
schedule tools are now wired to native storage and Pi. This closes the real
`platform_native_schedule_unavailable` gap in the previously pushed `0c2e864`.
Calendar/record/update contracts retain explicit MIT attribution; no registry DSH
runtime package has been added. The platform bridge also avoids an extra recovery
input while the original acknowledged reminder remains queued.

Current primary groups: **545 own +142 runtime +47 routing +388 domain +11 Linux
containment =1133 unique passes**, zero failures. One Windows containment case is
skipped. The domain group includes channel-adapter contracts; it does not claim
live channel acceptance. The earlier 272-case channel-independent domain subset
passed before this fix; it is not added again to the total.

A fresh frozen production-only install, with dependency install scripts explicitly
allowed only in its isolated copy, repeats all **20 default schedule cases**.
415 runtime/configuration files match this tree byte-for-byte; the installed graph
contains zero external registry DSH packages. Source guard:200 retained/3 UI
excluded/26 recorded adaptations;353 JS files/169 declared bare imports; no old
model/tool/history orchestrator or SDK runtime import is reintroduced.

The new cases use the actual default Host, real Pi wire requests to a loopback
fixture, native file writes and separate CLI processes. They cover: due-time
execution; model-created reminders; cold/overdue restore; restart without duplicate
file effects; durable inbox/receipt/wakeup commit gaps; a busy driver racing the
receipt; explicit cancellation during that race; partially committed recurring
batches; recurring coalescing; six timing selectors, DST gaps/overlaps and cron;
exact-session ownership, optimistic edits, archive and delegated-session refusal;
preserved read-only permissions and session model; the retained platform bridge
with original and superseded source bindings. The fixture replaces external model
responses and channel delivery only, not scheduler/controller/Pi/persistence/tools.

A service inventory of retained core lookups is now checked against the real
Host. `nativeJobRecovery` is an intentionally optional trusted isolation authority;
its missing proof path refuses admission. It is not a hidden default dependency
or a reason to loosen unknown-effect reconciliation. Arbitrary optional plugins
still require their own integration acceptance.

DWS and other channels are independent integration scopes, not prerequisites for
this Linux core acceptance. Real vendor model judgment, live business systems,
production data migration/long-running load and Windows/macOS kernel behavior are
unverified here. No real messages/business writes, production deployment, merge
or CI were performed. Containment uses the AGENTS.md-approved executor escalation
so its own bubblewrap can run; application sandbox policy was not disabled.

Evidence: `evidence/schedule-final-*`, `evidence/schedule-production-wire.txt`, and
`evidence/schedule-core-regression.json`. Source provenance and adapted hash guards:
`schedule-source-manifest.json`. The records below are earlier checkpoints, not
current remote-write or acceptance status.

# Final native runtime validation (2026-11-05)

Primary groups:525 own +142 runtime +47 routing +388 domain +11 real Linux
containment =1113 unique passes. Disjoint supplemental files add39 context/session
compatibility and28 core restart-probe passes =1180 unique passes overall. The
restart target run's2 pi cases are already included and not counted again.
One containment Windows case and6 supplemental platform cases are skipped.

A fresh offline/frozen production-only install repeats364 core +38 contracts +3
real kernel =405 meaningful cases. Its full dependency graph contains zero
registry DSH packages.407 runtime files and package/lock/workspace configuration
are byte-identical. Source200 retained/3 UI excluded/25 explicit adaptations;
348 JS files/164 bare imports;0 external SDK runtime imports/0 old orchestrator
definitions;15 compatibility-source hashes and the owned worker verify.

Native restart probes now bind native managed-process/ACL source paths, reviewed
LF/CRLF hashes and the exact evidence digest. The explicit old layout remains
available without changing live-process/writer/listener/time/evidence refusal.
Linux PowerShell syntax/read-only probe portions and formal HTTP/drain cases
pass; actual Windows ACL/managed-job kernel and macOS remain unaccepted here.

Initial pnpm run wrapping hit the cloud's inaccessible default cache SQLite
location. An explicit task cache/store refresh corrected it; all check scripts
passed. No application permission, containment or dependency guard was relaxed.

No real DWS/vendor/business writes, deployment, merge or CI occurred. Previous
GitHub push403 was not retried. Parent-reported new-environment download policy
was not bypassed. Code completion and external acceptance are separate claims.

Final logs: `evidence/native-final-*`; structured counts: validation-results.json.
Earlier checkpoints and their limitations follow as history.

# 实际验证

**本页前半部分是 `b16ac53` 的基线记录。当前替换后的结果见末尾“原生状态服务替换后的验证”；不能沿用基线测试数充作当前代码的证据。**

环境：托管 Linux 云机，Node.js 24.19.0，pnpm 11.25.0，2026-11-04。源主干为 `93e431a2a76938d32aefc070b093fcfb65691c70`。测试均使用隔离文件目录、脚本模型或 loopback 模型端点、模拟 DWS，不发送真实消息。

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir /tmp/pnpm-store` | 通过，lock 可复现 |
| `pnpm test` | 12 项通过，核心 200 模块/3 UI 排除/1 明确适配/相对导入/静态 HTTP 路由守恒通过 |
| `pnpm test:domain` | 388 项通过，无跳过 |
| `pnpm test:routing` | 47 项通过，无跳过 |
| `pnpm test:runtime` | **142 项通过，0 失败、0 跳过**（最终整组复测，142331ms） |
| 产物隔离回归 `task-artifact-scope-native` | 6 项：1 通过、4 因宿主沙箱不可用失败、1 Windows 专属项跳过；不得算作通过 |

本地 HTTP wire 测试使用真实 pi-ai OpenAI 兼容协议解析和真实 PiLoopAgent，验证两次模型请求、一次实际 Host 工具调用和后续工具结果入模。CLI 测试实际启动 `bin/night-bot.js`，读取 `/health` 并通过 SIGTERM 正常退出。该协议测试不证明真实模型的自主判断质量。

原生服务测试覆盖 11 个执行成员、容量队列、共享资源、原会话续办、反馈消费、未知操作不重放、已完成文件交付不重做，以及冻结交付后的通知部分恢复。文件守恒不是行为覆盖的替代物，因此同时保留原测试，未删断言或改业务规则来凑通过。

## 修正与复测

初次迁移发现并修复：重复请求钩子导致日志步骤不闭合；Pi 二次 schema 验证提前拒绝 Host/Zod 默认值；隐藏工具尝试绕过原审计；技能刷新 context 在实际请求前未重采样。修复后分别运行原生服务、技能、角色限制和 wire 路径。

完整 runtime 第一次最终运行 141/142 通过，人工协调中“独立成员按原会话恢复”一次超时；单项及整个人工协调组复测通过。根因是测试仅将 Date 临时推进到重试时刻，恢复异步入场前又把时钟退回。测试现保留模拟时间直到原执行真正恢复并排空，保留业务、原会话、版本和不重放的全部断言；最终整组复测结果记录在下方。不能把单项复测冒充整组通过。

## 环境阻塞与未验证部分

- **shell 产物隔离：** DSH 的 sandbox provider 返回 `SANDBOX_UNAVAILABLE`，拒绝 unconfined 运行。云机虽然有 `/usr/bin/bwrap`，实际 `bwrap --ro-bind / / --unshare-user -- true` 返回 `setting up uid map: Read-only file system`。源仓库使用原 DSH 循环在相同依赖/云机上定点复测，返回同样的 `SANDBOX_UNAVAILABLE`，详见 `evidence/upstream-sandbox-baseline.txt`。本次没有改系统权限、关闭沙箱或以完整权限重跑这些测试。跨产物 root 的文件 API 拒绝与权限恢复仍有通过证据，但受限 shell 下完整产物隔离验收尚未完成。
- Windows/MSYS 专属项在 Linux 未执行。
- 未配置真实钉钉凭据、业务模型/数据库/Bytebase/GitHub/浏览器插件；真实群收发、真实自主模型语义、完整原生子代理业务、外部工作流、定时外发、Claude 后端和 Windows 部署没有验收。实现及配置接口保留，不能称这些能力已在生产验证。
- 无生产部署、数据迁移、合并或业务副作用。所有新代码仍需目标环境及实际 provider 验收。
- GitHub API `https://api.github.com/user` 返回 `Forbidden`；当前环境网络白名单不含 `api.github.com`，无法验证账号或创建草稿 PR。`gh auth status` 的“token invalid”提示不能单独证明凭据失效；Git 推送结果另行记录。

日志证据在 `docs/evidence/`（仅清理行尾空白），其中 initial 文件包含首次失败，刻意保留，不作为最终通过结果。当前实现仍有 DSH Host 依赖和单会话工具串行的吞吐差异，详见 MIGRATION。

## 最终收束

四组主验证共 589 项通过；产物隔离组另有 1 项通过，合计 **590 项通过、4 项环境阻塞失败、1 项 Windows 专属跳过**。最终运行时整组 142/142 通过，日志为 `evidence/runtime-final.txt`。源文件守恒、CLI/wire、领域与路由组全部通过；受限 shell 产物隔离的 4 个失败没有豁免。

远端写入预检 `GIT_TERMINAL_PROMPT=0 git push --dry-run origin HEAD:refs/heads/feat/pi-headless-runtime` 返回 `Permission to zzusp/night-bot.git denied to zzusp` 和 HTTP 403。该预检没有推送内容；未在相同证据下重试实际写入。草稿 PR 正文已保存在 `docs/PR-DRAFT.md`。远端创建分支/PR仍被阻塞；本地分支与 Git bundle 可交接给有写权限的环境。

## 原生状态服务替换后的验证

DSH 依赖审计见 `DSH-AUDIT.md` 和 `runtime-audit.json`。本轮替换 active JSON 域与默认模型服务，并分离生产与开发直接依赖；状态明确为 **部分迁移，尚非去 DSH 完成品**。

| 本轮验证 | 实际结果 |
|---|---|
| `pnpm test` | 20/20 通过；含 8 个新原生状态合同、真实 wire、CLI/HTTP 模型保存与重启读回；文件守恒 200 核心/3 UI 排除/3 明确适配通过 |
| `pnpm test:runtime`（新 native state Host） | 142/142 通过，0 跳过 |
| `pnpm test:routing`（新 native state Host） | 47/47 通过，0 跳过 |
| `pnpm test:domain` | 388/388 通过，0 跳过 |
| `pnpm test:containment` | 仍为 1 通过、4 `SANDBOX_UNAVAILABLE` 相关失败、1 Windows 跳过；未降低隔离 |
| 独立副本仅安装生产依赖 | 正常 frozen-lockfile/supply-chain 校验通过，461 包安装；未安装开发直接根 `dsh-base`、`dsh-app-boot`、旧 `dsh-agent-loop`、`dsh-storage-json`、`dsh-agent-default-model` |
| 生产依赖副本的 `pi-wire` / `pi-native-state` | 10/10 通过；包括实际 CLI 重启、模型 API 保存和实际 wire/tool 请求，不依赖完整测试 profile |
| `pnpm audit:runtime` | 生成明确的部分迁移报告，仍有 56 个生产直接 DSH 包；四个旧 active service 挂载已移除 |

主验证共 597 个用例通过，含 containment 的额外 1 个通过后合计 **598 通过、4 环境阻塞失败、1 Windows 跳过**。生产副本 10 项是重复环境验证，不叠加到独立用例数。最后一轮仅调整新存储的失败/清理错误合并，随后复跑了 20 项应用自有测试和生产副本 10 项；没有把这两个小组冒充重新执行全部 142 项。

首次尝试 production offline 安装时缺少 supply-chain 镜像元数据，因此失败，没有把后续缺依赖的测试当业务失败或通过。改用正常网络策略允许的 registry 在线 frozen 安装，校验通过；缓存只放 `/tmp`，没有绕过供给链校验、改变代理或使用另一身份。

新日志前缀为 `evidence/native-state-*`。JSON 域兼容原单文档格式，拒绝损坏、版本不符、重复进程内 writer 和符号链接；rename 后发生 I/O 不确定性时冻结 handle，避免旧内存继续覆盖磁盘。可选额外 per-record 插件布局未实现，明确报错，不能声称其已迁移。真正的 Pi 会话、工具/沙箱、凭据/附件、技能/子代理和 workspace 层仍待替换。

远端 403 拒绝未获得新的相关授权/凭据证据，**本轮没有重试推送或另换账号/环境**，也没有创建 PR、合并或部署。原始 bundle 仍保留，后续本地提交单独打包。

## Pi 权威会话阶段（本轮）

新日志实际由 `@mariozechner/pi-coding-agent@0.73.1` SessionManager 构造，物理格式为 Pi v3；模型输入 flush 后读取其分支，不再从旧 `deriveMessages()` 取得。`pi-wire` 测试把旧方法设为抛错，真实本地 OpenAI SSE 和工具往返仍成功；CLI/HTTP 重启保存模型测试继续保留。新 `pi-session-authority` 核验分支退役/完整审计、完整提交与撕裂尾部、完整记录篡改拒绝、读句柄不释放写权、无记录初始化可回滚、旧 v4 导入及写锁、路径链接拒绝、真实多模态字节以及旧运行时在 Pi 两次租约间改日志时拒绝恢复。`pi-replay` 核验原生签名、响应身份和异常/外来 replay 降级。

针对恢复与权限边界的二次代码审查发现并修复：打开失败须释放已取得的旧 writer fence；写入与清理错误必须共同保留且标记提交结果不确定；旧日志指纹不能只在首次导入验证；源 task log 递归扫描不得追入会在关闭时消失的 Pi 临时租约目录（仍拒绝目录项 symlink，由 Pi 校验 lease）；排空跟踪不能在异步释放容量前移除 promise。保留原容量/共享资源/恢复测试断言，权限纠正测试改为解码 Pi 原生 custom 审计事件并明确核对头版本3，不再假设旧物理日志格式。

检查范围限制：当前并未把旧 DSH Session/factory/工具权限/provider 兼容层移除，旧 v4 导入仍调用隔离的旧 JSONL reader/writer-fence 服务；未在真实钉钉或生产日志上操作。OS sandbox 的四项环境失败仍是实际阻塞，未放宽权限以通过。远端 push 未重试，PR/合并/部署均未发生。

恢复补充审查：旧图片日志导入在附件不可用时必须保留原日志、撤销 Pi authority 注册并释放两侧 writer fence；新增测试连续两次失败后仍可打开旧 writer，验证失败路径不会留下假活跃会话。native lease close 为幂等，清理失败仍保留原因。没有把这类失败当成工具已执行或可自动重试的证据。

本阶段结果：`pnpm test` 36/36、`test:runtime` 142/142（约221秒）、`test:routing` 47/47、`test:domain` 388/388；containment 1通过/4环境失败/1 Windows跳过，独立通过合计614。重复定向排查不重复计数。全量运行时回归已验证四种容量组合、共享资源队列、真实进程恢复、正常关闭与崩溃恢复不重放，失败过的旧物理格式断言及目录扫描竞态均已修复后重跑。

统一版本阶段：官方 @earendil-works core/SDK/pi-ai 1.5.0，`finishTurn` 正确保留结束/拒绝语义；本地49、运行时142、路由47均通过。新增13项原生 catalog 配置测试尚不表示 Host provider 已接管。上一0b7d6c2归档在独立克隆仅安装生产依赖后运行26项测试通过（重复验证，不与本地数量相加）。

## 本地 Pi provider 阶段

Host 已将旧 provider 插件替换为本地 `NativePiProvider`；旧 `dsh-llm-pi-ai` 仅留在开发依赖供历史/差分测试。实际调用 Pi Models.streamSimple，保留已有通用 LLM 中间件及审计协议，不声称这些剩余 DSH seam 已去除。生产 DSH 直接依赖55。

- 本地测试99/99；包含旧 provider 的公开接口差分，41个 catalog provider、1592个模型的目录、推理/控制/上下文更新元数据，以及 prepared call 的默认值一致（不调用厂商接口）。
- 实际本地 HTTP/SSE 验证 Completions、Responses 和 Anthropic Messages 的请求、鉴权头、文本、usage 和 replay；PiLoop 完整工具往返与 CLI/HTTP 保存后重启继续通过。新测试还核对 prepared call 固定一代 endpoint，后续请求采用新配置。
- 凭据/OAuth refresh 排他、未挂载存储不假装保存、非法/缺失 key、登录设备码/提示/取消信号、动态 catalog 诊断、模型覆盖、工具声明、图像预算/逐出现次数卸载、text-only 和只读文件路径、流超时/中止/审计失败、quota/rate/context错误分类均有隔离测试。测试没有真实 OAuth 登录、钉钉外发或生产写入。
- 运行时142/142（约223秒）、路由47/47。本阶段领域代码未变，领域388及 containment 1通过/4 OS环境失败/1 Windows跳过沿用此前单独记录，未混称新执行。
- 对恢复错误分类作了二次审查，修正 quota 必须使用既有 `QUOTA` 分类、显式 context overflow 表述、重复存储模型的目录过滤、text-only adapter直调拒绝图片、以及 audit observer 抛错不能让 native stream 永久悬挂。

真实厂商 OAuth、AWS/Vertex/Azure 环境、WebSocket 等外部后端尚未验证；静态 catalog/登录映射和本地协议验证不能代替它们。通用 LLM/chunk/附件策略兼容层、工具/权限/进程服务、工厂与 registry 仍待完整迁移；当时 OS sandbox 检查仍未通过，后续复核见下；远端403未重试。

沙箱阻塞复核：经执行器批准的只读 `bwrap --ro-bind / / --unshare-user -- true` 探测在外层包装之外退出0；同样批准范围内运行原 `pnpm test:containment`，5通过、0失败、1 Windows跳过（约6秒）。之前4失败来自外层包装只读 uid_map，而非应用或云机内核。没有改沙箱/权限/测试断言。

生产安装修复复核：首次 fresh `--prod` 验证发现 provider context 引用了仅开发依赖的 attachment 尺寸 helper。已改为本地 `pi-provider-image.js`（横/竖/极端比例与预算差分），并加入 provider 未挂载则启动失败的真实 Host 测试；新增脚本检查218个运行时文件的92处字面量 bare imports，防止开发依赖掩盖生产缺项。最终本地101/101；只安装生产依赖的隔离副本74/74（重复验证，不相加）。离线安装曾因 typebox 镜像元数据缺失失败，随后正常 registry 安装成功，未绕过权限或改变锁定版本。

## 本地工具执行链替换

Host 与任务测试均挂载 NativeTools，覆盖分层注册/限制、单调权限、审计、输出约束、取消排空及可选 PTC 并行/顺序提交。工具调用意图在副作用前 flush 到 Pi 日志，结果在交给下一轮模型前持久化；flush 失败禁止 dispatch。PTC 退出会排空已开始的执行与审计，拒绝未开始的工作，不自动重放。

本轮应用测试128、任务运行时142、路由47、领域388全部通过；containment在获准的执行器外层执行6通过/1 Windows跳过，共711项独立通过。实际 Node PTC worker验证工作目录写入、嵌套文件工具RPC、外部路径拒绝和空继承环境。回归运行时约272秒，较上阶段约223秒增加，反映新增持久化屏障成本；未做吞吐基准。最后的纯渲染与异常getter改动由定向测试及128项应用组覆盖，未冒充再次运行完整任务组。

仍保留 DSH scope/schema/event carriers、通用 LLM、进程/jobs/sandbox后端、附件/凭据及工厂等；生产直接DSH依赖仍55个。此阶段不能标记完整迁移。生产闭包检查221文件/101裸导入均已声明。远端403未重试。

全新独立目录仅安装生产依赖（frozen-lockfile、ignore-scripts），wire/CLI/state/Pi authority/NativeTools/approval及公开工具差分48项重复验证通过，不叠加711项独立用例计数。

## 本地后台任务注册表

NativeJobs 已替换 Host 和任务恢复 fixture 的 jobs-local。8项注册表用例包含旧公开契约差分、UTF-8输出环、归属/作用域访问、限额、wait取消、最终pump读取、observer隔离、owner关闭实际排空及取消抛错的孤儿不确定性。

本轮应用136、任务运行时142（约301秒）、路由47、领域388全部通过，containment 6通过/1 Windows跳过，共719项独立通过。全新仅生产依赖副本47项wire/state/authority/tools等及7项注册表定向测试通过，共54项重复验证；公开旧jobs-local差分仅在开发依赖环境执行。225个实际运行时文件逐字节与生产副本一致。最后只新增Host必要服务检查及wire构造类型断言，定向wire/注册表11项和生产wire3项复跑通过；未重跑整组142项。

pnpm因仅调整依赖分组曾尝试自动重装而命中不可写默认缓存/无TTY保护；改用既定/tmp缓存和正常frozen安装成功，再直接执行node测试。未把这些启动失败当业务回归。54个生产直接DSH依赖和7个已替换active服务见runtime-audit.json；剩余进程后端仍存在，不能标记全迁移完成。远端403未重试，未创建PR/合并/部署。

## 本地沙箱与进程后端

新NativeSandbox下原142项运行时回归先通过；接入本地源代码派生managed-process后，再次完整运行142项通过（约300秒）。最新应用154、路由47、领域388全通过，containment 8通过/1 Windows跳过，共739项独立通过；其中4项是尚未接入主循环的原生事件捕获原型单元测试，不能据此声称LLM桥已移除。

真实内核测试覆盖read-only/workspace-write的目录内外写入；真实process测试覆盖argv/取消、bounded output/spill/独立读游标、Linux私有0600请求一次性消费与execve精确环境、PTY输出与整会话关闭，以及直接命令退出后仍有后代、只有terminate并观测范围排空才能宣告退出。当前云机可能选择原先允许的fallback进程树管理；未把它宣称为用户systemd scope或Windows Job实机验证。

全新仅生产依赖副本71项重复验证通过，234个运行时文件逐字节一致。生产导入检查现递归扫描src子目录并检查literal lazy loads，共231个JS文件/118个裸引用，全部声明。进程平台实现保留原MIT来源、哈希与明确适配记录；不是复制代码就算完全去DSH。Windows ACL仍是生产依赖，真实Windows/macOS、外部供应商和真实钉钉均未验收。远端403未重试。

## 本地LLM与Agent registry、原生Pi事件

最新应用178项通过（含5项尚未挂载NativeProjections原型测试）、任务运行时142项通过（约277秒）、路由47、领域388通过、containment 8通过/1 Windows跳过，共763独立通过。先前原生事件切换142、NativeLlm切换142、NativeAgents切换142分别通过；审查修复“middleware只改delta仍须拥有输出控制”后再次完整运行最新142项，并保留三种本地真实协议与wire断言`pi-native`。没有将前序重复回归叠加计数。

独立仅生产依赖副本99项重复验证通过，238个运行时文件与最终manifest/lock逐字节一致；235个JS文件/125个裸引用全部声明。Agent类型/helper生产包为兼容既有RPC/子代理类型资源明确保留，故依赖数仍55；不把依赖分组变化冒充运行时迁移。NativeLlm的元数据/一次性call/热切换绑定/RPC标记与原实现公开契约差分通过，middleware拒绝与迭代清理错误仍按原边界传播。

NativeAgents验证创建期间卸载的顺序、失败回滚、相同id不同父实例隔离、ALS原Promise身份/排空/重入关闭、单工厂所有权、原id卸载以及事件scope/subject不可伪造。没有替换v4审计facade、Session/Projection服务及剩余权限/外部能力，也未做真实供应商或钉钉操作。远端403未重试。

## Session、Projection、策略与启动环境阶段

NativeSessions、NativeProjections、NativePolicy 均已挂载。自有测试195通过、完整任务运行时142通过、路由47通过、领域388通过、真实隔离8通过且Windows1跳过，共780通过。完整运行时是在策略挂载后执行；随后核心mode helper切换另跑31项相关回归，启动环境再以真实CLI与本地模型wire验证。未把子集测试冒充再次运行完整142项。

独立生产依赖副本重复验证116项（103核心/6沙箱/7后台任务），不叠加独立用例数。运行时代码241文件与副本一致；静态闭包检查238文件/130裸导入。保留200个核心模块，排除3个UI模块，6个核心模块明确适配。日志见evidence/native-session-policy-*，机器结果见validation-results.json。

SessionManager仍是Pi权威持久上下文；NativeSessions仍依赖原v4内存facade及publicationEntry兼容hook，未宣称完整去DSH。凭据、附件、部分工具/权限与skills/workspace等仍待替换。GitHub403拒绝未重试，未创建远端PR或合并。

## 原生凭据阶段

自有208、任务运行时142、路由47、领域388全部通过；加上上一阶段未更改隔离后端的8通过/1 Windows跳过，当前独立793通过。完整runtime274389ms在挂载NativeCredentials后执行；后续相同值提交确认与Pi auth取消检查以自有208/生产118最终复测覆盖，没有把小组冒充再次完整runtime。

全新生产依赖副本frozen安装通过，243运行时文件及manifest/lock逐字节一致；重复118通过（108核心+10本地凭据合同），不叠加独立数。旧credentials-local仅开发依赖，两个旧后端差分测试明确不在生产合同组选取范围，未以缺模块失败充作通过。静态闭包240文件/134裸导入；200核心/3UI排除/6适配守恒。

证据evidence/native-credentials-*。真实旧进程/新进程交叉锁、原子文件替换和删除、死PID恢复、未知锁拒绝、inode替换围栏、关闭排空、Pi入场取消、注释与0600、错误不回显秘密、损坏credential启动拒绝均有定点测试。授权会话服务本阶段仍保留；没有真实OAuth、供应商、钉钉或业务操作。远端403未重试，未提交远端PR、合并或部署。

## 原生授权会话阶段

自有225（其中17授权合同）、完整任务142（274331ms）通过；保留此前未改动领域388、路由47、隔离8通过/1Windows跳过证据，当前独立810通过。任务fixture不挂载authorization，本轮完整142是任务无回归证据；真实授权验收来自17合同、实际Pi Models登录和真实Host/CLI/wire。后加ALS提交观察归属和reentrant close改动经过最终自有225/生产138验证，未冒充另一次完整142。

全新生产依赖frozen安装通过，重复138通过（128核心/登录/授权，10本地凭据合同），244运行时文件及manifest/lock一致。静态闭包241文件/136裸导入。原生授权的差分、取消、close/drain、自注销、不误认其他writer和实际Pi SDK登录均经过验证。没有真实供应商OAuth或DingTalk副作用。日志evidence/native-authorization-*；仍为部分迁移，远端403未重试。

## 原生工作目录阶段

自有233（其中8目录合同）、完整任务142（273494ms）、路由47、真实隔离8通过/1Windows跳过；领域388沿用未改业务模块的凭据阶段证据。当前独立818通过。目录服务在root/preset/原生任务fixture均挂载后执行回归；随后增加required-service启动检查，以最终11项目录/wire/CLI测试覆盖。

全新生产依赖副本frozen安装通过，重复145通过（128核心+17凭据/目录合同），245运行时文件及manifest/lock一致。旧后端差分测试依赖开发包，明确不选择到生产合同组。闭包242文件/140裸导入；200核心/3UI排除/6适配守恒。证据evidence/native-directory-*。没有真实业务、外发或远端写入，403未重试。

## 原生附件阶段

自有247（含13附件合同与1实际Pi image wire）、完整任务142（278189ms）、领域388、路由47通过。隔离沿用未变的目录阶段8通过/1Windows跳过，当前独立832通过。所有当前运行时代码均在上述回归前已挂载，随后只新增审查断言与文档。

全新生产依赖frozen安装通过，实际Sharp codec不依赖安装脚本；重复156通过（129核心/实际图片wire +27凭据/目录/附件合同），249运行时文件及manifest/lock一致。旧backend差分依赖开发包，明确不选择到生产合同组。闭包246文件/142裸导入；200核心/3UI排除/6适配守恒。

文件引用/路径/流和PNG/JPEG/WebP/GIF、16-bit、alpha、orientation/metadata、normalization、请求衍生字节/variant身份有旧新差分；源原件immutable、摘要/计数、拒绝损坏去重覆盖、canon base64/批次先验证、暂存清理、暂停read关闭、共享取消和链接边界有实际文件测试。真实Pi SDK本地请求证明衍生图预算与原件不变。codec在Linux真实执行；Windows/macOS原生平台未真实验收，真实供应商、DingTalk和业务外部系统仍未触发。证据evidence/native-attachments-*；52直接DSH依赖/18活动服务替换是部分迁移记录。远端403未重试。

## 原生技能注册表阶段

自有257（其中10注册表合同）、完整任务142（273833ms）、路由47通过；沿用未变业务领域388及目录隔离8通过/1Windows跳过，当前独立842通过。NativeSkills在默认Host和任务fixture挂载后跑完整回归；后加closed provider-factory guard经最终自有257/生产166验证，没有冒充重新跑完整142。

全新生产依赖安装通过，重复166通过（139核心/registry+27本地凭据/目录/附件合同），250运行时文件及manifest/lock一致。闭包247文件/145裸导入。文件发现/watch仍是原provider，公开skill helper仍保留，不把注册表更换当作文件provider完成迁移。证据evidence/native-skills-*。52直接DSH依赖/19活动服务替换；远端403未重试，无PR/合并/部署。

## 原生技能文件与监听阶段

最终自有270、完整任务142（266347ms）、路由47通过；领域388与隔离8通过/1Windows跳过沿用未改模块的前阶段证据，独立855通过。全部运行时代码，包括registry卸载撤销与默认watch:true修复，均在最终完整142执行前完成。另一次早期142不冒充最终结果。

全新生产依赖frozen安装通过，重复178通过（141核心/registry/真实正文刷新wire+37本地合同），252运行时文件及manifest/lock一致。闭包249文件/149裸导入；200核心/3UI排除/6适配守恒。watcher派生文件与manifest hash一致，MIT notice保留。

11文件provider合同、11registry合同、真实Host外部metadata更新及真实Pi正文单独变更/提示/显式重读/旧审计提供证据。旧provider差分不选择到生产合同组。watcher在Linux执行，Windows/macOS实机未验收。51直接DSH依赖/20活动替换仍是部分迁移；无真实供应商或DingTalk副作用，403未重试。日志evidence/native-skill-filesystem-*。

## 原生工作区验证

最终own288/288、完整runtime142/142（270105.91513ms）、routing47/47均通过。沿用未改动domain388及工作目录阶段真实containment8通过/1 Windows跳过，共873个独立通过。新17项workspace合同与1实际Pi wire包含旧服务差分、canonical成员、header-only恢复、pending marker/回滚、观察一致性、关闭排空与归档祖先拦截。

全新`/tmp/night-bot-workspace-production`使用production frozen install显式ignore-scripts后复测159+37=196项通过，253运行文件及manifest/lock逐字一致；静态250 JS文件/152字面bare imports通过。首次未指定ignore-scripts的安装因pnpm拒绝未批准build scripts返回非零，未把该次安装当成功；没有批准或运行额外脚本，验证使用保留的预构建运行依赖。证据见`evidence/native-workspace-*.txt`。

生产DSH直接依赖51，活动服务替换21，仍非完整迁移。工作区旧包仅保留公开错误身份；权限/FS/shell/子代理及Session facade等仍待替换。没有真实业务调用、远端重试、PR或合并。

## 无界面授权与凭据刷新验证

最终own298/298、完整runtime142/142（261246.609146ms）、routing47/47通过；未改动domain388与原containment8通过/1 Windows跳过沿用，共883独立通过。新7项operator合同、1真实Pi外部写入wire、1引用锁前取消合同及配置校验验证隐藏输入/终端恢复、提前管道答案、EOF、取消、readonly引用、真实Pi API-key登录与注销、metadata-only输出，独立CLI进程不创建workspace/业务账本/agent或DWS连接。

全新`/tmp/night-bot-operator-auth-production`production frozen ignore-scripts安装成功，178+38=216项复测通过；256运行文件及manifest/lock逐字相同，静态253 JS/154字面bare imports通过。证据`evidence/operator-auth-*.txt`。真实vendor OAuth、外部业务系统未验收，不能以fake API-key登录证明真实账号已接通。51生产DSH直接依赖/21活动服务替换保持；尚未完成全迁移。远端403未重试。

## 原生提示组装验证

最终own304/304、完整runtime142/142（257019.419773ms）、routing47/47通过；未改动domain388和containment8通过/1 Windows跳过沿用，共889独立通过。六项新增合同涵盖旧服务差分、scope覆盖、tool rest/hidden-known顺序与schema副本、complete authority、required context准入和独立suppressor生命周期。实际Pi wire断言NativeSystemPrompt构造器；正文刷新和工作目录重采样复测通过。

全新`/tmp/night-bot-system-prompt-production`production frozen ignore-scripts安装成功，184+38=222项通过；257运行文件及manifest/lock逐字一致，静态254 JS/157字面bare imports通过。证据`evidence/native-system-prompt-*.txt`。旧公开render/interpolation及scope helpers仍保留，51生产DSH直接依赖/22活动服务替换，不以此宣称完整迁移。远端403未重试。

## 原生模型请求重试验证

最终own312/312通过；新增7个retry合同与1真实Pi wire，工具成功→模型503→重试成功，全程工具/收据仅一次，并在第三次HTTP到达前从Pi reader核对retry/started持久记录。两个flush栅栏、失败或非Pi日志、取消/关闭排空、self-close、normal/always/downstream预算语义有合同证据。

任务fixture本来不挂载llm-retry，本阶段未改它；runtime142（257019.419773ms）和routing47明确沿用提示组装阶段最终整组，不声称本阶段重跑。domain388及原containment8通过/1 Windows跳过未改动也沿用。合计897独立通过。

全新`/tmp/night-bot-llm-retry-production`production frozen ignore-scripts安装成功；显式排除只在开发存在的旧retry差分后，191+38=229项通过，258运行文件及manifest/lock逐字一致，静态255 JS/158字面bare imports通过。首次负向name筛选未正确排除开发差分，产生缺旧包的一项失败；改用Node实际支持的`--test-skip-pattern`重跑后全通过，未把初次失败计作通过。证据`evidence/native-llm-retry-*.txt`。

原timeout行仅为函数库空挂载，移除不计活动服务替换；它及旧retry根依赖移到开发，传递helper依赖仍可能保留。49直接生产DSH依赖/23活动服务替换仍为部分迁移。没有远端重试、PR、合并或真实业务副作用。

## 本地子代理 provider 验证

最终own316/316通过。新增3个provider合同包含spawn/fork旧实现差分及借用事件身份/独立数组；实际Pi wire在父会话第二轮等待响应期间创建两child，验证PiLoopAgent、各自Pi authority、night-bot preset继承、spawn无父内容、fork仅包含已完成轮次。两child都自然完成并排空。该实验不验证全部continuation manager或外部provider；旧manager仍明确保留。

任务fixture保留自己的显式provider挂载，本阶段未改，runtime142（257019.419773ms）/routing47沿用提示组装阶段最终整组，不声称重跑。domain388及containment8通过/1 Windows跳过也未改动；合计901独立通过。

全新`/tmp/night-bot-subagent-providers-production`production frozen ignore-scripts安装成功，193+38=231项通过；显式排除开发差分，259运行文件及manifest/lock逐字一致，静态256 JS/159字面bare imports通过。证据`evidence/native-subagent-providers-*.txt`。47直接生产DSH依赖/25活动服务替换，仍为部分迁移。远端403未重试。

## 工具并发行为补齐验证

最终own322/322、完整runtime142/142（254585.98239ms）、routing47/47（23196.666915ms）通过。真实kernel containment重新运行8通过/1 Windows专属跳过（11904.77414ms）；依据AGENTS许可只将测试执行移出外层executor，应用自身bubblewrap/权限策略保持。未改动domain388沿用，共907独立通过。

五项实际Pi批次wire验证cap=2、乱序完成但model顺序收据、每个body前持久intent、静态/动态独占屏障、拒绝与隐藏工具零效果、取消不补位且等started body退出、一个concluding工具等全部兄弟收据后结束。异常重复id协议路径不执行body，保留ToolNotStarted可纠正收据；隔离旧串行driver基线同样通过，不宣称支持该无效vendor输出。最初测试把scope自己注册的submission工具当作可限制的继承能力，实际guard正确拒绝测试配置；改为root注册/agent限制后通过，未更改或放宽guard。

全新`/tmp/night-bot-parallel-batch-production`production frozen ignore-scripts安装成功，199+38=237项通过；259运行文件及manifest/lock逐字一致，静态256 JS/159字面bare imports通过。证据`evidence/parallel-batch-*.txt`。47直接生产DSH依赖/25活动服务替换保持，旧continuation manager/preset/FS/shell/权限等仍在；仍非完整迁移。远端403不重试。

## 原生审批/权限预设与终态提交验证

最终own341/341、完整runtime142/142（268793.216627ms）、routing47/47（25347.880652ms）通过。真实kernel containment重新8通过/1 Windows专属跳过（14037.094362ms），应用隔离未降低；domain388未改动沿用，共926独立通过。

10个approval合同和6个preset合同含旧服务差分、借用身份/scope、open-turn/live-session、问答/决定双flush、append和journal失败不grant、晚答/撤销/服务owner卸载、自关闭与已准入提交排空；preset覆盖同bundle/custom/动态默认、seeded/partial pin、当前Auto/冷恢复gate、原型名拒绝及catalog/command/RPC。三项真实Pi wire证明逐操作授权只执行一次、缺answerer失败、取消审计先于turn/end、idle等待终态sink且失败后拒绝新消息。

取消wire初次发现Pi driver未刷新最终turn/end，修复后最终日志在idle可读；终态flush失败经agent/error报告并封闭该实例，不能把idle误当成功持久化。普通取消及权限拒绝仍保持闭合日志和零未授权效果。没有测试真正外部Auto reviewer或业务账号。

全新`/tmp/night-bot-approval-presets-production`production frozen ignore-scripts安装成功，216+38=254项通过；261运行文件及manifest/lock逐字一致，静态258 JS/166字面bare imports通过。证据`evidence/native-approval-presets-*.txt`。45直接生产DSH依赖/27活动服务替换，仍非完整迁移；远端403未重试。

## 原生 Shell 环境事实验证

最终own347/347、完整runtime142/142（269070.236306ms）、routing47/47（24063.696693ms）通过。真实kernel containment九项通过、一项Windows专属跳过（13900.908611ms）；domain388未改动沿用，共933独立通过。六项合同覆盖旧实现差分、原子注册、不可变权限声明、调用者scope、异步resolver拒绝与生命周期。实际Pi→Bash→应用沙箱验证可信session/home/扩展事实注入且ambient DSH authority被剔除，未关闭应用隔离。

全新`/tmp/night-bot-shell-env-production`production frozen ignore-scripts安装成功，221核心+38合同+1真实沙箱wire=260项复测通过。262运行文件及manifest/lock逐字一致，静态259 JS/168字面bare imports通过。证据`evidence/native-shell-env-*.txt`。44直接生产DSH依赖/28活动服务替换；FS/shell工具与capability后端、指引、preset注册表和子代理续办管理器等仍待迁移。远端403未重试，未创建PR或合并。

## 原生指引上下文验证

最终own354/354、完整runtime142/142（271945.803893ms）、routing47/47（36330.030087ms）通过。真实kernel containment九项通过、一项Windows专属跳过（15174.067728ms）；domain388未改动沿用，共940独立通过。六项合同包含旧loader/renderer差分、legacy surface访问即抛错、变更/删除、嵌套执行token、capability拒绝及关闭排空；真实Pi wire验证两个global root、项目baseline、真正read后的nested发现、外部修改、删除和cwd replacement。

全新`/tmp/night-bot-agent-instructions-production`production frozen ignore-scripts安装成功，227核心/wire+38合同=265项复测通过；本阶段未声称独立生产kernel重跑。263运行文件及manifest/lock逐字一致，静态260 JS/171字面bare imports通过。最初误在开发目录执行production裁剪，导致主测试缺少开发包且runtime/routing未启动；这些结果全部作废，恢复完整frozen依赖后重跑所有受影响组，最终证据仅引用重跑日志。证据`evidence/native-agent-instructions-*.txt`。43直接生产DSH依赖/29活动服务替换；仍非完整迁移，远端403未重试。

## 原生 preset 注册表验证

最终own364/364、完整runtime142/142（276320.298322ms）、routing47/47（26412.217702ms）通过。真实kernel containment九项通过、一项Windows专属跳过（13194.834498ms）；domain388未改动沿用，共950独立通过。六项registry合同/真实Pi wires及四项preflight合同验证保留旧generation/lease、精确parent继承、不可变声明、目录/RPC元数据、根服务泄漏与缺依赖/导入失败、Pi持久选择、首次turn后锁定、等待中启动竞态、失败实例封闭及新实例resume。兼容预检保留精确ABI/exemption、patched Include、循环/不可读Include诊断；不在预检中评估插件代码。

全新`/tmp/night-bot-native-presets-production`production frozen ignore-scripts安装成功，234核心/wire+38合同=272项复测通过。265运行文件及manifest/lock逐字一致，静态262 JS/183字面bare imports通过。证据`evidence/native-presets-*.txt`。42直接生产DSH依赖/30活动服务替换，source-derived算法明确MIT归属。仍非完整迁移；后续审查发现默认Host缺少旧manager冷恢复所需sessionQuery，尚未把该功能列为完整覆盖。远端403未重试。

## 原生子代理 manager / cold query 验证

最终own384/384、runtime142/142（273832.191419ms）、routing47/47（23866.063919ms）通过。任务夹具组合未改动；新默认Host manager/query的直接行为由11项实际Pi child-control wires覆盖，不能把142任务回归当作完整generic child功能验收。真实kernel containment九项通过、一项Windows专属跳过（15906.450825ms）；domain388未改动沿用，共970独立通过。另有6个query合同、3个旧helper差分，涵盖冷读revision/handle关闭、source冲突、取消/关闭排空及self-close。

真实wires验证cold continuation不重调provider/不重放已完成工具、目录/递归未知与不可用分支、父会话完成通知、结构化纠错、人工文本和有效/无效图片、request/time-zone归属、容量forest隔离、interrupt ack与工具退出分离、scoped forest drain、startup/terminal Pi commit失败及实际Host shutdown。人工图片错误从旧AttachmentError身份切换为本地错误及当前附件服务的封闭代码识别，保留attachment-invalid；图片正文进入真实Pi wire。测试最初误把父通知HTTP算入child重复请求，已按子内容/图片识别并显式验证通知，未禁用通知。外部provider仅fake run协议，非真实后端验收。

全新`/tmp/night-bot-native-subagents-production`production frozen ignore-scripts安装成功，250实质核心/wire+38合同=288项复测通过。首次筛选把全部排除的helper文件作为Node空harness计入1项；最终移除该文件重跑，不给空harness通过计数。269运行文件及manifest/lock逐字一致，静态266 JS/201字面bare imports通过。证据`evidence/native-subagents-*.txt`。43直接DSH生产依赖（新声明一个read-only格式helper）、31个活动服务替换；此前缺失query已恢复，但仍非完整迁移。远端403未重试。

## 原生会话标题验证

最终own392/392、完整runtime142/142（266058.478842ms）、routing47/47（24867.636413ms）通过；任务夹具已切换NativeSessionTitle。真实kernel containment九项通过、一项Windows专属跳过（11203.299369ms）；domain388未改动沿用，共978独立通过。七项合同含旧normalizer/lifecycle差分、pin/late-result、声明与来源seq验证、provider卸载排空、self-unregister/owner self-close；实际Pi wire证明只有一个request/header的两轮自动标题、固定后不覆盖、显式刷新与持久cold read。

全新`/tmp/night-bot-session-title-production`production frozen ignore-scripts安装成功，256核心/wire+38合同=294项复测通过；270运行文件及manifest/lock逐字一致，静态267 JS/207字面bare imports通过。证据`evidence/native-session-title-*.txt`。原生控制器仍保留canonical公开错误身份，43直接生产DSH依赖/32活动组件替换；不是完整迁移。同步rename保留append语义，未冒充同步fsync。远端403未重试。

## 原生 Web registry / HTTP 后端验证

最终own417/417、runtime142/142（259708.737601ms）、routing47/47（22725.408041ms）通过。真实kernel containment九项通过、一项Windows专属跳过（9843.013237ms）；domain388未改动沿用，共1003独立通过。新增8 registry合同、10 HTTP合同、2实际Pi/preset wires、5配置合同；包含旧协议差分、Scope卸载排空/自关闭、DNS/NAT64/private拒绝、固定lookup真实本地socket、逐跳重校验/关闭、响应/MIME/charset预算、代理委托、timeout/abort及late resolver禁止后续HTTP。低层connector使用显式本地fixture pin，不改变public provider私网拒绝。

真实Pi web_fetch/search证明意图在provider/transport前持久化、private请求无transport、结果/错误收据及不可信内容标记保留；旧工具默认不输出provider answer，HTML的markdown转义按原行为保留。旧/new night-bot preset并存验证HTTP为Host单例，避免全局重复注册。未对真实搜索vendor/外网服务验收。

全新`/tmp/night-bot-web-production`production frozen ignore-scripts安装成功，279核心/wire+38合同=317项复测通过；273运行文件及manifest/lock逐字一致，静态270 JS/215字面bare imports通过。证据`evidence/native-web-*.txt`。42直接生产DSH依赖/34活动组件替换，仍有generic tool timeout缺口及FS/shell/工具等后续工作；不是完整迁移。远端403未重试。

## 原生 Web 工具与协作超时验证

最终own429/429、runtime142/142（260962.880164ms）、routing47/47（24453.076894ms）通过。真实kernel containment九项通过、一项Windows专属跳过（10240.516272ms）；domain388未改动沿用，共1015独立通过。新增4超时合同、3Web工具合同、2实际Pi超时wire及3配置合同。验证旧schema/render差分、校验先于provider、精确去重和有序来源、输出截断、工具启用及安全timer界限。

实际Pi wire证明timeout发出取消后仍等待已开始且忽略取消的body退出，持久化一份超时收据后才继续模型，不重放effect；search配置budget同样作用于provider。祖先和本地timer具有相同公开错误码时用reason身份保持归属。协作超时不代表进程已经终止；后端仍负责自身排空。

全新/tmp/night-bot-web-tools-production frozen production ignore-scripts安装成功，290实质核心/wire+38合同=328复测通过；275运行文件及manifest/lock逐字一致，静态272 JS/220字面bare imports通过。证据evidence/native-web-tools-*.txt。41直接DSH依赖/35活动组件替换；补回此前未挂载的timeout策略不计旧组件替换。仍非完整迁移，远端403未重试。

## 原生目录、待办与子代理工具绑定验证

最终own436/436（21194.439809ms）通过；新增4合同和3实际Pi wire。验证完整todo替换/重复与并行状态拒绝/turn reset、目录精确caller与signal、稳定adjacent marker、cold send一次续办、外来send拒绝、absent interrupt接受无操作，以及模型实际delegation创建Pi child、父目录持久记录和return guidance。18项定向回归（含既有11 manager wires）通过。初次测试误用同步throws检查async defineTool、无inject属性访问和把parent参数中的marker算成child请求；修正测试后最终通过，未放宽运行时。

全新/tmp/night-bot-control-tools-production frozen production ignore-scripts安装，296实质核心/wire+38合同=334复测通过；279运行文件及manifest/lock逐字一致，静态276 JS/232字面bare imports通过。runtime142/routing47/domain388及真实kernel9通过1 Windows跳过因夹具与对应运行边界未改动沿用d78b96e证据，不声称本阶段重跑；独立覆盖共1022通过。证据evidence/native-control-tools-*.txt。37直接DSH依赖/39活动组件替换，仍未完成全迁移；403未重试。

## 原生技能工具与 Pi 目录可见性验证

最终own442/442（21525.140975ms）通过，新增5合同及1实际Pi wire。旧schema/输出差分、Session.surface访问即抛错、Pi目录重复抑制/变更/清空、malformed seed/writer缺失、精确registration shadow、invocation禁止/incomplete snapshot、直接user手势去重与scope均通过。实际Pi三轮证明summary不偷加载body、/wire-skill注入正文且无重复catalog/无tool effect、移除后空replacement。既有OS watcher body变更与显式重读wire也在7项定向组通过。

全新/tmp/night-bot-skill-tool-production frozen production ignore-scripts安装，301实质核心/wire+38合同=339复测通过；280运行文件及manifest/lock逐字一致，静态277 JS/236字面bare imports通过。runtime142/routing47/domain388/kernel9通过1 Windows跳过因对应边界未改动沿用d78b96e证据，不声称重跑；共1028独立通过。证据evidence/native-skill-tool-*.txt。36直接DSH依赖/40活动组件替换，仍未完成迁移；403未重试。

## 原生后台作业工具验证

最终own449/449（22936.492967ms）通过；新增4合同和3实际Pi wire。验证旧schema/render与UTF-8跨chunk保留差分、wait cap及caller signal、隐藏producer log/owner/offset、完成notice字节预算、连续唤醒预算/直接user重置和awaited/killed/teardown抑制。真实Pi验证增量与final result仅消费一次、awaited不重复唤醒、foreign read拒绝、kill先接受而producer仍stopping，以及空闲owner一次持久notice唤醒。首次wire有测试语法错误已修正；空闲完成测试使用观察等待而非jobs.wait，避免人为把其变为awaited并改变待验行为。

全新/tmp/night-bot-job-tools-production frozen production ignore-scripts安装，306实质核心/wire+38合同=344复测通过；282运行文件及manifest/lock逐字一致，静态279 JS/239字面bare imports通过。runtime142/routing47/domain388/kernel9通过1 Windows跳过因对应边界未改动沿用d78b96e证据，不声称重跑；共1035独立通过。证据evidence/native-job-tools-*.txt。35直接DSH依赖/41活动组件替换；仍非完整迁移，403未重试。

## 原生文件系统后端与观察策略验证

最终own458/458（24798.27982ms），新增7合同及2实际Pi wire通过。验证旧后端差分、CRLF/字节窗口/二进制拒绝、FIFO CAS仅一方成功、POSIX mode保留、真实watch与显式close、staging 0700/0600和取消后旧字节不变/暂存清理、只读及workspace外symlink拒绝、owner观察隔离与卸载清空。真实Pi七步验证unseen edit拒绝、read、外部修改后stale edit拒绝、重读、edit及新建write的六份收据；另验证read-only无授权写入/不擅自escalate。初次测试对原后端CRLF返回、umask创建mode、公开二进制错误码及workspace-write允许/tmp作了错误假设；依据固定源行为修正测试，未改或弱化guard。

真实kernel九通过/一Windows跳过（14650.772878ms），仅执行器按AGENTS升级，应用隔离保持。全新/tmp/night-bot-filesystem-production frozen production ignore-scripts安装，314实质核心/wire+38合同=352复测通过；285运行文件及manifest/lock逐字一致，静态282 JS/246字面bare imports通过。runtime142/routing47/domain388对应夹具未改动沿用d78b96e证据，不声称重跑；共1044独立通过。证据evidence/native-filesystem-*.txt。34直接DSH依赖/43活动组件替换；路径policy仍保留源实现已声明TOCTOU限制，非kernel代码隔离替代。403未重试。

## 原生文件/图片/搜索工具与完整结果存储验证

最终own468/468（34749.119749ms）、完整runtime142/142（279576.583687ms）、routing47/47（31850.046544ms）通过；domain388未改动沿用。真实kernel九通过、一Windows专属跳过（22115.634056ms），应用隔离未关闭；共1054独立通过。新增3文件/搜索合同、4spill合同及3实际Pi wire；12项定向组包含既有两FS policy wires。

实际打包ripgrep验证glob/grep、空格路径和invalid regex；schema/argv/解析/UTF-8 preview保留旧协议，--no-config及plain argv不经过shell，raw output丢失时不解析partial结果。图片wire发现条件子上下文没有声明fs注入，补齐attachments/tools/fs/workingDirectory后，真实图片字节进入Pi，PNG误标JPEG走原生附件错误纠正提示。先前仅成功构造工具不能当图片验收。

补回默认Host缺失spillStore；真实Pi grep251条保留内联250条，完整私有结果保存且read取回第251条。验证安全编码、0600文件/0700目录、会话symlink替换拒绝、active-root-only清理不影响其他旧根、同步写入和关闭排空/拒绝后续请求。初次symlink测试暴露旧存储写路径只做编码而跟随已替换session目录，本地实现增加root/session检查；保留普通可信路径祖先并发替换TOCTOU限制，不声称内核安全。新增服务是修复缺失，未计移除旧活动组件。

全新/tmp/night-bot-file-tools-production frozen production ignore-scripts安装，322实质核心/wire+38合同=360复测通过；288运行文件及manifest/lock逐字一致，静态285 JS/258字面bare imports通过。证据evidence/native-file-tools-*.txt。33直接DSH依赖/45活动组件替换；Shell wrapper/tool和v4 Session/inbox等辅助依赖仍明确保留，仍非完整迁移。403未重试，未推送/创建PR/合并/部署。

## 原生 Shell 执行/沙箱消费/工具验证

最终own476/476（27306.976154ms）通过，新增8合同。保留旧Bash/Pwsh argv/env/output/exit、工具schema/render与尾部marker协议；校验精确caller cwd/env/signal、background禁用和未声明escalation零执行、provider创建失败不重试。原生准备取消/超时等待已准入回调退出、禁止晚到argv spawn；同BASH_TIMEOUT码祖先先取消即使本地计时器随后触发也保留原因身份。准备忽略取消时不能谎称已经退出。PowerShell保留历史共享错误码，但未运行真实Pwsh/Windows。

真实kernel containment11通过/一Windows跳过（18724.509406ms）。新增两实际Pi/bubblewrap wire验证显式后台及timeout提升，一次受限效果、job_output收集、per-process facts释放且无多余notice；既有可信环境wire确认已切NativeSandboxBashExecutor。全新/tmp/night-bot-shell-production frozen production ignore-scripts安装，327实质核心/wire+38合同+3真实kernel wire=368复测通过；295运行文件及manifest/lock逐字一致，静态292 JS/271字面bare imports通过。

runtime142/routing47/domain388对应核心/夹具未改动沿用de10f64证据，不声称本阶段重跑；独立总计1064通过。证据evidence/native-shell-*.txt。28直接DSH依赖/49活动组件替换，默认Host已无DSH plugin row；仍保留数据facade与公共辅助库，不是完整DSH独立。初次smoke引用不存在测试名没有执行，随即改为现存真实Host wires并通过，不计失败命令为验收。远端403未重试。

## 原生纯值与工作账务辅助验证

最终own481/481（37307.449977ms）通过；新增4合同验证turn/inbox取消/claim/suffix旧折叠差分、跨realm和lossless JSON拒绝差分、getter单次读取/嵌套快照分离/字面__proto__保护，以及循环freeze保留AbortSignal可取消。17项定向组含真实child控制和tool timeout wires通过。Agent registry此前一个用例同时验证native与旧SDK；production移除旧包后初次筛选遇开发包缺失，已拆成独立Native协议验证与开发差分，重跑受影响own和production core；未恢复生产旧包或丢掉Native验证。

真实kernel11通过/一Windows跳过（20292.826325ms）；全新/tmp/night-bot-value-helpers-production frozen production ignore-scripts安装，329实质核心/wire+38合同+3真实kernel wire=370复测通过。298运行文件及manifest/lock逐字一致，静态295 JS/258字面bare imports通过。runtime142/routing47/domain388沿用de10f64对应未改动核心/夹具证据，不声称重跑；共1069独立通过。证据evidence/native-value-helpers-*.txt。25直接DSH依赖/49活动组件替换；纯helper不计服务替换，仍非DSH独立，403未重试。

## 原生代理策略、语言映射与环境声明清理验证

最终own488/488（41684.222031ms）通过；新增4代理合同及1实际Pi wire。测试打包原实现路由/child overlay/语言映射差分、嵌套direct恢复dispatcher和环境、unsupported scheme不泄漏合成凭据且保留child原值、真实认证HTTP CONNECT在无直接DNS下传输并等待响应后关闭。真实Pi wire证明public Web一次经proxy、loopback模型服务直连，ordinary child使用同一overlay，收据正常且无真实外部网络。

初次测试错误假设undici getGlobalDispatcher一定返回原Agent对象，实际可返回版本桥接wrapper；改为能力检查并用真实传输验证。私有地址测试恢复默认resolver而非用会抛错的测试resolver。生产首轮还暴露两测试文件静态导入已移到开发依赖的旧环境/策略模块；拆分Native协议验证和lazy开发差分，重跑own及production core，不恢复旧生产依赖，也不丢掉Native生产测试。最终14项定向组通过；此前HTTP完整合同组也已通过。

真实kernel11通过/一Windows跳过（18354.55915ms）；全新/tmp/night-bot-proxy-production frozen production ignore-scripts安装，333实质核心/wire+38合同+3真实kernel wire=374复测通过。300运行文件及manifest/lock逐字一致，静态297 JS/256字面bare imports通过。runtime142/routing47/domain388对应未改动核心/夹具沿用de10f64证据，不声称重跑；共1076独立通过。证据evidence/native-proxy-*.txt。20直接DSH依赖/49活动组件替换，纯helper和unused声明不计服务替换。仍非DSH独立；403未重试。
## 原生提示、RPC与凭据协议验证

最终own497/497（41847.722393ms）、runtime142/142（281725.314098ms）、routing47/47（36512.477477ms）、domain388/388（14164.301484ms）通过；真实kernel11通过/一Windows跳过（24952.60358ms），聚合1085独立通过。另有workflow-configuration/execution-configuration两文件16项通过，单列，不假定与历史覆盖无重叠而增加总数。

新增6提示/RPC合同及2凭据协议合同，验证严格变量诊断、literal/空context/不递归替换、新旧RPC元数据/结构错误/owned-value双向互读、一次dispose、detached版本描述符、scope参数与service namespace。结构错误协议按marker/code识别，原型复制后仍能识别；不使用instanceof作为判据。

Import guard发现核心workflow仍需双参数credentialKey，新增本地纯protocol，只改变该core import并记录第7处适配。16项已有配置回归和真实NativeCredentials保存/关闭/重开/秘密脱敏/轮换后旧run冻结版本测试通过；原始记录键不变。

独立/tmp/night-bot-prompt-rpc-production frozen production ignore-scripts安装，338实质核心/wire+38合同+3真实kernel wire=379复测通过；303运行文件及manifest/lock逐字一致。静态300 JS/251字面bare imports通过；源账200保留、3 UI排除、7显式适配，relative imports/HTTP routes闭合。证据为evidence/native-prompt-rpc-*.txt。17直接DSH依赖/49活动组件替换，仍非DSH独立；403未重试。

文档汇总脚本语法错误导致证据未随00f10d1代码提交；随后追加文档提交，运行代码未改变，以上均引用已完成的最终验证日志。

Native Scope authority (2026-11-05): 499 own +142 runtime +47 routing +388 domain
+11 real Linux containment =1087 aggregate unique passes; one Windows-only skip.
The 41-case dynamic execution file and 27 targeted Scope/CWD/workspace cases were
also rerun after test imports changed and are not added again. Independent
original-source fixture SHA-256 matches the source manifest; private graph/event/
store behavior agrees. All four retained SDK Scope peers share application
function identity. Fresh production frozen ignore-scripts install passes340 core
+38 contracts +3 real kernel wires =381 repetitions. Two initially missed test
only dynamic imports failed in production; both were corrected and their full
production groups rerun successfully. No failed run counts as passing.
308 runtime files and package.json/pnpm-lock.yaml/pnpm-workspace.yaml are
byte-identical; bounded static guard scans303 JS files/240 bare imports. Source
coverage remains200 retained/3 UI excluded/7 explicit adaptations; audit16 direct
DSH dependencies/49 active replacements/explicit local Scope compatibility alias.
See evidence/native-scope-*.txt. Migration remains incomplete; no real vendor,
DingTalk, Windows or macOS acceptance and no remote writes were performed.

Sandbox protocol extraction follow-up:502 own tests,41 targeted native execution
regressions and11 real Linux containment tests pass (one Windows skip). Existing
production frozen installation repeats343 core +3 kernel cases;309 runtime files
are byte-identical. This stage changes no dependencies; the preceding full142
runtime/47 routing/388 domain and38 production-contract baseline is explicitly
carried forward, not described as freshly rerun. Independent retained SDK helper
comparisons cover approval ordering/outcomes, narrow/equal/wider modes, writable
roots and runner failure attribution. Public SandboxUnavailableError identity is
reexported unchanged. Inventory remains16 direct DSH dependencies/49 active
replacements; helper extraction is not another service replacement. Evidence:
`evidence/native-sandbox-protocol-*.txt`.

Native message and stream protocol (2026-11-05):506 own +142 runtime +47 routing
+388 domain +11 real containment =1094 unique passes, one Windows-only skip.
347 core +38 contracts +3 kernel =388 production repetitions in the existing
frozen installation (dependency graph unchanged);310 runtime files identical.
Bounded import guard305 JS/216 bare imports; source accounting200 retained/3 UI
excluded/17 explicitly adapted. New source changes are message-constructor imports,
with original source hashes retained. Tests independently compare the original
SDK construction/assembly/compaction algorithms, including Unicode and original
timestamps, corruption rejection, detached immutable values and exact-object
request markers. Actual Pi wire/title/child/restore tests pass with local markers.
No legacy LlmRuntime is copied or delegated to; canonical errors, abstract adapter
and attribution helpers remain external.16 direct dependencies/49 active service
replacements unchanged. Evidence: `evidence/native-message-*.txt`.

Canonical capability errors and trusted namespace compatibility (2026-11-05):509
own +142 runtime +47 routing +388 domain +11 real Linux confinement =1097 unique
passes, one Windows-only skip. Fresh production frozen ignore-scripts install
repeats349 core +38 contracts +3 kernel =390;323 runtime files and manifests/
lock/workspace configuration are byte-identical. Guard310 JS/213 bare imports.
Four independent original service references retain their original error classes;
the title comparison was corrected to check each implementation against its own
constructor after a strict-prototype assertion caught that separation. No assertion
was weakened to name-only. All original public exports remain available through
explicit local aliases; an actual legacy HTTP provider throws the same WebError
constructor as the app before any network call.12 external direct DSH dependencies
remain,49 active replacements; no additional service credit for aliases. Source
accounting200/3/17 unchanged. Evidence: `evidence/native-capability-errors-*.txt`.

Filesystem/sandbox/skill/projection interface migration:513 own +142 runtime +47
routing +388 domain +11 real containment =1101 unique passes, one Windows skip.
Fresh production frozen install repeats352 core +38 contracts +3 kernel =393;
337 runtime files and manifests/lock/workspace are byte-identical. Guard316 JS/
211 bare imports; source accounting200/3/17 unchanged. Independent original
helpers/base/registry references retain their algorithms; public namespace export
vocabulary and actual SDK backend peer error constructors are verified. Production
Host checks the native skill alias via the retained ACL peer when development
root links are absent; private SDK Scope checks now apply to session/tools/
subagent, with skills directly importing native Scope.8 external direct DSH
packages remain,49 active replacements. Evidence: `evidence/native-interface-*`.

Execution public protocols:518 own +142 runtime +47 routing +388 domain +11 real
containment =1106 unique passes, one Windows-only skip. Fresh production frozen
install repeats357 core +38 contracts +3 kernel =398;350 runtime files/manifests/
lock/workspace identical. Guard323 JS/169 bare imports; source200/3/24 explicit
adaptations. All original public names remain available through native namespace
owners. Independent original Runtime references preserve private scheduler/request
markers; native aliases share their canonical identities. A retained Session SDK
peer shares native model error constructors, while forged errors still fail
strict HarnessError narrowing. Schema validators, TS/Python SDK renderers, error
facts, adapter API, custom attribution and secret-safe nonvisual guidance pass.
Only the legacy Session facade still needs an external private Scope peer check.
5 external direct DSH packages remain (Session, persistence base/JSONL/catalog,
Windows ACL),49 active replacements unchanged. Source algorithms MIT-attributed;
no claim of original authorship or completed migration. Evidence:
`evidence/native-execution-protocol-*.txt`.

Complete external SDK runtime dependency closure:523 own +142 runtime +47 routing
+388 domain +11 real containment =1111 unique passes; one Windows-only skip.
Fresh frozen production installation repeats362 core +38 contracts +3 kernel =403;
its complete package graph contains zero registry `@deepseek-ai/dsh-*` packages.
407 runtime files and manifests/lock/workspace match byte-for-byte. Guard348 JS/
164 bare imports; source200 retained/3 UI excluded/24 explicit adaptations.
Local compatibility covers only data/audit/publication/inbox, released v0-v4
format and import IO, and Windows ACL/process support; Pi remains current context,
history and inference authority. Independent original Store/private brands use
matching reference append helpers; strict receiver and ownership checks remain.
Original release-generated plain/zstd logs read unchanged. The new isolated ESM
verifier validates bytes/identity/count/prefix, rejects malformed requests and
excludes the old worker's bundled model Runtime. Eleven MIT source packages have
exact source/target hashes and import rewrites recorded. Real Windows/macOS and
vendor/DingTalk acceptance remain unavailable; Windows restart-scope provider
pins still need native binding review. Evidence: `evidence/native-legacy-*`.
