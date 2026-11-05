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
