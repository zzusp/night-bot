import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** 轮询只有一个在途请求；换路由取消旧读，连续失败三次后等待刷新或网络恢复。 */
export function useResource<T>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const activePath = useRef(path);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (activePath.current !== path) { setData(null); setUpdatedAt(null); activePath.current = path; }
    setError(null);
    if (!path) { setLoading(false); return; }
    let disposed = false, failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const read = async () => {
      setLoading(true);
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (disposed) return;
        setData(value); setError(null); setUpdatedAt(Date.now()); failures = 0;
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err : new Error('REQUEST_FAILED')); failures += 1;
      } finally {
        if (!disposed) {
          setLoading(false);
          if (interval && failures < 3) timer = setTimeout(read, interval * Math.max(1, 2 ** failures));
        }
      }
    };
    void read();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [path, interval, revision]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && interval) refresh(); };
    const online = () => { if (path) refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', online); };
  }, [path, interval, refresh]);
  // 路由切换的清理间隙不展示上一资源的数据、错误或读取状态。
  const current = activePath.current === path;
  return { data: current ? data : null, error: current ? error : null, loading: !!path && (!current || loading), updatedAt: current ? updatedAt : null, refresh };
}

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/chat');
  useEffect(() => {
    const update = () => setHash(window.location.hash.slice(1) || '/chat');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return new URL(hash.startsWith('/') ? hash : '/chat', window.location.origin);
}

export function navigate(path: string) { window.location.hash = path; }

export const dateTime = (value?: string | number) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
};

export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  for (const key of ['text', 'summary', 'result', 'message', 'detail', 'reason', 'objective', 'title']) {
    if (typeof row[key] === 'string') return row[key] as string;
  }
  return '';
}
