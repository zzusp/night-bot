
Scope authority update (2026-11-05): no registry Scope implementation remains in
production peer resolution. Four retained SDK helper consumers resolve the local
compatibility reexport and share function identity/private state with the app.
The alias remains explicitly recorded in runtime-audit.json and the source hash
in scope-compat-manifest.json; this does not count as an extra active service
replacement. Arbitrary independently installed external plugins are not covered
by the four known-consumer startup check. Sixteen external direct DSH packages
remain, including legacy session formats, LLM/schema/error helpers and Windows ACL.
