# Issue 83: evidence-linked memory reconciliation

The old flow could save a report using a current human source, then create a new
reflection after verification without revisiting the report. A completion-only
Router turn could not use the human-source mutation port: its current admission
contains a task event, not a new human message. Merely changing that prompt would
leave either a failed update or an authorization bypass.

The Router now has `resident_memory_review` and `resident_memory_reconcile`.
Review reads the actual completion and traverses the normal root/topic/entry
indexes. The Router, not keyword matching or timestamps, compares old evidence
with the new result and chooses keep, update or delete. The memory prompt calls
for this assessment before settling a relevant completion, including follow-up
verification after an earlier saved report. Reflection remains independent; a
new reflection lesson is not evidence that an old report was reviewed.

The completion port only accepts an admitted pending completion in the current
conversation and Router generation, matching the exact current completion
command and task versions. It revalidates the live actor, memory write capability,
channel binding, source holds/revocation and current source versions under the
memory write lock. It cannot create a new entry. CAS uses the existing entry's
revision. Task model memory permissions and the human-source tools are unchanged.

Updates preserve original applicability and evidence, record the completion event
as a task source (never as a human quote), retain `originSource`, prior content,
provenance and task/source references, then read back the stored result. Delete
also requires readback. Failures return failure/uncertain, not success. An atomic completion/key/input-hash receipt permits confirmation and derived
cleanup after an already-committed but unconfirmed write. A retry only confirms
the exact current content; it cannot overwrite a later revision or delete a
recreated entry. Conflicting parameters are rejected inside the storage transaction.
Completed Router inputs
remain consumed on restart. Keep does not create another memory version; its
reason stays in the official Pi tool journal. Existing v1/v2 contextual entries
fail explicitly rather than silently dropping or broadening their applicability.

## Validation scope

Scripted local model tests exercise real Host, Pi, channel, task and Markdown
storage. They prove the maintenance path and guards, not that every external
model will always make the correct semantic decision. No live vendor message,
Windows deployment, merge or real-model evaluation is part of this check.

Verified on the isolated Linux worktree based on `569a6dc`:

- New reconciliation suite: 7/7 (three semantic scenarios within the full path,
  stale/foreign/revoked event and source cases, write capability checks, failed
  persistence/readback, exact source/version tracking, durable uncertain-write
  recovery and cold no-replay).
- Existing memory store, progressive recall, official source and resident Router:
  35/35.
- Existing resident Router flow: 33/33.
- Existing memory wire/extraction/privacy/kernel: initially 34/36 with dependencies
  symlinked outside the worktree. Both capped-grep failures disappeared after
  copying the installed dependency tree into this worktree; final kernel plus
  reconciliation run: 12/12. No application permission or sandbox was relaxed.
- Source accounting, production imports, native-runtime and whitespace guards:
  passed.
- Default aggregate started separately; not represented by the targeted counts.
- Final reconciliation + store + progressive combined run: 35/35 after the
  uncertain-write recovery changes, including argument-order-independent retry
  identity and concurrent input-hash conflict rejection inside the transaction.
