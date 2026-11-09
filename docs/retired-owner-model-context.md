# Business content files, not Owner history

Production has one import of this module: group-coordinator-session uses
createOfficialModelContentIndex to bound a current business envelope and tool
results. The file catalog stores immutable admitted business values; it does not
read, append, edit, compact or reconstruct a transcript. Factory setup may create
it from the actor's exact logical metadata before the SDK session exists.

The zero-production-caller exports modelHostMessage/modelHostInput,
createModelContentIndex/modelContentRoot, taskModelInput, executionModelInput,
executionDirectory, operationDirectory and operationModelReadback are retired.
This also removes old parent-session scope inheritance and the deferred Owner
catalog machinery. Prior projection caches no longer imply that an object is
visible: deduplication is local to one payload and immutable byte storage.

| Retired old test case | Retained current contract/proof |
| --- | --- |
| Owner/team member selection, historical execution window, old continuation self-result and Topic-scoped member resume | These cancelled orchestration shapes have no current caller. Official CurrentTask keeps one execution session; existing pi-single-task-official and official factory tests own dispatch, continuation, receipts and scope |
| Stage/provider recovery, unknown operations, human corrections and material references | model-context tests retain exact current input revisions, original author/version/correction and unknown-effect facts behind lossless bounded snapshots; no algorithm selects or authorizes a historical execution |
| Source deduplication, many short requirements and nested quote/identity graphs | Current payload tests retain all source records/edges and deduplicate equal body bytes without merging authors or permissions |
| Native Session append/surface visibility and reopen | Removed. Real SDK context edits/compaction and authenticated business inputs remain tested separately; the content catalog cannot change message visibility or history |
| Long instructions, file paths and complete evidence | Existing immutable files, exact JSON Pointer reads, Unicode pagination, tamper checks, foreign-scope and symlink rejection remain; readRequired never proves read or authority |
| Whole UTF-8 budget, long keys, reserved fields and tool output bypasses | Current host/wrapOutput budgets retain a complete immutable overflow snapshot; explicit official tool execution reads leaf data and rejects stale/foreign references |

Night persistence/journals, model queries, permissions, codecs, skills,
instructions and Host implementations are unchanged. Official resource and
compaction tests remain the authority for their separate lifecycle contracts.
