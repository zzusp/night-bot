# Mutable Session implementation retirement

The generic Session class, surface manager/event log, fork seed builder,
publication store and session namespace re-export are removed. No production
module imports them after native-only persistence and business-edge migration.
The old v4/generic-event fixtures were implementation copies, not the supported
format of Night's current backups; no converter is retained or introduced.

Official Pi AgentSession/SessionManager remain the sole conversation, context,
branch, compaction and message implementation. Night keeps its strict native
journal/commit envelope, typed business state, path bindings, writer leases,
authorization, archive manifests and unknown-drain/no-replay restrictions.
Existing native metadata header version 4 is preserved as application metadata;
it does not re-enable a Session-event format.

The removed pi-native-sessions tests exercised that cancelled store's own
created/event/disposed callbacks, append reentrancy, snapshot/fork ABI, stale
preparations, sealed-facade reattachment and publicationEntry hook behavior.
Those APIs are explicitly retired, not claimed migrated or passing. Relevant
current ownership/safety contracts remain in pi-native-agents (strict real SDK
identity and metadata, publication ownership/lifetime), pi-official-session and
factory failure/kernel tests (commit-before-effect, startup/disposal fences),
pi-native-store and pi-native-storage-boundary (strict committed prefix, writer
lease, immutable borrowed audit evidence, no generic lifecycle event sink), and
application session catalog tests (actual live/stored headers and conflicts).
Pi's public context edits/branch/compaction retain original source entries in the
native storage tests; the old child Session fork-seed metadata contract has no
current product caller and is not recreated.

pi-native-execution-protocols no longer asserts the deleted Session namespace
ABI; canonical current model errors/tool validation assertions remain. Three
official business-policy/job fixtures and the actual group coordinator fixture
stop constructing the unused Session/projection services. The group coordinator
retains its genuine SDK attempt, 15-source batching, source/file identity,
read-only tool, cold recovery, cancellation and >32 feedback contracts.

Projection registry retirement followed the final instructions consumer migration
and removed the Host/application service declarations. No projection shim keeps
the old class surface available.

## Generic audit projections

`NativeProjections`, its capability re-export and `pi-native-projections.test.js`
are retired after the final instructions consumer moved to official resources.
Their registration, mutable checkpoint, fold replay and generic event ABI are
removed contracts, not passing equivalents of Pi history. Current business
receipts use private native actor ports and strict committed audit snapshots;
`pi-business-state`, `pi-native-storage-boundary`, `pi-session-authority` and
`pi-maintenance-journal` retain snapshot detachment, strict prefix/tail,
checksum and ownership verification. Official projection ordering and provenance
remain covered by `pi-native-store` and official-session tests.

The Host no longer installs a projection service; `pi-wire` asserts its absence.
