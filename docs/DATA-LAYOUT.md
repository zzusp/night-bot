# Installation data layout and portability

The development rule is in `AGENTS.md`: application-owned data defaults beneath
the installation root, separated from code, with explicit backup/upgrade/privacy
boundaries. New installs require the standard `dataDir: "data"`; the default installation root is
the package root, independent of the shell's working directory. An explicit
`installRoot` may be absolute or relative to the configuration file. There are no
hardcoded personal directories. A data root outside that installation root is
refused in portable mode. A permission/file/symlink failure does not fall back to
a home directory.

```text
<install>/
  bin/ src/ packages/ scripts/ docs/    # code; replace during upgrade
  node_modules/                       # rebuild from the frozen lock
  backups/                            # offline private snapshots; Git ignored
  data/                               # preserve during every upgrade
    config/
      config.json                     # deployment config, environment references
      skills/                         # owned custom skills
      agents/                         # owned agent instructions/skills
      harness/                        # compatibility instruction/skill roots
    secrets/
      credentials.json                # credential values; private separate backup
      .env                            # optional environment values
    state/
      sessions/                       # ordinary/triage Pi journals + legacy readers
      storage/                        # native domains, schedules, workspace/model state
      tasks.sqlite                    # tasks, operations, notification ledger
      spills/                         # retained tool/process output, recovery evidence
        subprocess/
    memory/                           # scoped Markdown facts, candidates, trusted grants
      v1/<kind>/<scope-hash>/evolution/ # task reviews and scoped learned skills
    attachments/v1/                   # original content-addressed files/images
    workspaces/                       # tasks/<id> complete task archives; conversations
    cache/attachments/                # rebuildable image variants
    logs/service.log                  # diagnostic output of managed launcher
    temp/                             # managed process/Node temporary files
    runtime/
      .host.lock/                     # live Host ownership, normally absent offline
      restore.pending.json            # interrupted restore marker, normally absent
```

Create `data/config/config.json` once with `pnpm init:assistant --actor YOUR_ID` (the optional provider/model/key-env flags select your model). This records a relative `installRoot: "../.."`, unique instance ID and current ingress epoch. A manually copied example needs the same relative installation root when stored under `data/config`. Do not
overwrite it during upgrades. The example has no absolute user path. `.gitignore`
excludes installation `data/`, `backups/` and root `config.json`; this is not protection against
`git clean -fdx`, deletion or an installer replacing the entire installation tree.
No generic release installer existed for this tree: older `install-profile.ps1`/
`deploy-local.ps1` scripts target the source DSH deployment (including old fixed
Windows paths) and remain historical references, not Night Bot upgrade entrypoints.

显式绝对 state/workspace 接入也将默认技能/指令根限定在 `state/runtime/configured-agents` 与 `state/runtime/configured-harness`，不回退到用户 home。该接入不搬迁既有数据；新安装仍要求标准 portable 布局。

## Actual routing and scope

| Purpose | Standard location |
|---|---|
| Ordinary sessions, native domains, schedules, task SQLite | `data/state` |
| Task sessions, sources, frozen outputs, reviews and task snapshot | `data/workspaces/tasks/<taskId>` |
| Task materials, artifacts, execution cwd | `data/workspaces` |
| Credential values and optional environment | `data/secrets` |
| Attachment originals / derived cache | `data/attachments/v1` / `data/cache/attachments` |
| Retained full process/tool output | task `materials/runtime-evidence`; ordinary sessions use `data/state/spills` |
| Markdown memory, grants, reviews, learned skills | `data/memory` |
| Owned skills and instructions | `data/config/{skills,agents,harness}` |
| Managed log / transient files | `data/logs` / `data/temp` |

`data/config/skills` stores private skill bodies and their same-directory
`scripts`, `references` and `assets`; these are installation data, not source code or
an npm package. A migration must use an existing installation pointer within this task's authorized
reuse scope and avoid stale `node_modules` or worktrees. If cleanup or relocation is
needed, touch only materials introduced by this task; never overwrite or move another
session's existing skills. Before and after copying, run `git check-ignore`; before
delivery independently inspect `git diff --cached` and `git ls-files`. Never copy
accounts or credentials.

`pnpm start CONFIG` now runs `bin/night-bot-run.js`, which scopes `TMPDIR`, `TMP`,
`TEMP` and `XDG_CACHE_HOME` to its child and sends stdout/stderr to the private log.
It preserves inherited proxy/CA/credential environment variables and does not rewrite
`HOME`. 它等待服务排空后退出；受管父进程通过 Node IPC 发送 `{type:"night-bot-shutdown"}`，launcher 再转发给服务。Windows 的 `child.kill("SIGTERM")` 是强制终止，不能用于声称已优雅停止；POSIX 信号仍接入同一排空路径。 Calling
`bin/night-bot.js` directly still works, but retains the caller's OS temporary
environment; it does not provide managed file logging. These are real exceptions.
Portable custom `skillDirs` must remain within the physical installation tree;
external roots and symlink ancestor aliases are refused before loading/watchers.
Portable model file tools read installation files and write only the workspace.
Canonical file resolution rejects external traversal and symlink targets. Linux
model subprocesses run in a separate mount namespace: installation/package code
and system dependency roots (`/usr`, `/bin`, `/sbin`, `/lib*`, `/etc`, `/opt`) are
read-only, workspace writes follow the permission preset, `/tmp` is ephemeral,
and raw state/memory/vault/attachments/cache/logs are masked. Other business
locations are absent. Even `danger-full-access` does not override this deployment
boundary; `read-only` stays read-only. Kernel tests cover all three modes. This is
not a sandbox for trusted plugins or the Host administrator; they execute code with
the service account's authority. System dependency roots are explicitly readable,
not a promise of arbitrary OS-secret isolation. External custom binaries must be
installed in allowed dependency locations or within the installation. Model process
execution fails closed without the Linux namespace runner; Windows/macOS equivalent
privacy namespaces are not implemented or validated. The native file fence remains
available on those platforms. Existing low-level explicit-root APIs are retained for
compatibility tests, but the supported managed launcher refuses that layout. No
plugin historical-data conversion/import was added. Use physical installation paths:
symlink/junction ancestor aliases are refused rather than traversed on setup.

## Upgrade and consistent backups

Stop the service and wait for successful drain/exit before copying durable data.
The portable Host lease remains held through all service shutdown, including
background memory work. Backups acquire that same lease and refuse a live Host.
Shared-file transactions queue by resolved path within one Host before acquiring
the existing disk lease. This prevents its Windows contenders from reading an
owner record while the previous transaction removes it. Cross-process live-owner,
stale-owner and token checks remain unchanged; permission failures propagate.
No lock format migration or Windows cross-process kernel parity is claimed.
Keep SQLite, journals, memory, domains, workspaces and attachment objects from one
offline snapshot; copying only `tasks.sqlite` during a live write is not supported.

```sh
node bin/night-bot-data.js /path/to/config.json paths
node bin/night-bot-data.js /path/to/config.json backup <install>/backups/snapshot
# Explicitly include the private vault only when required:
node bin/night-bot-data.js /path/to/config.json backup /private/full-backup --include-secrets
```

Default snapshots include state, memory, workspaces, attachment originals, a
sanitized resolved configuration and owned config skills/agents/harness. They
exclude the secrets directory, `.env` variants, credential/private-key filenames,
logs, cache, temp and runtime data. Excluded filenames and policy roots are recorded in
the manifest. Known secret configuration keys/headers and credential URL fields
are removed; JSON config under owned config directories is sanitized as well.
External custom directories/config files outside those owned areas are not copied.
The explicit `--include-secrets` flag includes the vault; other directory exclusions
remain. Treat all snapshots as private: raw chats, Markdown, business artifacts and
unknown user-provided text may contain sensitive data even without credential files.
This is a directory snapshot, not encryption or a guarantee of semantic redaction.

The destination must be new and outside the data root. A staging directory is
installed only after a SHA-256 manifest is complete. Symlinks/special files are
refused rather than followed into other users' data. Inspect `excludedFiles` and
the manifest before calling the snapshot complete. Do not run older upstream backup
scripts as substitutes for this layout-aware entrypoint.

## Restore and relocation limits

```sh
node bin/night-bot-data.js /path/to/config.json restore <install>/backups/snapshot
```

Restore verifies every path/hash before applying to an offline destination with no
durable data files (empty service-created directories are allowed). It stages bytes
before swapping durable directories; existing config and an excluded credential
vault are preserved. Known exceptions roll back newly installed directories. An
interrupted process leaves `runtime/restore.pending.json`: startup and new backups
refuse that incomplete state. Inspect the marker/staging tree and retain evidence;
recover from the verified offline snapshot into an empty destination rather than
blindly deleting the marker or running on a partial restore.

New Night Bot sessions record typed install-relative references beside immutable
physical journal metadata; workspace/transport directory fields have equivalent
references. On read they resolve against the current installation root. Pi journal
bytes, commit checksums, user text, historical commands, tool arguments and effect
receipts are not rewritten. Attachments are content-addressed and memory scopes
use stable IDs. A tested A→B restore continues Pi history, reads workspace artifacts,
attachments and Markdown memory, executes a persisted reminder once and survives a
second restart. The standard `data/` layout must match. The restored configuration
uses `installRoot: "../.."` relative to `data/config/config.json`; existing target
configuration is preserved.

This is portability for newly written Night Bot data, not import of old DSH data.
Opaque text containing a former absolute path remains historical text, not a
rebound resource. Do not automatically replay commands, unknown effects, external
business workspaces or external references found in chats/tasks. Such references
need current user instructions and current path validation; model tools cannot
write outside the current workspace or access unmounted business directories.
An external path does not become authorized through restore. Native in-flight
processes and external vendors cannot be transferred by a directory copy: stop and
drain before snapshotting; uncertain effects retain their reconciliation boundary.
Cross-OS tooling, ACLs and running external task effects were not validated by the
A→B test. No existing user installation or production data was moved.

## Logs, temporary files and cleanup

`data/logs` and `data/temp` are independent of the task workspace, credential vault,
memory and durable state. The managed launcher routes its stdout/stderr and Node
temporary/cache environment to the documented installation paths. Retained complete
tool/process output is recovery evidence in `data/state/spills`, not disposable temp.
Linux model namespaces additionally use ephemeral `/tmp` for system mechanisms.
Default snapshots exclude logs, temp, caches and runtime leases/restore markers.

No automatic log rotation or temp eviction is installed. Stop the service and join
its tasks/processes before archiving/removing old logs or temporary files. Never
clean an active task's files, Host lease, pending restore, unresolved effect evidence
or retained output as though it were cache. An upgrade replaces code/dependencies
and preserves `data/`; it does not run `git clean -fdx`.

## Credential and account storage

`data/secrets` is the app-owned credential/account directory: API-key references,
provider API-key/OAuth grant records live in `credentials.json`; optional environment
values live only in `secrets/.env`. Portable startup does not read a config/home
`.env`. Public owner IDs, profile aliases and environment/reference names can remain
in configuration; passwords, tokens, cookies, authorization headers and credential
URL values are refused there. API-key/OAuth flows use the Host credential service,
not a second Pi auth.json in a user's home. Noninteractive process-environment
configuration and the auth command's stdin/hidden-prompt interfaces remain available.

On POSIX, dedicated directories use 0700 and secret files 0600. Startup checks
ownership and refuses links/hardlinks/special files in the vault, tightening only
app-owned files inside that directory. Ordinary model file tools and Linux processes
cannot read the vault; model subprocess environments use a safe dependency-variable
allowlist, do not inherit provider keys, and have an ephemeral home. Trusted adapter
operations use the credential service behind their authorization boundary. Secret
values are not printed by auth metadata commands or copied into memory. Raw chats
and external vendor errors are separate evidence/privacy boundaries: do not paste
secrets into chat or assume arbitrary prose can always be detected/redacted.

Windows ACL equivalence and macOS model-process privacy are not verified. No system
ACL, account or external home was modified. The optional DWS plugin scopes child HOME/USERPROFILE and XDG_CONFIG_HOME to
`data/secrets/dingtalk-dws`, its workdir to `data/workspaces/channels/dingtalk-dws`,
and cache/temp to the installation paths. It does not reuse an external login.
A vendor CLI may ignore environment conventions; real login/store behavior still
requires integration acceptance. Other trusted extensions must declare their paths.
The default snapshot excludes the entire vault; only explicit `--include-secrets`
includes it. Snapshots still contain private chats, memory and business artifacts.

## Complete task archives

[TASK-ARCHIVE](TASK-ARCHIVE.md) defines the task subdirectories, runtime-authority
boundary and offline backup/restore/rebuild/repair commands. General installation
backups remain separate. An interrupted task restore/index publication blocks Host
startup and installation snapshots until its explicit recovery command resolves it.
