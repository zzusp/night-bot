// Night-owned read-only observation lifetime/cache and Pi projection transport.
// Retained audit-lease algorithms derive from MIT dsh-session-query;
// see licenses/dsh-session-query-MIT.txt. No DSH query ABI or search is exposed.
import {AsyncLocalStorage} from 'node:async_hooks';
import {Service} from '@deepseek-ai/cordis';
import {deepFreeze} from './native-values.js';
import {HarnessError} from './native-llm-protocol.js';
import {validateSessionAudit, SessionLogOffset, SessionSeq, interruptedTurnClosers} from './native-session-protocol.js';
import {imageSelectionProjection} from './runtime/session-image-selection.js';
import {readCommittedContext, pageCommittedProjection} from './runtime/committed-session-query.js';

const currentSessionMessageProjections = [imageSelectionProjection];
const SESSION_OBSERVATION_CACHE_DEFAULT = 5;
class SessionQueryError extends HarnessError {
 constructor(message, code, options) { super(message, code, options); }
}

// Cold application audit data and its optional official Pi context are observed
// through one read handle. Synthetic interrupted-turn closers are audit-only;
// they do not alter storage or the separately committed Pi context.
async function readColdSessionLog(persistence, sessionId, signal) {
	const options = signal === void 0 ? void 0 : { signal };
	const handle = await persistence.open(sessionId, "read", options);
	let read;
	try {
		read = await handle.read(0, void 0, { ...options, includeContext: true });
	} catch (error) {
		try {
			await handle.close();
		} catch {}
		throw error;
	}
	await handle.close();
	const { events } = read;
	return {
		...read.context === undefined ? {} : { context: deepFreeze(structuredClone(read.context)) },
		eventState: read.eventState,
		header: handle.header,
		inheritedEventCount: handle.inheritedEventCount,
		events: [...events, ...interruptedTurnClosers(events)]
	};
}

function assertSessionHeadersCompatible(a, b) {
	if (a.id !== b.id || a.createdAt !== b.createdAt || a.cwd !== b.cwd || a.parentSession !== b.parentSession || a.isSeeded !== b.isSeeded || (a.delegationDepth ?? 0) !== (b.delegationDepth ?? 0)) throw new SessionQueryError(`session source headers conflict for session "${a.id}"`, "SESSION_QUERY_SOURCE_CONFLICT");
}

var SessionObservationReader = class {
	ctx;
	cacheCapacity;
	cache = /* @__PURE__ */ new Map();
	/**
	* @param ctx - context carrying the live session store and optional persistence/projection services.
	* @param cacheCapacity - maximum unpinned cold observations retained for reuse.
	*/
	constructor(ctx, cacheCapacity = 5) {
		this.ctx = ctx;
		this.cacheCapacity = cacheCapacity;
	}
	/**
	* Observe one live-preferred audit cut and retain a cold read-only view until disposal.
	* @param sessionId - logical Session identity.
	* @param options - cancellation and all-or-none projection computation for this read.
	* @returns one exact immutable observation.
	* @throws {@link SessionQueryError} with code `SESSION_QUERY_CORRUPT_SESSION` when audit validation or projection computation fails.
	*/
	async read(sessionId, options = {}) {
		const { signal, projectionMode = "all" } = options;
		for (;;) {
			throwIfObservationAborted(signal);
			const live = this.ctx.sessions.get(sessionId);
			if (live !== void 0) return this.live(live, projectionMode);
			const persistence = this.ctx.get("sessionPersistence");
			if (persistence === void 0) throw notFound(sessionId);
			const snapshot = await this.statSource(persistence, sessionId, signal);
			const attachedDuringStat = this.ctx.sessions.get(sessionId);
			if (attachedDuringStat !== void 0) {
                assertSessionHeadersCompatible(snapshot.header, attachedDuringStat.header);
                return this.live(attachedDuringStat, projectionMode);
            }
			let entry = this.cachedEntry(persistence.identity, sessionId, snapshot.revision);
            if (entry !== undefined) assertSessionHeadersCompatible(snapshot.header, entry.header);
			if (entry === void 0) {
				const loaded = await this.loadSource(persistence, sessionId, signal);
				throwIfObservationAborted(signal);
				const attached = this.ctx.sessions.get(sessionId);
				if (attached !== void 0) {
                    assertSessionHeadersCompatible(snapshot.header, attached.header);
                    assertSessionHeadersCompatible(loaded.header, attached.header);
                    return this.live(attached, projectionMode);
                }
                assertSessionHeadersCompatible(snapshot.header, loaded.header);
                let audit;
                try {
                    audit = validateSessionAudit(sessionId, loaded.events, loaded.header, loaded.inheritedEventCount, currentSessionMessageProjections);
                } catch (error) {
                    if (this.ctx.sessions.get(sessionId) !== void 0) continue;
                    throw new SessionQueryError(`stored session "${sessionId}" is corrupt: ${errorMessage(error)}`, "SESSION_QUERY_CORRUPT_SESSION", { cause: error });
                }
                entry = {
                    persistenceIdentity: persistence.identity,
                    revision: snapshot.revision,
                    header: audit.header,
                    inheritedEventCount: audit.inheritedEventCount,
                    events: audit.events,
                    context: loaded.context,
                    refs: 0
                };
				this.store(sessionId, entry);
			}
			let projections;
			try {
				projections = projectionMode === "none" ? void 0 : this.businessProjections(entry);
			} catch (error) {
				throw new SessionQueryError(`failed to project session "${sessionId}": ${errorMessage(error)}`, "SESSION_QUERY_CORRUPT_SESSION", { cause: error });
			}
			return this.coldLease(sessionId, entry, projections);
		}
	}
	/** Observe the stored snapshot, mapping absence and backend failures to the query taxonomy. */
	async statSource(persistence, sessionId, signal) {
		let snapshot;
		try {
			snapshot = await persistence.stat(sessionId, signal === void 0 ? void 0 : { signal });
		} catch (error) {
			throwIfObservationAborted(signal);
			throw mapPersistenceFailure(sessionId, error);
		}
		throwIfObservationAborted(signal);
		if (snapshot === void 0) throw notFound(sessionId);
		if (snapshot.header.id !== sessionId) throw new SessionQueryError(`session persistence returned "${snapshot.header.id}" for "${sessionId}"`, "SESSION_QUERY_SOURCE_CONFLICT");
		return snapshot;
	}
	/** Read the complete balanced cold log, mapping backend failures to the query taxonomy. */
	async loadSource(persistence, sessionId, signal) {
		try {
			return await readColdSessionLog(persistence, sessionId, signal);
		} catch (error) {
			throwIfObservationAborted(signal);
			throw mapPersistenceFailure(sessionId, error);
		}
	}
	/** Return a still-valid cached entry and mark it most recently used. */
	cachedEntry(persistenceIdentity, sessionId, revision) {
		const cached = this.cache.get(sessionId);
		if (cached === void 0 || cached.persistenceIdentity !== persistenceIdentity || cached.revision !== revision) return;
		this.cache.delete(sessionId);
		this.cache.set(sessionId, cached);
		return cached;
	}
	/** Insert or replace the entry for one id, then evict past the capacity. */
	store(sessionId, entry) {
		this.cache.delete(sessionId);
		this.cache.set(sessionId, entry);
		this.evictPastCapacity(entry);
	}
	/**
	* Evict oldest unpinned entries until the cache fits its capacity again.
	* Runs on store and whenever a lease release unpins an entry, so leases
	* that pinned every candidate cannot leave the cache over budget for good.
	* @param keep - the entry being stored, about to be leased; never evicted.
	*/
	evictPastCapacity(keep) {
		if (this.cache.size <= this.cacheCapacity) return;
		for (const [id, candidate] of this.cache) {
			if (candidate === keep || candidate.refs > 0) continue;
			this.cache.delete(id);
			if (this.cache.size <= this.cacheCapacity) return;
		}
	}
	/** Build one disposable lease over a cached entry, pinning it until every lease releases. */
	coldLease(sessionId, entry, projections) {
		entry.refs += 1;
		const lease = () => {
			let disposed = false;
			return {
				source: "prepared",
				header: entry.header,
				inheritedEventCount: entry.inheritedEventCount,
				events: entry.events,
				cursor: entry.events.at(-1)?.seq ?? -1,
				revision: entry.revision,
				...entry.context === undefined ? {} : { context: entry.context },
				...projections === void 0 ? {} : { projections },
				retain: () => {
					if (disposed) throw new Error(`session observation "${sessionId}" is disposed`);
					entry.refs += 1;
					return lease();
				},
				[Symbol.dispose]: () => {
					if (disposed) return;
					disposed = true;
					entry.refs -= 1;
					if (entry.refs === 0) this.evictPastCapacity();
				}
			};
		};
		return lease();
	}
	live(session, projectionMode) {
		const seq = session.seq;
		let materialized;
		let projections;
		try {
			projections = projectionMode === "none" ? void 0 : this.ctx.get("sessionProjections")?.snapshot(session);
		} catch (error) {
			throw new SessionQueryError(`failed to project session "${session.id}": ${errorMessage(error)}`, "SESSION_QUERY_CORRUPT_SESSION", { cause: error });
		}
		const lease = () => {
			let disposed = false;
			return {
				source: "live",
				header: session.header,
				inheritedEventCount: session.inheritedEventCount,
				get events() {
					materialized ??= session.snapshotEvents(SessionLogOffset(0), seq);
					return materialized;
				},
				cursor: seq === 0 ? -1 : SessionSeq(seq - 1),
				...projections === void 0 ? {} : { projections },
				retain: () => {
					if (disposed) throw new Error(`session observation "${session.id}" is disposed`);
					return lease();
				},
				[Symbol.dispose]: () => {
					disposed = true;
				}
			};
		};
		return lease();
	}
	businessProjections(entry) {
		const registry = this.ctx.get("sessionProjections");
		if (registry === void 0) return void 0;
        // Detached folds do not create weak Session cells or trust checkpoint
        // caches. Their end is exactly the audited observation cut.
        return registry.restore({}, entry.events, SessionLogOffset(0), entry.header, entry.inheritedEventCount).snapshot;
	}
};
function throwIfObservationAborted(signal) {
	if (signal?.aborted !== true) return;
	throw new SessionQueryError("session observation was aborted", "SESSION_QUERY_ABORTED", { cause: signal.reason });
}
function mapPersistenceFailure(sessionId, error) {
	if (hasErrorName(error, "SessionPersistenceNotFoundError")) return notFound(sessionId, error);
	if (hasErrorName(error, "SessionPersistenceCorruptionError")) return new SessionQueryError(`stored session "${sessionId}" is corrupt: ${error.message}`, "SESSION_QUERY_CORRUPT_SESSION", { cause: error });
	return new SessionQueryError(`failed to observe session "${sessionId}": ${errorMessage(error)}`, "SESSION_QUERY_PERSISTENCE_FAILED", { cause: error });
}
function notFound(sessionId, cause) {
	return new SessionQueryError(`session "${sessionId}" not found`, "SESSION_QUERY_SESSION_NOT_FOUND", cause === void 0 ? void 0 : { cause });
}
function errorMessage(error) {
	return error instanceof Error ? error.message : "unknown error";
}
function hasErrorName(error, name) {
	return error instanceof Error && error.name === name;
}

/** Night's read-only business observation leases and official Pi projection pages.
 * This service does not implement transcript search, history trees or message folds. */
class NativeSessionQuery extends Service {
 static inject = ['sessions'];
 lifetime = new AbortController();
 activeQueries = new Set();
 queryCalls = new AsyncLocalStorage();
 constructor(ctx, config = {}) {
  const capacity = config.observationCacheSize ?? SESSION_OBSERVATION_CACHE_DEFAULT;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new SessionQueryError('observationCacheSize must be a positive safe integer', 'SESSION_QUERY_INVALID_CONFIG');
  super(ctx, 'sessionQuery');
  this._observations = new SessionObservationReader(ctx, capacity);
  ctx.effect(() => async () => {
   this.lifetime.abort(new Error('NATIVE_SESSION_QUERY_CLOSED'));
   const current = this.queryCalls.getStore() ?? new Set();
   await Promise.allSettled([...this.activeQueries].filter(record => !current.has(record)).map(record => record.done));
   this._observations.cache.clear();
  }, 'native session observation cancellation/drain');
 }
 observeSession(sessionId, options = {}) {
  return this._observations.read(sessionId, options);
 }
 /** The supplied persistence owns strict decoding. Official Pi owns all context
  * projection semantics; Night applies only source identity and transport bounds. */
 async readContextProjection(sessionId, options = {}) {
  let snapshot;
  try {
   snapshot = await readCommittedContext(this.ctx.get('sessionPersistence'), sessionId, options.signal);
  } catch (error) {
   if (options.signal?.aborted) options.signal.throwIfAborted();
   if (typeof error.code === 'string' && error.code.startsWith('SESSION_QUERY_')) throw error;
   throw mapPersistenceFailure(sessionId, error);
  }
  const live = this.ctx.sessions.get(sessionId);
  if (live !== undefined) assertSessionHeadersCompatible(live.header, snapshot.session);
  return pageCommittedProjection(snapshot, options);
 }
 readSurface(sessionId, options = {}) {
  return this.readContextProjection(sessionId, options);
 }
}

// Owned cancellation includes each borrowed read and its handle cleanup. Nested
// calls retain ancestry so a backend may dispose its owner without self-waiting.
for (const method of ['observeSession', 'readContextProjection', 'readSurface']) {
 const original = NativeSessionQuery.prototype[method];
 NativeSessionQuery.prototype[method] = function(sessionId, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
   || ![Object.prototype, null].includes(Object.getPrototypeOf(options)))
   return Promise.reject(new TypeError('query options must be a plain object'));
  const signal = AbortSignal.any([this.lifetime.signal, ...options.signal === undefined ? [] : [options.signal]]);
  const reason = () => method === 'observeSession'
   ? new SessionQueryError('session observation was aborted', 'SESSION_QUERY_ABORTED', {cause:signal.reason}) : signal.reason;
  if (signal.aborted) return Promise.reject(reason());
  const record = {}, parents = this.queryCalls.getStore() ?? new Set();
  this.activeQueries.add(record);
  let operation;
  try { operation = this.queryCalls.run(new Set([...parents, record]), () => original.call(this, sessionId, {...options, signal})); }
  catch (error) { this.activeQueries.delete(record); return Promise.reject(error); }
  record.done = Promise.resolve(operation).then(value => {
   if (signal.aborted) { value?.[Symbol.dispose]?.(); throw reason(); }
   return value;
  }).finally(() => this.activeQueries.delete(record));
  return record.done;
 };
}
export {NativeSessionQuery, NativeSessionQuery as default, SessionQueryError, SESSION_OBSERVATION_CACHE_DEFAULT};
