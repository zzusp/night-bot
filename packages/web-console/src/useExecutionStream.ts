import {useCallback, useEffect, useRef, useState} from 'react';
import {api, ApiError, type ExecutionPage, type Message} from './api';

const batchSize = 200;
type Read = 'newer' | 'older' | 'reset' | 'live';
type State = {data: ExecutionPage | null; error: Error | null; olderError: Error | null; loading: boolean; loadingOlder: boolean; updatedAt: number | null; epoch: number};
const initial = (): State => ({data: null, error: null, olderError: null, loading: true, loadingOlder: false, updatedAt: null, epoch: 0});
const unique = (rows: Message[]) => [...new Map(rows.map(row => [row.id, row])).values()];
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
    const publish = (patch: Partial<State>) => { current = {...current, ...patch}; if (!disposed) setState(current); };
    publish({});
    const read = async (requested: Read) => {
      if (disposed || document.visibilityState === 'hidden') return;
      if (busy) {
        // Scroll events can arrive before React paints the busy state. Coalesce
        // repeats rather than queuing another historical window per event.
        if (requested === 'older' && inFlight === 'older') return;
        if (requested === 'reset' || queued !== 'reset') queued = requested;
        return;
      }
      const selected = requested === 'live' && (!current.data?.liveProof || Date.now() >= historyDue) ? 'newer' : requested;
      const kind = selected === 'reset' && current.data && !current.error ? 'newer' : selected;
      const previous = kind === 'reset' ? null : current.data;
      if (kind === 'older' && (!previous?.before || current.error)) return;
      busy = true; inFlight = kind; clearTimeout(timer); controller = new AbortController();
      publish({loading: kind !== 'older' && kind !== 'live', loadingOlder: kind === 'older'});
      const params = new URLSearchParams({stream: '1', limit: String(batchSize)});
      if (previous?.checkpoint) params.set('checkpoint', previous.checkpoint);
      if (kind === 'older' && previous?.before) params.set('before', previous.before);
      if (kind === 'live') {params.delete('stream'); params.delete('limit'); params.delete('checkpoint'); params.set('live', previous!.liveProof!);}
      let catchUp = false;
      try {
        const page = await api<ExecutionPage>(`${endpoint}?${params}`, {signal: controller.signal});
        if (disposed || controller.signal.aborted) return;
        if (kind === 'live') {
          if (page.historyChanged) {
            publish({data: current.data ? {...current.data, live: {active:false, items:[]}, liveProof:undefined} : null});
            catchUp = true;
          } else {
            const ended = previous?.live?.active === true && !page.live?.active;
            publish({data: current.data ? {...current.data, live:page.live} : null, error:null, updatedAt:Date.now()});
            catchUp = ended;
          }
          failures = 0;
          return;
        }
        historyDue = Date.now() + 2500;
        let data = page;
        if (page.status === 'ready' && previous?.status === 'ready' && previous.checkpoint) {
          data = {...page, items: unique(kind === 'older' ? [...page.items, ...previous.items] : [...previous.items, ...page.items]),
            before: kind === 'older' ? page.before : previous.before};
        }
        // A temporary commit barrier is not an empty history. Keep the verified
        // snapshot marked as stale, without pretending it is current.
        if (page.status === 'pending' && previous?.status === 'ready') {
          publish({error: new ApiError(503, 'SESSION_COMMIT_PENDING')});
        } else {
          publish({data, error: null, olderError: null, updatedAt: Date.now(), epoch: current.epoch + (kind === 'reset' ? 1 : 0)});
        }
        failures = 0; catchUp = page.status === 'ready' && page.hasNewer === true;
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const problem = error instanceof Error ? error : new Error('REQUEST_FAILED');
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
          if (next && failures < 3) void read(next);
          else if (catchUp) void read('newer');
          else if (failures < 3 && !(current.error instanceof ApiError && (current.error.status === 409 || revoked(current.error)))) {
            const light = !!current.data?.liveProof && current.data?.live?.active === true;
            const interval = light ? 250 : 2500;
            timer = setTimeout(() => void read(light ? 'live' : 'newer'), interval * Math.max(1, 2 ** failures));
          }
        }
      }
    };
    dispatch.current = kind => { if (kind === 'reset') failures = 0; void read(kind); };
    const resume = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); controller?.abort(); }
      else { failures = 0; void read('newer'); }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    void read('newer');
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [endpoint]);
  return {...(active.current === endpoint ? state : initial()), refresh, loadOlder};
}
