# Markdown memory

Memory is application-owned reference data. Pi remains the authority for original
conversation history and inference; a remembered fact never grants permission or
overrides a current instruction. No graph, embeddings, vector database or semantic
recall is used. Search is case-insensitive literal substring matching, with all
whitespace-separated terms required, and at most 20 results.

## Code and runtime boundaries

`src/memory/` contains `scope.js` (authorization), `commands.js` (explicit command
grammar), `format.js` (Markdown envelope and secret checks), `store.js` (transactions),
`service.js` (Host/session lifecycle, candidates and stale recall revocation) and
`tools.js` (model interface). Runtime path/lease/backup code lives in `src/runtime/`.
Existing flat runtime modules are retained; this change does not move their source
or change the historical core module accounting.

The portable default is `<install>/data/memory/`:

```text
memory/
  bindings.json                 # trusted session-to-principal grants, private
  v1/
    personal/<scope-sha256>/
    group/<scope-sha256>/
    project/<scope-sha256>/
      index.md                  # short topic links/counts, no fact bodies
      topics/<topic-sha256>.md   # current facts in one topic
      candidates.md             # unapproved; absent when empty
      scope.json                # revision, bounded dedup/forget fingerprints
      pending.json              # transient redo transaction; normally absent
      .lock/                    # cross-process scope lease; normally absent
```

Markdown has a JSON-compatible YAML front matter envelope with format/scope/
revision, entry identity, source message/session IDs, source hash and timestamps.
Fact text lives only in its Markdown body. Corrections replace the old value;
they preserve identity/creation time and increment the entry revision. Candidate
promotion preserves its original source separately from the approval source.
The envelope and content hash are validated. Direct edits which invalidate hashes
are refused, rather than silently imported as trusted memory. Use the guarded
commands/tools to modify records. Directory names do not expose raw actor/group IDs.

## Identity is a Host responsibility

Memory is mounted by the default Host but fails closed until a trusted adapter binds
an authenticated session. Models cannot set an actor, group, filesystem root or
arbitrary scope ID. A trusted application can call:

```js
await host.ctx.memory.bindSession(sessionId, {
  actorId: authenticatedActorId,
  // groupId: authenticatedGroupId,
  // groupWrite: true,             // only if the caller may change shared memory
  projects: [{ id: authorizedProjectId, write: false }],
})
```

The same declarations can be supplied in trusted `memory.bindings` configuration,
keyed by the exact session ID. Bindings survive restart. A session cannot be
reassigned to another principal/group; create a new session for that identity.
Do not bind an aggregate multi-person coordinator as one private user. No identity
is inferred from free text, model output, or a guessed DingTalk ID. The task service binds owner and native execution sessions from trusted ledger owner/group identities before model work. Other ingress adapters and delegated agents must supply authenticated bindings; this is independent of DWS.

Personal memory is unavailable in group-bound sessions, even for the same actor.
Group reads are confined to the bound group; group writes require `groupWrite`.
Projects require individual read/write grants. Unbound and read-only sessions get
failure feedback rather than a false saved acknowledgment. Delegated agents do not
automatically inherit a binding. Generic model file tools cannot read raw application state; Linux model processes mask it in a mount namespace. Trusted plugins and administrative programs retain service-account authority. Non-Linux model processes fail closed until equivalent privacy enforcement is implemented. See DATA-LAYOUT.md for dependency and temporary-path boundaries.

## Remember, correct and forget

These unambiguous commands are executed before inference in the current turn:

```text
记住 preferences/style：简短回答
修改记忆 preferences/style：详细回答
忘记 preferences/style
记住 本群 facts/name：本群用于项目协作
记住 项目[authorized-project] facts/version：v2
记住候选 preferences/format
```

English `remember`, `update memory` and `forget` use the same `topic/key: value`
shape. Flexible requests can use `memory_read`, `memory_search`, `memory_remember`,
`memory_forget`, `memory_candidates`, `memory_promote` and `memory_status` in the
same model turn. Mutations require the current human message ID, an exact source
quote, and an authorized target; a source found in historical/tool/coordinator
content does not grant write consent. Fact text must be a literal short quote,
not an invented summary. Ambiguous targets need clarification. Optimistic
`expectedRevision` prevents a stale correction overwriting a newer one.

“This time/today/for now” preferences remain in the current conversation. Explicit
expiry can be supplied by a guarded tool only with the exact ISO instant in the
current user source. Expired facts are excluded from reads/index/search. Known
credential labels, API token patterns, private keys, bearer tokens and credential
URLs are refused; do not use memory as a secret vault. Pattern checks cannot prove
that arbitrary unlabeled prose is non-sensitive.

At a completed turn's idle boundary, enabled background extraction sends at most
three bounded human messages to the existing configured model without tools. It
accepts at most three literal durable-fact quotes, excludes temporary/explicit
memory commands and known secrets, and stores only **unapproved candidates**.
Candidates are not recalled as accepted facts. They require a current explicit
approval. Disable this work with `memory.background: false`. A scope revision check
discards an extraction racing a correction/forget; forget fingerprints also suppress
stale candidates. `memory_status` and the next prompt expose maintenance error codes.
No automatic external notification is sent on a background error.

## Persistence, forgetting and failures

Writers acquire a per-scope cross-process lease, reload current Markdown, and use
private temporary files, fsync and atomic rename. A redo journal commits topics,
candidates, index and revision as one logical operation. A failed post-journal write
reports `MEMORY_COMMIT_UNCERTAIN`; the next locked access finishes recovery. Read
current state before retrying an uncertain mutation. A live lock is never stolen
on a timeout. Dead Linux owners are checked with PID/start/boot identity; an uncertain
owner remains blocked for operator review.

Forget removes the current fact, matching candidates and derived index entries;
empty topic files disappear. It leaves only bounded non-plaintext fingerprints and
dedup metadata. Stale memory tool bodies are revoked in subsequent model requests,
including inherited context lacking the necessary grants. The raw Pi conversation
and its historical tool records are intentionally retained. Forgetting memory is
not a claim to erase original chats, backups, vendor logs, or manually copied files.

The index is bounded to 40 topics and carries no fact bodies. Reads are on demand;
keyword search scans current scoped topics. This implementation is intended for
modest personal/group/project notes, not a large document search engine. Real model
extraction quality, all natural-language intent variations and channel-specific
identity integration require their own acceptance.

Task experience and managed learned skills are documented in [SELF-EVOLUTION](SELF-EVOLUTION.md). Forgetting an experience removes its derived learned skill and review lesson; raw task facts and Pi history remain evidence.
