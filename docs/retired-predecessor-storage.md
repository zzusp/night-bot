# Night storage support boundary

Night starts with the current resident domain version 9 and official Pi session
storage. The predecessor application's resident v6–v8 conversion scripts and v8
schema snapshot are retired. Those documents were application business records,
not DSH Session journals; their use of the DSH JSON-storage SDK did not change
that distinction. Night does not import the predecessor Owner/execution backend,
its archived run/node artifact reader, or its retired task/session identities.

An explicit `legacyDbPath` option now fails before creating a destination or
reading the old database. Existing current-ledger blocker rows and resource locks
are preserved: an unresolved row continues to block execution/completion and is
never automatically resolved, released or converted into a runnable job. The
explicit evidence-based resolution contract remains separate from data import.

Night's own supported operations remain unchanged:

- Offline backup/restore manifest version 1, privacy exclusions and relocation checks.
- Current task archives, offline seals, held-effect restore and reindex.
- Current SQLite ledger version 1→2 upgrades with identity, drained writers,
  state-digest CAS and transactional schema installation.
- Current archive/pagination index upgrades, uncertain-effect fences and durable
  operation receipts.

Current resident files with another domain version fail closed; they are not
silently rewritten or guessed to be current. Future Night schema changes must
provide an explicit upgrade for supported Night versions, preserve originals and
backup/restore guarantees, and never turn migration into automatic effect replay.

The active service's negative archived-task test remains: an unrelated old
archive is neither imported nor exposed, and its bytes remain unchanged. Retiring
its standalone reader does not remove current task materials or attachment checks.
