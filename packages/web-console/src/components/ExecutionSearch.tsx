import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiArrowUpSLine, RiArrowDownSLine, RiCloseLine, RiSearchLine } from '@remixicon/react';
import type { Message } from '../api';
import { searchExecutionRecords } from '../execution-search';
import { IconButton } from './BoardPrimitives';
import '../styles/execution-search.css';

export const ExecutionSearchToolbar = createContext<HTMLElement | null>(null);

export function ExecutionSearch({ messages, onLocate }: { messages: Message[]; onLocate: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const toolbar = useContext(ExecutionSearchToolbar);
  const owner = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    onLocate(null);
    setOpen(false);
    requestAnimationFrame(() => (toolbar ?? owner.current)?.querySelector<HTMLButtonElement>('button')?.focus());
  };
  const content = open
    ? <ExecutionSearchForm id={id} messages={messages} onLocate={onLocate} onClose={close} />
    : <IconButton label="搜索执行记录" aria-expanded={false} onClick={() => setOpen(true)}><RiSearchLine size={16} /></IconButton>;
  return <div className="execution-search-owner" ref={owner}>
    {toolbar ? createPortal(content, toolbar) : content}
  </div>;
}

function ExecutionSearchForm({ id, messages, onLocate, onClose }: { id: string; messages: Message[]; onLocate: (id: string | null) => void; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const composing = useRef(false);
  const hits = useMemo(() => searchExecutionRecords(messages, query), [messages, query]);
  const index = hits.findIndex(hit => hit.id === selected);
  const firstId = hits[0]?.id;
  useEffect(() => {
    if (composing.current || !firstId || index >= 0) return;
    const timer = window.setTimeout(() => {
      if (composing.current) return;
      setSelected(firstId);
      onLocate(firstId);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, firstId, index, onLocate]);
  const search = (value: string) => {
    if (value === query) return;
    setQuery(value);
    setSelected(null);
    onLocate(null);
  };
  const locate = (direction: number) => {
    if (!hits.length) return;
    const next = index < 0 ? direction > 0 ? 0 : hits.length - 1 : (index + direction + hits.length) % hits.length;
    setSelected(hits[next].id); onLocate(hits[next].id);
  };
  return <section id={id} className="execution-search" aria-label="搜索执行记录" onKeyDown={event => { if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onClose(); } }}>
    <div className="search-field">
      <input autoFocus type="search" aria-label="搜索已载入记录" value={draft} placeholder="搜索记录" autoComplete="off"
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; search(event.currentTarget.value); }}
        onChange={event => { setDraft(event.target.value); if (!composing.current) search(event.target.value); }}
        onKeyDown={event => { if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); locate(event.shiftKey ? -1 : 1); } }} />
      {!!query.trim() && <>
        <span className="execution-search-count" role="status" aria-live="polite">{hits.length ? `${Math.max(1, index + 1)} / ${hits.length}` : '无匹配'}</span>
        <div className="execution-search-navigation">
          <IconButton label="上一个搜索结果" disabled={!hits.length} onClick={() => locate(-1)}><RiArrowUpSLine size={16} /></IconButton>
          <IconButton label="下一个搜索结果" disabled={!hits.length} onClick={() => locate(1)}><RiArrowDownSLine size={16} /></IconButton>
        </div>
      </>}
      <IconButton label="关闭记录搜索" onClick={onClose}><RiCloseLine size={16} /></IconButton>
    </div>
  </section>;
}
