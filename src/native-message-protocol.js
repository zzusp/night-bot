// MIT source-derived message, projection and assistant-stream protocols; see licenses/dsh-llm-MIT.txt.
// Request markers are application-local. Canonical error classes and attribution are owned by the adjacent native LLM protocols.
import {assertNever,deepFreeze,snapshotJsonValue} from './native-values.js';
import {brandString} from './native-brand.js';
import {randomUUID} from 'node:crypto';
import {HarnessError,LlmError} from './native-llm-errors.js';
//#region lib/types/message.js
/** Message value types, identity, and immutable construction helpers. */
/**
* Bound for a `notice` summary. Producers commit the one-line account to the
* durable log; its inputs — task labels, goal objectives, tool arguments —
* are caller text with no length of their own.
*/
const CONTEXT_SUMMARY_MAX_CHARS = 120;
/**
* Bound one `notice` summary to {@link CONTEXT_SUMMARY_MAX_CHARS}.
* @param summary - the producer's one-line account, of any length.
* @returns the account, ellipsized when it exceeds the bound.
*/
function boundContextSummary(summary) {
	return summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`;
}
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return deepFreeze(structuredClone({
		...input,
		id: brandString(randomUUID())
	}));
}
/**
* Create an identified, immutable developer message.
* @param input - content and producer source for the new message.
* @returns a detached developer message with a fresh identity.
*/
function createDeveloperMessage(input) {
	return createMessage({
		...input,
		role: "developer"
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
/**
* Create one identified model-produced assistant message and freeze it before publication.
* @param input - complete content plus the provider, model, and optional replay state for a new assistant message.
* @returns an immutable assistant message with fixed role/source tags and a fresh stable identity.
*/
function createAssistantMessage(input) {
	return createMessage({
		role: "assistant",
		content: input.content,
		source: {
			kind: "model",
			...input.source
		}
	});
}
/**
* Create and freeze one identified system-role message holding a rendered
* system prompt.
* @param text - the complete rendered prompt; `''` records "no system prompt".
* @returns an immutable system message with a fresh stable identity.
*/
function createSystemMessage(text) {
	return createMessage({
		role: "system",
		content: text.length === 0 ? [] : [{
			type: "text",
			text
		}],
		source: { kind: "system-prompt" }
	});
}
/**
* Create and freeze one identified tool-result message.
* @param input - call identity, raw result blocks, and outcome.
* @returns an immutable tool-role message that answers the tool call.
*/
function createToolResultMessage(input) {
	return createMessage({
		role: "tool",
		source: {
			kind: "tool",
			callId: input.callId
		},
		toolCallId: input.callId,
		content: input.content,
		isError: input.isError
	});
}
//#endregion
//#region lib/types/error.js
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
/** Canonical provider-neutral code for an exhausted account quota or balance. */
const QUOTA_EXCEEDED_CODE = "QUOTA";
/** Account-token quota that can be replenished through the first-party billing page. */
const ACCOUNT_QUOTA_EXCEEDED_CODE = "ACCOUNT_QUOTA";
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
/**
* Canonical provider-neutral code for a credential that was supplied but
* cannot be used — malformed rather than absent. Distinct from
* `MISSING_CREDENTIAL` because the fix differs: correct the stored value
* rather than supply one. Deliberately outside the default retryable set —
* a malformed credential fails identically on every attempt.
*/
const INVALID_CREDENTIAL_CODE = "INVALID_CREDENTIAL";
/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Recognize the context-overflow wording used by OpenAI-compatible providers
* and library adapters. Adapters pass all available provider code, type, and
* message text so both thrown and in-band delivery styles share one classifier.
* @param detail - provider error code/type/message text joined into one string.
* @returns true when the detail identifies a request exceeding the model context window.
*/
function isContextWindowExceededError(detail) {
	return STRUCTURED_CONTEXT_OVERFLOW.test(detail) || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail) || TOO_LARGE_FOR_CONTEXT.test(detail) || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail) || EXCEEDS_MODEL_CONTEXT.test(detail);
}
/**
* Recognize provider wording that identifies an exhausted account quota rather
* than a transient request-rate limit.
* @param detail - provider error code/type/message text joined into one string.
* @returns true only for terminal quota, balance, credit, budget, or usage-limit wording.
*/
function isQuotaExceededError(detail) {
	return /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail) || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail) || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail) || /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail) || /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail);
}
/**
* Render a thrown value with its full `cause` chain and AggregateError
* members, so transport wrappers like undici's `TypeError: fetch failed`
* surface the underlying failure instead of masking it. Plain structured
* failures render their own data-backed `message`. Diagnostic-surface
* rendering only (messages, notices, logs) — never parse the result; route on
* {@link HarnessError.code}.
* @param value - the caught value (`unknown` in catch clauses).
* @returns the outermost message first, each cause appended with `: ` (skipped
* when it repeats the wrapper message verbatim), and AggregateError members
* bracketed and `; `-joined.
*/
function errorChain(value) {
	const path = /* @__PURE__ */ new Set();
	const render = (current) => {
		if (path.has(current)) return "<circular cause>";
		path.add(current);
		try {
			if (!(current instanceof Error)) {
				if (typeof current === "object" && current !== null) {
					const descriptor = Object.getOwnPropertyDescriptor(current, "message");
					if (descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string") return descriptor.value;
				}
				return String(current);
			}
			const message = current.message === "" ? current.name : current.message;
			const members = current instanceof AggregateError && current.errors.length > 0 ? ` [${current.errors.map(render).join("; ")}]` : "";
			const causeText = current.cause === void 0 || current.cause === null ? "" : render(current.cause);
			return `${message}${members}${causeText === "" || causeText === message ? "" : `: ${causeText}`}`;
		} catch {
			return "<unrenderable value>";
		} finally {
			path.delete(current);
		}
	};
	return render(value);
}
/**
* Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
* @param value - the caught value (`unknown` in catch clauses).
* @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
*/
function isHarnessError(value) {
	return value instanceof HarnessError;
}
/**
* Canonical code for a request an image-capable route cannot send until more
* of its images are offloaded. The failure's `offloadImages` names how many
* more of the oldest retained occurrences must be offloaded;
* `dsh-compaction-image-offload` records an `image/offload` selection before
* the agent or summarizer retries with freshly derived input.
*/
const IMAGE_OFFLOAD_REQUIRED_CODE = "IMAGE_OFFLOAD_REQUIRED";
//#endregion
//#region lib/types/call-config.js
/**
* Conversation call configuration and freeze utilities. Provider routing,
* model, reasoning effort, and sampling values are request-header state that
* can affect cache reuse; request waterfalls replace them and the loop logs
* changed snapshots instead of allowing silent per-call drift.
* @module dsh-llm/call-config
*/
/** Process-local identities of request objects assembled by dsh-agent-loop. */
const AGENT_LOOP_REQUESTS = /* @__PURE__ */ new WeakSet();
/**
* Field-wise equality over {@link LlmCallConfig} — the comparison a caller
* runs to decide whether a proposed configuration is a real change (worth a
* logged header snapshot) or the held one restated.
* @param a - one configuration.
* @param b - the other.
* @returns whether every field (including the `stop` list, element-wise) matches.
*/
function callConfigEquals(a, b) {
	if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
	if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
	return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
/**
* Mark one exact request object as assembled by dsh-agent-loop.
* @param request - loop-owned request envelope before LLM dispatch.
* @returns the same request object marked as created by the process-local agent loop.
*/
function markAgentLoopRequest(request) {
	AGENT_LOOP_REQUESTS.add(request);
	return request;
}
/**
* Test whether the exact request object was assembled by dsh-agent-loop.
* @param request - request envelope observed at the LLM waterfall.
* @returns whether {@link markAgentLoopRequest} recorded this object.
*/
function isAgentLoopRequest(request) {
	return AGENT_LOOP_REQUESTS.has(request);
}
//#endregion
//#region lib/types/adapter-failure.js
/**
* Normalization for values thrown by a final LLM adapter boundary.
*
* @module @deepseek-ai/dsh-llm/adapter-failure
*/
/**
* Detach serializable provider facts from a value thrown by an adapter.
* @param value - arbitrary value thrown during adapter dispatch or iteration.
* @returns immutable provider-neutral facts suitable for a terminal finish chunk.
* @internal
*/
function normalizeLlmFailure(value) {
	const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
	const carried = ownFailureSnapshot(error);
	if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
	return Object.freeze({
		message: errorMessage(error),
		code: harnessErrorCode(error)
	});
}
/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value) {
	try {
		const message = String(value);
		return message.length > 0 ? message : "LLM adapter failed";
	} catch (_hostileThrownValue) {
		return "LLM adapter failed";
	}
}
/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
		return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	try {
		const candidate = value;
		const message = candidate.message;
		const code = candidate.code;
		const status = candidate.status;
		const providerRetryAfterMs = candidate.providerRetryAfterMs;
		const requestId = candidate.requestId;
		const offloadImages = candidate.offloadImages;
		if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
		return Object.freeze({
			message,
			code,
			...status === void 0 ? {} : { status },
			...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
			...requestId === void 0 ? {} : { requestId },
			...offloadImages === void 0 ? {} : { offloadImages }
		});
	} catch (_sdkFailureGetter) {
		return;
	}
}
/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage(error) {
	try {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch (_sdkMessageGetter) {}
	return "LLM adapter failed";
}
/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error) {
	return error instanceof HarnessError ? error.code : "UNKNOWN";
}
//#endregion
//#region lib/types/api-key.js
/**
* The one definition of a well-formed provider API key, shared by every
* adapter that puts one in an HTTP header.
* @module @deepseek-ai/dsh-llm/api-key
*/
/**
* Characters an HTTP header value carries verbatim and every known provider
* key uses: printable ASCII, space excluded. A key outside this set cannot
* reach any provider — `fetch` refuses to build the header — so this is a
* transport invariant rather than one provider's policy. Latin-1 is excluded
* deliberately: a header could carry it, but no provider issues it, and
* admitting it trades a local explained refusal for an opaque 401.
*/
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
/**
* Judge one *supplied* API key, trimming surrounding whitespace first.
*
* Trimming is silent because a padded key has one unambiguous reading; every
* other defect is reported. Absence is a configuration state this function
* never sees — a profile naming no credential authenticates through the
* provider's own ambient discovery or OAuth — so callers decide whether a
* value was supplied before asking.
* @param raw - the key exactly as configured, stored, or typed.
* @returns the trimmed key, or why it cannot be used.
*/
function normalizeApiKey(raw) {
	const value = raw.trim();
	if (value.length === 0) return {
		ok: false,
		reason: "empty"
	};
	if (!LEGAL_API_KEY.test(value)) return {
		ok: false,
		reason: "illegalCharacters"
	};
	return {
		ok: true,
		value
	};
}
//#endregion
//#region lib/types/content.js
/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */
/**
* Bridge one attachment provider's host object location into the mounted
* tool execution world. The consumer supplies the current filesystem
* provider's mapping without making attachment or LLM definitions depend on it.
* @param attachments - provider that owns the normalized attachment object.
* @param mapHostPath - map one absolute host path into the current tool execution world.
* @param ref - durable normalized attachment reference.
* @returns a read-only execution-world path, or undefined when either provider exposes no mapping.
* @throws an attachment error when the durable reference is invalid.
*/
function resolveImageAttachmentAccess(attachments, mapHostPath, ref) {
	const hostPath = attachments.imageHostPath(ref);
	if (hostPath === void 0) return void 0;
	const readonlyPath = mapHostPath(hostPath);
	return readonlyPath === void 0 ? void 0 : { readonlyPath };
}
function quoted(value) {
	return JSON.stringify(value);
}
function imageIdentity(ref) {
	return ref.name === void 0 ? String(ref.attachmentId) : `${quoted(ref.name)} (${ref.attachmentId})`;
}
function extension(mediaType) {
	switch (mediaType) {
		case "image/png": return ".png";
		case "image/jpeg": return ".jpg";
		case "image/webp": return ".webp";
		case "image/gif": return ".gif";
		default: return assertNever(mediaType, "image extension");
	}
}
function normalizedAccessText(ref, access) {
	return ` Normalized copy (read-only; may be resized or re-encoded): ${quoted(access.readonlyPath)} (${ref.width}x${ref.height}px, ${ref.mediaType}). Source dimensions, format, and byte size may differ. Copy to a writable path ending in ${extension(ref.mediaType)} before editing.`;
}
/**
* Stable text shown to a model that cannot accept one durable image reference.
* @param ref - durable normalized attachment omitted from the request.
* @returns deterministic text-only placeholder.
*/
function textOnlyImageText(ref) {
	return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
/**
* Stable model-facing handle for one exact request image. Identity comes from
* the occurrence's own durable reference: request versions are prepared per
* attachment id, so one shared version may serve occurrences whose display
* names differ.
* @param ref - the occurrence's durable normalized attachment.
* @param version - exact request-image dimensions shown beside the text.
* @param access - optional path resolved for the current tool execution world.
* @returns attachment handle and request-image dimensions.
*/
function requestImageHandleText(ref, version, access) {
	const preview = `Image ${imageIdentity(ref)}; request preview ${version.width}x${version.height}px.`;
	return access === void 0 ? `${preview} It may be resized or re-encoded; source dimensions, format, and byte size may differ.` : preview + normalizedAccessText(ref, access);
}
/**
* Stable per-image placeholder for a request-limit omission.
* @param ref - durable normalized attachment omitted from this request.
* @param access - optional provider-resolved path for model tools.
* @returns identity, normalized metadata, and the available recovery path.
*/
function offloadedImageText(ref, access) {
	const identity = `image omitted to fit request image limits; ${imageIdentity(ref)}.`;
	if (access === void 0) return `[${identity} No local normalized image path is available; ask the user to attach it again if needed.]`;
	return `[${identity}${normalizedAccessText(ref, access)}]`;
}
/**
* True when typed model content contains an image block. This is the one image
* walk shared by every image policy (capability gating, text-only
* serialization, compaction survey), so a consumer cannot silently diverge.
* @param content - typed model content blocks.
* @returns whether any block is an image.
*/
function contentHasImage(content) {
	return content.some((block) => block.type === "image");
}
/**
* True when typed model content contains a file block.
* Reads current content on every call without retaining scan results.
* @param content - typed model content blocks.
* @returns whether any block is a file.
*/
function contentHasFile(content) {
	for (const block of content) if (block.type === "file") return true;
	return false;
}
/**
* Stable model-facing handle for one durable file reference: the address of
* the verbatim stored copy and the instruction to read it on demand. This is
* the only representation a provider ever receives for a file.
* @param ref - durable verbatim file reference.
* @param readonlyPath - execution-world path of the stored copy, when resolvable.
* @returns deterministic handle text naming the file, its size, and its address.
*/
function fileHandleText(ref, readonlyPath) {
	const digest = String(ref.attachmentId).slice(7, 15);
	const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
	if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
	return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
/** Replace every file occurrence with handle text. */
function replaceFilesWithHandles(blocks, resolvePath) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "file") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: fileHandleText(block.attachment, resolvePath(block.attachment))
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
	if (!messages.some((message) => contentHasFile(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceFilesWithHandles(message.content, resolvePath);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/** Base64 length of raw image bytes, including padding. */
function base64Length(bytes) {
	return Math.ceil(bytes / 3) * 4;
}
/**
* Visit every image occurrence of typed content in message order.
* @param content - typed model content blocks.
* @param visit - called once per occurrence.
*/
function visitImageBlocks(content, visit) {
	for (const block of content) if (block.type === "image") visit(block);
}
/** Replace every offloaded occurrence with its placeholder. */
function replaceOffloadedImages(blocks, placeholder) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "image" && block.offloaded === true) {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: placeholder(block.attachment)
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectOffloadedImages(messages, placeholder) {
	return messages.map((message) => {
		const content = replaceOffloadedImages(message.content, placeholder);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
/**
* Number of oldest retained image occurrences one route budget removes, in
* whole count and byte quanta, once the budget is exceeded. The result depends
* only on the represented lengths, so every route names the count the same
* way.
* @param lengths - represented byte length of every retained occurrence, oldest first.
* @param budget - count/byte budgets and removal quanta; unbounded when absent.
* @returns how many leading occurrences to offload.
*/
function offloadedImagePrefixCount(lengths, budget) {
	const total = lengths.reduce((sum, bytes) => sum + bytes, 0);
	const excessCount = budget.maxImages === void 0 ? 0 : Math.max(0, lengths.length - budget.maxImages);
	const excessBytes = budget.maxBytes === void 0 ? 0 : Math.max(0, total - budget.maxBytes);
	if (excessCount === 0 && excessBytes === 0) return 0;
	const countQuantum = budget.countQuantum ?? 1;
	const byteQuantum = budget.byteQuantum ?? 1;
	const removeCount = excessCount === 0 ? 0 : Math.ceil(excessCount / countQuantum) * countQuantum;
	const removeBytes = excessBytes === 0 ? 0 : Math.ceil(excessBytes / byteQuantum) * byteQuantum;
	let count = 0;
	let removedBytes = 0;
	for (const imageBytes of lengths) {
		if (count >= removeCount && (removeBytes === 0 || (byteQuantum === 1 ? removedBytes >= removeBytes : removedBytes > removeBytes))) break;
		removedBytes += imageBytes;
		count += 1;
	}
	return count;
}
/**
* Number of oldest retained occurrences a route must still offload before a
* derived request fits its budget at the exact byte length the route sends;
* zero when the request fits. A route fails with `IMAGE_OFFLOAD_REQUIRED`
* carrying this count instead of offloading on its own.
* @param messages - derived request history carrying the surface's `offloaded` marks.
* @param budget - route representation, budgets, and removal quanta.
* @param versionBytes - exact request-version byte length of one retained occurrence.
* @returns how many more leading retained occurrences to offload.
*/
function requiredImageOffload(messages, budget, versionBytes) {
	const lengths = [];
	for (const message of messages) visitImageBlocks(message.content, (block) => {
		if (block.offloaded === true) return;
		const bytes = versionBytes(block);
		lengths.push(budget.representation === "base64" ? base64Length(bytes) : bytes);
	});
	return offloadedImagePrefixCount(lengths, budget);
}
/** Replace every image occurrence for a text-only model. */
function replaceImagesForTextModel(blocks) {
	let next;
	for (const [index, block] of blocks.entries()) {
		if (block.type === "image") {
			next ??= blocks.slice(0, index);
			next.push({
				type: "text",
				text: textOnlyImageText(block.attachment)
			});
			continue;
		}
		next?.push(block);
	}
	return next ?? blocks;
}
function projectImagesForTextModel(messages) {
	if (!messages.some((message) => contentHasImage(message.content))) return messages;
	return messages.map((message) => {
		const content = replaceImagesForTextModel(message.content);
		return content === message.content ? message : {
			...message,
			content
		};
	});
}
function withoutDeveloperMessages(messages) {
	const retained = messages.filter((message) => message.role !== "developer");
	return retained.length === messages.length ? messages : retained;
}
function toolDeclarations(tools, mode, history) {
	const declarations = new Map(history.tools.map((tool) => [tool.name, tool]));
	for (const update of history.updates) for (const tool of update.additions) if (!declarations.has(tool.name)) declarations.set(tool.name, {
		...tool,
		deferLoading: true
	});
	switch (mode) {
		case "in-history": return declarations;
		case "addition-only": {
			const activeNames = new Set(tools?.map((tool) => tool.name));
			for (const name of declarations.keys()) if (!activeNames.has(name)) declarations.delete(name);
			return declarations;
		}
		/* v8 ignore next 2 -- closed-union exhaustiveness guard */
		default: return assertNever(mode);
	}
}
/**
* Construct provider declarations from session-folded history without changing logged active tools.
* Unsupported routes and incomplete history use current declarations without developer updates.
* Explicitly deferred baseline tools become available only after their first retained addition.
* @param messages - complete request inputs, or the prefix selected for an auxiliary call.
* @param tools - currently active tool schemas.
* @param toolUpdate - the resolved route's update mode.
* @param history - immutable state folded from committed headers and developer messages.
* @returns provider declarations and the corresponding filtered history.
*/
function projectToolUpdates(messages, tools, toolUpdate, history) {
	if (toolUpdate === void 0) {
		let immediateTools = tools;
		if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
		return {
			messages: withoutDeveloperMessages(messages),
			tools: immediateTools
		};
	}
	if (history === void 0) return {
		messages: withoutDeveloperMessages(messages),
		tools
	};
	const messageIds = new Set(messages.flatMap((message) => message.role === "developer" ? [message.id] : []));
	if (history.updates.some((update) => !messageIds.has(update.messageId))) return {
		messages: withoutDeveloperMessages(messages),
		tools
	};
	const declarations = toolDeclarations(tools, toolUpdate, history);
	const updateIds = new Set(history.updates.map((update) => update.messageId));
	const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
	const projectedMessages = [];
	for (const message of messages) {
		if (message.role !== "developer") {
			projectedMessages.push(message);
			continue;
		}
		if (!updateIds.has(message.id)) continue;
		const content = message.content.filter((block) => {
			switch (block.type) {
				case "tool-addition":
					if (!declarations.has(block.toolName) || offered.has(block.toolName)) return false;
					offered.add(block.toolName);
					return true;
				case "tool-removal":
					if (toolUpdate !== "in-history") return false;
					return offered.delete(block.toolName);
				default: return true;
			}
		});
		if (content.length === 0) continue;
		if (content.length === message.content.length) projectedMessages.push(message);
		else projectedMessages.push({
			...message,
			content
		});
	}
	return {
		messages: projectedMessages.length === messages.length && projectedMessages.every((message, index) => message === messages[index]) ? messages : projectedMessages,
		tools: [...declarations.values()]
	};
}
//#endregion
//#region lib/types/brand.js
/**
* dsh-llm's owned branded ids: tool-call correlation and provider request
* diagnostics.
*
* The `Branded<B>` primitive and stateless constructor live in
* `@deepseek-ai/dsh-brand` so every owner of a cross-boundary id can brand it
* without depending on dsh-llm; see that package's README for the
* nominal-typing policy.
*
* @module @deepseek-ai/dsh-llm/brand
*/
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string with the message-id brand.
*/
function MessageId(id) {
	return brandString(id);
}
/**
* Brand a string as a {@link ToolCallId}.
* @param id - the provider-issued or synthesized call id.
* @returns the same string with the tool-call-id brand.
*/
function ToolCallId(id) {
	return brandString(id);
}
/**
* Brand a provider-issued request identifier.
* @param id - the opaque provider-issued string.
* @returns the same string, branded; no validation is performed.
*/
function ProviderRequestId(id) {
	return brandString(id);
}
/**
* Brand one loop-owned streaming attempt identifier.
* @param id - the opaque Agent-lifecycle-local identifier.
* @returns the same string with the attempt-id brand.
*/
function LlmAttemptId(id) {
	return brandString(id);
}
/**
* Brand an adapter-owned reasoning-effort identifier.
* @param id - the opaque identifier exposed by one model capability.
* @returns the same string, branded; no validation is performed.
*/
function ReasoningEffortId(id) {
	return brandString(id);
}
//#endregion
//#region lib/types/assembler.js
/**
* Incremental chunk-to-message assembler. This is the single canonical assembly
* algorithm used by the agent loop to build an assistant message from a chunk
* stream while logging the raw chunks for replay fidelity.
*
* @module @deepseek-ai/dsh-llm/assembler
*/
/**
* Incrementally assembles raw {@link StreamChunk}s into complete
* {@link ContentBlock}s and a final assistant {@link Message}.
*
* The agent loop feeds it while logging raw chunks for replay fidelity, then
* reads `blocks()` / `message()` / `usage` / `finish` once the stream ends,
* or `interruptedBlocks()` when cancellation cut the stream short.
*
* Tolerant of delta-only protocols (no block-start/end); deltas arriving for
* an index already closed by `block-end` are ignored (malformed stream) so a
* misbehaving adapter cannot grow memory or corrupt a completed block.
*/
var BlockAssembler = class {
	partials = /* @__PURE__ */ new Map();
	order = [];
	_usage;
	_finish;
	_replayState;
	/**
	* Feed one chunk into the assembly state.
	* @param chunk - the next raw chunk, in stream order.
	*/
	push(chunk) {
		switch (chunk.type) {
			case "block-start":
				if (!this.partials.has(chunk.index)) {
					this.order.push(chunk.index);
					this.partials.set(chunk.index, {
						blockType: chunk.blockType,
						text: "",
						toolCallArguments: ""
					});
				}
				return;
			case "text-delta":
			case "reasoning-delta": {
				const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
				if (partial.block) return;
				partial.text += chunk.text;
				return;
			}
			case "tool-call-delta": {
				const partial = this.ensure(chunk.index, "tool-call");
				if (partial.block) return;
				partial.toolCallId = chunk.id;
				if (chunk.name) partial.toolCallName = chunk.name;
				partial.toolCallArguments += chunk.argumentsDelta;
				return;
			}
			case "block-end": {
				const partial = this.ensure(chunk.index, chunk.block.type);
				if (partial.block) return;
				partial.block = chunk.block;
				return;
			}
			case "usage":
				this._usage = chunk.usage;
				return;
			case "finish":
				this._finish = chunk.reason;
				this._replayState = chunk.replayState;
				return;
			default: return assertNever(chunk, "BlockAssembler.push");
		}
	}
	ensure(index, blockType) {
		let partial = this.partials.get(index);
		if (!partial) {
			partial = {
				blockType,
				text: "",
				toolCallArguments: ""
			};
			this.partials.set(index, partial);
			this.order.push(index);
		}
		return partial;
	}
	assemble(partial, index) {
		if (partial.block) return partial.block;
		switch (partial.blockType) {
			case "text": return {
				type: "text",
				text: partial.text
			};
			case "reasoning": return {
				type: "reasoning",
				text: partial.text
			};
			case "tool-call": return {
				type: "tool-call",
				id: partial.toolCallId ?? brandString(`call-${index}`),
				name: partial.toolCallName ?? "",
				arguments: partial.toolCallArguments
			};
			default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
		}
	}
	/** Invariant accessor: every index in `order` has a partial. */
	mustGet(index) {
		const partial = this.partials.get(index);
		if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
		return partial;
	}
	/**
	* The one shared keep/drop decision over all seen blocks: max-token
	* truncation drops tool calls that cannot be executed safely. Emitted blocks
	* and replay metadata both derive from this result, so they cannot disagree.
	*/
	assembled() {
		const all = this.order.map((index) => this.assemble(this.mustGet(index), index));
		const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
		const blocks = kept === void 0 ? all : all.filter((_, position) => kept[position]);
		const envelope = this._replayState;
		if (envelope?.blocks === void 0) return {
			blocks,
			replay: envelope
		};
		if (envelope.blocks.length !== all.length) return {
			blocks,
			replay: void 0
		};
		return {
			blocks,
			replay: kept === void 0 || blocks.length === all.length ? envelope : {
				response: envelope.response,
				blocks: envelope.blocks.filter((_, position) => kept[position])
			}
		};
	}
	/**
	* Assemble all blocks seen so far, in stream order.
	* @returns one block per seen index, except that max-token truncation drops
	*   tool calls that cannot be executed safely; an open block assembles from
	*   its accumulated deltas (an unknown block type never closed by `block-end` throws).
	*/
	blocks() {
		return this.assembled().blocks;
	}
	/**
	* Assemble the prefix an interrupted stream can safely finalize: closed and
	* open text/reasoning blocks with non-whitespace content, in stream order.
	* Tool calls are omitted because interruption precedes dispatch; retaining
	* one would require a fabricated result. Open unknown blocks are also omitted.
	* @returns the kept blocks; empty when nothing streamed before the interruption.
	*/
	interruptedBlocks() {
		return this.order.map((index) => {
			const partial = this.mustGet(index);
			const type = partial.block?.type ?? partial.blockType;
			if (type !== "text" && type !== "reasoning") return void 0;
			return this.assemble(partial, index);
		}).filter((block) => (block?.type === "text" || block?.type === "reasoning") && block.text.trim() !== "");
	}
	/** Usage from the `usage` chunk; undefined until one arrives. */
	get usage() {
		return this._usage;
	}
	/** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
	get finish() {
		return this._finish ?? { kind: "stop" };
	}
	/**
	* Replay metadata from the terminal finish chunk, if any, with per-block
	* entries pruned in step with {@link blocks}. Undefined when the envelope's
	* entries do not align with the emitted blocks.
	*/
	get replayState() {
		return this.assembled().replay;
	}
	/**
	* The assembled assistant message.
	* @param source - provider/model attribution (without the `kind` tag) for the assembled message.
	* @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
	*/
	message(source) {
		return createAssistantMessage({
			content: this.blocks(),
			source
		});
	}
};
//#endregion
//#region lib/types/assistant-stream.js
/**
* Lossless compact representation of one model-stream attempt, plus record-level
* readers that answer common consumer questions without materializing members.
* Readers trust the static record type; expandAssistantStream is the validating
* path for records read at a durable boundary.
*/
function safeTime(value) {
	if (!Number.isSafeInteger(value)) throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`);
	return value;
}
function safeIndex(value, label) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`${label} index must be a non-negative safe integer`);
	return value;
}
function snapshotChunk(chunk) {
	const snapshot = snapshotJsonValue(chunk);
	if (snapshot === void 0) throw new TypeError("Assistant stream chunk must be losslessly JSON-serializable");
	return snapshot;
}
function safeGap(previous, next) {
	const gap = next - previous;
	return Number.isSafeInteger(gap) && previous + gap === next ? gap : void 0;
}
/** Incrementally compacts one attempt without retaining a second raw-chunk list. */
var AssistantStreamAccumulator = class {
	records = [];
	/**
	* Add one timed chunk to the compact attempt stream.
	* @param value - model chunk and its original Session timestamp.
	* @returns a detached immutable copy for assembly and live publication.
	*/
	push(value) {
		const time = safeTime(value.time);
		const chunk = snapshotChunk(value.chunk);
		const timed = deepFreeze({
			time,
			chunk
		});
		const previous = this.records.at(-1);
		switch (chunk.type) {
			case "text-delta":
			case "reasoning-delta": {
				safeIndex(chunk.index, chunk.type);
				if (typeof chunk.text !== "string") throw new TypeError(`${chunk.type} text must be a string`);
				const type = chunk.type === "text-delta" ? "text-chunks" : "reasoning-chunks";
				const gap = previous !== void 0 && previous.type === type ? safeGap(previous.lastTime, time) : void 0;
				if (previous !== void 0 && previous.type === type && previous.index === chunk.index && gap !== void 0) {
					previous.dt.push(gap);
					previous.texts.push(chunk.text);
					previous.lastTime = time;
				} else this.records.push({
					type,
					time0: time,
					index: chunk.index,
					dt: [],
					texts: [chunk.text],
					lastTime: time
				});
				return timed;
			}
			case "tool-call-delta": {
				safeIndex(chunk.index, chunk.type);
				if (typeof chunk.id !== "string") throw new TypeError("tool-call-delta id must be a string");
				if (Object.hasOwn(chunk, "name") && typeof chunk.name !== "string") throw new TypeError("tool-call-delta name must be a string");
				if (typeof chunk.argumentsDelta !== "string") throw new TypeError("tool-call-delta argumentsDelta must be a string");
				if (chunk.id.length === 0 || chunk.name === "") {
					this.records.push({
						type: "chunk",
						time,
						chunk
					});
					return timed;
				}
				const gap = previous?.type === "tool-call-chunks" ? safeGap(previous.lastTime, time) : void 0;
				const sameName = previous?.type === "tool-call-chunks" && Object.hasOwn(previous, "name") === Object.hasOwn(chunk, "name") && previous.name === chunk.name;
				if (previous?.type === "tool-call-chunks" && previous.index === chunk.index && previous.id === chunk.id && sameName && gap !== void 0) {
					previous.dt.push(gap);
					previous.args.push(chunk.argumentsDelta);
					previous.lastTime = time;
				} else this.records.push({
					type: "tool-call-chunks",
					time0: time,
					index: chunk.index,
					dt: [],
					id: chunk.id,
					...Object.hasOwn(chunk, "name") ? { name: chunk.name } : {},
					args: [chunk.argumentsDelta],
					lastTime: time
				});
				return timed;
			}
			case "block-start":
			case "block-end":
			case "usage":
			case "finish":
				this.records.push({
					type: "chunk",
					time,
					chunk
				});
				return timed;
			default: return assertNever(chunk, "AssistantStreamAccumulator.push");
		}
	}
	/**
	* Return the current compact attempt stream.
	* @returns a detached immutable record list suitable for a durable event.
	*/
	snapshot() {
		return deepFreeze(this.records.map((record) => {
			if (record.type === "chunk") return { ...record };
			const { lastTime: _lastTime, ...durable } = record;
			if (durable.type === "tool-call-chunks") return {
				...durable,
				dt: [...durable.dt],
				args: [...durable.args]
			};
			return {
				...durable,
				dt: [...durable.dt],
				texts: [...durable.texts]
			};
		}));
	}
};
/**
* Expand compact records into the exact timed chunk sequence.
* @param stream - compact records from one durable Assistant settlement.
* @returns detached timed chunks with every original delta boundary preserved.
* @throws {TypeError} when a record or reconstructed timestamp is invalid.
*/
function expandAssistantStream(stream) {
	const chunks = [];
	for (const candidate of stream) {
		const record = validateRecord(candidate);
		if (record.type === "chunk") {
			chunks.push({
				time: record.time,
				chunk: record.chunk
			});
			continue;
		}
		const members = record.type === "tool-call-chunks" ? record.args : record.texts;
		let time = record.time0;
		for (let index = 0; index < members.length; index += 1) {
			if (index > 0) time += record.dt[index - 1];
			let chunk;
			if (record.type === "text-chunks") chunk = {
				type: "text-delta",
				index: record.index,
				text: members[index]
			};
			else if (record.type === "reasoning-chunks") chunk = {
				type: "reasoning-delta",
				index: record.index,
				text: members[index]
			};
			else chunk = {
				type: "tool-call-delta",
				index: record.index,
				id: record.id,
				...Object.hasOwn(record, "name") ? { name: record.name } : {},
				argumentsDelta: members[index]
			};
			chunks.push({
				time,
				chunk
			});
		}
	}
	return chunks;
}
function hasNonWhitespace(text) {
	return /\S/.test(text);
}
function blockIsVisible(block) {
	if (block.type === "tool-call") return false;
	if (block.type === "text" || block.type === "reasoning") return hasNonWhitespace(block.text);
	return true;
}
/**
* Whether one chunk carries the model's first output token for latency measurement.
* @param chunk - any stream chunk.
* @returns true for a non-empty text, reasoning, or Tool-call arguments fragment and for
*   every name-bearing Tool-call delta; false for block, usage, and finish chunks.
*/
function isTokenDelta(chunk) {
	switch (chunk.type) {
		case "text-delta":
		case "reasoning-delta": return chunk.text !== "";
		case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== void 0;
		default: return false;
	}
}
/**
* Whether one chunk by itself contributes reader-visible transcript content.
* Text and reasoning count only with non-whitespace content, streamed as a delta or
* completed as a block; a block of any other kind counts at its start and its end,
* except a Tool call, which is protocol rather than content. Usage and finish never count.
* @param chunk - any stream chunk.
* @returns whether a transcript reader would see this chunk.
*/
function isVisibleChunk(chunk) {
	switch (chunk.type) {
		case "text-delta":
		case "reasoning-delta": return hasNonWhitespace(chunk.text);
		case "block-start": return chunk.blockType !== "text" && chunk.blockType !== "reasoning" && chunk.blockType !== "tool-call";
		case "block-end": return blockIsVisible(chunk.block);
		default: return false;
	}
}
/**
* Whether one chunk carries non-whitespace text, as a text delta or a completed text block.
* Reasoning, Tool calls, and other block kinds never count.
* @param chunk - any stream chunk.
* @returns whether the chunk contributes visible text.
*/
function chunkHasVisibleText(chunk) {
	if (chunk.type === "text-delta") return hasNonWhitespace(chunk.text);
	return chunk.type === "block-end" && chunk.block.type === "text" && hasNonWhitespace(chunk.block.text);
}
function firstRunMemberTime(run, predicate) {
	const fragments = run.type === "tool-call-chunks" ? run.args : run.texts;
	let time = run.time0;
	for (let index = 0; index < fragments.length; index += 1) {
		if (index > 0) time += run.dt[index - 1];
		if (predicate(fragments[index])) return time;
	}
}
/**
* Time of the first member of one packed run that {@link isTokenDelta} accepts: a
* name-bearing Tool-call run starts at its first member, otherwise the first non-empty fragment.
* Stops scanning at that member.
* @param run - one packed delta run.
* @returns the member's reconstructed time, or undefined when no member qualifies.
*/
function runFirstTokenTime(run) {
	if (run.type === "tool-call-chunks" && run.name !== void 0) return run.time0;
	return firstRunMemberTime(run, (fragment) => fragment !== "");
}
/**
* Time of the first member of one packed run that {@link isVisibleChunk} accepts: the first
* non-whitespace text or reasoning fragment. A Tool-call run has none. Stops scanning at that member.
* @param run - one packed delta run.
* @returns the member's reconstructed time, or undefined when no member qualifies.
*/
function runFirstVisibleTime(run) {
	return run.type === "tool-call-chunks" ? void 0 : firstRunMemberTime(run, hasNonWhitespace);
}
/**
* Time of the first token in one compact stream per {@link isTokenDelta}, read from the
* records themselves and stopping at the first qualifying member.
* @param stream - compact records from one durable Assistant settlement.
* @returns the first token's time, or undefined when the stream carries no token.
*/
function assistantStreamFirstTokenTime(stream) {
	for (const record of stream) {
		const time = record.type === "chunk" ? isTokenDelta(record.chunk) ? record.time : void 0 : runFirstTokenTime(record);
		if (time !== void 0) return time;
	}
}
/**
* Whether one compact stream carries any reader-visible content per {@link isVisibleChunk},
* stopping at the first qualifying member.
* @param stream - compact records from one durable Assistant settlement.
* @returns whether a transcript reader would see anything from this stream.
*/
function assistantStreamHasVisibleContent(stream) {
	return stream.some((record) => record.type === "chunk" ? isVisibleChunk(record.chunk) : runFirstVisibleTime(record) !== void 0);
}
/**
* Whether one compact stream carries non-whitespace text per {@link chunkHasVisibleText},
* stopping at the first qualifying member.
* @param stream - compact records from one durable Assistant settlement.
* @returns whether the stream contributes visible text.
*/
function assistantStreamHasVisibleText(stream) {
	return stream.some((record) => record.type === "text-chunks" ? record.texts.some(hasNonWhitespace) : record.type === "chunk" && chunkHasVisibleText(record.chunk));
}
/**
* The last raw chunk of one never-packed type, scanning backwards and stopping at the first hit.
* @param stream - compact records from one durable Assistant settlement.
* @param type - chunk type that only appears as a raw record.
* @returns the stream's final chunk of that type, or undefined when it has none.
*/
function lastAssistantStreamChunk(stream, type) {
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const record = stream[index];
		if (record.type === "chunk" && record.chunk.type === type) return record.chunk;
	}
}
/**
* Every raw chunk of one never-packed type, in stream order.
* @param stream - compact records from one durable Assistant settlement.
* @param type - chunk type that only appears as a raw record.
* @returns the matching chunks; empty when the stream has none.
*/
function assistantStreamChunks(stream, type) {
	const chunks = [];
	for (const record of stream) if (record.type === "chunk" && record.chunk.type === type) chunks.push(record.chunk);
	return chunks;
}
/**
* Every streamed text-delta fragment joined in stream order; reasoning and Tool-call fragments are excluded.
* @param stream - compact records from one durable Assistant settlement.
* @returns the joined text, empty when the stream carries no text delta.
*/
function joinAssistantStreamText(stream) {
	const parts = [];
	for (const record of stream) if (record.type === "text-chunks") parts.push(record.texts.join(""));
	else if (record.type === "chunk" && record.chunk.type === "text-delta") parts.push(record.chunk.text);
	return parts.join("");
}
/**
* Feed one compact stream into a {@link BlockAssembler} without materializing members.
* Each run contributes one delta carrying its joined fragments, which assembles the same
* blocks as the original per-member deltas because assembly only concatenates them;
* raw chunks are pushed as recorded. The records are trusted, not validated: validate a
* stream read at a durable boundary with {@link expandAssistantStream} first.
* @param stream - compact records from one durable Assistant settlement.
* @param assembler - assembler to feed; a fresh one by default.
* @returns the same assembler after every record was pushed.
*/
function assembleAssistantStream(stream, assembler = new BlockAssembler()) {
	for (const record of stream) switch (record.type) {
		case "chunk":
			assembler.push(record.chunk);
			break;
		case "text-chunks":
			assembler.push({
				type: "text-delta",
				index: record.index,
				text: record.texts.join("")
			});
			break;
		case "reasoning-chunks":
			assembler.push({
				type: "reasoning-delta",
				index: record.index,
				text: record.texts.join("")
			});
			break;
		case "tool-call-chunks":
			assembler.push({
				type: "tool-call-delta",
				index: record.index,
				id: record.id,
				...record.name === void 0 ? {} : { name: record.name },
				argumentsDelta: record.args.join("")
			});
			break;
		default: assertNever(record, "assembleAssistantStream");
	}
	return assembler;
}
function validateRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Assistant stream record must be an object");
	const record = value;
	switch (record.type) {
		case "text-chunks":
		case "reasoning-chunks": {
			exactKeys(record, [
				"type",
				"time0",
				"index",
				"dt",
				"texts"
			], record.type);
			const texts = stringArray(record.texts, `${record.type} texts`);
			if (texts.length === 0) throw new TypeError(`${record.type} texts must be non-empty`);
			validateRun(record, texts.length, record.type);
			return record;
		}
		case "tool-call-chunks": {
			exactKeys(record, Object.hasOwn(record, "name") ? [
				"type",
				"time0",
				"index",
				"dt",
				"id",
				"name",
				"args"
			] : [
				"type",
				"time0",
				"index",
				"dt",
				"id",
				"args"
			], record.type);
			const args = stringArray(record.args, "tool-call-chunks args");
			if (args.length === 0) throw new TypeError("tool-call-chunks args must be non-empty");
			if (typeof record.id !== "string" || record.id.length === 0) throw new TypeError("tool-call-chunks id must be a non-empty string");
			if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) throw new TypeError("tool-call-chunks name must be a non-empty string");
			validateRun(record, args.length, record.type);
			return record;
		}
		case "chunk": {
			exactKeys(record, [
				"type",
				"time",
				"chunk"
			], "chunk");
			const time = safeTime(record.time);
			if (typeof record.chunk !== "object" || record.chunk === null || Array.isArray(record.chunk)) throw new TypeError("Assistant stream raw chunk must be a lossless JSON object");
			let chunk;
			try {
				chunk = snapshotChunk(record.chunk);
			} catch (error) {
				throw new TypeError("Assistant stream raw chunk must be a lossless JSON object", { cause: error });
			}
			return deepFreeze({
				type: "chunk",
				time,
				chunk
			});
		}
		default: throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`);
	}
}
function validateRun(record, members, label) {
	safeTime(record.time0);
	safeIndex(record.index, label);
	if (!Array.isArray(record.dt) || record.dt.some((value) => !Number.isSafeInteger(value))) throw new TypeError(`${label} dt must contain safe integers`);
	if (record.dt.length !== members - 1) throw new TypeError(`${label} dt length must be one less than its members`);
	let time = record.time0;
	for (const gap of record.dt) {
		time += gap;
		if (!Number.isSafeInteger(time)) throw new TypeError(`${label} member times must stay safe integers`);
	}
}
function stringArray(value, label) {
	if (!Array.isArray(value) || value.some((member) => typeof member !== "string")) throw new TypeError(`${label} must be a string array`);
	return value;
}
function exactKeys(record, keys, label) {
	if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(", ")}`);
}
//#endregion

export { ACCOUNT_QUOTA_EXCEEDED_CODE, AssistantStreamAccumulator, BlockAssembler, CONTEXT_SUMMARY_MAX_CHARS, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, IMAGE_OFFLOAD_REQUIRED_CODE, INVALID_CREDENTIAL_CODE, LlmAttemptId, MessageId, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId, ToolCallId, assembleAssistantStream, assistantStreamChunks, assistantStreamFirstTokenTime, assistantStreamHasVisibleContent, assistantStreamHasVisibleText, boundContextSummary, callConfigEquals, chunkHasVisibleText, contentHasFile, contentHasImage, createAssistantMessage, createDeveloperMessage, createMessage, createSystemMessage, createToolResultMessage, createUserMessage, errorChain, expandAssistantStream, fileHandleText, freezeMessage, isAgentLoopRequest, isContextWindowExceededError, isHarnessError, isQuotaExceededError, isTokenDelta, isVisibleChunk, joinAssistantStreamText, lastAssistantStreamChunk, markAgentLoopRequest, normalizeApiKey, offloadedImageText, projectFilesToText, projectImagesForTextModel, projectOffloadedImages, projectToolUpdates, requestImageHandleText, requiredImageOffload, resolveImageAttachmentAccess, runFirstTokenTime, runFirstVisibleTime, textOnlyImageText };
