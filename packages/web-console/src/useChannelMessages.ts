import {useEffect, useRef, useState} from 'react';
import {api, ApiError, type Message} from './api';

type Page = {nextOffset: number | null; total: number; revision?: string};
type Snapshot = {items: Message[]; pages: {messages: Page; outbox: Page}};
const revoked = (error: Error) => error instanceof ApiError && [401, 403, 404].includes(error.status);

/** One serial reader. History retains both source revisions; never mixes pages from different snapshots. */
export function useChannelMessages(id?: string) {
  const [state, setState] = useState<{id?: string; data: Snapshot | null; error: Error | null; olderError: Error | null; loading: boolean; olderLoading: boolean; updatedAt: number | null}>({id, data: null, error: null, olderError: null, loading: !!id, olderLoading: false, updatedAt: null});
  const actions = useRef({refresh: () => {}, load: () => {}});
  useEffect(() => {
    let disposed = false, busy = false, history = false, failures = 0;
    let olderError: Error | null = null;
    let snapshot: Snapshot | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setState({id, data: null, error: null, olderError: null, loading: !!id, olderLoading: false, updatedAt: null});
    if (!id) return;
    const read = async (older = false) => {
      if (busy || disposed || older && !snapshot) return;
      clearTimeout(timer); busy = true;
      if (older) history = true;
      olderError = null;
      setState(value => ({...value, loading: !older, olderLoading: older, ...(older ? {olderError: null} : {error: null})}));
      const pages = older ? snapshot!.pages : null;
      const query = new URLSearchParams({messageOffset: String(pages ? pages.messages.nextOffset ?? pages.messages.total : 0), outboxOffset: String(pages ? pages.outbox.nextOffset ?? pages.outbox.total : 0), limit: '50'});
      if (pages?.messages.revision) query.set('messageRevision', pages.messages.revision);
      if (pages?.outbox.revision) query.set('outboxRevision', pages.outbox.revision);
      try {
        const next = await api<Snapshot>(`/conversations/${encodeURIComponent(id)}/messages?${query}`, {signal: controller.signal});
        if (disposed) return;
        const items = older ? [...new Map([...snapshot!.items, ...next.items].map(item => [item.id, item])).values()].sort((a,b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)) : next.items;
        snapshot = {...next, items}; failures = 0;
        setState({id, data: snapshot, error: null, olderError: null, loading: false, olderLoading: false, updatedAt: Date.now()});
      } catch (caught) {
        if (disposed) return;
        const error = caught instanceof Error ? caught : new Error('REQUEST_FAILED');
        failures++;
        olderError = older ? error : null;
        if (revoked(error)) {snapshot = null; history = true;}
        setState(value => ({...value, data: revoked(error) ? null : value.data, error: !older || revoked(error) ? error : value.error, olderError: older ? error : null, loading: false, olderLoading: false}));
      } finally {
        busy = false;
        if (!disposed && !history && failures < 3) timer = setTimeout(() => void read(), 5000 * Math.max(1, 2 ** failures));
      }
    };
    const refresh = () => {if (busy) return; history = false; failures = 0; void read();};
    actions.current = {refresh, load: () => {
      // A revision conflict requires a new snapshot, not another stale page.
      if (olderError instanceof ApiError && olderError.status === 409) refresh();
      else if (snapshot && (snapshot.pages.messages.nextOffset != null || snapshot.pages.outbox.nextOffset != null)) void read(true);
    }};
    const online = () => {if (!history) refresh();};
    window.addEventListener('online', online);
    void read();
    return () => {disposed = true; controller.abort(); clearTimeout(timer); window.removeEventListener('online', online);};
  }, [id]);
  const current = state.id === id ? state : {...state, data: null, error: null, olderError: null, loading: !!id, olderLoading: false, updatedAt: null};
  return {...current, refresh: () => actions.current.refresh(), older: {hasMore: !!current.data && (current.data.pages.messages.nextOffset != null || current.data.pages.outbox.nextOffset != null), loading: current.olderLoading, error: current.olderError, disabled: current.loading || !!current.error, onLoad: () => actions.current.load()}};
}
