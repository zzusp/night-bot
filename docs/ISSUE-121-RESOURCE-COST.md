# Router resource cost (#121)

## Verified causes and changes

- `before_agent_start` and every `turn_end` refresh scoped instructions and skills. A filesystem skill previously passed through provider `get`, mapper `readText`, and provider `get` again. Mapping now uses one fresh read through the consuming actor's selected filesystem for the built-in filesystem provider. This is not a cross-round body cache. Catalog metadata mismatches invalidate and retry; registration/revision, actor lifetime, root/realpath, and scoped filesystem checks still fail closed. Dynamic providers retain repeated `get` validation because their authorization can change without a catalog invalidation event.
- Learned-skill resource discovery previously incremented a load counter and wrote the usage file for every provider validation. Resource discovery is now explicitly read-only for that counter; an actual `skills.get` still counts. This does not add a usage database or derive model usage from resource loading.
- `resident_task_query` defaults to a task summary, ten tasks per list page. `taskId` plus `detail: "full"` retrieves the original full task and dependency evidence. Plan/action returns summarize the task objects without changing durable command receipts, task history, source associations, or revision fences. The Router is instructed to fetch full details before dependency evaluation or artifact delivery. The underlying business query still reads the task list before slicing; this is bounded model payload, not database pagination.

## Preserved boundaries

The maximum four concurrent skill mappings already existed. This change does not introduce that parallelism or claim it as a new improvement. No unknown-effect operation is replayed, no task authorization or recovery fence is relaxed, and no execution outcome is inferred from a performance trace.

Final `turn_end` refresh is **not** skipped: Pi 1.5 polls steering/follow-up after the turn-end handlers, and other handlers may request continuation. Neither `outcome=completed` nor an empty pending-message snapshot proves there will be no next inference. Moving refresh requires a reliable before-next-turn integration, not guessing at the final turn.

## Verification and limits

Resource regression tests use the real NativeSkills registry, NativeSkillFilesystem, Reflection and scoped Host resolver. They assert one read per warm mapping; fresh content without a watcher notification; metadata refresh; permission revocation; dynamic-provider content/revocation races; concurrent revision changes; cancellation; and unchanged read counters during resource discovery. Router tests exercise large durable task records, summary/default pagination, explicitly requested full detail, cross-conversation refusal, and actual Pi/Host dependency/reopen and attachment delivery flows.

These are deterministic local regressions, not a production latency comparison. The issue's 185-second sample contains nested timing spans and an unexplained interval; neither can be attributed in full to skill loading or added together as independent durations. No provider request count, billing claim, same-model p50/p95 improvement, or Windows production result is asserted. A same-environment before/after trace remains required to quantify end-to-end benefit. The remaining final-turn refresh and per-round current authorization reads are documented rather than concealed by a cache.
