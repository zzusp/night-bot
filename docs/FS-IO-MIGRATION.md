# Pi file operations and Night IO

The locked `@earendil-works/pi-coding-agent` 1.5.0 public `createReadTool`,
`createWriteTool` and `createEditTool` APIs remain the model-facing tools.
Their public `operations` ports are supplied by `src/pi-file-tools.js`.
Pi owns multi-edit matching, diff rendering, ordinary read rendering and mutation
queue lifecycle. The independent `read_window` is an explicitly bounded resource
capability for files beyond the ordinary complete-buffer policy.

Pi's default write operations use `fs.writeFile`; they do not implement Night's
observation CAS, private state boundaries or task archive ownership. Replacing
these policy capabilities with bare default operations would remove security
contracts. `native-fs-local.js` is now a separately implemented Node IO adapter,
not a copied model tool. It supplies canonical paths and metadata, regular-file
reads, bounded byte windows/stream decoding, stable directory enumeration,
watch subscriptions, per-target serialized CAS and atomic publication.

Publication creates an exclusive private sibling staging directory/file, writes
and fsyncs the file, checks cancellation before publication, preserves existing
mode bits and uses an exclusive hard link for create-if-absent or rename for
replacement. A concurrent creator is preserved. Failure before publication
removes staging; a failure cleaning staging after successful publication does not
misreport a committed write as absent. This is file publication atomicity, not a
claim of parent-directory fsync or atomic transactions across separate files.
The metadata version guard serializes this backend's mutations; it is not an OS
transaction against arbitrary external concurrent writers. Canonical containment
and ancestor symlink race limitations remain those of the unchanged policy layer.

The old backend `editText(oldString,newString,replaceAll)` method and its two
unused policy passthroughs are removed. There are no production consumers.
Current editing always uses Pi's official edits array; no replacement literal
edit engine is maintained. The former direct-package comparison test now asserts
explicit CRLF bytes, guarded replacement and stale/no-clobber outcomes.

Observation state is now an independent weak map keyed by the authenticated live
official actor. It rejects old `agent.session` facades and foreign/unbound actors,
retains a copied observation instead of caller-mutable state, and clears on plugin
disposal. These are Host IO facts, not a message/history projection.

## Retained attribution and platform limits

`fs-windows-security.js` retains the existing MIT-derived Windows DACL and
ReplaceFileW bridge. It is explicitly attributed to `dsh-fs-local` and has not
been rewritten or validated on Windows in this Linux environment. Therefore
`licenses/dsh-fs-local-MIT.txt` must remain. The sandbox policy implementation also
remains attributed. This change does not claim all FS-derived code is gone.

`test/fixtures/legacy-fs-interface.mjs` had no runtime or test import and was
removed. Its stale reference-manifest entry must be retired by the integration
owner. The protocol module and observation module were independently rewritten;
removing their old package notices also requires the integration owner's full
remaining-source/test-copy audit. No license files are removed in this slice.

## Verification

Targeted official-tool and IO tests cover CRLF, concurrent CAS, exclusive create
races, post-stat growth bounds, physical `alias/..` traversal, cancellation and
staging cleanup, actual watcher close, official actor isolation, symlink aliases,
preflight before intent, readonly one-call escalation and private-path no-ask.
The Linux Single artifact kernel cohort retains application bubblewrap and
executes a real child before assessing denials. It covers cold continuation,
readonly recovery, Host-owned task directories, symlink escape, explicit reopen
and held portable restore. Windows behavior is not certified by Linux tests.

Slice evidence (no full-suite claim):

- `/tmp/night-fs-independent-frozen.tap`: 34/34 IO, official editing/read,
  actor-observation contracts, including unowned staging-collision preservation.
- `/tmp/night-fs-independent-contracts.tap`: 34/34 registration, preflight,
  default Host file/image contracts.
- `/tmp/night-fs-protocol-final.tap`: 2/2 capability protocol contracts.
- `/tmp/night-fs-independent-kernel.tap`: 3/3 actual Linux bubblewrap contracts;
  approved outer executor, application sandbox enabled, no skips.

Public source/hash/reference manifests are integration-owned and need refreshing
before their strict guard can serve as final integration evidence.
