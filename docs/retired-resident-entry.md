# Retired predecessor plugin entry and artifact adapters

`packages/dingtalk-core/resident.js` was an unused predecessor plugin entry:
`name`, `inject`, `apply` and the internal group-configuration bootstrap. No
production module imports it. Its `configureResidentGroups` export had no external
caller. Configuration maintenance scripts containing its historical module name
are not module loaders and have not been rewritten as part of this retirement.

The production entry is `src/application.js`: it composes the current Host,
channel-neutral application, task service and existing `http.js` route handler.
Retiring the plugin does not retire HTTP routes, Topic functions, task recovery,
credential records, transport history or task notifications. The actual Host test
`test/pi-resident-retirement.test.js` checks health, retired workflow HTTP 410,
rejection of workflow variable mutation, retained credential bytes and zero model
requests through this production entry. The mixed legacy test files keep their
HTTP/domain contracts; only plugin injection/packing/apply fixtures were removed. The old core-only npm
packaging fixtures assumed a separately loadable published plugin; the core is
private and imports the containing Night `src/` application. The complete Night
installation/lockfile and Host regression remain the supported artifact tests.

`assertTaskArtifactScopePresent` and `bindTaskArtifactScope` in
`task-artifact-scope.js` had no production caller. Their old Session/header and
sessionProjections contracts are retired, rather than adding a new compatibility
policy reader. `resolveTaskArtifactScope` and its directory, membership, recurrence
and authenticated correction-source validation remain in the task service path.

Security mappings to current interfaces:

- `test/pi-native-policy.test.js`: private bound actor policy, durable artifact
  binding, immutable native origin, rejected changed binding, forged actor,
  malformed root and replaced symlink ancestors. Request overrides cannot elevate
  standing actor permissions.
- `test/pi-task-archive.test.js`: default task tools cannot forge Host-owned frozen
  outputs while legitimate work artifacts remain available.
- `test/pi-task-material-backup.test.js`: actual Single task retains uncertain
  effect intent, held task state, unchanged Pi entries and material bytes through
  cross-root backup/restore; no model or tool replay.
- `test/task-artifact-scope.test.js`: retained pure business scope resolver tests
  verify exact membership and authenticated correction evidence.

No policy accessor, resource grant or cancelled team executor was introduced.
