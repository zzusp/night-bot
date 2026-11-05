// MIT source-derived audit/publication/inbox facade and legacy event contracts. Pi SessionManager is model-context/history authority; no legacy SessionStore.
import { isAbsolute } from "node:path";

import { assertNever, deepFreeze, snapshotJsonValue } from "./native-values.js";
import { callConfigEquals } from "./native-llm-protocol.js";
function SessionId(id) {
	return (id);
}
function SessionSeq(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
	return (value);
}
function SessionLogOffset(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
	return (value);
}
const SESSION_FORMAT_VERSION = 4;
const KNOWN_SESSION_EVENT_TYPES = new Set([
	"agent-preset/selected",
	"agent/inbox/spliced",
	"approval/asked",
	"approval/decided",
	"approval/policy",
	"assistant/attempt",
	"assistant/message",
	"command/done",
	"command/run",
	"compaction/end",
	"compaction/prune",
	"compaction/start",
	"compaction/summary",
	"deliverables/presented",
	"developer/message",
	"feedback/message-delete",
	"feedback/message-put",
	"feedback/record",
	"goal/change",
	"hook/invoked",
	"hook/result",
	"image/offload",
	"llm/retry",
	"llm/retry-started",
	"model/selection",
	"permission/preset",
	"plan/mode",
	"request/context",
	"request/header",
	"sandbox/mode",
	"schedule/change",
	"session-log-deepseek/delivery-accepted",
	"session/end-seed",
	"session/title",
	"session/title-llm-request",
	"step/end",
	"step/start",
	"subagent/catalog",
	"subagent/descriptor",
	"subagent/model-selection-policy",
	"system/message",
	"team/member",
	"team/message/delivered",
	"team/message/queued",
	"team/task",
	"todo/write",
	"tool-workflow/agent-end",
	"tool-workflow/agent-start",
	"tool-workflow/run-end",
	"tool-workflow/run-start",
	"tool/call",
	"tool/ptc-dispatch",
	"tool/ptc-dispatch-start",
	"tool/result",
	"turn/end",
	"turn/start",
	"user/message",
	"web/deepseek-search-llm-request",
	"working-directory/change",
	"workspace/changes"
]);
const MESSAGE_PROJECTION_EVENT_TYPES = new Set(["image/offload"]);
const SURFACE_EVENT_TYPES = new Set([
	"system/message",
	"developer/message",
	"user/message",
	"assistant/message",
	"tool/result"
]);
function isSurfaceEligibleType(type) {
	return SURFACE_EVENT_TYPES.has(type);
}
function isSurfaceEvent(event) {
	if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
	return event.surfaceOp !== void 0;
}
function isAppendSurfaceEvent(event) {
	return isSurfaceEvent(event) && event.surfaceOp === "append";
}
function isReplacementSurfaceEvent(event) {
	return isSurfaceEvent(event) && event.surfaceOp !== "append";
}
function deriveEventMessage(event, projectedMessages) {
	const projected = projectedMessages?.get(event.seq);
	if (projected !== void 0) return projected;
	switch (event.type) {
		case "user/message": return event.data;
		case "system/message":
		case "developer/message":
		case "assistant/message":
			if (event.data.message.content.length === 0) return null;
			return event.data.message;
		case "tool/result": return event.data.message;
		default: return null;
	}
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateSessionEventData(event, subject) {
	const data = event.data;
	if (SURFACE_EVENT_TYPES.has(event.type) && isRecord(data)) {
		const message = event.type === "user/message" ? data : data["message"];
		if (isRecord(message)) {
			if (event.type === "developer/message" !== (message["role"] === "developer")) throw new Error(`${subject} developer/message and developer role must occur together`);
			if (message["role"] !== "developer" && Array.isArray(message["content"]) && message["content"].some((block) => isRecord(block) && (block["type"] === "tool-addition" || block["type"] === "tool-removal"))) throw new Error(`${subject} tool-change blocks require developer role`);
			if (event.type === "developer/message" && Array.isArray(message["content"])) {
				let hasAdditions = false;
				for (const block of message["content"]) {
					if (!isRecord(block) || block["type"] !== "tool-addition" && block["type"] !== "tool-removal") continue;
					if (typeof block["toolName"] !== "string" || block["toolName"].length === 0) throw new Error(`${subject} ${block["type"]} requires a nonempty toolName`);
					if (block["type"] === "tool-addition") {
						hasAdditions = true;
						if (Object.hasOwn(block, "tool")) throw new Error(`${subject} tool-addition must omit inline tool definitions`);
					}
				}
				if (hasAdditions ? !isEventSeq(data["headerSeq"]) : Object.hasOwn(data, "headerSeq")) throw new Error(`${subject} requires headerSeq exactly when tool additions are present`);
			}
		}
	}
	if (event.type === "request/header") {
		if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
		const header = data["header"];
		if (!isRecord(header)) throw new Error(`${subject} header must be an object`);
		if (Object.hasOwn(header, "system")) throw new Error(`${subject} must omit header.system; use system/message`);
		if (Array.isArray(header["tools"]) && header["tools"].length === 0) throw new Error(`${subject} must omit empty tools`);
		const defaults = header["adapterDefaults"];
		if (isRecord(defaults) && Object.keys(defaults).length === 0) throw new Error(`${subject} must omit empty adapterDefaults`);
	} else if (event.type === "tool/result") {
		if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
		if (data["error"] === void 0) return;
		const message = data["message"];
		if (!isRecord(message) || message["isError"] !== true) throw new Error(`${subject} error requires message.isError === true`);
	}
}
function createFoldState() {
	return {
		nodes: [],
		replaceGeneration: 0,
		contentGeneration: 0,
		projectedMessages: /* @__PURE__ */ new Map(),
		projections: /* @__PURE__ */ new Set()
	};
}
function isEventSeq(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function isReplaceOp(value) {
	const op = value;
	return Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && op["op"] === "replace" && isEventSeq(op["startSeq"]) && isEventSeq(op["endSeq"]);
}
function surfaceOpOf(event) {
	const raw = event;
	if (!isSurfaceEligibleType(event.type)) {
		if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true) return;
		if (raw.surfaceOp !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
		if (raw.sourceEventSeqs !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`);
		return;
	}
	const op = raw.surfaceOp;
	if (op === void 0) throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
	if (op === "append") return op;
	if (op === null || typeof op !== "object" || Array.isArray(op)) throw new Error(`session event "${event.type}" carries an invalid surfaceOp`);
	if (!isReplaceOp(op)) throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`);
	return op;
}
function assertSourceEventReferences(event, shadowedSeqs) {
	const raw = event.sourceEventSeqs;
	if (event.type === "assistant/message" && raw !== void 0) throw new Error("assistant/message embeds its source stream and cannot carry sourceEventSeqs");
	const sources = /* @__PURE__ */ new Set();
	if (raw !== void 0) {
		if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`);
		if (raw.length === 0) throw new Error("sourceEventSeqs must not be empty");
		let nonEarlierSource;
		for (const source of raw) {
			if (!isEventSeq(source)) throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`);
			sources.add(source);
			if (nonEarlierSource === void 0 && source >= event.seq) nonEarlierSource = source;
		}
		if (sources.size !== raw.length) throw new Error("sourceEventSeqs must not contain duplicates");
		if (nonEarlierSource !== void 0) throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`);
	}
	const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
	if (missing.length > 0) throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(", ")}`);
}
function assertDeveloperHeader(event, events, baseSeq) {
	if (event.type !== "developer/message") return;
	validateSessionEventData(event, `developer/message at seq ${event.seq}`);
	if (event.data.headerSeq === void 0) return;
	const headerSeq = event.data.headerSeq;
	const headerEvent = events[headerSeq - baseSeq];
	if (headerSeq >= event.seq || headerEvent?.type !== "request/header") throw new Error("developer/message headerSeq must reference an earlier request/header");
	for (const block of event.data.message.content) {
		if (block.type !== "tool-addition") continue;
		const definitions = headerEvent.data.header.tools?.filter((tool) => tool.name === block.toolName) ?? [];
		if (definitions.length !== 1) throw new Error(`developer/message tool-addition "${block.toolName}" must name exactly one tool in headerSeq ${headerSeq}`);
		const definition = definitions[0];
		if (typeof definition.description !== "string" || !isRecord(definition.parameters)) throw new Error(`developer/message tool-addition "${block.toolName}" requires a complete tool definition in headerSeq ${headerSeq}`);
		if (Object.hasOwn(definition, "deferLoading") && definition.deferLoading !== true) throw new Error("developer/message referenced tool deferLoading must be true when present");
	}
}
function validateSurfaceMetadata(event) {
	const op = surfaceOpOf(event);
	if (op !== void 0 && op !== "append" && (op.startSeq >= event.seq || op.endSeq >= event.seq)) throw new Error(`surface replace at seq ${event.seq}: startSeq and endSeq must reference earlier events`);
	if (op !== void 0) assertSourceEventReferences(event, []);
	return op;
}
function replacementRange(state, op) {
	const startIdx = state.nodes.indexOf(op.startSeq);
	if (startIdx === -1) throw new Error(`surface replace: start seq ${op.startSeq} not found in surface`);
	const endIdx = state.nodes.indexOf(op.endSeq);
	if (endIdx === -1) throw new Error(`surface replace: end seq ${op.endSeq} not found in surface`);
	if (startIdx > endIdx) throw new Error(`surface replace: start seq ${op.startSeq} (index ${startIdx}) is after end seq ${op.endSeq} (index ${endIdx})`);
	return {
		startIdx,
		endIdx,
		shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1)
	};
}
function isDeepEqualJson(a, b) {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => isDeepEqualJson(item, b[i]));
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	const aKeys = Object.keys(a);
	const bRecord = b;
	if (aKeys.length !== Object.keys(b).length) return false;
	return aKeys.every((key) => Object.hasOwn(b, key) && isDeepEqualJson(a[key], bRecord[key]));
}
function assertToolResultRewrite(event, shadowedSeqs, events, baseSeq) {
	if (event.type !== "tool/result") return;
	if (shadowedSeqs.length !== 1) throw new Error("tool/result surface replacement must rewrite exactly one current node");
	for (const originalSeq of shadowedSeqs) {
		const original = events[originalSeq - baseSeq];
		if (original?.type !== "tool/result") throw new Error("tool/result surface replacement must target a current tool/result");
		const originalRest = { ...original.data };
		const replacementRest = { ...event.data };
		originalRest["message"] = {
			...original.data.message,
			content: null
		};
		replacementRest["message"] = {
			...event.data.message,
			content: null
		};
		if (!isDeepEqualJson(originalRest, replacementRest)) throw new Error("tool/result surface replacement may change only content");
	}
}
function assertSystemHeadRewrite(event, state, startIdx, shadowedSeqs, events, baseSeq) {
	if (startIdx !== 0) return;
	if (events[state.nodes[0] - baseSeq]?.type !== "system/message") return;
	if (event.type !== "system/message" || shadowedSeqs.length !== 1) throw new Error("surface replace: node 0 holds the system prompt and may be rewritten only by a system/message over exactly that node");
}
function planSurfaceEvent(state, event, expectedSeq, events, baseSeq, projections) {
	if (event.seq !== expectedSeq) throw new Error(`session event seq ${event.seq} is not contiguous; expected ${expectedSeq}`);
	const surfaceOp = validateSurfaceMetadata(event);
	assertDeveloperHeader(event, events, baseSeq);
	const projection = projections.find((item) => item.type === event.type);
	if (projection !== void 0) return {
		kind: "project",
		projection,
		messages: projection.project(event, {
			nodes: state.nodes,
			events,
			baseSeq,
			messages: state.projectedMessages
		})
	};
	if (MESSAGE_PROJECTION_EVENT_TYPES.has(event.type)) throw new Error(`session event "${event.type}" requires a message projection; load its owning plugin or supply its projection definition`);
	if (surfaceOp === void 0) return;
	if (surfaceOp === "append") return {
		kind: "append",
		seq: event.seq
	};
	const range = replacementRange(state, surfaceOp);
	assertSourceEventReferences(event, range.shadowedSeqs);
	assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq);
	assertSystemHeadRewrite(event, state, range.startIdx, range.shadowedSeqs, events, baseSeq);
	return {
		kind: "replace",
		seq: event.seq,
		start: surfaceOp.startSeq,
		end: surfaceOp.endSeq,
		...range
	};
}
function applySurfaceEvent(state, event, expectedSeq, events, baseSeq, projections) {
	return applySurfacePlan(state, planSurfaceEvent(state, event, expectedSeq, events, baseSeq, projections));
}
function applySurfacePlan(state, plan) {
	if (plan?.kind === "append") state.nodes.push(plan.seq);
	else if (plan?.kind === "replace") {
		state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
		state.replaceGeneration += 1;
		state.contentGeneration += 1;
	} else if (plan?.kind === "project") {
		for (const [seq, message] of plan.messages) state.projectedMessages.set(seq, message);
		state.projections.add(plan.projection);
		state.contentGeneration += 1;
	}
	if (plan?.kind !== "replace") return;
	return {
		seq: plan.seq,
		start: plan.start,
		end: plan.end,
		shadowedSeqs: plan.shadowedSeqs
	};
}
function foldSurface(events, projections = []) {
	const state = createFoldState();
	const replacements = [];
	for (const [index, event] of events.entries()) {
		const replacement = applySurfaceEvent(state, event, SessionSeq(index), events, SessionLogOffset(0), projections);
		if (replacement !== void 0) replacements.push(replacement);
	}
	return {
		nodes: [...state.nodes],
		replacements,
		projectedMessages: new Map(state.projectedMessages)
	};
}
var SurfaceManager = class {
	log;
	baseSeq;
	projections;
	/** Shared transition state; replacement history is not retained. */
	_state = createFoldState();
	/** Last processed absolute seq. */
	_lastProcessedSeq;
	/** Candidate already validated by `validateNext`, pending exact log admission. */
	_pendingPlan;
	/**
	* @param log - Contiguous complete log or loaded event window.
	* @param baseSeq - Absolute sequence of the window's first event.
	* @param projections - live borrowed definitions; removing a used definition invalidates further reads.
	*/
	constructor(log, baseSeq = SessionLogOffset(0), projections = []) {
		this.log = log;
		this.baseSeq = baseSeq;
		this.projections = projections;
		this._lastProcessedSeq = baseSeq === 0 ? -1 : SessionSeq(baseSeq - 1);
	}
	/**
	* Validate the next candidate without mutating the committed surface.
	* @param event - candidate event that has not entered the log yet.
	*/
	validateNext(event) {
		this._assertProjections();
		if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
		const expectedSeq = SessionSeq(this.baseSeq + this.log.length);
		this._pendingPlan = {
			event,
			expectedSeq,
			plan: planSurfaceEvent(this._state, event, expectedSeq, this.log, this.baseSeq, this.projections)
		};
	}
	/** Monotonic count of folded positional replacements. */
	get replaceGeneration() {
		this._assertProjections();
		if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
		return this._state.replaceGeneration;
	}
	/** Monotonic count of committed changes to existing model-visible content. */
	get contentGeneration() {
		this._assertProjections();
		if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
		return this._state.contentGeneration;
	}
	/** Surface event sequences in model-visible order. */
	get nodes() {
		this._assertProjections();
		if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
		return this._state.nodes;
	}
	/** Fold events appended since the previous access. */
	_processDelta() {
		const tailSeq = this.baseSeq + this.log.length - 1;
		for (let seq = this._lastProcessedSeq + 1; seq <= tailSeq; seq++) {
			const index = seq - this.baseSeq;
			const event = this.log[index];
			const pending = this._pendingPlan;
			if (pending?.event === event && pending.expectedSeq === seq) applySurfacePlan(this._state, pending.plan);
			else applySurfaceEvent(this._state, event, SessionSeq(seq), this.log, this.baseSeq, this.projections);
			if (pending !== void 0 && pending.expectedSeq <= seq) this._pendingPlan = void 0;
			this._lastProcessedSeq = SessionSeq(seq);
		}
	}
	/** Cached messages cannot outlive the definitions that interpreted their log. */
	_assertProjections() {
		const candidate = this._pendingPlan;
		const pending = candidate !== void 0 && this.log[candidate.expectedSeq - this.baseSeq] === candidate.event ? candidate.plan : void 0;
		const required = pending?.kind === "project" ? [...this._state.projections, pending.projection] : this._state.projections;
		for (const projection of required) if (!this.projections.includes(projection)) throw new Error(`session message projection "${projection.type}" was removed or replaced; restore the session with its owning plugin`);
	}
};
function canonicalHeader(header) {
	const adapterDefaults = header.adapterDefaults;
	return {
		config: header.config,
		...adapterDefaults?.reasoningEffort === true || adapterDefaults?.maxTokens === true ? { adapterDefaults } : {},
		...header.tools !== void 0 && header.tools.length > 0 ? { tools: header.tools } : {}
	};
}
function sameSchema(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
function headerEquals(a, b) {
	if (!callConfigEquals(a.config, b.config) || a.adapterDefaults?.reasoningEffort !== b.adapterDefaults?.reasoningEffort || a.adapterDefaults?.maxTokens !== b.adapterDefaults?.maxTokens) return false;
	const at = a.tools ?? [];
	const bt = b.tools ?? [];
	return at.length === bt.length && at.every((tool, i) => sameSchema(tool, bt[i]));
}
function foldRequestHeader(events, from) {
	let state = from;
	for (const event of events) if (event.type === "request/header") state = canonicalHeader(event.data.header);
	return state;
}
var ToolHistoryProjection = class {
	/** Historical declarations indexed by the header sequence referenced by additions. */
	headers = /* @__PURE__ */ new Map();
	/** Definitions retained in the current declaration series, including removed tools. */
	declared = /* @__PURE__ */ new Map();
	/** Active definitions from the latest request header. */
	active = [];
	/** Active names reconstructed from the baseline and recorded updates. */
	available = /* @__PURE__ */ new Set();
	/** Header that starts the current declaration series; absent before the first header. */
	baselineSeq;
	/** Immutable request snapshot of the current baseline and resolved updates. */
	history = deepFreeze({
		tools: [],
		updates: []
	});
	/**
	* Consume the next committed event in log order.
	* @param event - a session event, including inherited events during restoration.
	*/
	apply(event) {
		if (event.type === "request/header") {
			const tools = event.data.header.tools ?? [];
			this.headers.set(event.seq, tools);
			const redeclared = tools.some((tool) => {
				const before = this.declared.get(tool.name);
				return before !== void 0 && JSON.stringify(before) !== JSON.stringify(tool);
			});
			if (this.baselineSeq === void 0 || event.data.reason === "series" || event.data.startsSeries || redeclared) {
				this.baselineSeq = event.seq;
				this.declared = new Map(tools.map((tool) => [tool.name, tool]));
				this.history = deepFreeze({
					tools,
					updates: []
				});
				this.available = new Set(tools.map((tool) => tool.name));
			}
			this.active = tools;
		} else if (event.type === "developer/message") {
			const { message, headerSeq } = event.data;
			const definitions = headerSeq === void 0 ? [] : this.headers.get(headerSeq);
			const additions = message.content.flatMap((block) => {
				if (block.type !== "tool-addition") return [];
				const tool = definitions?.find((tool) => tool.name === block.toolName);
				if (tool === void 0) throw new Error(`tool history: missing definition for ${block.toolName}`);
				return [tool];
			});
			for (const tool of additions) this.declared.set(tool.name, tool);
			for (const block of message.content) if (block.type === "tool-addition") this.available.add(block.toolName);
			else if (block.type === "tool-removal") this.available.delete(block.toolName);
			this.history = deepFreeze({
				tools: this.history.tools,
				updates: [...this.history.updates, {
					messageId: message.id,
					additions
				}]
			});
		}
	}
	/**
	* Read an immutable snapshot; subsequent events do not mutate it.
	* @returns initial declarations and historically resolved additions for the current series.
	*/
	snapshot() {
		if (this.active.length !== this.available.size || this.active.some((tool) => !this.available.has(tool.name))) return deepFreeze({
			tools: this.active,
			updates: []
		});
		return this.history;
	}
};
const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";
const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";
const CLOSER_TEXT = {
	interrupted: {
		started: "The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.",
		notStarted: "The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed."
	},
	forked: {
		started: "The history inherited by this branch records this tool call starting but does not include its result. The parent session may have completed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.",
		notStarted: "The history inherited by this branch has no record of this tool call starting. The parent session may have executed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly."
	}
};
function openTurnClosers(events, cause) {
	let openTurn = null;
	let openStep = null;
	const recovery = new ToolCallRecovery(cause);
	for (const event of events) {
		recovery.observe(event);
		switch (event.type) {
			case "turn/start":
				openTurn = event.data.turn;
				openStep = null;
				break;
			case "turn/end":
				openTurn = null;
				openStep = null;
				break;
			case "step/start":
				openStep = event.data.step;
				break;
			case "step/end":
				openStep = null;
				break;
			default: break;
		}
	}
	const last = events.at(-1);
	if (openTurn === null || last === void 0) return [];
	const closers = recovery.results();
	let seq = last.seq + closers.length + 1;
	const time = last.time;
	if (openStep !== null) closers.push({
		type: "step/end",
		seq: SessionSeq(seq++),
		time,
		data: {
			turn: openTurn,
			step: openStep
		}
	});
	closers.push({
		type: "turn/end",
		seq: SessionSeq(seq++),
		time,
		data: {
			turn: openTurn,
			reason: { kind: cause.kind }
		}
	});
	return closers;
}
var ToolCallRecovery = class {
	cause;
	pendingCalls = /* @__PURE__ */ new Map();
	last;
	/** @param cause - defaults to interrupted live/crash recovery; fork-seed construction supplies its own cause. */
	constructor(cause = { kind: "interrupted" }) {
		this.cause = cause;
	}
	/**
	* Consume the next committed event; closed steps and turn boundaries discard pending requests.
	* @param event - the next event from the same Session, in sequence order.
	*/
	observe(event) {
		this.last = {
			seq: event.seq,
			time: event.time
		};
		switch (event.type) {
			case "turn/start":
			case "turn/end":
			case "step/end":
				this.pendingCalls.clear();
				break;
			case "assistant/message":
				for (const block of event.data.message.content) if (block.type === "tool-call") this.pendingCalls.set(block.id, {
					turn: event.data.turn,
					step: event.data.step
				});
				break;
			case "tool/call": {
				const entry = this.pendingCalls.get(event.data.callId);
				if (entry) entry.callSeq = event.seq;
				break;
			}
			case "tool/result": {
				const callId = event.data.message.source.callId;
				const entry = this.pendingCalls.get(callId);
				if (event.surfaceOp === "append" && entry !== void 0 && entry.turn === event.data.turn && entry.step === event.data.step) this.pendingCalls.delete(callId);
				break;
			}
			default: break;
		}
	}
	/**
	* Build conservative error results in assistant order without changing tracked state.
	* Sequences follow the latest observed event and timestamps reuse its time.
	* Callers commit the results and observe those commits before recovering again.
	* @returns pending tool-result events, empty when no request remains unanswered.
	*/
	results() {
		if (this.last === void 0) return [];
		let seq = this.last.seq + 1;
		const time = this.last.time;
		const results = [];
		const text = CLOSER_TEXT[this.cause.kind];
		for (const [callId, { turn, step, callSeq }] of this.pendingCalls) {
			const started = callSeq !== void 0;
			const message = deepFreeze({
				id: (`${this.cause.kind}-tool-result-${callId}-${seq}`),
				role: "tool",
				toolCallId: callId,
				isError: true,
				source: {
					kind: "tool",
					callId
				},
				content: [{
					type: "text",
					text: started ? text.started : text.notStarted
				}]
			});
			results.push({
				type: "tool/result",
				seq: SessionSeq(seq++),
				time,
				data: {
					turn,
					step,
					message,
					error: started ? {
						name: "ToolOutcomeUnknownError",
						code: TOOL_OUTCOME_UNKNOWN
					} : {
						name: "ToolNotStartedError",
						code: TOOL_NOT_STARTED
					}
				},
				surfaceOp: "append",
				...started ? { sourceEventSeqs: [callSeq] } : {}
			});
		}
		return results;
	}
};
function interruptedTurnClosers(events) {
	return openTurnClosers(events, { kind: "interrupted" });
}
function buildForkSeed(events, boundary) {
	const prefix = events.slice(0, boundary + 1);
	prefix.push({
		type: "session/end-seed",
		seq: SessionSeq(boundary + 1),
		time: events[boundary].time,
		data: { inherited: true }
	});
	return prefix.concat(openTurnClosers(prefix, { kind: "forked" }));
}
function validateSessionHeader(id, input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("session header is not a plain JSON record");
	const record = input;
	if (Object.hasOwn(record, "seedLength")) throw new Error("session header has invalid field \"seedLength\"");
	if (record.version !== 4) throw new Error(`session header version must be 4, got ${String(record.version)}`);
	if (record.id !== id) throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`);
	if (typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) throw new Error("session header createdAt must be a non-negative safe integer");
	if (record.cwd !== void 0) {
		if (typeof record.cwd !== "string") throw new Error("session header cwd must be a string");
		if (!isAbsolute(record.cwd)) throw new Error(`session header cwd must be an absolute path, got "${record.cwd}"`);
	}
	if (record.parentSession !== void 0 && typeof record.parentSession !== "string") throw new Error("session header parentSession must be a string");
	if (typeof record.isSeeded !== "boolean") throw new Error("session header isSeeded must be a boolean");
	if (record.origin !== void 0 && record.origin !== "subagent") throw new Error("session header origin must be \"subagent\"");
	if (record.delegationDepth !== void 0 && (typeof record.delegationDepth !== "number" || !Number.isSafeInteger(record.delegationDepth) || record.delegationDepth < 0)) throw new Error("session header delegationDepth must be a non-negative safe integer");
	if (record.agentPreset !== void 0 && typeof record.agentPreset !== "string") throw new Error("session header agentPreset must be a string");
	return deepFreeze(record);
}
function validateRestoredSessionHeader(id, input) {
	if (input !== null && typeof input === "object" && !Array.isArray(input)) {
		const prototype = Reflect.getPrototypeOf(input);
		if (prototype !== Object.prototype && prototype !== null) throw new Error("session header is not a plain JSON record");
	}
	return validateSessionHeader(id, input);
}
function snapshotSessionHeader(id, source) {
	const snapshot = snapshotJsonValue(source === void 0 ? {
		version: 4,
		id,
		createdAt: Date.now(),
		isSeeded: false
	} : source);
	if (snapshot === void 0) throw new Error("session header is not losslessly JSON-serializable");
	return validateSessionHeader(id, snapshot);
}
function adoptSessionEvent(event) {
	validateSessionEventData(event, `session event at seq ${event.seq}`);
	validateSurfaceMetadata(event);
	assertMessageEventShape(event, `session event at seq ${event.seq}`);
	switch (event.type) {
		case "user/message":
			deepFreeze(event.data);
			break;
		case "developer/message":
		case "system/message":
		case "assistant/message":
		case "tool/result":
			deepFreeze(event.data.message);
			break;
		default: break;
	}
	return event;
}
function snapshotSessionEvent(event) {
	return adoptSessionEvent(structuredClone(event));
}
function assertSessionEventEnvelope(value, index) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`seed event at index ${index} has an invalid event envelope`);
	const event = value;
	for (const key in event) switch (key) {
		case "type":
		case "seq":
		case "time":
		case "data":
		case "surfaceOp":
		case "sourceEventSeqs":
		case "ignorable": break;
		default: throw new Error(`seed event at index ${index} has an invalid event envelope`);
	}
	const type = event["type"];
	const seq = event["seq"];
	const time = event["time"];
	if (typeof type !== "string" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0) || typeof time !== "number" || !Number.isSafeInteger(time) || event["data"] === void 0 || event["ignorable"] !== void 0 && event["ignorable"] !== true) throw new Error(`seed event at index ${index} has an invalid event envelope`);
	validateSessionEventData(event, `seed ${type} at index ${index}`);
	switch (type) {
		case "request/header":
		case "developer/message":
		case "system/message":
		case "user/message":
		case "assistant/attempt":
		case "assistant/message":
		case "tool/result":
			assertCurrentLlmShape(event, index);
			break;
	}
}
function assertCurrentLlmShape(event, index) {
	const data = event["data"];
	const record = typeof data === "object" && data !== null ? data : void 0;
	if (event["type"] === "request/header") {
		const headerRecord = record?.["header"];
		const config = headerRecord["config"];
		if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`);
		const configRecord = config;
		const reasoningEffort = configRecord["reasoningEffort"];
		if (reasoningEffort !== void 0 && (typeof reasoningEffort !== "string" || reasoningEffort.length === 0)) throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`);
		assertAdapterDefaults(headerRecord["adapterDefaults"], configRecord, index);
		const reason = record?.["reason"];
		if (reason !== "initial" && reason !== "resume" && reason !== "change" && reason !== "series") throw new Error(`seed request/header at index ${index} has an invalid reason`);
		if (record?.["startsSeries"] !== void 0 && record["startsSeries"] !== true) throw new Error(`seed request/header at index ${index} has an invalid startsSeries marker`);
	}
	const type = event["type"];
	if (type === "assistant/attempt") {
		assertAssistantSettlementShape(record, type, index);
		return;
	}
	if (!isMessageEventType(type)) return;
	assertMessageEventShape(event, `seed ${type} at index ${index}`);
	if (type === "assistant/message") assertAssistantSettlementShape(record, type, index);
}
function assertAssistantSettlementShape(data, type, index) {
	const turn = data?.["turn"];
	const step = data?.["step"];
	if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0) || typeof step !== "number" || !Number.isSafeInteger(step) || step < 0 || Object.is(step, -0) || !Array.isArray(data?.["stream"])) throw new Error(`seed ${type} at index ${index} has invalid settlement fields`);
}
const allowedAdapterKeys = new Set(["reasoningEffort", "maxTokens"]);
function assertAdapterDefaults(value, config, index) {
	if (value === void 0) return;
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`);
	const defaults = value;
	if (Object.keys(defaults).some((key) => !allowedAdapterKeys.has(key)) || Object.values(defaults).some((marker) => marker !== true) || defaults["reasoningEffort"] === true && config["reasoningEffort"] === void 0 || defaults["maxTokens"] === true && config["maxTokens"] === void 0) throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`);
}
function isMessageEventType(type) {
	return type === "developer/message" || type === "system/message" || type === "user/message" || type === "assistant/message" || type === "tool/result";
}
const MESSAGE_ROLE_BY_TYPE = {
	"system/message": "system",
	"developer/message": "developer",
	"user/message": "user",
	"assistant/message": "assistant",
	"tool/result": "tool"
};
function assertMessageEventShape(event, subject) {
	const type = event["type"];
	if (!isMessageEventType(type)) return;
	const data = event["data"];
	const record = typeof data === "object" && data !== null ? data : void 0;
	const message = type === "user/message" ? record : record?.["message"];
	if (typeof message !== "object" || message === null || typeof message["id"] !== "string" || message["id"] === "") throw new Error(`${subject} lacks an identified message`);
	const messageRecord = message;
	const expectedRole = MESSAGE_ROLE_BY_TYPE[type];
	if (messageRecord["role"] !== expectedRole) throw new Error(`${subject} message must have role "${expectedRole}"`);
	const source = messageRecord["source"];
	if (typeof source !== "object" || source === null || typeof source["kind"] !== "string" || source["kind"] === "") throw new Error(`${subject} message has invalid source`);
	if (!Array.isArray(messageRecord["content"])) throw new Error(`${subject} message has invalid content`);
	const sourceRecord = source;
	if (type === "system/message") {
		if (sourceRecord["kind"] !== "system-prompt") throw new Error(`${subject} message must have system-prompt source`);
		return;
	}
	if (type === "assistant/message") {
		if (sourceRecord["kind"] !== "model" || !hasProviderModel(sourceRecord)) throw new Error(`${subject} message must have model source`);
		return;
	}
	if (type !== "tool/result") return;
	if (sourceRecord["kind"] !== "tool" || typeof sourceRecord["callId"] !== "string" || sourceRecord["callId"] === "") throw new Error(`${subject} message must have tool source`);
	if (messageRecord["toolCallId"] !== sourceRecord["callId"]) throw new Error(`${subject} message has mismatched tool call ids`);
}
function hasProviderModel(value) {
	if (typeof value !== "object" || value === null) return false;
	const pair = value;
	return typeof pair["provider"] === "string" && pair["provider"].length > 0 && typeof pair["model"] === "string" && pair["model"].length > 0;
}
function collectSessionCallbacks(ctx, args) {
	return [...ctx.events.dispatch("emit", args)];
}
function invokeContainedSessionObservers(ctx, name, id, args, callbacks) {
	for (const callback of callbacks) try {
		const returned = callback(...args);
		Promise.resolve(returned).catch((error) => {
			ctx.logger.warn(`session "${id}": ${name} listener rejected: ${String(error)}`);
		});
	} catch (error) {
		ctx.logger.warn(`session "${id}": ${name} listener threw: ${String(error)}`);
	}
}
// Night Bot owns publication. External DSH-shaped objects and public method
// overrides cannot acquire or redirect the publication capability.
const applicationSessions=new WeakSet(),publications=new WeakMap();
export const isApplicationSession=value=>applicationSessions.has(value);
export function bindSessionPublication(session,entry){
 if(!applicationSessions.has(session))throw new TypeError('Unsupported external Session facade');
 if(publications.has(session))throw new Error('session is already attached to a store');
 publications.set(session,entry);let active=true;
 return()=>{if(!active)return;active=false;if(publications.get(session)!==entry)throw new Error('Session publication ownership lost');publications.delete(session)};
}
function publicationFor(session){
 const entry=publications.get(session);
 if(entry?.appending)throw new Error('session append cannot reenter while another append is being published');
 return entry;
}
const PLUGIN_RECORD_TYPE = /^plugin:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
function isPluginRecordType(type) {
	return PLUGIN_RECORD_TYPE.test(type);
}
function assertPluginRecordEvent(value) {
	const { type } = value;
	if (!isPluginRecordType(type)) throw new Error(`plugin record type "${type}" must be "plugin:" followed by lowercase slash-separated segments`);
}
let commitPluginRecord;
function appendPluginRecord(session, type, data) {
	return commitPluginRecord(session, type, data);
}
function pluginRecordOf(event) {
	const type = event.type;
	if (event.ignorable !== true || !isPluginRecordType(type)) return void 0;
	return {
		type,
		seq: event.seq,
		time: event.time,
		data: event.data
	};
}
/** Decode Night's audit presentation without creating an application Session.
 * This is a read-only codec, never a model-context or publication authority. */
function validateSessionAudit(id, sourceEvents, sourceHeader, suppliedInheritedEventCount, projections = []) {
 const headerSnapshot = snapshotJsonValue(sourceHeader);
 if (headerSnapshot === void 0) throw new Error("session header is not losslessly JSON-serializable");
 const header = validateRestoredSessionHeader(id, headerSnapshot);
 const events = snapshotJsonValue(sourceEvents);
 if (!Array.isArray(events)) throw new Error("session audit events must be a JSON array");
 for (const [index, event] of events.entries()) {
  assertSessionEventEnvelope(event, index);
  if (event.seq !== index) throw new Error(`seed event at index ${index} has seq ${event.seq} (expected ${index}); seed must be contiguous from 0`);
 }
 foldSurface(events, projections);
 if (header.isSeeded && suppliedInheritedEventCount === void 0) throw new Error("seeded session requires an inherited event count");
 const inheritedEventCount = SessionLogOffset(suppliedInheritedEventCount ?? 0);
 if (!header.isSeeded && inheritedEventCount !== 0) throw new Error("unseeded session inherited event count must be 0");
 if (inheritedEventCount > events.length) throw new Error("session inherited event count exceeds its event log");
 const marker = events[inheritedEventCount];
 if (marker?.type === "session/end-seed" && marker.data.inherited === true && events.slice(inheritedEventCount + 1).some(event => event.type === "session/end-seed" && event.data.inherited === true)) throw new Error("session inherited event count must identify the final inherited marker");
 return deepFreeze({header, events, inheritedEventCount});
}
var Session = class Session {
	log = [];
	/** Single incremental owner of surface acceptance and projection state. */
	surfaceManager;
	/** The ordered surface over this session's event log. */
	get surface() {
		return this.surfaceManager;
	}
	/**
	* Detached, deep-frozen creation metadata (format version, cwd, lineage,
	* and whether fork history exists). Supplied by the store via `ctx.sessions.create()`. When a
	* `Session` is created without a store-owned header, a minimal header is
	* synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
	* `session.header` is always present. Kept out of the event log — it is a
	* storage concern, not replayable conversation state.
	*/
	header;
	/** Number of leading events inherited from this Session's fork parent. */
	inheritedEventCount;
	/** The session identity, derived from its durable header's single copy. */
	get id() {
		return this.header.id;
	}
	/**
	* The constructor seed length (0 without one), before any marker appended
	* during construction. Seed events never publish on `session/event`. A
	* marker appended before the store attaches occupies this seq without
	* publishing either; otherwise this seq is available for the next append.
	*
	* This in-process offset is not persisted. A fork seed can already contain
	* the child's inherited marker and synthetic closers, so its child-owned
	* history starts at {@link inheritedEventCount}, before this offset. A
	* resumed Session's seed contains its full stored log, while its inherited
	* count keeps the durable fork cut. Consumers needing complete canonical
	* history start at seq 0.
	*/
	firstLiveSeq;
	/**
	* First event produced for this object lifecycle. A new fork includes its
	* child-owned seed marker and closers; a restored Session starts after its
	* complete stored prefix. This in-process capture offset is not persisted.
	*/
	firstLifecycleSeq;
	/**
	* Create a detached session by validating and snapshotting borrowed seed
	* events and storage metadata.
	* @param id - session identity.
	* @param seed - optional borrowed replay or fork events.
	* @param header - optional borrowed storage metadata.
	* @param inheritedEventCount - exact fork-inherited prefix length for a seeded header.
	* @param projections - pure interpreters for plugin-owned message changes.
	* @returns a detached session.
	* @throws when a seed event requires a missing message interpreter or fails validation.
	*/
	static create(id, seed, header, inheritedEventCount, projections) {
		return new Session(id, seed, header, "snapshot", inheritedEventCount, projections);
	}
	/**
	* Restore a detached session by adopting an independently owned or deeply frozen seed.
	* Runtime-required event fields, event envelopes, sequence continuity, surface
	* transitions, and header fields are validated without copying or freezing events.
	* Embedded Assistant streams remain opaque until a stream consumer or storage
	* verifier reads them.
	* @param id - restored session identity.
	* @param seed - independently owned or deeply frozen events.
	* @param header - independently owned storage metadata.
	* @param inheritedEventCount - exact fork-inherited prefix length decoded from storage.
	* @param eventState - aliasing state carried from the operation that produced the seed.
	* @param projections - pure interpreters for plugin-owned message changes.
	* @returns a restored detached session.
	* @throws when a seed event requires a missing message interpreter or fails validation.
	*/
	static fromRestore(id, seed, header, inheritedEventCount, eventState, projections) {
		return new Session(id, seed, header, eventState, inheritedEventCount, projections);
	}
	constructor(id, seed, header, mode = "snapshot", suppliedInheritedEventCount, projections = []) {
        applicationSessions.add(this);
		this.surfaceManager = new SurfaceManager(this.log, SessionLogOffset(0), projections);
		const restoredHeader = mode === "snapshot" ? void 0 : validateRestoredSessionHeader(id, header);
		if (seed !== void 0) for (const [index, source] of seed.entries()) {
			const snapshot = mode === "snapshot" ? snapshotJsonValue(source) : source;
			if (snapshot === void 0) throw new Error(`seed event at index ${index} is not losslessly JSON-serializable`);
			assertSessionEventEnvelope(snapshot, index);
			if (snapshot.seq !== index) throw new Error(`seed event at index ${index} has seq ${snapshot.seq} (expected ${index}); seed must be contiguous from 0`);
			try {
				this.surfaceManager.validateNext(snapshot);
			} catch (error) {
				throw new Error(`invalid seed event at index ${index}: ${error instanceof Error ? error.message : "invalid surface metadata"}`);
			}
			this.log.push(mode === "snapshot" ? deepFreeze(snapshot) : snapshot);
		}
		this.firstLiveSeq = SessionLogOffset(this.log.length);
		this.header = restoredHeader ?? snapshotSessionHeader(id, header);
		if (this.header.isSeeded && seed === void 0) throw new Error("seeded session requires an explicit constructor seed");
		if (this.header.isSeeded && suppliedInheritedEventCount === void 0) throw new Error("seeded session requires an inherited event count");
		const inheritedEventCount = SessionLogOffset(suppliedInheritedEventCount ?? 0);
		if (!this.header.isSeeded && inheritedEventCount !== 0) throw new Error("unseeded session inherited event count must be 0");
		if (inheritedEventCount > this.log.length) throw new Error("session inherited event count exceeds its event log");
		const seedMarker = this.log[inheritedEventCount];
		const markedSeed = seedMarker?.type === "session/end-seed" && seedMarker.data.inherited === true;
		if (mode === "snapshot" && this.header.isSeeded && inheritedEventCount !== this.log.length && !markedSeed) throw new Error("seeded session constructor seed must equal its inherited prefix or mark its inherited cut");
		if (markedSeed && this.log.slice(inheritedEventCount + 1).some((event) => event.type === "session/end-seed" && event.data.inherited === true)) throw new Error("session inherited event count must identify the final inherited marker");
		this.inheritedEventCount = inheritedEventCount;
		this.firstLifecycleSeq = mode === "snapshot" && this.header.isSeeded ? inheritedEventCount : this.firstLiveSeq;
		if (seed !== void 0 && mode === "snapshot" && this.header.isSeeded && !markedSeed) this.append("session/end-seed", { inherited: true });
		else if (seed !== void 0 && !(mode === "snapshot" && this.header.isSeeded) && this.log.at(-1)?.type !== "session/end-seed") this.append("session/end-seed", {});
	}
	/** Cached immutable full snapshot of the private append-only log. */
	eventsSnapshot;
	/**
	* Return the immutable event stored at one exact sequence number.
	* @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
	* See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
	* @param seq - event sequence number.
	* @returns the accepted event, or undefined when the log does not contain it.
	*/
	eventAt(seq) {
		return this.log[seq];
	}
	/**
	* Materialize an immutable snapshot of a half-open event sequence range.
	* A full current snapshot is reused until the next append; every previously
	* returned snapshot remains stable after later appends.
	* @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
	* See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
	* @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
	* @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
	* @returns a frozen array of the selected deeply frozen events.
	*/
	snapshotEvents(fromSeq = SessionLogOffset(0), toSeqExclusive = this.seq) {
		if (fromSeq === 0 && toSeqExclusive === this.log.length) {
			this.eventsSnapshot ??= Object.freeze([...this.log]);
			return this.eventsSnapshot;
		}
		return Object.freeze(this.log.slice(fromSeq, toSeqExclusive));
	}
	/**
	* Return this Session's events after its fork-inherited prefix.
	* @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
	* See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
	* @returns a fresh array containing child-owned events in log order.
	*/
	ownEvents() {
		return this.snapshotEvents(this.inheritedEventCount);
	}
	/**
	* Whether one existing event position is outside the fork-inherited prefix.
	* @param seq - event position in this Session.
	* @returns true when the event belongs to this Session rather than its parent.
	*/
	isOwnSeq(seq) {
		return seq >= this.inheritedEventCount && seq < this.seq;
	}
	/** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
	get seq() {
		return SessionLogOffset(this.log.length);
	}
	/**
	* Append one typed event to the log and synchronously notify observers via
	* the store-owned, module-private publication hooks. The hot path never blocks
	* on I/O — persistence plugins buffer asynchronously. Once the event enters
	* the log, the append is committed: observer failures are logged and
	* contained per listener, so they do not change the return value or prevent
	* later listeners from observing the same accepted event.
	*
	* @param type - The event type (key of {@link SessionEventMap}).
	* @param data - The event payload; must be JSON-serializable.
	* @param opts - Surface metadata: `surfaceOp` controls how the event enters
	*   the ordered Night audit surface; `sourceEventSeqs` lists the seq numbers of earlier
	*   events this one derives from. REQUIRED for
	*   {@link SurfaceEventType} events (every message-producing event must
	*   declare how it joins the surface, the audit projection; Pi remains the model-history
	*   authority) and
	*   rejected by the compiler for non-surface types like `turn/start` or
	*   `assistant/attempt`. Assistant messages embed their exact provider
	*   stream and cannot cite top-level source events.
	* @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
	*   `data` that entered the log, so reading `event.data` back sees the logged
	*   value, never the caller's still-mutable input.
	* @throws if `data` or surface metadata is not losslessly JSON-serializable
	*   (BigInt, function, symbol, undefined, negative zero, non-finite number,
	*   circular reference, sparse array, or an exotic object such as
	*   Map/Set/Date/class instance), or when the candidate violates the
	*   request-header empty-field or tool-error consistency rules, or the
	*   canonical surface contract (marker shape and eligibility, unique
	*   earlier source-event references, positional replacement validity, and complete
	*   shadowed-node coverage). One iterative pass reads, validates, and
	*   copies each nested value once, so a stateful getter cannot supply one value
	*   to validation and another to storage. The event log is the durable source
	*   of truth, so a bad event fails at the append site rather than later during
	*   a backend flush. A synchronous internal dispatch validation failure or an
	*   append reentered while this acceptance/publication boundary is open also
	*   rejects before the log changes.
	*/
	append(type, data, ...opts) {
		const surfaceOpts = opts[0];
		const surfaceMetadata = {
			...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
			...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp }
		};
		const dataSnapshot = snapshotJsonValue(data);
		if (dataSnapshot === void 0) throw new Error(`session event "${type}" carries non-JSON-serializable data`);
		const surfaceMetadataSnapshot = snapshotJsonValue(surfaceMetadata);
		if (surfaceMetadataSnapshot === void 0) throw new Error(`session event "${type}" carries non-JSON-serializable surface metadata`);
		const entry = publicationFor(this);
		const event = deepFreeze({
			type,
			seq: SessionSeq(this.log.length),
			time: Date.now(),
			data: dataSnapshot,
			...surfaceMetadataSnapshot
		});
		validateSessionEventData(event, `session event "${type}" at seq ${event.seq}`);
		this.#commit(event, entry);
		return event;
	}
	static {
		commitPluginRecord = (session, type, data) => session.#appendRecord(type, data);
	}
	/**
	* Commit one plugin record; {@link appendPluginRecord} is the only caller.
	* @param type - record type, checked against the plugin record grammar.
	* @param data - JSON payload, snapshotted before it enters the log.
	* @returns the record's sequence number.
	*/
	#appendRecord(type, data) {
		const dataSnapshot = snapshotJsonValue(data);
		if (dataSnapshot === void 0) throw new Error(`plugin record "${type}" carries non-JSON-serializable data`);
		const entry = publicationFor(this);
		const record = deepFreeze({
			type,
			seq: SessionSeq(this.log.length),
			time: Date.now(),
			data: dataSnapshot,
			ignorable: true
		});
		assertPluginRecordEvent(record);
		this.#commit(record, entry);
		return record.seq;
	}
	/**
	* Read the store attachment for one append, refusing an append that
	* reenters while another append is being published.
	* @returns the attachment, or undefined for a detached Session.
	*/

	/**
	* Accept one frozen candidate at the next sequence number, enter it into the
	* log, and notify `session/event` observers with per-listener containment.
	* @param event - the candidate built at the current log length.
	* @param entry - the attachment read before the candidate was built.
	*/
	#commit(event, entry) {
		this.surfaceManager.validateNext(event);
		if (entry !== void 0) entry.appending = true;
		try {
			let callbacks;
			const callbackArgs = [this, event];
			if (entry !== void 0) callbacks = collectSessionCallbacks(entry.emitCtx, [
				entry.carrier,
				"session/event",
				...callbackArgs
			]);
			this.log.push(event);
			this.eventsSnapshot = void 0;
			if (callbacks !== void 0 && entry !== void 0) invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbacks);
		} finally {
			if (entry !== void 0) {
				entry.appending = false;
				if (entry.detachRequested && !entry.announcing) entry.detach();
			}
		}
	}
	/** Cached fold of the request-header events — see {@link requestHeader}. */
	headerFold;
	/** Log position (events consumed) the header fold has reached. */
	headerFoldSeq = 0;
	/**
	* The {@link EpochHeader} in force after the log's last header event — the
	* header the NEXT request will be compared against — or undefined before
	* the first `request/header` snapshot. The live, incrementally-maintained
	* form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
	* once, when first seen, so a per-step read costs O(new events).
	* @returns the folded header, or undefined when no header event exists yet.
	*/
	requestHeader() {
		if (this.headerFoldSeq < this.log.length) {
			this.headerFold = deepFreeze(foldRequestHeader(this.log.slice(this.headerFoldSeq), this.headerFold));
			this.headerFoldSeq = this.log.length;
		}
		return this.headerFold;
	}
	/** Cached fold of `request/context` events. */
	contextFold;
	contextFoldSeq = 0;
	/**
	* Return the latest resolved route metadata, or `undefined` before the first
	* `request/context` event. Each event is folded once.
	* @returns the latest immutable route metadata.
	*/
	requestContext() {
		if (this.contextFoldSeq < this.log.length) {
			for (const event of this.log.slice(this.contextFoldSeq)) if (event.type === "request/context") this.contextFold = deepFreeze({ ...event.data });
			this.contextFoldSeq = this.log.length;
		}
		return this.contextFold;
	}
	/** Cached historical tool definitions and updates for request projection. */
	toolHistoryProjection = new ToolHistoryProjection();
	/** Index of the next committed event not yet consumed by the tool-history fold. */
	toolHistorySeq = 0;
	/**
	* Fold unseen committed events into capability-independent tool history.
	* Initial access reconstructs inherited history; later reads consume only new events.
	* @returns an immutable snapshot for LLM request projection, including historical addition definitions.
	*/
	toolHistory() {
		for (const event of this.log.slice(this.toolHistorySeq)) this.toolHistoryProjection.apply(event);
		this.toolHistorySeq = this.log.length;
		return this.toolHistoryProjection.snapshot();
	}

};
var SessionForkError = class extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.code = code;
		this.name = "SessionForkError";
	}
};
export { validateSessionAudit, KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session, SessionForkError, SessionId, SessionLogOffset, SessionSeq, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN, ToolCallRecovery, adoptSessionEvent, appendPluginRecord, buildForkSeed, canonicalHeader, deriveEventMessage, foldRequestHeader, foldSurface, headerEquals, interruptedTurnClosers, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEligibleType, isSurfaceEvent, pluginRecordOf, snapshotSessionEvent };
