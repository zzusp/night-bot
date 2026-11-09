> 历史快照（2026-11-05）：以下 Scope 消费者、compatibility reexport、alias 和 16 个外部包属于当时状态，逐字保留，不是当前依赖或部署合同，也不要求恢复已退入口。现行职责见 [RUNTIME](RUNTIME.md)，当前处置与受验版本见[唯一目标](acceptance/resident-conversation-routing/goal.md)；保留派生实现仍须署源。


Scope authority update (2026-11-05): no registry Scope implementation remains in
production peer resolution. Four retained SDK helper consumers resolve the local
compatibility reexport and share function identity/private state with the app.
The alias remains explicitly recorded in runtime-audit.json and the source hash
in scope-compat-manifest.json; this does not count as an extra active service
replacement. Arbitrary independently installed external plugins are not covered
by the four known-consumer startup check. Sixteen external direct DSH packages
remain, including legacy session formats, LLM/schema/error helpers and Windows ACL.
