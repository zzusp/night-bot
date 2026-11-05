// MIT source-derived consumed inbox/turn accounting fold; see licenses/dsh-agent-MIT.txt. Audit accounting only, never model context authority.
function accountsForClaim(reason) {
	switch (reason.kind) {
		case "completed": return false;
		case "blocked":
		case "aborted":
		case "interrupted":
		case "error": return true;
		/* v8 ignore next 5 -- unreachable: `max-tokens` requires a step and short-circuits
		* before this call; `forked` exists only in constructor seed history, while production
		* callers fold an operation-owned suffix. `TurnEndReasonMap` is merge-extensible, so a
		* backend-added variant cannot be listed; an unnameable ending over consumed input must
		* not read as success. */
		default: return true;
	}
}
/**
* Fold one agent log, or an owned suffix of one, into its account of consumed
* work. Single pass, and every input is the log itself: no caller has to sample
* live state before cancelling, so a cancellation issued by anyone — the owner's
* teardown, an ancestor's interrupt, an unloading plugin — reads the same.
* @param events - the log, or an owned suffix, to fold.
* @returns the accounting turn when one closed, and whether work was dropped unrun after it.
*/
function foldConsumedWork(events) {
	const stepped = /* @__PURE__ */ new Set();
	const claimed = /* @__PURE__ */ new Set();
	let open;
	let end;
	let droppedUnrun = false;
	for (const event of events) switch (event.type) {
		case "turn/start":
			open = event.data.turn;
			break;
		case "step/start":
			stepped.add(event.data.turn);
			break;
		case "agent/inbox/spliced": {
			const { removedCount, outcome, inserted } = event.data;
			if (removedCount === void 0) break;
			if (outcome === "canceled") droppedUnrun ||= inserted.length === 0;
			else if (open !== void 0) claimed.add(open);
			break;
		}
		case "turn/end": {
			const { turn, reason } = event.data;
			open = void 0;
			if (stepped.delete(turn) || claimed.delete(turn) && accountsForClaim(reason)) {
				end = event;
				droppedUnrun = false;
			}
			break;
		}
		default: break;
	}
	return {
		...end === void 0 ? {} : { end },
		droppedUnrun
	};
}

export {foldConsumedWork};
