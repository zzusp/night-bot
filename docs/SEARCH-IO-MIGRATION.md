# Safe search IO and Pi 1.5

The default model catalog now exposes `find` from the locked Pi 1.5 public
`createFindToolDefinition` interface. Its official schema, output rendering,
relative result formatting and tool execution remain Pi-owned. The old `glob`
name and its presentation ABI are removed, without an alias. The deployment
`globMaxResults` configuration now bounds find results (100 by default); explicit
higher limits are rejected. Night 的自定义 `glob` operations port 先枚举已授权
普通文件，再用成熟库 Minimatch 在进程内匹配（`dot:true`、`matchBase:true`、
`nonegate:true`、`nocomment:true`）；不为文件名查找启动 fd、rg 或其它子进程。

Custom find operations use an explicit authorized file allowlist. This differs
from Pi's default fd discovery: `.gitignore` is not applied, recursive symlinks
are not followed, and VCS metadata and node_modules directories are excluded.
The former Night glob also searched ignored files. These custom-operation
semantics are stated in the tool description; default-fd behavior is not claimed.

Pi 1.5 public `GrepOperations` only exposes `isDirectory` and `readFile`. The
actual `grep.js` starts its own child process and does not expose spawn or raw
capture budgets. Replacing that whole process path is not possible through this
public port. Night therefore supplies an independently implemented bounded grep,
using the existing `pattern`, optional `path` and optional `include` arguments.
It is not advertised as Pi's official grep and does not pretend to implement its
additional context/literal/ignoreCase parameters. Regex/glob matching itself is
performed by packaged ripgrep, without a shell or custom matching engine.

The former search module was MIT-derived and is replaced, rather than renamed.
Its old card metadata/DSH parse and retention ABI are not carried forward. Text
results and private complete-match-list spill/readback remain; no session/history
or model context projection is added.

## Authorization and bounded execution

Only the actual official actor and exact NativeTools invocation can use the
registered tools. A PrivateFileSystem capability is required; a nonportable Host
without that capability rejects search rather than silently using raw local IO.
An old portable Host already wrapped subprocesses with processPrivacy bubblewrap;
this change does not claim it previously ran wholly without a sandbox. The
additional module-level contract is explicit per-path filesystem authorization
and composition with that retained process boundary.

A streaming directory iterator checks canonical filesystem policy before adding
each file. Unauthorized task/workspace, state, memory and private session paths
既不会进入 find 匹配集合，也不会成为 grep 的 ripgrep 输入。Recursive symlinks are skipped. Directory
traversal defaults to at most 10,000 entries and depth 64; failure at either bound
returns a resource error before search. Paths and complete aggregate raw output
are bounded by `rawOutputMaxBytes` (20 MB default). Explicit argv batches are
bounded to 16 KB of filenames. The caller's current working directory is used.
No raw search is performed over an unconstrained recursive directory argument.

For grep, immediately before each batch, canonical path and regular-file status are
checked again. The packaged executable receives `--no-config`, literal argv
values and `--` before its explicit files. No shell or preprocessor is permitted.
Output overflow is an error, not a silently partial parsed result. The registered
cooperative deadline and caller signal reach the actual subprocess. Both successful
completion and failure/cancellation await the process owner's `waitForExit`;
failure to establish drain reports `SEARCH_DRAIN_FAILED`.

Line previews preserve UTF-8 scalar boundaries. Result count and retained UTF-8
text budgets are separate from raw capture. If the private spill service is
available, an over-count grep saves the complete match list with its original
session/call identity; omitted matches can be read through authorized file IO.
The result value is bounded text, without a second unbounded metadata copy.
Search results do not constitute a whole-file observation authorizing a later
edit; Pi read and the Host observation/CAS policy remain responsible for that.

Canonical rechecks alone are not an OS transaction against arbitrary concurrent
ancestor substitution. Portable Host processPrivacy/bubblewrap remains necessary
for untrusted process containment. Linux tests retain that sandbox; Windows
search/process containment is not certified by these Linux results.

> 以下定向日志保留原迁移阶段结果，不是本轮同版全量；当前平台与清理状态见[唯一目标](acceptance/resident-conversation-routing/goal.md)。find 的进程内匹配不证明 grep/shell 的模型子进程隐私边界已可用。

## Targeted evidence

`/tmp/night-search-safe-final.tap` passes 9/9: actual portable find/grep and private
spill/readback, unchanged official image routing, argv/no-config/UTF-8 behavior,
raw overflow and malformed-record rejection, cancellation and provider-error
range joins (including a real running ripgrep that emits matches before cancellation), actual task/Host-state/session/symlink privacy, and entry/depth budget
failures before process dispatch. No tests are skipped. The private-path proof
checks the argv passed before processPrivacy wrapping, not just displayed results.

The integration owner must refresh source/reference manifests and audit remaining
source/test copies before retiring the former search license notice. Package,
lockfile and notices were not changed in this slice.
