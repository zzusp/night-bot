# Official instruction resources without the retired publication loop

The installed runtime obtains AGENTS files through
`createOfficialHostResourceResolver().context.instructions`, the current actor's
controlled working directory, and `officialInstructionFiles`. Pi's public resource
loader, `before_agent_start` and `turn_end` extension hooks own prompt refresh.
There is no Night instruction message queue or parallel history authority.

This slice removes the unused `agent/pre-step`, `session/event`/turnBoundary,
legacy `agent.session`, inbox synchronization, publication-proof scan and deferred
projection/version-cache path from `native-agent-instructions.js`. The plugin no
longer injects `sessionProjections` or `piAuthority`. It records successful current
`path` arguments from read/read_window/write/edit results for the next official
resource refresh. Foreign/revoked actors and disposed observation owners fail
closed; failed or canceled calls do not discover instruction directories.

The attributed discovery/parser/renderer, bounded file reads, precedence,
per-directory duplicate suppression and UTF-8/framing behavior remain. No parser
or watcher is represented as an independent rewrite and the existing MIT notice
must remain. The legacy `file_path` observation alias is removed. Resource reads
have an explicit entry cancellation check before contacting the FS provider.

## Filesystem capability correction

Migration tests exposed a real resource-wiring defect: the official resolver
selected the mounted working-directory and instruction observer services, but
captured an inherited `actor.ctx` filesystem instead of the preset-selected FS.
These are distinct actual PrivateFileSystem implementations in the default Host.
A narrower preset filesystem could deny an instruction while the resource reader
still accessed its physical file through the inherited capability.

The resolver now captures the actual preset-selected FS, matching the file-tool
capability. If a preset selector exists but supplies no filesystem, resolution
fails; it does not retry through a broader inherited FS. Direct scoped compositions
without a preset selector still use their explicitly supplied scope FS. Provider,
model, reasoning, resume, credentials and retry selection are unchanged.

Real SDK regressions prove that a selected-FS denial prevents existing physical
AGENTS text from entering the prompt and that an admitted selected-FS stream is
canceled and joined before its actor writer closes. A separate negative test
rejects a missing selection before any fallback filesystem read.

## Exact former-contract disposition

The 13 tests in `pi-native-agent-instructions.test.js` are migrated in place,
without a second Session/projection fixture or a DSH historical-data import:

| Former test purpose | Current contract |
| --- | --- |
| Root precedence, duplicate suppression, byte budget and framing | Retained parser/discovery checks, unchanged algorithms. |
| Removal of a configured global root with old publication metadata | Current SDK refresh removes the actual owned file, retains current project instructions and ignores a project-global lookalike. Old DSH labels/baseline import are retired, not converted. |
| Baseline visibility plus file change/removal reconciliation | Actual SDK system context replaces/removes source content by rereading current authorized files. |
| Nested token aggregation and pending-inbox deduplication | Actual SDK read calls discover a successful nested path; failed and genuinely canceled calls do not. No parent-token inbox aggregator is recreated. |
| Capability-provider denial without raw FS fallback | Stronger actual preset-selected FS denial against an existing physical file; this required the production wiring fix above. |
| Shutdown abort/drain without late inbox publication | Actual actor cancellation waits for its blocked official resource stream, with zero provider dispatch. |
| Cancellation and providerless no-op | Entry cancellation does no provider IO; a providerless observer mount registers only the official tool-result observer, no old step/inbox lifecycle. |
| Relative/tilde private roots rejected | Retained direct discovery validation. |
| Context-edit publication proof | Real public Pi context editing cannot grant a removed file as a current system resource. Pi still owns ordinary user-message semantics. |
| Compaction, summary and branch publication proof | Real public Pi manager compaction/summary/branch operations do not authorize removed source files. No Night replay or history fold is added. |
| Missing writer/malformed old instruction projection | Exact current actor/lifecycle ownership replaces the retired projection dependency; foreign/revoked actors are refused. |
| Claimed-publication deduplication | Real reloads produce one current system resource, only the two authenticated original inputs, and no synthetic instruction business input/audit. |
| Old metadata/body mismatch proof | Current source authorization is file-based, not a historical metadata claim; an oversized current source is additionally rejected before SDK provider dispatch rather than silently truncating authority. |

The three existing `pi-agent-instructions-wire` variants remain: default official
file tools, explicit official read, and read_window. Each exercises actual nested
discovery, source update/removal and controlled cwd replacement in the official
prompt. No fake `steer`, publication surface or legacy event facade is introduced.

## Targeted evidence

- `/tmp/night-instructions-selected-fs-final.tap`: 35/35 migrated source contracts,
  original three wire variants, official resource/model-context and lifecycle tests.
- `/tmp/night-instruction-resource-model-routes.tap`: 16/16 resource tests including
  no broad-FS fallback, and five actual route/reasoning/default/cold-resume cases.

There are no skipped tests in these targeted results. They are not a full default
or runtime acceptance run. No package/lockfile/license/public manifest is edited;
the integration owner refreshes source hashes and runs combined acceptance.
