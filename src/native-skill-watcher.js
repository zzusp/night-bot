// MIT source-derived platform watcher backend; see THIRD_PARTY.md and
// docs/skill-watcher-fork-manifest.json. Provider discovery/parser are local.
import {watchFile,unwatchFile} from 'node:fs'
import {lstat,stat} from 'node:fs/promises'
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import chokidar from 'chokidar'
import {canonicalizeWatchPath} from './credential-file.js'
const DEFAULT_WATCH_STABILITY_THRESHOLD_MS=200,DEFAULT_WATCH_POLL_INTERVAL_MS=100,DEFAULT_WATCH_MAX_PROJECTS=128
const errorMessage=error=>{try{return String(error)}catch{return'[unrenderable thrown value]'}}
export class SkillWatchManager {
	ctx;
	invalidate;
	config;
	roots = /* @__PURE__ */ new Map();
	projects = /* @__PURE__ */ new Map();
	lifecycle = new AbortController();
	closing = false;
	invalidationQueued = false;
	constructor(ctx, invalidate, config) {
		this.ctx = ctx;
		this.invalidate = invalidate;
		this.config = config;
	}
	async observeRoots(roots) {
		if (this.closing) return;
		const projectRoots = /* @__PURE__ */ new Map();
		const pending = [];
		for (const root of roots) {
			if (root.projectRoot === void 0) {
				pending.push(this.retainRoot(root, `shared:${root.path}`));
				continue;
			}
			const grouped = projectRoots.get(root.projectRoot) ?? [];
			grouped.push(root);
			projectRoots.set(root.projectRoot, grouped);
		}
		for (const [projectRoot, grouped] of projectRoots) {
			const owner = `project:${projectRoot}`;
			this.projects.delete(projectRoot);
			const paths = new Set(grouped.map((root) => root.path));
			this.projects.set(projectRoot, paths);
			for (const root of grouped) pending.push(this.retainRoot(root, owner));
		}
		let evictedProject = false;
		while (this.projects.size > this.config.maxProjects) {
			const oldest = this.projects.entries().next();
			/* v8 ignore next -- the loop condition proves one project exists. */
			if (oldest.done) break;
			const [projectRoot, paths] = oldest.value;
			this.projects.delete(projectRoot);
			const owner = `project:${projectRoot}`;
			for (const path of paths) pending.push(this.releaseRoot(path, owner));
			evictedProject = true;
		}
		await Promise.all(pending);
		if (evictedProject) this.invalidate();
	}
	observeHostMutation(path) {
		if (this.closing) return;
		const normalized = resolve(path);
		if (![...this.roots.values()].some((state) => isPotentialSkillPath(state.root, normalized))) return;
		this.invalidate();
	}
	async dispose() {
		this.closing = true;
		this.lifecycle.abort(/* @__PURE__ */ new Error("skill-filesystem watcher disposed"));
		const states = [...this.roots.values()];
		this.roots.clear();
		this.projects.clear();
		await Promise.all(states.map(async (state) => {
			await settleWatcherOpening(state.opening);
			const watcher = state.watcher;
			state.watcher = void 0;
			if (watcher !== void 0) await this.closeWatcher(watcher);
		}));
	}
	async retainRoot(root, owner) {
		let state = this.roots.get(root.path);
		if (state === void 0) {
			state = {
				root,
				owners: /* @__PURE__ */ new Set(),
				watcher: void 0,
				opening: void 0,
				unhealthy: true
			};
			this.roots.set(root.path, state);
		}
		state.owners.add(owner);
		if (this.config.enabled) await this.ensureWatcher(state);
	}
	async releaseRoot(path, owner) {
		const state = this.roots.get(path);
		/* v8 ignore next -- Concurrent cwd observations can evict the same shared root before this release settles. */
		if (state === void 0) return;
		state.owners.delete(owner);
		if (state.owners.size > 0) return;
		this.roots.delete(path);
		await settleWatcherOpening(state.opening);
		const watcher = state.watcher;
		state.watcher = void 0;
		if (watcher !== void 0) await this.closeWatcher(watcher);
	}
	ensureWatcher(state) {
		/* v8 ignore next -- A scheduled rewatch can reach this guard only when teardown wins its await. */
		if (this.closing || !this.config.enabled) return Promise.resolve();
		if (state.opening !== void 0) return state.opening;
		const opening = this.ensureCurrentWatcher(state);
		state.opening = opening;
		opening.then(() => {
			state.opening = void 0;
		}, () => {
			state.opening = void 0;
		});
		return opening;
	}
	async ensureCurrentWatcher(state) {
		const watcher = state.watcher;
		if (watcher !== void 0 && !state.unhealthy) {
			const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks);
			if (!state.unhealthy && sameWatchMode(watcher.mode, current)) return;
		}
		await this.replaceWatcher(state);
	}
	async replaceWatcher(state) {
		const previous = state.watcher;
		state.watcher = void 0;
		if (previous !== void 0) await this.closeWatcher(previous);
		/* v8 ignore next -- Teardown can win while an unhealthy watcher is still closing. */
		if (this.closing || state.owners.size === 0) return;
		try {
			const watcher = await this.openStableWatcher(state);
			/* v8 ignore next -- The loop returns no handle only when teardown wins between awaited probes. */
			if (watcher === void 0) return;
			/* v8 ignore start -- Post-open teardown is timing-dependent; the disposal race has an explicit integration test. */
			if (this.closing || state.owners.size === 0) {
				await this.closeWatcher(watcher);
				return;
			}
			/* v8 ignore stop */
			state.watcher = watcher;
			state.unhealthy = false;
		} catch (error) {
			if (!this.closing) {
				state.unhealthy = true;
				this.ctx.logger.warn(`skill-filesystem: failed to watch ${state.root.path}: ${errorMessage(error)}`);
			}
			throw error;
		}
	}
	async openStableWatcher(state) {
		let attempts = 0;
		while (!this.closing && state.owners.size > 0) {
			if (++attempts > 8) throw new Error("skill root changed repeatedly during watcher admission");
			const mode = await resolveRootWatchMode(state.root.path, this.config.followSymlinks);
			const watcher = mode.kind === "ancestor" ? this.openAncestorWatcher(state, mode) : await this.openRootWatcher(state, mode);
			/* v8 ignore else -- A host path transition between the two probes is timing-dependent. */
			if (sameWatchMode(mode, await resolveRootWatchMode(state.root.path, this.config.followSymlinks))) return watcher;
			/* v8 ignore next -- Covered by the same host path transition guard. */
			await this.closeWatcher(watcher);
		}
	}
	openAncestorWatcher(state, mode) {
		const listener = (_current, _previous) => {
			this.handleAncestorWatchEvent(state, mode);
		};
		watchFile(mode.nextPath, {
			persistent: false,
			interval: this.config.pollIntervalMs
		}, listener);
		return {
			mode,
			close() {
				unwatchFile(mode.nextPath, listener);
			}
		};
	}
	async handleAncestorWatchEvent(state, mode) {
		let current;
		try {
			current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks);
		} catch (error) {
			/* v8 ignore start -- Non-absence stat failures need a platform permission or I/O fault. */
			if (!this.closing && state.owners.size > 0) this.handleWatcherError(state, error);
			return;
		}
		if (this.closing || state.owners.size === 0 || sameWatchMode(mode, current)) return;
		this.queueInvalidation();
		state.unhealthy = true;
		this.scheduleRewatch(state);
	}
	async openRootWatcher(state, mode) {
		const watcher = chokidar.watch(mode.anchor, {
			persistent: true,
			ignoreInitial: true,
			depth: 1,
			followSymlinks: this.config.followSymlinks,
			atomic: true,
			awaitWriteFinish: {
				stabilityThreshold: this.config.stabilityThresholdMs,
				pollInterval: this.config.pollIntervalMs
			},
			usePolling: this.config.usePolling,
			interval: this.config.pollIntervalMs
		});
		let ready = false;
		const readiness = Promise.withResolvers();
		const signal = this.lifecycle.signal;
		const onError = (error) => {
			if (!ready) {
				readiness.reject(error);
				return;
			}
			this.handleWatcherError(state, error);
		};
		const handle = {
			mode,
			close: () => {
				const closing = watcher.close();
				watcher.on("error", onError);
				return closing;
			}
		};
		if (signal.aborted) {
			await this.closeWatcher(handle);
			signal.throwIfAborted();
		}
		const onAbort = () => {
			readiness.reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		watcher.on("error", onError);
		watcher.once("ready", () => {
			ready = true;
			readiness.resolve(void 0);
		});
		for (const event of [
			"add",
			"addDir",
			"change",
			"unlink",
			"unlinkDir"
		]) watcher.on(event, (path) => {
			this.handleWatchEvent(state, mode, event, path);
		});
		try {
			await readiness.promise;
		} catch (error) {
			await this.closeWatcher(handle);
			throw error;
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
		return handle;
	}
	handleWatchEvent(state, mode, event, path) {
		const target = resolve(path);
		if (this.closing || !isRelevantWatchEvent({
			...state.root,
			path: mode.anchor
		}, event, target)) return;
		this.queueInvalidation();
		if (target === mode.anchor && event === "unlinkDir") {
			state.unhealthy = true;
			this.scheduleRewatch(state);
		}
	}
	handleWatcherError(state, error) {
		if (this.closing) return;
		this.ctx.logger.warn(`skill-filesystem: watcher for ${state.root.path} failed: ${errorMessage(error)}`);
		state.unhealthy = true;
		this.queueInvalidation();
		this.scheduleRewatch(state);
	}
	scheduleRewatch(state) {
		const currentOpening = state.opening ?? Promise.resolve();
		(async () => {
			await settleWatcherOpening(currentOpening);
			try {
				await this.ensureWatcher(state);
			} catch {
				return;
			}
			this.queueInvalidation();
		})();
	}
	queueInvalidation() {
		if (this.closing || this.invalidationQueued) return;
		this.invalidationQueued = true;
		queueMicrotask(() => {
			this.invalidationQueued = false;
			/* v8 ignore next -- Effect teardown can win this queued microtask before provider disposal emits. */
			if (this.closing) return;
			this.invalidate();
		});
	}
	async closeWatcher(watcher) {
		try {
			await watcher.close();
		} catch (error) {
			this.ctx.logger.warn(`skill-filesystem: failed to close watcher: ${errorMessage(error)}`);
		}
	}
};
async function settleWatcherOpening(opening) {
	if (opening === void 0) return;
	try {
		await opening;
	} catch {}
}
function resolveWatchConfig(config) {
	const stabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS;
	const pollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS;
	const maxProjects = config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS;
	assertPositiveInteger("watchStabilityThresholdMs", stabilityThresholdMs);
	assertPositiveInteger("watchPollIntervalMs", pollIntervalMs);
	assertPositiveInteger("watchMaxProjects", maxProjects);
	return {
		enabled: config.watch ?? true,
		usePolling: config.watchUsePolling ?? false,
		stabilityThresholdMs,
		pollIntervalMs,
		maxProjects,
		followSymlinks: config.watchFollowSymlinks ?? true
	};
}
async function resolveRootWatchMode(root, followSymlinks) {
	let candidate = root;
	while (true) {
		try {
			if ((await stat(candidate)).isDirectory()) {
				const anchor = candidate === root && !followSymlinks && (await lstat(candidate)).isSymbolicLink() ? resolve(candidate) : await canonicalizeWatchPath(candidate);
				if (candidate === root) return {
					kind: "root",
					anchor
				};
				const firstSegment = relative(candidate, root).split(sep)[0];
				/* v8 ignore next -- candidate is a strict ancestor of root. */
				if (firstSegment === void 0 || firstSegment.length === 0) return {
					kind: "root",
					anchor
				};
				return {
					kind: "ancestor",
					anchor,
					nextPath: join(anchor, firstSegment)
				};
			}
		} catch (error) {
			/* v8 ignore next -- Non-absence stat failures are platform/permission-specific and propagate as incomplete discovery. */
			if (!isAbsentPathError(error)) throw error;
		}
		const parent = dirname(candidate);
		/* v8 ignore next -- Traversal reaches the existing filesystem root before this fallback. */
		if (parent === candidate) return {
			kind: "ancestor",
			anchor: candidate,
			nextPath: root
		};
		candidate = parent;
	}
}
function sameWatchMode(left, right) {
	return left.kind === right.kind && left.anchor === right.anchor && (left.kind === "root" || right.kind === "ancestor" && left.nextPath === right.nextPath);
}
function isRelevantWatchEvent(root, event, path) {
	const segments = containedSegments(root.path, path);
	if (segments === void 0) return false;
	if (segments.length === 0) return event === "addDir" || event === "unlinkDir";
	if (root.skipSystem === true && segments[0] === ".system") return false;
	if (segments.length === 1) {
		if (event === "addDir" || event === "unlinkDir") return true;
		return segments[0]?.endsWith(".md") === true;
	}
	return segments.length === 2 && segments[1] === "SKILL.md" && event !== "addDir" && event !== "unlinkDir";
}
function isPotentialSkillPath(root, path) {
	const segments = containedSegments(root.path, path);
	if (segments === void 0 || segments.length === 0 || segments.length > 2) return false;
	if (root.skipSystem === true && segments[0] === ".system") return false;
	return segments.length === 1 ? segments[0]?.endsWith(".md") === true : segments[1] === "SKILL.md";
}
function containedSegments(root, path) {
	const child = relative(root, path);
	if (child.length === 0) return [];
	if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) return void 0;
	return child.split(sep);
}
function mutationToolName(actor) {
	if (actor === void 0 || !("name" in actor)) return void 0;
	const value = actor.name;
	return value === "edit" || value === "write" ? value : void 0;
}
function assertPositiveInteger(field, value) {
	if (!Number.isInteger(value) || value < 1) throw new TypeError(`skill-filesystem: ${field} must be a positive integer`);
}
function isAbsentPathError(error) {
	return hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR");
}
function isAbsentSkillPathError(error) {
	return isAbsentPathError(error) || hasErrorCode(error, "FS_NOT_FOUND") || hasErrorCode(error, "FS_NOT_DIRECTORY");
}
function hasErrorCode(error, code) {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export {resolveWatchConfig}
