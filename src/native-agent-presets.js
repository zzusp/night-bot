// MIT source-derived preset generation, scope and Loader audit algorithms; see THIRD_PARTY.md.
import {AgentSession} from '@earendil-works/pi-coding-agent';
import z from "@deepseek-ai/schemastery";
import {ControlError} from './runtime/control-error.js'
import { bindScopeParent, createScope, scopeOf, scopeParentOf } from "./native-scope.js";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { dump } from "js-yaml";
import { Context, Service } from "@deepseek-ai/cordis";
import { EntryTree, isJsExpr } from "@deepseek-ai/cordis-plugin-loader";
import {prepareProfileEntries} from "./native-profile-preflight.js";
//#region lib/types/definition.js
/** Validate a parsed Cordis entry list, including nested groups.
* @param rows Parsed YAML value.
* @param at Diagnostic prefix.
* @returns The first invalid row, or undefined.
*/
function entryListProblem(rows, at = "") {
	if (!Array.isArray(rows)) return at === "" ? "the composition must be a top-level list of plugin rows" : `group ${at} must hold a list of plugin rows`;
	for (const [index, row] of rows.entries()) {
		const label = at === "" ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`;
		if (typeof row !== "object" || row === null || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`;
		const { name, group, config } = row;
		if (typeof name !== "string" || name === "") return `${label} names no plugin (a "name" string is required)`;
		if (group === true) {
			const nested = entryListProblem(config, label);
			if (nested !== void 0) return nested;
		}
	}
}
//#endregion
//#region lib/types/mount.js
/** Runtime plugin trees shared by Agents selecting one preset revision. */
/** In-memory Loader tree; only the profile configuration editor persists definitions. */
var PresetTree = class extends EntryTree {
	constructor(ctx) {
		const owner = ctx.fiber.entry;
		const subtree = owner?.subtree;
		const subgroup = owner?.subgroup;
		super(ctx);
		if (owner !== void 0) {
			if (subtree === void 0) delete owner.subtree;
			else owner.subtree = subtree;
			if (subgroup === void 0) delete owner.subgroup;
			else owner.subgroup = subgroup;
		}
	}
	write() {}
};
/**
* Whether `fiber` is `root` itself or is mounted anywhere inside its subtree.
*
* Membership is object identity. `uid` looks like a cheaper key but is a
* per-registry counter, so fibers in two different roots collide on it and a
* subtree in one runtime would be blamed for a service published in another.
* @param fiber - the fiber to locate.
* @param root - the subtree root to test membership against.
* @returns true when `fiber` belongs to `root`'s subtree.
*/
function withinFiber(fiber, root) {
	let current = fiber;
	while (true) {
		if (current === root) return true;
		const parent = current.parent.fiber;
		if (parent === current) return false;
		current = parent;
	}
}
/**
* Service names the mounted subtree published into the root realm.
*
* A provider without an `isolate` realm stores its implementation under the
* root's symbol for that name, which is exactly the comparison below; a
* provider inside an `isolate` realm stores under a realm-private symbol and
* is correctly absent here.
* @param ctx - any context of the runtime whose service store is inspected.
* @param mount - the mounted subtree's fiber.
* @returns the leaked service names in lexical order.
*/
function leakedServices(ctx, mount) {
	const store = ctx.reflect.store;
	const rootIsolate = ctx.root[Context.isolate];
	const leaked = [];
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than
		clearing it, so an own symbol always resolves; the guard exists only
		because the store's index signature is optional. */
		if (impl === void 0) continue;
		if (!withinFiber(impl.fiber, mount)) continue;
		if (rootIsolate[impl.name] === key) leaked.push(impl.name);
	}
	return leaked.sort((left, right) => left.localeCompare(right));
}
/**
* Read a service implementation owned by one retained preset, including isolated realms.
*
* Ownership is the same relation {@link leakedServices} reads, inverted: there
* it names implementations a subtree published into the ROOT realm, here it
* names the one this subtree published anywhere. Fiber membership is object
* identity for the reason stated on {@link withinFiber}.
*
* @param ctx - any context of the runtime whose service store is inspected.
* @param mount - the retained revision whose subtree owns the service.
* @param name - the service name as the preset's rows resolve it.
* @returns the implementation, or undefined when the mount provides none.
*/
function serviceForMount(ctx, mount, name) {
	const store = ctx.reflect.store;
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than clearing it */
		if (impl === void 0) continue;
		if (impl.name !== name) continue;
		if (withinFiber(impl.fiber, mount.fiber)) return impl.value;
	}
}
/**
* Audit the rows of a mounted subtree.
*
* Wait for the subtree, then report import failures, activation failures, and
* rows waiting for services the composition does not supply.
* @param tree - the mounted subtree.
* @returns failed and pending rows, both empty when every enabled row is usable.
*/
async function auditRows(tree) {
	await tree.await();
	const failed = [];
	const pending = [];
	for (const entry of tree.entries()) {
		if (entry.disabled) continue;
		const fiber = entry.fiber;
		if (fiber === void 0) {
			failed.push(`${entry.options.id} (${entry.options.name}): never started`);
			continue;
		}
		try {
			await fiber.await();
		} catch (error) {
			const detail = mountDetail(error);
			failed.push(`${entry.options.id} (${entry.options.name}): ${detail}`);
			continue;
		}
		const missing = Object.keys(fiber.inject).filter((name) => fiber.ctx.get(name) === void 0);
		if (missing.length > 0) pending.push(`${entry.options.id} (${entry.options.name}): waiting for ${missing.join(", ")}`);
	}
	return {
		failed,
		pending
	};
}
/**
* The causes of `error` whose detail its own message does not already carry.
*
* Aggregate errors carry separate member messages. A wrapper can preserve the
* aggregate as its cause without including those messages in its own text.
* @param error - the failure to read branches from.
* @returns the branches to render beneath `error.message`, possibly empty.
*/
function detailBranches(error) {
	if (error instanceof AggregateError) return error.errors;
	return error.cause instanceof AggregateError ? error.cause.errors : [];
}
/**
* The reportable text of a mount failure.
*
* A plugin may reject with an aggregate or wrap one as its cause. Include its
* member messages beneath the row diagnostic so each failure is visible.
* @param error - the value the mount rejected with.
* @returns a single-line-per-cause description.
*/
function mountDetail(error) {
	if (!(error instanceof Error)) return String(error);
	const branches = detailBranches(error);
	if (branches.length === 0) return error.message;
	return [error.message, ...branches.map((branch) => `- ${mountDetail(branch).replaceAll("\n", "\n  ")}`)].join("\n");
}
/** Load and audit one revision under its registry-owned scope.
*
* Failed rows and root-realm service leaks reject the mount. Rows waiting for
* a Host service stay mounted: they activate by themselves once the provider
* finishes, and the registry re-audits them after the Host tree settles.
* Inside a profile, compatibility policy decides admission first: a row whose
* plugin the profile denies mounts disabled, so the audit reads it as
* intentionally inactive instead of reporting a failed import.
* @param ctx Scope context inheriting the declaring Loader's resolution base.
* @param id Preset identity.
* @param plugins Declared Cordis entry list.
* @returns The live tree; scope disposal owns its teardown.
*/
async function mountPreset(ctx, id, plugins) {
	if (scopeOf(ctx) === void 0) throw new Error("agent-preset: mounting requires a scope");
	await ctx.fiber.await();
	const tree = new PresetTree(ctx);
	ctx.effect(() => () => {
		tree.root.stop();
	}, "agent-preset.tree");
	await tree.root.update(prepareProfileEntries(ctx, plugins, ctx.baseUrl));
	const audit = await auditRows(tree);
	const leaked = leakedServices(ctx, ctx.fiber);
	if (audit.failed.length > 0) throw new Error(audit.failed.join("\n"));
	if (leaked.length > 0) throw new Error(`Preset services require isolate realms: ${leaked.join(", ")}`);
	return {
		presetId: id,
		fiber: ctx.fiber,
		tree,
		key: scopeOf(ctx)
	};
}
//#endregion
//#region lib/types/composition-inventory.js
/** Read active module references without exposing Loader entries.
* @param tree - the retained revision's tree.
* @returns detached module references in Loader order.
*/
function activeCompositionModules(tree) {
	const modules = [];
	for (const entry of tree.entries()) {
		if (entry.options.group || entry.disabled || entry.fiber?.state !== 2) continue;
		const ownerTree = entry.parent.tree;
		const baseUrl = ownerTree.ctx.baseUrl;
		modules.push({
			moduleName: entry.options.name,
			...baseUrl === void 0 ? {} : { baseUrl },
			useHostBase: ownerTree === tree
		});
	}
	return modules;
}
/**
* One `disabled` node's contribution to effective enablement, mirroring the
* Loader's own reading: a `!!js` expression is asked of the evaluator — a
* refusal (throw) leaves the decision to a mount — and anything else disables
* exactly when `Boolean(value)` does.
* @param value - the raw `disabled` node of one composition row.
* @param evaluateExpression - the Loader-context evaluator for `!!js` nodes.
* @returns true (disabled), false (enabled), or `'conditional'`.
*/
function disabledContribution(value, evaluateExpression) {
	if (isJsExpr(value)) try {
		return Boolean(evaluateExpression(value.__jsExpr));
	} catch {
		return "conditional";
	}
	return Boolean(value);
}
/**
* Combine an ancestor group's disabled state with a row's own, the way the
* Loader walks owning groups: any literal true disables, otherwise any
* expression leaves the decision to a mount.
* @param outer - the combined ancestor contribution.
* @param own - this row's contribution.
* @returns the row's effective disabled state.
*/
function combineDisabled(outer, own) {
	if (outer === true || own === true) return true;
	if (outer === "conditional" || own === "conditional") return "conditional";
	return false;
}
/**
* Flatten one parsed row list into plugin rows. Group rows are structural —
* the Loader reports a group entry as always enabled and lets children
* inherit its `disabled` — so only their children are emitted.
* @param rows - the parsed rows, shape-checked by the caller.
* @param outerDisabled - the combined ancestor-group disabled state.
* @param evaluateExpression - the Loader-context evaluator for `!!js` nodes.
* @param found - the accumulator receiving flattened rows.
*/
function flattenRows(rows, outerDisabled, evaluateExpression, found) {
	for (const value of rows) {
		const row = value;
		const disabled = combineDisabled(outerDisabled, disabledContribution(row.disabled, evaluateExpression));
		if (row.group === true) {
			flattenRows(row.config, disabled, evaluateExpression, found);
			continue;
		}
		found.push({
			entryId: typeof row.id === "string" && row.id !== "" ? row.id : null,
			moduleName: row.name,
			enabled: disabled === true ? false : disabled === "conditional" ? "conditional" : true,
			...isJsExpr(row.disabled) ? { condition: row.disabled.__jsExpr } : {}
		});
	}
}
/** Flatten declared child plugins for diagnostics before a successful activation.
* @param rows Parsed child entries.
* @param evaluateExpression Loader-context evaluator for disabled expressions.
* @returns Flattened entries or a configuration diagnostic.
*/
function definitionComposition(rows, evaluateExpression) {
	const problem = entryListProblem(rows);
	if (problem !== void 0) return { broken: problem };
	const found = [];
	flattenRows(rows, false, evaluateExpression, found);
	return { rows: found };
}
/**
* Plugin rows of one live standing composition, in Loader-entry order.
* @param tree - the standing mount's entry tree.
* @returns rows with the Loader's evaluated enablement and root-fiber states.
*/
function mountedCompositionRows(tree) {
	const found = [];
	const owner = tree.ctx.fiber.entry;
	const prefix = owner === void 0 ? "" : `${owner.id}:`;
	for (const entry of tree.entries()) {
		if (entry.options.group) continue;
		found.push({
			entryId: entry.id.slice(prefix.length),
			moduleName: entry.options.name,
			enabled: !entry.disabled,
			...isJsExpr(entry.options.disabled) ? { condition: entry.options.disabled.__jsExpr } : {},
			...entry.fiber === void 0 ? {} : { fiberState: entry.fiber.state }
		});
	}
	return found;
}
//#endregion
//#region lib/types/index.js
export default class NativeAgentPresets extends Service {
static inject = ["loader", "agents"];
static Config = z.object({
	default: z.string().required(),
	selectedDefault: z.string().volatile()
});
owner;
definitions = /* @__PURE__ */ new Map();
generations = /* @__PURE__ */ new Map();
bindings = /* @__PURE__ */ new WeakMap();
sealedCompositions=new WeakMap();
inheritedCompositions=new WeakMap();
closing=false;
constructor(ctx, config) {
	super(ctx, "agentPresets");
	this.config = config;
	this.owner = ctx;
	ctx.effect(()=>()=>{this.closing=true},'native preset registry close');
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});

}
/** Default preset for a subsequently created session. */
get defaultId() {
	return this.config.selectedDefault.get() ?? this.config.default;
}
/** Register and eagerly load a definition; activation failure remains visible in the roster.
* @param definition Parsed configuration supplied by the declaring plugin.
* @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
*/
async register(definition) {
	if(this.closing)throw new Error("NATIVE_PRESET_REGISTRY_CLOSED");
	const context = this.ctx;
	if (!definition.id.trim()) throw new Error("Preset id must not be empty");
	if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`);
	const record = {
		config: structuredClone(definition),
		context,
		ready: Promise.resolve()
	};
	this.definitions.set(definition.id, record);
	let disposed = false;
	const unregister = async () => {
		if (disposed) return;
		disposed = true;
		this.definitions.delete(definition.id);
		await record.ready;
		if (record.generation !== void 0) {
			record.generation.retired = true;
			await this.collect(record.generation);
		}
	};
	record.ready = this.activate(record);
	await record.ready;
	return unregister;
}
async activate(record) {
	const key = {};
	const scope = createScope(this.owner, key);
	try {
		const problem = entryListProblem(record.config.plugins);
		if (problem !== void 0) throw new Error(problem);
		const context = scope.ctx.extend({ baseUrl: record.context.baseUrl });
		const generation = {
			scope,
			key,
			mount: await mountPreset(context, record.config.id, record.config.plugins),
			users: 0,
			retired: false
		};
		context.effect(() => {
			this.generations.set(key, generation);
			return () => {
				this.generations.delete(key);
			};
		}, "agent-preset.mount");
		record.generation = generation;
	} catch (error) {
		record.broken = error.message;
		this.owner.logger.warn(`agent preset ${record.config.id}: ${record.broken}`);
		await scope.dispose();
	}
}
/**
* Current activation diagnostic of a definition.
*
* A mount failure is final. A mounted tree is re-audited on every read: a
* row waiting for a Host service activates by itself once that provider
* finishes, so the audit waits for the Host Loader tree to settle before
* reporting the row as unusable. Callers therefore must not run inside a
* Host row's own activation, which the settlement would wait on.
* @param record - the definition to audit.
* @returns one line per unusable row, or undefined when the definition is usable.
*/
async diagnostic(record) {
	await record.ready;
	if (record.generation === void 0) return record.broken;
	const tree = record.generation.mount.tree;
	let audit = await auditRows(tree);
	if (audit.pending.length > 0) {
		await this.owner.loader.await();
		audit = await auditRows(tree);
	}
	const lines = [...audit.failed, ...audit.pending];
	return lines.length === 0 ? void 0 : lines.join("\n");
}
async collect(generation) {
	if (!generation.retired || generation.users !== 0) return;
	this.generations.delete(generation.key);
	await generation.scope.dispose();
}
generationFor(ctx) {
 const key=ctx===undefined?undefined:scopeOf(ctx);
 if(key===undefined)return;
 const binding=this.bindings.get(key);if(binding)return binding.generation;
 for(let parent=scopeParentOf(key);parent!==undefined;parent=scopeParentOf(parent)){
  const generation=this.generations.get(parent)??this.bindings.get(parent)?.generation;
  if(generation)return generation;
 }
}
/** Inspect retained revisions, or the exact revision an Agent joined.
* @param ctx - optional Agent context; omission includes all retained revisions.
* @returns detached module references and isolation diagnostics; no match returns an empty list.
*/
inspectCompositions(ctx) {
	const joined = ctx === void 0 ? void 0 : this.generationFor(ctx);
	return (ctx === void 0 ? [...this.generations.values()] : joined === void 0 ? [] : [joined]).map(({ mount }) => ({
		id: mount.presetId,
		modules: activeCompositionModules(mount.tree),
		leakedServices: leakedServices(this.owner, mount.fiber)
	}));
}
/** Read every declared preset, including activation failures.
* @returns Display metadata and loading diagnostics.
*/
async list() {
	return (await Promise.all([...this.definitions.values()].map(async (record) => {
		const broken = await this.diagnostic(record);
		return {
			id: record.config.id,
			...record.config.name === void 0 ? {} : { name: record.config.name },
			...record.config.description === void 0 ? {} : { description: record.config.description },
			...record.config.order === void 0 ? {} : { order: record.config.order },
			...broken === void 0 ? {} : { broken }
		};
	}))).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id));
}
/** Read the selection roster.
* @returns Current presets, each marked when it is the default.
*/
async remoteExportList() {
	const defaultId = this.defaultId;
	return { presets: (await this.list()).map((row) => ({
		...row,
		isDefault: row.id === defaultId
	})) };
}
/** Resolve an identity without starting an Agent.
* @param id Explicit preset or the current default.
* @returns Current metadata, including failure when activation failed.
*/
async resolve(id) {
	const wanted = id ?? this.defaultId;
	const record = this.definitions.get(wanted);
	if (record === void 0) throw new ControlError("agent-preset/not-found", `Unknown agent preset: ${wanted}`, {
		agentPreset: wanted,
		available: [...this.definitions.keys()]
	});
	const broken = await this.diagnostic(record);
	return {
		id: wanted,
		...broken === void 0 ? {} : { broken }
	};
}
/** Read one declaration's child plugin list as YAML, for viewing only.
* @param agentPreset Preset identity.
* @returns The declared composition beside its published metadata.
*/
readDocument(agentPreset) {
	const record = this.definitions.get(agentPreset);
	if (record === void 0) return Promise.reject(new ControlError("agent-preset/not-found", `Unknown agent preset: ${agentPreset}`, {
		agentPreset,
		available: [...this.definitions.keys()]
	}));
	const { id, name, description, plugins } = record.config;
	const content = dump(plugins, {
		schema: entryListSchema,
		noRefs: true,
		lineWidth: -1
	});
	return Promise.resolve({
		agentPreset: id,
		content,
		...name === void 0 ? {} : { name },
		...description === void 0 ? {} : { description }
	});
}
async retain(id) {
	const wanted = id ?? this.defaultId;
	while (true) {
		const record = this.definitions.get(wanted);
		if (record === void 0) throw new ControlError("agent-preset/not-found", `Unknown agent preset: ${wanted}`, {
			agentPreset: wanted,
			available: [...this.definitions.keys()]
		});
		const broken = await this.diagnostic(record);
		if (this.definitions.get(wanted) !== record) continue;
		const generation = record.generation;
		if (broken !== void 0 || generation === void 0) {
			const reason = broken;
			throw new ControlError("agent-preset/invalid", reason, {
				agentPreset: wanted,
				reason
			});
		}
		generation.users++;
		return generation;
	}
}
/** Freeze the exact startup composition before the official SDK captures tools.
 * Header identity is checked by the application factory; no Session is minted. */
seal(actor) {
 const key=scopeOf(actor?.ctx),generation=this.generationFor(actor?.ctx);
 if(!actor||key!==actor||actor.lifecycle?.isLive()!==true||!generation)throw new Error('NATIVE_PRESET_ACTOR_UNBOUND');
 const previous=this.sealedCompositions.get(actor);
 if(previous&&previous!==generation)throw new Error('NATIVE_PRESET_COMPOSITION_CHANGED');
 this.sealedCompositions.set(actor,generation);
}
assertMutableBinding(ctx,generation) {
 const actor=scopeOf(ctx),current=this.generationFor(ctx);
 const captured=actor&&this.sealedCompositions.get(actor),inherited=actor&&this.inheritedCompositions.get(actor);
 if(inherited&&inherited!==generation)throw new ControlError('agent-preset/locked','A child retains its exact parent preset revision',{sessionId:actor?.id});
 const published=actor&&typeof actor.id==='string'&&this.owner.agents.get(actor.id)===actor;
 if((captured||published||actor?.piSession instanceof AgentSession)&&current!==generation)throw new ControlError('agent-preset/locked','Official SDK composition is immutable; choose a preset when creating a new session',{sessionId:actor?.id,agentPreset:generation.mount.presetId});
}
async bind(ctx, generation) {
	this.assertMutableBinding(ctx,generation);
	const key = scopeOf(ctx);
	if (key === void 0) throw new Error("Agent preset binding requires a scoped context");
	const binding = this.bindings.get(key);
	if (binding?.generation === generation) return;
	if (binding !== void 0) {
		if(!binding.parent)throw new ControlError('agent-preset/locked','An inherited routing scope retains its exact parent composition');
		binding.parent.rebind(generation.key);
		const old = binding.generation;
		generation.users++;
		binding.generation = generation;
		old.users--;
		await this.collect(old);
	} else this.join(ctx, key, generation);
}
join(ctx, key, generation) {
 const existingParent=scopeParentOf(key);
 // A real child already has its parent's routing ancestry. Borrow that link
 // only when it reaches the exact retained generation; own a separate lease.
 const inherited=existingParent===undefined?undefined:this.generationFor(ctx);
 if(existingParent!==undefined&&inherited!==generation)throw new ControlError('agent-preset/locked','Parent routing scope has a different preset composition');
 const binding={parent:existingParent===undefined?bindScopeParent(key,generation.key):undefined,generation};
 generation.users++;this.bindings.set(key,binding);
 if(existingParent!==undefined)this.inheritedCompositions.set(key,generation);
 try{
  ctx.effect(()=>async()=>{this.bindings.delete(key);binding.generation.users--;await this.collect(binding.generation)},'agent-preset.binding');
 }catch(error){this.bindings.delete(key);this.inheritedCompositions.delete(key);generation.users--;throw error}
}
/** Bind an unpublished Agent to the current preset revision.
* @param ctx Agent context from its setup callback.
* @param id Requested preset, or the default.
* @returns Bound preset identity.
*/
async mount(ctx, id, validate) {
	const generation = await this.retain(id);
	try {
		validate?.();
		await this.bind(ctx, generation);
		return { id: generation.mount.presetId };
	} finally {
		generation.users--;
		await this.collect(generation);
	}
}
/** Join a child to the exact revision retained by its parent.
* @param ctx Child Agent context.
* @param parent Parent Agent context.
* @returns Inherited preset id, or undefined in a preset-free composition.
*/
composeFrom(ctx, parent) {
	const generation = this.generationFor(parent);
	if (generation === void 0) {
		if (parent.get("agentPresets")?.composedPreset(parent) !== void 0) throw new Error("Parent preset revision is unavailable");
		return;
	}
	const key = scopeOf(ctx);
	if (key === void 0) throw new Error("Child preset binding requires a scope");
	if(this.bindings.has(key)){if(this.bindings.get(key).generation===generation)return generation.mount.presetId;throw new Error("Child already joined a different preset");}
	this.assertMutableBinding(ctx,generation);
	this.join(ctx, key, generation);
	this.inheritedCompositions.set(key,generation);
	return generation.mount.presetId;
}
/** Read the preset a live Agent uses.
* @param ctx Agent context.
* @returns Its preset id, if bound.
*/
composedPreset(ctx) {
	return this.generationFor(ctx)?.mount.presetId;
}
/** Read a service supplied inside an Agent's isolated preset group.
* @param agent Agent whose composition is queried.
* @param name Cordis service name.
* @returns The service, or undefined.
*/
serviceFor(agent, name) {
	const mount = this.generationFor(agent.ctx)?.mount;
	return mount === void 0 ? void 0 : serviceForMount(this.owner, mount, name);
}
/** Rebind a blank Agent; the caller owns the blank-session check.
* @param ctx Agent context.
* @param id Requested preset.
* @returns The bound identity.
*/
async recompose(ctx, id, validate) {
	const preset = await this.mount(ctx, id, validate);
	try {
		this.owner.emit("tools/change");
	} catch (error) {
		this.owner.logger.warn(`Preset tools observer: ${String(error)}`);
	}
	return preset;
}
/** Official actor composition is immutable after creation.
* Choose the preset through creation metadata/defaults and the startup mount,
* never by rewriting a session record or switching a published actor.
*/
async select(agent, agentPreset) {
	if(this.closing)throw new Error('NATIVE_PRESET_REGISTRY_CLOSED');
	if(!(agent?.piSession instanceof AgentSession)||scopeOf(agent.ctx)!==agent||this.owner.agents.get(agent.id)!==agent||agent.lifecycle?.isLive()!==true)throw new Error('NATIVE_PRESET_LIVE_AGENT_REQUIRED');
	throw new ControlError('agent-preset/locked','Official SDK presets are selected during session creation',{sessionId:agent.id,agentPreset});
}

/** Read current registrations for cold transcript presentation.
* @param id Preset identity or the default.
* @returns A revision lease; dispose it after the scoped read completes.
*/
async acquireScope(id) {
	const generation = await this.retain(id);
	let disposed = false;
	return {
		key: generation.key,
		[Symbol.asyncDispose]: async () => {
			if (disposed) return;
			disposed = true;
			generation.users--;
			await this.collect(generation);
		}
	};
}
/** Read plugin rows without creating an Agent.
* @returns Current declaration metadata and activation states.
*/
compositionInventory() {
	return Promise.all([...this.definitions.values()].map(async (record) => {
		const { id, name, description } = record.config;
		const broken = await this.diagnostic(record);
		const read = definitionComposition(record.config.plugins, () => {
			throw new Error("Inactive definition");
		});
		return {
			id,
			...name === void 0 ? {} : { name },
			...description === void 0 ? {} : { description },
			isDefault: id === this.defaultId,
			...broken === void 0 ? {} : { broken },
			rows: record.generation === void 0 ? "rows" in read ? read.rows : [] : mountedCompositionRows(record.generation.mount.tree)
		};
	}));
}
}

export {NativeAgentPresets,auditRows,entryListProblem,leakedServices}
