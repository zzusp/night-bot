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
current task, owned effects/wakes/notifications/events, direct source links,
dependencies and completion assessments, required source rows, historical Topic
audit evidence and own command receipts. Source sequence metadata preserves each task’s
decision/effect chronology when global SQLite rowids are reassigned. It includes a digest and is never watched or
executed as commands. It does not contain other tasks, channel account credentials
or entire shared memory/skill catalogs.

After committed task-related commands, a coalescing per-task queue writes the
latest projection through a private file lease and atomic replacement. A projection
is labeled `live-projection`; the ledger and session can continue changing and an
old manifest is then invalid. Failures do not reverse a committed task result:
`taskArchiveStatus(taskId)`, maintenance alerts/logs and retryable projections
report them. Recovery refreshes the live projection; normal shutdown waits for
task/review drain and pending projections, without walking or hashing work files.
Host shutdown owns and waits for the task service's close promise, preventing late
writes after data cleanup. Ordinary shutdown does not create an offline seal.
Use the explicit offline backup command before treating a directory as portable.

Only offline, drained tasks with no live session writer may be backed up. An offline
seal compares the current ledger digest, validates Pi commits/identity, verifies
frozen delivery descriptors and original attachment bytes, and hashes the actual
regular files. It excludes tmp and the transient archive lease. No symlink,
hardlink or special-file traversal is silently followed. Such work trees require
explicit review/materialization into regular files before backup; the tool refuses
rather than exporting an outside path. This is an intentionally strict portability
boundary, not support for arbitrary filesystem images or live processes.

## 档案版本与直接来源

新写出的 `task.json.version` 与 `ledger.version` 均为 **2**；`archive.manifest.json.version` 仍为 **1**，它只描述封存文件、字节数、哈希和账本 digest，不能与快照版本混用。

v2 账本保留原任务的 `tasks`、`executions`、`operations`、`wakes`、`notifications`、`task_events`、`sources` 和 `receipts`，并增加：

| 表集合 | 内容与边界 |
| --- | --- |
| `source_links` | 本任务到原消息来源版本的直接关联；被关联来源必须在本档案的 `sources` 中 |
| `dependencies` | 本任务等待的前置任务身份、适用版本、条件与来源授权；不复制前置任务全文或执行会话 |
| `completion_evaluations` | 本任务的完成评估记录及证据引用；恢复不重新认可该评估 |
| `historical_topic_facts` | 旧 Topic facts 的只读审计证据，不构成活动路由或新命令 |

v2 不再把 `topic_facts` 作为活动集合导出。版本 1 的既有封存档案仍可校验和恢复：导入时将其 `topic_facts` 写入独立的 `dynamic_task_topic_audit`，不恢复旧 Topic 链，也不从历史摘要推断任务依赖。新导出可携带这部分历史审计。

既有任务重安排时，当前 `dependencies` 全集和有效评估按新 `arrangementRevision` 保存；被替换的依赖/评估冻结在该任务自己的 `task.arranged` 事件中，经 `task_events` 随档案保留。历史安排只作审计，恢复不能据其重新满足依赖、执行任务或发送通知。

单任务档案不包含 Router conversation、inbox、轮换记录或整群 journal，也不随 B 复制前置 A。恢复保留原 taskId、执行 session、原始来源与产物身份；所有任务仍为 `paused`、`reviewRequired`。`dependencies` 强制重置为 `pending`，移除旧 `evaluationId` 并设置 `archiveRestoreHold`；来源、评估、通知和历史 Topic 审计同样保持 hold。操作员确认并不自动释放依赖或历史发送；前置任务身份、版本和证据不可验证时，B 继续等待。

以上为当前格式/源码合同。本轮真实归档升级、旧版读取、恢复及依赖拒绝的实跑状态见 [常驻 Router 验收入口](acceptance/resident-conversation-routing/goal.md)，不能用此前 v1 档案验收代替。

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
  task. Only a directory explicitly sealed and validated by this offline operation
  can also be copied in full; normal shutdown alone does not make it a backup.
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
  reconstruction of unrelated channel/Router/schedule configuration or other tasks
  whose archives are missing. Partial/unsealed directories cause refusal.
- `recover-restore` completes a proven committed import/index publication or rolls
  back a known pre-commit task publication. Interrupted operations retain a private
  marker and block startup and ordinary installation backups. A marker/database
  identity mismatch stays blocked; no unproved operation is replayed.

Concurrent restores are serialized/refused by the installation lease. Import
conflicts are transactional; unrelated tasks and shared rows are not overwritten.
Task IDs and session IDs are preserved, not guessed or renamed.

## Operator review before continuation

Restored tasks remain paused and require operator review. Sources, dependencies,
completion assessments, historical notifications and Topic audit evidence remain
held; restoration does not resend them, run tools, restart
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
explicit authorized continuation; re-establish any needed authenticated
conversation/source bindings without guessing identities. Historical Topic fields
cannot recreate an active Topic path. Unknown effects and pending external deliveries need
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

在 `permissionMode: ask`（默认）与 `auto` 下，文件和受限进程保留任务档案边界：任务内仅 work/ 和 tmp/ 可写，materials/outputs/reviews/metadata 由 Host 管理，raw sessions 不向进程开放。任务外的业务路径可申请准确单次授权，批准只给本次调用的声明范围，不能因此修改 Host 私有区或扩大到其它任务。路径、符号链接、调用身份及参数在实际执行前重新核对。可写任务的 TMP/TEMP/TMPDIR 指向准确 task.tmp；只读执行仍可使用隔离 OS 临时机制，不能据此扩大业务写界。

显式 `full` 按当前运行环境的 OS 账号权限直接访问；Host API 仍维护档案所有权、审计、取消与 no-replay，但不能声称同账号直接进程仍被 OS 阻止读取或修改这些档案文件。full 不等于管理员提权，也不证明默认受限档已通过。系统依赖与 OS 临时机制仍区别于外部业务目标；可信插件不因 cwd 而成为隔离执行。权限选择见 [README](../README.md#工具权限)，各平台实际进程保护与厂商验收保留[当前目标](acceptance/resident-conversation-routing/goal.md)中的未验边界。

Archives contain private source messages, task files, tool output and Pi history.
They intentionally do not package `data/secrets`, credentials or shared account
homes; nevertheless, secrets pasted into task text/files can remain in its audit.
Git ignores task data and backups. Do not run git clean -fdx or replace data on
upgrade. There is no automatic temp/log cleanup while tasks are active.

### Typed material paths in Night backups

New Host material snapshots include `pathBindings.version: 1` with kind
`task-material-relative`. The closed field list covers the source JSON filename,
retained resource filenames and their matching image/file descriptor paths. Raw
file descriptors retain their original name, MIME, byte length and SHA-256; the
model receives a controlled read-only material path, never a vendor download ID. Reading a
snapshot validates its original absolute paths and exact field list, then resolves
only those leaves under the current task's materials directory. The source ID,
version, actor, message, text, quote, resource identity, byte length and SHA-256
checks still apply. No stored packet, Pi history, signature, tool argument or effect
receipt is rewritten, and relocating material evidence grants no execution rights.
Task archive restore validates these marked packets without rewriting their paths.

Older unmarked material packets remain bound to their recorded root. A cross-root
whole-install restore of those packets stays held; do not edit JSON or infer paths
from user content. The existing offline sealed task archive restore path has its
own verified manifest/source root and explicit operator-review requirement; it
remains the supported route for those task archives. Unknown effects still require
the separate operator reconciliation and authorization workflow, never replay.

The real offline own-backup regression also submits a fresh operator dialogue to
an uncertain restored task: typed materials pass validation, the existing unknown
effect remains blocked, and no model/tool request is replayed. The current dialogue
API reports `TASK_DIALOGUE_NO_REPLY` for that held attempt, rather than exposing the
unknown-effect reason directly. An unmarked historical packet reports
`TASK_MATERIAL_SOURCE_MISMATCH`. These are distinct refusals; material portability
does not resolve, authorize or hide an unknown external effect.
