// Management contracts derived from DeepSeek dsh-schedule 0.2.1-alpha.2 (MIT).
// Copyright (c) 2026 DeepSeek. See licenses/dsh-schedule-MIT.txt.
import {isDeepStrictEqual} from 'node:util'
import {Service} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {randomUUID} from 'node:crypto'
import {ScheduleRuntime} from './native-schedule-runtime.js'
import {scheduleDomain,ScheduleId,ScheduleInputError,scheduleTitle,createAtScheduleRecord,createAfterScheduleRecord,createEveryScheduleRecord,createDailyScheduleRecord,createWeeklyScheduleRecord,createCronScheduleRecord,deliveryHistoryPage,resolveScheduleUpdate} from './native-schedule-protocol.js'
const DEFAULT_DELIVERY_HISTORY_DAYS=30,DEFAULT_DELIVERY_HISTORY_RECORDS=200
export default class NativeSchedule extends Service {
		static inject = [
			"agents",
			"storageDomain",
			"sessionController",
			"sessionPersistence", "workspaceRegistry"
		];
		static Config = z.object({
			deliveryHistoryDays: z.number().step(1).min(1).max(3650).default(DEFAULT_DELIVERY_HISTORY_DAYS),
			deliveryHistoryRecords: z.number().step(1).min(1).max(1e4).default(DEFAULT_DELIVERY_HISTORY_RECORDS)
		});
		/** Resolved retention bounds shared with the runtime that appends acknowledgments. */
		retention;
		ready;
		initialized;
		chain = Promise.resolve();
		runtime;
		stopping = false;
		/**
		* @param ctx - Host services owning storage, dispatch, and Session restoration.
		* @param config - Validated retention configuration for delivery history.
		*/
		constructor(ctx, config) {
			super(ctx, "schedule");
			this.retention = {
				days: config.deliveryHistoryDays ?? DEFAULT_DELIVERY_HISTORY_DAYS,
				records: config.deliveryHistoryRecords ?? DEFAULT_DELIVERY_HISTORY_RECORDS
			};
			this.ready = ctx.storageDomain.open(scheduleDomain).then(async (domain) => {
				for (const [key, task] of domain.table("tasks").entries()) if (key !== task.record.id) {
					try {
						await domain.close();
					} catch (error) {
						ctx.logger.warn(`schedule: closing the domain after a key mismatch failed: ${String(error)}`);
					}
					throw new Error(`schedule: stored task key "${key}" differs from record id "${task.record.id}"`);
				}
				for(const [key,row]of domain.table('deliveries').entries())if(key!==row.packet.id){await domain.close();throw new Error('NIGHT_SCHEDULE_DELIVERY_KEY_MISMATCH')}
				return domain;
			});
			this.initialized = ctx.effect(async () => {
				const domain = await this.ready;
				let cleanup;
				try {
					cleanup = ctx.effect(() => async () => {
						this.stopping = true;
						await this.runtime?.dispose();
						await this.chain;
						await domain.close();
					});
				} catch (error) {
					this.stopping = true;
					await domain.close();
					throw error;
				}
				const tasks = domain.table("tasks");
				this.runtime = new ScheduleRuntime(ctx, () => [...tasks.entries()].map(([, task]) => task), (work) => this.serialize(work), async (task) => {
					await tasks.put(task.record.id, task);
					this.emitChanged();
				}, this.retention, {deliveries:()=>[...domain.table("deliveries").entries()].map(([,row])=>row), saveDelivery:row=>domain.table("deliveries").put(row.packet.id,scheduleDomain.tables.deliveries.valueSchema.parse(row))});
				// Delivery starts only after the default preset has mounted.
				return cleanup;
			});

			ctx.effect(() => {
				const activity = ctx.on("workspace/session-activity", async ({ sessionId }, next) => {
					const active = await this.list({ sessionId });
					const rest = await next();
					if (active.length === 0) return rest;
					return [{
						kind: "schedule",
						items: active.map((record) => ({
							id: record.id,
							label: record.title
						}))
					}, ...rest];
				});
				const stop = ctx.on("workspace/session-stop", async ({ sessionId }) => {
					await this.stopSessionTasks(sessionId);
				});
				return () => {
					stop();
					activity();
				};
			}, "schedule.archiveAdmission()");
		}
		async [Service.init]() {
			await this.initialized;
		}
		/**
		* Create a reminder bound to the caller-selected Session without activating it.
		*
		* The request must supply a title; a missing, blank-after-trim, or over-long
		* title rejects with `invalid_prompt` instead of deriving one from the prompt.
		* A Session a delegated child owns rejects with `subagent_session`, because delivery
		* can never reach it: the child is one whose delegation depth is above zero.
		* The record is built from the clock reading taken before the request joins the
		* serialized queue, so a create that waits behind a longer operation keeps its
		* request-time anchor and may already be due when the queue reaches it.
		* @param sessionId - Original Session receiving the reminder.
		* @param request - Validated tool selector, required title, and reminder content.
		* @param signal - Optional cancellation checked before persistence begins, including after FIFO waits.
		* @returns The durably stored schedule. Cancellation does not roll back an in-flight write.
		*/
		async create(sessionId, request, signal) {
			if (Number(request.at !== void 0) + Number(request.after_seconds !== void 0) + Number(request.every_seconds !== void 0) + Number(request.daily !== void 0) + Number(request.weekly !== void 0) + Number(request.cron !== void 0) > 1) throw new ScheduleInputError("invalid_selector", "Exactly one reminder selector is required.");
			const title = scheduleTitle(request.title);
			const id = ScheduleId(`schedule-${randomUUID()}`);
			const now = Date.now();
			let record;
			if (request.at !== void 0) record = createAtScheduleRecord(id, request.prompt, request.at, now, title);
			else if (request.after_seconds !== void 0) record = createAfterScheduleRecord(id, request.prompt, request.after_seconds, now, title);
			else if (request.every_seconds !== void 0) record = createEveryScheduleRecord(id, request.prompt, request.every_seconds, now, title);
			else if (request.daily !== void 0) record = createDailyScheduleRecord(id, request.prompt, request.daily, now, title);
			else if (request.weekly !== void 0) record = createWeeklyScheduleRecord(id, request.prompt, request.weekly, now, title);
			else if (request.cron !== void 0) record = createCronScheduleRecord(id, request.prompt, request.cron, now, title);
			else throw new ScheduleInputError("invalid_selector", "Exactly one reminder selector is required.");
			return this.serialize(async () => {
				const refusal = await this.reminderTargetRefusal(sessionId);
				if (refusal !== void 0) throw new ScheduleInputError("subagent_session", refusal.message);
				const domain = await this.getDomain();
				signal?.throwIfAborted();
				await domain.table("tasks").put(id, {
					sessionId,
					record,
					status: "active",
					deliveryHistory: {
						records: [],
						earlierRecordsUnavailable: false
					}
				});
				this.emitChanged();
				this.runtime?.requestDrive();
				return structuredClone(record);
			});
		}
		/**
		* Read the selected Session's active tasks without resuming its Agent.
		* @param request - Session whose task list is requested.
		* @returns Persisted reminders in storage order.
		*/
		async list(request) {
			return [...(await this.getDomain()).table("tasks").entries()].filter(([, task]) => task.sessionId === request.sessionId && task.status === "active").map(([, task]) => structuredClone(task.record));
		}
		/**
		* Read all active and inactive Host reminders with their original Session bindings.
		* A deleted reminder has no row, so it is absent here.
		* Does not activate Sessions or read Session history.
		* @returns Reminders ordered by scheduledAt ascending, then lexicographically by id.
		*/
		async catalog() {
			return [...(await this.getDomain()).table("tasks").entries()].map(([, task]) => ({
				...task.record,
				sessionId: task.sessionId,
				status: task.status,
				...task.lastDelivery === void 0 ? {} : { lastDelivery: task.lastDelivery }
			})).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));
		}
		/**
		* Read saved accepted reminder deliveries without activating or reading the original Session.
		* The task's own row supplies its binding, so its records stay readable through this lookup.
		* @param request - Session binding, task identity, explicit limit, and optional exclusive message cursor.
		* @returns Newest-first deliveries in append order, or a task/cursor lookup failure.
		* @throws ScheduleInputError when limit is not a safe integer from 1 through 100.
		*/
		async history(request) {
			if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new ScheduleInputError("invalid_rule", "Delivery history limit must be a safe integer from 1 through 100.");
			const task = (await this.getDomain()).table("tasks").get(request.id);
			if (task === void 0 || task.sessionId !== request.sessionId) return {
				id: request.id,
				code: "schedule_not_found"
			};
			return deliveryHistoryPage(task, request, this.retention);
		}
		/**
		* Delete one task belonging to the selected Session, leaving queued messages intact.
		*
		* The row is removed: the task no longer schedules, leaves `list` and `catalog`, and its
		* saved delivery records go with it. A task bound to a Session a delegated child owns
		* stays deletable even though creation and timing edits refuse that binding, so a task
		* stored before that rule existed remains removable.
		* @param request - Session and exact task identity.
		* @param signal - Optional cancellation checked before persistence begins, including after FIFO waits.
		* @returns Whether that Session owned a deleted task. Cancellation does not roll back an in-flight write.
		*/
		async delete(request, signal) {
			return this.serialize(async () => {
				const tasks = (await this.getDomain()).table("tasks");
				signal?.throwIfAborted();
				const current = tasks.get(request.id);
				if (current === void 0 || current.sessionId !== request.sessionId) return {
					id: request.id,
					deleted: false,
					code: "schedule_not_found"
				};
				await tasks.delete(request.id);
				this.emitChanged();
				this.runtime?.requestDrive();
				return {
					id: request.id,
					deleted: true
				};
			});
		}
		/**
		* Update the name, instruction, and timing of an active task within the original Session
		* binding without activating the Session or changing saved deliveries.
		*
		* Each supplied field replaces its stored value; an omitted field keeps it. A name or
		* instruction change alone does not reset the committed target. A Session a delegated
		* child owns returns the non-mutating `subagent_session` result, so an edit cannot
		* re-arm a task bound to a Session delivery can never reach, and the Web editor can
		* explain the refusal through the ordinary result it already renders.
		* @param request - Task binding, complete observed record, and any combination of timing, name, and instruction.
		* @param signal - Cancellation checked after domain readiness and FIFO waits, before persistence begins.
		* @returns The committed record, unchanged record for a no-op, or a non-mutating input/lookup/conflict/refusal result.
		* Storage and lifecycle failures reject; cancellation after a write starts does not roll it back.
		*/
		async update(request, signal) {
			return this.serialize(async () => {
				const refusal = await this.reminderTargetRefusal(request.sessionId);
				if (refusal !== void 0) return refusal;
				const tasks = (await this.getDomain()).table("tasks");
				signal?.throwIfAborted();
				const current = tasks.get(request.id);
				if (current === void 0 || current.sessionId !== request.sessionId) return {
					id: request.id,
					updated: false,
					code: "schedule_not_found"
				};
				if (current.status === "inactive") return {
					id: request.id,
					updated: false,
					code: "schedule_ended"
				};
				const result = resolveScheduleUpdate(current.record, request.expected, request.change, Date.now(), request);
				if (!("record" in result) || !result.updated) return structuredClone(result);
				await tasks.put(request.id, {
					...current,
					record: result.record
				});
				this.emitChanged();
				this.runtime?.requestDrive();
				return structuredClone(result);
			});
		}
		/**
		* Dispatch one post-commit `schedule/changed` notification, containing
		* synchronous listener failures: every call site emits only after its durable
		* task write landed, so a throwing listener must not reject the caller or
		* skip the following `requestDrive()`.
		*/
		emitChanged() {
			try {
				this.ctx.emit("schedule/changed");
			} catch (error) {
				this.ctx.logger.warn(`schedule: schedule/changed listener failed: ${String(error)}`);
			}
		}
        async cancelAccepted(actor) {
            if(!actor||this.ctx.agents.get(actor.id)!==actor)throw new Error('NIGHT_SCHEDULE_FOREIGN_ACTOR')
            return this.serialize(async()=>{
                const deliveries=(await this.getDomain()).table('deliveries')
                for(const [id,row]of deliveries.entries())if(row.sessionId===actor.id&&!row.cancelled&&actor.admission.status?.(id)!=='admitted'){
                    await deliveries.put(id,{...row,cancelled:true})
                }
            })
        }
        async authorizeInput(packet,actor) {
            if(!actor||this.ctx.agents.get(actor.id)!==actor||!actor.lifecycle?.isLive()||actor.lifecycle.signal.aborted)return false
            try { this.ctx.sessionController.assertOrdinary(actor.metadata) } catch { return false }
            const row=(await this.getDomain()).table('deliveries').get(packet?.id)
            return !!row&&!row.cancelled&&row.sessionId===actor.id&&isDeepStrictEqual(row.packet,packet)
        }

		async getDomain() {
			await this.initialized;
			return this.ready;
		}
		/**
		* Refuse a Session no delivery can reach because a delegated child owns it.
		*
		* Delivery resolves the bound Session through `ctx.sessionController.resolveAgent`,
		* which rejects the live Agent of a delegated child; a stored task for such a Session
		* would stay permanently overdue and retry on every drive. Both operations that can
		* arm a delivery read that same fact here instead of restating it: a delegated child
		* is one whose {@link delegationDepthOf} is above zero, the accounting the delegation
		* cap itself enforces, which survives a cold resume through the persisted header.
		* @param sessionId - Session the task would be bound to.
		* @returns The stable refusal for a delegated child's Session, or undefined when the Session is eligible.
		*/
        async reminderTargetRefusal(sessionId) {
            const header = await this.ctx.sessionController.header(sessionId);
            if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) throw new ScheduleInputError('session_archived', 'Archived sessions cannot create reminders.');
            if(header.agentPreset==='night-bot-task')return {code:'subagent_session',message:'Task-owned sessions cannot receive ordinary reminders.'};
            if ((header.delegationDepth ?? 0) === 0 && header.origin !== 'subagent') return;
            return {code:'subagent_session',message:'This Session belongs to subagent routing, which never receives reminder delivery.'};
        }

		/**
		* Remove every active task stored for one Session, inside the queue the tools
		* use.
		*
		* Enumerating and deleting in one queue slot is what makes an archive stop
		* ordered behind a create whose write is still in flight: a stop that read the
		* table outside the queue could miss a row the create was about to commit and
		* leave an armed reminder behind. Re-entering the public `delete()` from here
		* would deadlock on this queue, so the rows are removed directly.
		* @param sessionId - Session whose active Host tasks must stop.
		*/
		async stopSessionTasks(sessionId) {
			await this.serialize(async () => {
				const tasks = (await this.getDomain()).table("tasks");
				const active = [...tasks.entries()].filter(([, task]) => task.sessionId === sessionId && task.status === "active").map(([, task]) => task.record.id);
				if (active.length === 0) return;
				let removed = false;
				let failure;
				for (const id of active) try {
					await tasks.delete(id);
					removed = true;
				} catch (error) {
					failure ??= error instanceof Error ? error : /* @__PURE__ */ new Error(`schedule stop failed: ${String(error)}`);
				}
				if (removed) {
					this.emitChanged();
					this.runtime?.requestDrive();
				}
				if (failure !== void 0) throw failure;
			});
		}
		serialize(work) {
			if (this.stopping) return Promise.reject(/* @__PURE__ */ new Error("Schedule service is stopping"));
			const pending = this.chain.then(work);
			this.chain = pending.catch(() => void 0);
			return pending;
		}
 start(){if(!this.stopping)this.runtime.requestDrive()}
}
