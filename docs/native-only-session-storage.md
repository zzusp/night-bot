# Native-only Session storage boundary

Current Night backups contain pinned official Pi entries, native commit v2, typed
Night business receipts and backup/archive manifest v1. They are not generic
Session/v4 event logs. An application header's existing `version:4` field remains
in native bytes; it does not authorize an event-format converter or old driver.

The native persistence service exposes createNative/openNative/readNative and
stat/list/flush. Generic create/open, event append/replay, lifecycle publication,
Host-message conversion, surface replacement and resetLeaf reconstruction are
retired. native-persistence-protocol retains only its attributed error vocabulary
and a pure JSON metadata snapshot. It no longer loads mutable Session code.
Task routing wraps only native APIs, preserving exact Host writer leases, task
binding and cwd checks. The old event inspector explicitly refuses its retired
API; it cannot manufacture events from official messages.

The strict decoder accepts only the native storage marker and commit-v2 envelope.
It preserves UTF-8/line validation, entry identity/parent envelopes, immutable
prefix/checksum chains, raw signatures/entries, complete-tail refusal for writer
and offline evidence, and explicit portable codecs. Pi public projection and
converter remain responsible for context/message behavior. No complete public
runtime SessionEntry validator exists in locked Pi 1.5; no replacement Pi message,
tree, branch or compaction implementation is introduced here.

Safety tests move to actual official managers and native persistence rather than
retaining old generic-writer fixtures. pi-session-authority keeps its checksum,
visibility retirement/original evidence, tail, owner, abort, link, media and
no-import contracts. Its former auto-truncate-on-write recovery is deliberately
replaced by strict native reopening refusal; it is not counted as compatible
behavior. pi-routed-journal and pi-maintenance-journal retain route/physical file
identity, exact bytes, checksum, tail, linked files/ancestors, explicit archive
owner markers and portable-path checks through current native files.

The removed Windows/event maintenance proposal algorithm had no production caller
and already refused native files. It is not a current Night backup contract or a
source of drain truth. readNativeHistory now returns only strict official native
projection plus typed business audit; readNativeDrainReceipts continues to verify
committed native attestations. Missing/unknown physical drain stays refused and
cannot become settled or replayable. A formal Windows current-native probe is a
separate pending capability, not inferred from old event records.

Header-only business tests use a tiny metadata fixture and no Session service.
They retain actual native admission, skill command, input/invocation provenance,
effect reconciliation, policy-state and execution-audit assertions. Policy and
preset retirement is handled in separate coordinated slices. Mutable Session,
projection registry and remaining source consumers are not claimed retired by
this storage slice alone.

The related portable standing-business path extension is specified in
native-business-path-bindings.md. It changes only explicitly marked logical audit
path views, preserving raw Pi entries, signed messages, user/effect strings and
backup bytes. All source accounting/notice/package changes remain centrally
reviewed; no DSH data import or automatic upgrade exists.
