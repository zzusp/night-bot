# Native business receipt path bindings

Pi entries, signed messages, user strings and effect arguments are never rewritten.
The native journal remains `pi-native-v1` with commit v2. Only these trusted Host
business receipt fields acquire an optional envelope sidecar:

- `directory/changed`: `payload.cwd`.
- `sandbox/policy`: `payload.artifactRoot.artifactRoot` and
  `payload.artifactRoot.sessionCwd`, when an artifact binding exists.

```
{
  version: 1, domain: "directory", kind: "changed",
  payload: {cwd: "/source/data/workspaces/project/sub", recovered: false},
  pathBindings: {
    version: 1, kind: "install-relative", originRoot: "/source",
    fields: {cwd: "data/workspaces/project/sub"}
  }
}
```

The Host codec stamps the sidecar only after the registered payload schema passes.
A caller cannot supply its own sidecar to `appendAudit`. Commit validates manually
appended business entries against that same configured Host codec. Encoding and
decoding require the path to remain inside the explicitly configured workspaces
root. There is no home fallback, string search/replacement, or new permission root.

The strict journal decoder validates exact sidecar vocabulary, the known field set, and each original
payload path's binding to the recorded origin root plus relative value. Only the
logical audit view decodes those known fields at the destination. Raw entries,
official `sourceEntry` projection, message bytes, signatures, commit hashes and
backup manifest v1 stay unchanged. General envelope validation also accepts these
logical views; it is never a replacement for strict raw-journal path validation. New receipts after restore record the new Host
origin root; the immutable session header and prior receipts are not edited.

Unmarked existing current-native receipts remain readable at their original root.
If the strict header proves relocation and an unmarked receipt contains one of
these controlled fields, reading fails with
`PI_SESSION_PORTABLE_BUSINESS_PATH_UNPROVEN`. No old path is silently retained as
an active grant, guessed, rewritten, or substituted with a broader default. Own
backup restoration already holds effects and forbids automatic delivery; a path
proof failure does not settle or replay any effect. Old generic Session/event
journals are unsupported, not an upgrade source.

Permission mode/approval selections contain no paths and retain their ordinary
schemas. Task effects, tool arguments, frozen source text and ordinary attachments
are opaque business evidence; this codec does not retarget them. Future business
kinds needing controlled path relocation require an explicit schema/field contract.
