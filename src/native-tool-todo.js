// MIT source-derived model tool binding; see licenses/dsh-tool-todo-MIT.txt. Active lifecycle belongs to native services and Pi.
import {AgentSession} from '@earendil-works/pi-coding-agent';
import {scopeOf} from './native-scope.js';
import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { defineTool } from "./native-tool-protocol.js";
//#region lib/types/index.js
/**
* Model-facing whole-list replacement recorded as typed Night planning receipts.
* Pi owns conversation history; no Session projection or turn event owns this list.
* Only the exact live official actor can update its own business receipts.
* @module @deepseek-ai/dsh-tool-todo
*/
const name = "night-native-tool-todo";
const inject = ["tools", "agents"];
/** The valid {@link TodoItem} statuses, as a runtime set for input narrowing. */
const STATUSES = [
	"pending",
	"in_progress",
	"completed"
];
/** Schemastery configuration for the todo tool consumer. */
const Config = z.object({ allowParallelInProgress: z.boolean().required() });
const DESCRIPTION_HEAD = "Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. Add one todo per concrete step before you start. ";
const DESCRIPTION_PARALLEL = "While work remains, keep the todos being worked on `in_progress`, several only when work runs in parallel. ";
const DESCRIPTION_SINGLE = "While work remains, keep exactly one todo `in_progress`. ";
const DESCRIPTION_TAIL = "Mark each todo `completed` as soon as it is done.";
/**
* The model-facing description for one activation. The active-status clause is the only part that
* varies, because it is the only instruction the parallel policy changes.
* @param allowParallel - whether several todos may be `in_progress` at once.
* @returns the composed tool description.
*/
function describe(allowParallel) {
	return DESCRIPTION_HEAD + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE) + DESCRIPTION_TAIL;
}
/**
* Validate the value constraints the ParameterSchemaSpec can't express and build the canonical {@link
* TodoItem}[]: trimmed non-empty unique content, and at most one `in_progress` item unless the
* deployment allows parallel work. The registry has already enforced the status enum and rejected
* unknown item keys (`additionalProperties: false` — the logged snapshot must equal what the model
* believes it wrote, so a nested/extended item shape fails loud at the schema boundary instead of
* silently flattening); the cast below records that guarantee.
* @param raw - the model-supplied list, already schema-checked.
* @param allowParallel - whether several items may be `in_progress` at once.
* @returns the canonical list.
*/
function toTodoList(raw, allowParallel) {
	const todos = [];
	const seen = /* @__PURE__ */ new Set();
	let active = 0;
	for (const item of raw) {
		const content = item.content.trim();
		if (content.length === 0) throw new Error("invalid todo: `content` must be a non-empty string");
		if (seen.has(content)) throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`);
		seen.add(content);
		if (item.status === "in_progress") active++;
		todos.push({
			content,
			status: item.status
		});
	}
	if (!allowParallel && active > 1) throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`);
	return todos;
}
/** Register the planning tool; typed business receipts own its durable facts. */
function apply(ctx, config) {
	const allowParallel = config.allowParallelInProgress;
	ctx.tools.register(defineTool({
		name: "todo_write",
		description: describe(allowParallel),
		parameters: { todos: {
			type: "array",
			required: true,
			description: "The COMPLETE task list, replacing any previous list.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					content: {
						type: "string",
						required: true,
						description: "What the task is — a short imperative line."
					},
					status: {
						type: "string",
						required: true,
						enum: [...STATUSES],
						description: "pending (not started) | in_progress (now) | completed (done)."
					}
				}
			}
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					todos: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								content: {
									type: "string",
									required: true
								},
								status: {
									type: "string",
									required: true,
									enum: [...STATUSES]
								}
							}
						}
					},
					counts: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							pending: {
								type: "integer",
								required: true
							},
							inProgress: {
								type: "integer",
								required: true
							},
							completed: {
								type: "integer",
								required: true
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`
			}]
		},
		async execute(args, exec) {
			const todos = toTodoList(args.todos, allowParallel);
			if (!exec.agent) throw new Error("todo_write requires an owning agent session");
			const actor=exec.agent;
			if(!(actor.piSession instanceof AgentSession)||scopeOf(actor.ctx)!==actor||ctx.agents.get(actor.id)!==actor||actor.lifecycle?.isLive()!==true)throw new Error('PI_TODO_ACTOR_REQUIRED');
			exec.signal?.throwIfAborted();actor.lifecycle.signal.throwIfAborted();
			if(typeof actor.receipts?.append!=='function'||typeof actor.receipts.commit!=='function')throw new Error('PI_TODO_BUSINESS_RECEIPTS_REQUIRED');
			actor.receipts.append({version:1,domain:'planning',kind:'todos',payload:{todos}});await actor.receipts.commit();
			const count = (status) => todos.filter((t) => t.status === status).length;
			return Promise.resolve({
				todos: todos.map((todo) => ({
					content: todo.content,
					status: todo.status
				})),
				counts: {
					pending: count("pending"),
					inProgress: count("in_progress"),
					completed: count("completed")
				}
			});
		},
		presentCall: (args) => ({
			card: "generic",
			title: "Update todo list",
			kind: "other",
			rawInput: args.todos
		})
	}));
}
//#endregion
export { Config, apply, inject, name };
const nativeTodoReceipt=z$1.strictObject({todos:z$1.array(z$1.strictObject({content:z$1.string().min(1),status:z$1.enum(STATUSES)}))})
export const todoAuditKinds=Object.freeze({'planning/todos':value=>nativeTodoReceipt.safeParse(value).success})
