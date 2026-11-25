import {useCallback, useEffect, useRef, useState} from 'react';
import {api, ApiError, type ExecutionPage, type Message} from './api';

const batchSize = 200;
type Read = 'newer' | 'older' | 'reset' | 'live';
type State = {data: ExecutionPage | null; error: Error | null; olderError: Error | null; committing: boolean; loading: boolean; loadingOlder: boolean; updatedAt: number | null; epoch: number};
const initial = (): State => ({data: null, error: null, olderError: null, committing: false, loading: true, loadingOlder: false, updatedAt: null, epoch: 0});
const unique = (rows: Message[]) => [...new Map(rows.map(row => [row.id, row])).values()];
const changedFields = <T extends object>(last: T | undefined, patch: T | undefined) =>
  !!patch && (Object.keys(patch) as (keyof T)[]).some(key => patch[key] !== last?.[key]);
function applyObservations(rows: Message[], page: ExecutionPage) {
  if (!page.timingUpdates && !page.compactionUpdates) return rows;
  let changed: Message[] | undefined;
  rows.forEach((row, index) => {
    const timing = page.timingUpdates && Object.hasOwn(page.timingUpdates, row.id) ? page.timingUpdates[row.id] : undefined;
    const compaction = row.kind === 'compaction' && row.compaction && page.compactionUpdates && Object.hasOwn(page.compactionUpdates, row.id)
      ? page.compactionUpdates[row.id] : undefined;
    if (!changedFields(row.timing, timing) && !changedFields(row.compaction, compaction)) return;
    changed ??= rows.slice();
    changed[index] = {...row, ...(timing && {timing:{...row.timing,...timing}}), ...(compaction && {compaction:{...row.compaction,...compaction}})};
  });
  return changed ?? rows;
}
const retainLive = (previous: ExecutionPage['live'], next: ExecutionPage['live']) =>
  previous === next || (previous && next && previous.revision === next.revision && JSON.stringify(previous) === JSON.stringify(next)) ? previous : next;
const revoked = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);

/** One stream and one in-flight read. Older windows never replace the tail.
 * The server verifies the complete authorized prefix before accepting a cursor. */
export function useExecutionStream(endpoint: string) {
  const [state, setState] = useState<State>(initial);
  const active = useRef(endpoint);
  const dispatch = useRef<(kind: Read) => void>(() => {});
  const refresh = useCallback(() => dispatch.current('reset'), []);
  const loadOlder = useCallback(() => dispatch.current('older'), []);
  useEffect(() => {
    active.current = endpoint;
    let current = initial(), disposed = false, busy = false, failures = 0, historyDue = 0;
    let queued: Read | null = null, inFlight: Read | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let source: EventSource | undefined, connected = false, reconnect = false, historyPending = false, liveVersion = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const publish = (patch: Partial<State>) => { current = {...current, ...patch}; if (!disposed) setState(current); };
    publish({});
    const planRead = () => {
      clearTimeout(timer);
      if (disposed || busy || document.visibilityState === 'hidden' || failures >= 3 || revoked(current.error)) return;
      // Independent resource changes and incomplete commits can occur without a
      // Pi event. Only those pages keep their regular authorized check.
      if (connected && !current.data?.resourceProof && !current.committing && !current.error &&
        (current.data?.status === 'ready' || current.data?.reason === 'SESSION_NOT_STARTED')) return;
      const light = !connected && !!current.data?.liveProof && !current.data.resourceProof && current.data.live?.active === true;
      timer = setTimeout(() => void read(light ? 'live' : 'newer'), (light ? 1000 : 2500) * Math.max(1, 2 ** failures));
    };
    const read = async (requested: Read) => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (busy) {
        if (requested === 'newer') { historyPending = true; return; }
        // Scroll events can arrive before React paints the busy state. Coalesce
        // repeats rather than queuing another historical window per event.
        if (requested === 'older' && inFlight === 'older') return;
        if (requested === 'reset' || queued !== 'reset') queued = requested;
        return;
      }
      const selected = requested === 'live' && (!current.data?.liveProof || !!current.data.resourceProof || Date.now() >= historyDue) ? 'newer' : requested;
      const kind = selected === 'reset' && current.data && !current.error ? 'newer' : selected;
      const previous = kind === 'reset' ? null : current.data;
      if (kind === 'older' && (!previous?.before || current.error)) return;
      busy = true; inFlight = kind; clearTimeout(timer); controller = new AbortController();
      publish({loading: kind !== 'older' && kind !== 'live', loadingOlder: kind === 'older'});
      const params = new URLSearchParams({stream: '1', limit: String(batchSize)});
      if (previous?.checkpoint) params.set('checkpoint', previous.checkpoint);
      if (previous?.resourceProof) params.set('resources', previous.resourceProof);
      if (kind === 'older' && previous?.before) params.set('before', previous.before);
      if (kind === 'live') {params.delete('stream'); params.delete('limit'); params.delete('checkpoint'); params.set('live', previous!.liveProof!);}
      let catchUp = false;
      const startedLiveVersion = liveVersion;
      try {
        const page = await api<ExecutionPage>(`${endpoint}?${params}`, {signal: controller.signal});
        if (disposed || controller.signal.aborted) return;
        if (kind === 'live') {
          if (page.historyChanged) {
            publish({data: current.data ? {...current.data, live: {active:false, items:[]}, liveProof:undefined, resourceProof:page.resourceProof ?? current.data.resourceProof} : null});
            catchUp = true;
          } else {
            const ended = previous?.live?.active === true && !page.live?.active;
            publish({data: current.data ? {...current.data, live:retainLive(previous?.live,page.live), resourceProof:page.resourceProof ?? current.data.resourceProof} : null, error:null, updatedAt:Date.now()});
            catchUp = ended;
          }
          failures = 0;
          return;
        }
        historyDue = Date.now() + 2500;
        let items = page.items, before = page.before;
        if (page.status === 'ready' && previous?.status === 'ready' && previous.checkpoint) {
          items = page.items.length ? unique(kind === 'older' ? [...page.items, ...previous.items] : [...previous.items, ...page.items]) : previous.items;
          before = kind === 'older' ? before : previous.before;
        }
        // A missing field in an incremental response is not evidence that
        // earlier protected rows have been discarded. Only reset or an explicit
        // replacement may change the guard for the bodies still in memory.
        const sameSnapshot = current.data?.sessionId === page.sessionId && current.data?.activeGeneration === page.activeGeneration && current.data?.revision === page.revision;
        const nextLive = startedLiveVersion !== liveVersion && sameSnapshot ? current.data?.live : page.live;
        const data = {...page, items:applyObservations(items,page), before, live:retainLive(previous?.live,nextLive),
          resourceProof:page.resourceProof ?? previous?.resourceProof};
        // A commit barrier keeps the last authorized snapshot, not a read error.
        // Drop provisional output/proof; only a fresh history read can restore it.
        if (page.status === 'pending' && page.reason === 'SESSION_COMMIT_PENDING') {
          const retained = current.data?.status === 'ready' ? current.data : null;
          publish({data: retained ? {...retained, liveProof:undefined, live:{active:false,items:[]}} : page, committing:!!retained && !current.error});
        } else {
          publish({data, error: null, olderError: null, committing:false, updatedAt: Date.now(), epoch: current.epoch + (kind === 'reset' ? 1 : 0)});
          if (reconnect) {reconnect = false;openEvents();}
        }
        failures = 0; catchUp = page.status === 'ready' && page.hasNewer === true;
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const problem = error instanceof Error ? error : new Error('REQUEST_FAILED');
        publish({committing:false});
        if (revoked(problem)) publish({data: null, error: problem, olderError: null, epoch: current.epoch + 1});
        else if (problem instanceof ApiError && /^(SESSION_IDENTITY_INVALID|SESSION_SOURCE_IDENTITY_INVALID|SESSION_USAGE_INVALID)$/.test(problem.code)) {
          // A previously valid live proof must never resurrect token metadata
          // after an identity failure. Only a full authorized read restores it.
          publish({data:current.data ? {...current.data,tokenUsage:undefined,liveProof:undefined,live:{active:false,items:[]}} : null,error:problem});
        }
        else if (problem instanceof ApiError && problem.status === 409) {publish({data:null, error:problem, olderError:null, epoch:current.epoch+1}); queued='reset';}
        else if (kind === 'older' && !(problem instanceof ApiError && problem.status === 409)) publish({olderError: problem});
        else publish({error: problem});
        failures++;
      } finally {
        busy = false; inFlight = null;
        if (!disposed) {
          publish({loading: false, loadingOlder: false});
          const next = queued; queued = null;
          const pending = historyPending; historyPending = false;
          if (next && failures < 3) { historyPending = pending && next === 'older'; void read(next); }
          else if ((catchUp || pending) && failures < 3 && !revoked(current.error)) void read('newer');
          else planRead();
        }
      }
    };
    const closeEvents = () => { clearTimeout(watchdog); source?.close(); source = undefined; connected = false; };
    const openEvents = () => {
      if (source || typeof EventSource === 'undefined' || document.visibilityState === 'hidden') return;
      const events = new EventSource(`/api${endpoint}?events=1`);
      source = events;
      const currentSource = () => !disposed && source === events;
      const tick = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (!currentSource()) return;
          const stalled = events.readyState === EventSource.OPEN;
          closeEvents();
          if (stalled) openEvents();
          planRead();
        }, 10_000);
      };
      events.addEventListener('ready', () => {
        if (!currentSource()) return;
        connected = true; tick();
        if (!revoked(current.error)) {failures = 0;void read('newer');}
      });
      events.addEventListener('heartbeat', () => { if (currentSource()) tick(); });
      events.addEventListener('history', () => { if (currentSource() && connected && !revoked(current.error)) {tick(); void read('newer');} });
      events.addEventListener('live', event => {
        if (!currentSource() || !connected) return;
        tick();
        const data = current.data;
        const frame = JSON.parse(event.data) as Pick<ExecutionPage, 'sessionId' | 'activeGeneration' | 'live'>;
        if (!data || current.error || current.committing || data.status !== 'ready' || frame.sessionId !== data.sessionId || frame.activeGeneration !== data.activeGeneration) return;
        liveVersion++;
        publish({data:{...data, live:retainLive(data.live,frame.live)}});
      });
      events.addEventListener('invalidate', event => {
        if (!currentSource()) return;
        closeEvents(); controller?.abort();
        const {status,code} = JSON.parse(event.data) as {status:number;code:string};
        reconnect = status === 409;
        publish({data:null, error:new ApiError(status,code), olderError:null, committing:false, epoch:current.epoch+1});
        failures = 0; void read('reset');
      });
      events.onerror = () => {
        if (!currentSource()) return;
        connected = false; tick(); planRead();
      };
      tick();
    };
    dispatch.current = kind => { if (kind === 'reset') {failures = 0;openEvents();} void read(kind); };
    const resume = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); controller?.abort(); closeEvents(); }
      else { openEvents(); failures = 0; void read('newer'); }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    openEvents(); void read('newer');
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer); closeEvents();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [endpoint]);
  return {...(active.current === endpoint ? state : initial()), refresh, loadOlder};
}
