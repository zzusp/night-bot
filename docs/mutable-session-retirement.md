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

Projection registry retirement is a separate coordinated step: its last old
instruction consumer and Host/application service declarations must be removed
before deleting the registry. No projection shim is installed to keep the old
class surface available.
