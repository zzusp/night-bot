# Own backup directory preservation

Night backup manifest version 1 now has an optional `directories` array of
canonical relative path strings. It records actual included directories, including
empty working directories and task `work`/`outputs` subtrees. There is no path
inference from messages, implicit scope, new permission grant or secret discovery.
Directory permissions restore as 0700; files retain the existing private write
policy. Existing valid v1 backups without this field remain readable. Older builds
that ignore it cannot restore directories which have no backed-up files.

The normal state/memory/workspaces/attachments and configured skills/agents/harness
roots retain their existing scope. Credentials, environment-file names, runtime,
cache, logs and temporary data remain excluded by default; explicit secret backup
uses the existing opt-in. Nonportable path separators, drive/stream colons and
control characters, trailing-dot/space components and Windows device aliases are refused. Backup/restore refuse symbolic directory entries
and symbolic ancestor paths. Directory metadata must refer to actual backup
directories; duplicates, file/directory collisions and file-as-parent paths are
rejected before installation.

Restoration validates metadata and file hashes, creates private staged directories,
and then installs roots under the offline Host lease and pending marker. A failed
install restores previous empty directory trees and removes installed files. An
unrecoverable rollback retains its stage and pending marker and reports
`NIGHT_RESTORE_ROLLBACK_UNCERTAIN`; it must not pretend a clean restore succeeded.
A process crash is still protected by the existing pending-maintenance gate, not
silently repaired on startup.

These tests cover own backup relocation of a real official actor's empty origin
cwd and a real task's empty work/sub and outputs, with its unresolved effect intent
and blocked decision preserved and no recovery dispatch. This directory change
does not rewrite official journal entries, path bindings or effect scope proofs.
Business path-binding relocation is a separate change: on the older base, a new
post-restore dialogue for this held task can be refused earlier with
`TASK_MATERIAL_SOURCE_MISMATCH`. That is not described as successful reconciliation
or a proven new invocation of the unknown-effect gate.
