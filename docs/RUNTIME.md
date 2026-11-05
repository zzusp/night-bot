# Native runtime and compatibility boundaries

Pi agent-core1.5.0 owns inference/tool iteration. Pi coding-agent SessionManager
owns current branch context and checksummed single-writer history. App-owned
services enforce authorization, side-effect intent/result receipts, bounded
concurrency, commit-before-idle and restart fencing. An uncertain terminal commit
fails the instance; completed effects are not redispatched on recovery.

No external registry DSH runtime packages remain in a production-only install.
Default Host composition mounts49 locally owned replacements and native spill/
configuration support. Generic Cordis/schema/native-system libraries remain
ordinary dependencies, rather than a DSH Host. Public legacy package names map
explicitly to local owners/protocols; SDK ABI metadata is separate from Pi/app
versioning. Original Runtime classes exist only in independent test references.

Compatibility intentionally retained:

- The event/audit/publication/inbox façade preserves source business APIs and
  strict receiver/ownership semantics. Its surface fold is not model context.
- Released v0–v4 codecs preserve historical readers, adjacent migrations,
  relationship validation, corruption refusal and plain/zstd import. The app
  writes current history through Pi; legacy IO is isolated import support.
- The verifier is an isolated ESM worker using the shared owned verifier. It
  validates physical bytes, logical identity/count, prefix and complete assistant
  streams, without the old bundled model Runtime.
- Windows ACL/process support retains exact MIT source provenance and low-level
  flags. Managed restart evidence binds native source paths and reviewed LF/CRLF
  hashes. Explicit legacy deployment probes remain separate compatibility input.

The source façade/format code is not presented as newly invented algorithms or
additional active-service replacement credit. Original/target hashes, rewrites,
licenses and release-generated golden byte fixtures are retained for review.

Functional mapping and acceptance limits are in MIGRATION.md and VALIDATION.md.
Real DWS/vendor/business, Windows/macOS kernel and optional Claude/browser/plugin
integrations require their own installed, authorized environment. No current
result claims that external acceptance has occurred.
