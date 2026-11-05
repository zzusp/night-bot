# A task directory is its portable archive

The portable kit uses this layout under `data/workspaces/tasks/<taskId>/`:

```text
.task-session.json        # Host-owned session identity/routing, not a task command
archive.manifest.json     # offline seal and per-file SHA-256/byte count
task.json                # consistent SQLite export, versions, source/receipt/effect facts
materials/
  source-<hash>.json       # source snapshots and typed local material paths
  resource-...            # successfully materialized channel resources
  attachments/<sha>.bin   # independent copies of referenced original attachments
  runtime-evidence/
    tools/                # full capped-tool output, scoped by session
    process/              # retained process output
work/                     # editable task process files and original artifacts
outputs/<taskId>/<artifactId>/
  <original-name>          # registered frozen delivery bytes
  descriptor.json         # task/version/producer/hash binding
sessions/<session-sha>.pi.jsonl
reviews/<completion-event-sha>.json
tmp/                     # task temporary files; excluded from the offline seal
```

The spaces beforetask.json/tmp above are cosmetic. Neither filenames nor task
folders come from a model-selected title or external path. Exactly one task
execution session is routed here. Ordinary conversational/triage sessions remain
in `data/state/sessions`. Task bodies and retained output no longer depend on the
shared `delivery-files` or spill roots. Shared attachments may remain as an
immutable shared cache, but task-required attachment references found in task
ledger/source records and its Pi journal get byte-verified local copies. A channel
resource that was never successfully fetched remains explicitly unavailable; an
archive cannot manufacture its missing bytes or an external website/repository.

## Authority, snapshots and concurrency

SQLite remains authoritative for task state, dispatch, permissions, notifications
and command receipts. `task.json` contains a single transactional ledger export:
current task, owned effects/wakes/notifications/events/Topic facts, required source
rows and own command receipts. Source sequence metadata preserves each task’s
decision/effect chronology when global SQLite rowids are reassigned. It includes a digest and is never watched or
executed as commands. It does not contain other tasks, channel account credentials
or entire shared memory/skill catalogs.

After committed task-related commands, a coalescing per-task queue writes the
latest projection through a private file lease and atomic replacement. A projection
is labeled `live-projection`; the ledger and session can continue changing and an
old manifest is then invalid. Failures do not reverse a committed task result:
`taskArchiveStatus(taskId)`, maintenance alerts/logs and retryable projections
report them. Recovery and normal shutdown refresh the archive; normal shutdown
also attempts a seal after task and review drain. Host shutdown owns and waits for
the task service's close promise, preventing late writes after data cleanup.

Only offline, drained tasks with no live session writer may be backed up. An offline
seal compares the current ledger digest, validates Pi commits/identity, verifies
frozen delivery descriptors and original attachment bytes, and hashes the actual
regular files. It excludes tmp and the transient archive lease. No symlink,
hardlink or special-file traversal is silently followed. Such work trees require
explicit review/materialization into regular files before backup; the tool refuses
rather than exporting an outside path. This is an intentionally strict portability
boundary, not support for arbitrary filesystem images or live processes.

## Review evidence and shared learning

`reviews` preserves only this task's completion reviews and their evidence-linked
memory/skill destination identifiers. Missing, failed or skipped reviews are
explicit in `task.json.reviewCoverage`; an absent review is not a successful
retrospective. Destination identifiers do not prove the target still exists.
Restoring an archive preserves these reports, not a whole personal/group/project
memory or skill collection and not new authority to use someone else's scope.
Existing current instructions and permissions continue to prevail. Live forgetting
removes corresponding derived report bodies/destinations; separately created
archives/backups and original Pi audit evidence are separate retained snapshots.

## Offline commands

Run from the physical installation root, after stopping the managed service and
waiting for its tasks/processes to drain. These are operator commands, not model
tools. They use the same installation ownership lease as the Host.

```sh
node bin/night-bot-task.js data/config/config.json backup TASK_ID backups/task-SNAPSHOT
node bin/night-bot-task.js data/config/config.json validate TASK_ID
node bin/night-bot-task.js data/config/config.json restore /PATH/TO/SEALED_TASK_ARCHIVE
node bin/night-bot-task.js data/config/config.json rebuild data/workspaces/tasks/TASK_ID
node bin/night-bot-task.js data/config/config.json rebuild-index
node bin/night-bot-task.js data/config/config.json recover-restore
```

- `backup` produces a new directory beneath this installation's `backups/`, with
  no overwrite. It refreshes the SQLite projection and copies a validated sealed
  task. A normally stopped/sealed task directory can also be copied in full.
- `validate` checks the installed archive and compares its ledger digest to SQLite.
  Stale snapshots cannot replace the live database.
- `restore` validates everything before publication, requires an absent target task
  directory and task index entry, and transactionally imports the owned ledger
  rows. Only typed material paths are rebound; arbitrary chat, commands and effect
  receipts remain original evidence. Attachment caches are reconstructed from local
  task copies, without a model request or download.
- `rebuild` imports an already copied, sealed task directory missing from the
  existing database. It never overwrites a task already indexed.
- `rebuild-index` constructs a new SQLite database from all sealed task archives
  only when `tasks.sqlite` is absent. It refuses an existing database, stages the
  new index, preserves an existing initialization marker in a private backup,
  and publishes the matching database/marker under a startup guard. It is not a
  reconstruction of unrelated channel/Topic/schedule configuration or other tasks
  whose archives are missing. Partial/unsealed directories cause refusal.
- `recover-restore` completes a proven committed import/index publication or rolls
  back a known pre-commit task publication. Interrupted operations retain a private
  marker and block startup and ordinary installation backups. A marker/database
  identity mismatch stays blocked; no unproved operation is replayed.

Concurrent restores are serialized/refused by the installation lease. Import
conflicts are transactional; unrelated tasks and shared rows are not overwritten.
Task IDs and session IDs are preserved, not guessed or renamed.

## Operator review before continuation

Restored tasks remain paused and require operator review. Historical notifications
and Topic facts remain held; restoration does not resend them, run tools, restart
jobs, recreate shared learned skills or ask the model to repeat an old review.
An unresolved effect intent in Pi still blocks automatic continuation even after
an operator acknowledgment. Copying a folder is not evidence an external effect
failed, nor permission to repeat it.

After personally checking effect receipts, ownership/scope and available dependencies:

```sh
node bin/night-bot-task.js data/config/config.json acknowledge TASK_ID "What was actually checked"
```

This records the configured operator's attestation and leaves the task paused.
It is not program verification of business facts and does not release historical
notification holds. Use the ordinary versioned task control/reopen API for an
explicit authorized continuation; re-establish any needed channel/Topic bindings
without guessing identities. Unknown effects and pending external deliveries need
separate real readback/reconciliation. No universal external-effect resolution is
provided by the archive utility.

## Existing Night Bot data and boundaries

The normal runtime refuses to silently shadow an existing central task journal.
For Night Bot's own earlier **single-task Pi** layout only, explicitly run offline:

```sh
node bin/night-bot-task.js data/config/config.json adopt TASK_ID
```

It verifies drained ownership, task identity and original Pi commits, packs those
same bytes into sessions, copies known frozen delivery files into outputs, and
seals the archive under a restart guard. Original raw chat/command text is not
converted. Existing historical root-level work files stay as evidence; future
editable work uses work/. Shared delivery-cache originals are not deleted.
A mismatch or live writer is refused. No original DSH `.dsh` journals, execution
teams, legacy plugin datasets or foreign workspaces are imported.

Default model file tools and Linux model subprocesses enforce the per-task
boundary including absolute paths and symlinks: only work/ andtmp/ are writable;
materials/outputs/reviews/metadata are Host-owned, and raw sessions are masked.
Task process TMP/TEMP/TMPDIR point to its tmp directory for writable modes;
read-only execution retains isolated OS temporary behavior. System dependency
files and ephemeral OS mechanisms remain separate from business work. Trusted
plugins and Host administrator code retain service-account authority: cwd is not
an arbitrary-plugin security sandbox. Windows/macOS equivalent process privacy
and real vendor CLI behavior are not accepted here.

Archives contain private source messages, task files, tool output and Pi history.
They intentionally do not package `data/secrets`, credentials or shared account
homes; nevertheless, secrets pasted into task text/files can remain in its audit.
Git ignores task data and backups. Do not run git clean -fdx or replace data on
upgrade. There is no automatic temp/log cleanup while tasks are active.
