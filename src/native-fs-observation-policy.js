// MIT source-derived owner-isolated observation/intent gate; see licenses/dsh-fs-observation-policy-MIT.txt.
import {officialWorkingDirectoryOrigin} from './native-working-directory.js'
import { FsError } from "./native-fs-protocol.js";
//#region lib/types/index.js
/**
* Event-only filesystem observation policy; it registers no service. A weak owner/target map
* records every authoritative presence/absence observation, single-slot intent listeners derive
* guards from that state, and the provider performs the atomic freshness/no-clobber check. Without
* this plugin, tools retain the bare provider's unconditional mutation behavior. See the package
* README for composition rules.
* @module @deepseek-ai/dsh-fs-observation-policy
*/
/**
* Per-context observed-file state and the three `fs/*` decisions over it. One
* instance is created per `apply()` so disposal can drop all state for HMR.
*/
var ObservedStateGate = class {
	/**
	* Observed-file state, keyed first by the owner object (weakly held, so a
	* collected actor/session frees its state), then by {@link FsTarget.targetKey}. An
	* entry's presence is the prior-observation record; its discriminant keeps
	* confirmed absence distinct from an unseen target.
	*/
	observed = /* @__PURE__ */ new WeakMap();
    constructor(ctx){this.ctx=ctx}
	/**
	* Derive the observed-state owner from the opaque event actor — normally the
	* active agent session. `undefined` when no owner can be derived (e.g. a
	* direct tool call with no agent); such calls read freely but cannot satisfy
	* the write/edit prior-observation policy.
	*/
	owner(actor) {
		const agent=actor?.agent
        if(agent?.piSession){
            if(this.ctx.get('agents')?.get(agent.id)!==agent||this.ctx.get('agents')?.currentInitiator()!==agent)throw new FsError('Official file observation actor is not authenticated','FS_ACTOR_AUTHORITY_REQUIRED')
            try{officialWorkingDirectoryOrigin(agent);const policy=this.ctx.get('sandboxPolicy');if(!policy)throw Error('sandbox authority missing');policy.resolve({actor:agent})}catch{throw new FsError('Official file observation actor has no bound file authority','FS_ACTOR_AUTHORITY_REQUIRED')}
            return agent
        }
        return agent?.session;
	}
	get(owner, targetKey) {
		return this.observed.get(owner)?.get(targetKey);
	}
	set(owner, targetKey, observation) {
		let byTarget = this.observed.get(owner);
		if (!byTarget) {
			byTarget = /* @__PURE__ */ new Map();
			this.observed.set(owner, byTarget);
		}
		byTarget.set(targetKey, observation);
	}
	/** Drop all recorded state (HMR safety / disposal). */
	clear() {
		this.observed = /* @__PURE__ */ new WeakMap();
	}
	/**
	* Decide the write intent: unseen or confirmed absent ⇒ `createIfAbsent`;
	* confirmed present ⇒ `replaceIfVersion` at the observed version.
	*/
	writeIntent(target, actor) {
		const owner = this.owner(actor);
		const prior = owner ? this.get(owner, target.targetKey) : void 0;
		return prior?.kind === "present" ? {
			kind: "replaceIfVersion",
			version: prior.version
		} : { kind: "createIfAbsent" };
	}
	/**
	* Decide the edit version guard: unseen rejects with `FS_NOT_OBSERVED`,
	* confirmed absence rejects with `FS_NOT_FOUND`, and presence supplies the
	* observed version as the CAS basis.
	*/
	editIntent(target, actor) {
		const owner = this.owner(actor);
		const prior = owner ? this.get(owner, target.targetKey) : void 0;
		if (!owner || prior === void 0) throw new FsError(`edit requires reading "${target.displayPath}" first`, "FS_NOT_OBSERVED");
		if (prior.kind === "absent") throw new FsError(`cannot edit "${target.displayPath}": not found`, "FS_NOT_FOUND");
		return { version: prior.version };
	}
	/** Record an authoritative present or absent observation for this owner and target. */
	observe(target, observation, actor) {
		const owner = this.owner(actor);
		if (owner) this.set(owner, target.targetKey, observation);
	}
};
/** Cordis plugin name used by loader diagnostics. */
const name = "night-native-fs-observation-policy";
const inject=["agents","sandboxPolicy"];
/**
* Register the three `fs/*` listeners. Official actor ownership is checked
* against the injected live registry and private file policy. The observation
* facts remain local to the weak owner map. The waterfalls are unbound
* (the tool dispatches them with no `this`), so the listeners take the raw
* `(target, actor, next)` arguments.
*/
function apply(ctx) {
	const gate = new ObservedStateGate(ctx);
	ctx.effect(() => () => {
		gate.clear();
	}, "fs-observation-policy observed-state teardown");
	ctx.on("fs/write-intent", (target, actor) => Promise.resolve().then(() => gate.writeIntent(target, actor)));
	ctx.on("fs/edit-intent", (target, actor) => Promise.resolve().then(() => gate.editIntent(target, actor)));
	ctx.on("fs/observed", (target, observation, actor) => {
		gate.observe(target, observation, actor);
	});
}
//#endregion
export { apply, name, inject };
