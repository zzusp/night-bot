import { useId, useMemo, useRef, useState } from 'react';
import { RiArrowUpSLine, RiArrowDownSLine, RiCloseLine, RiSearchLine } from '@remixicon/react';
import type { Message } from '../api';
import { searchExecutionRecords } from '../execution-search';
import { IconButton } from './BoardPrimitives';
import '../styles/execution-search.css';

export function ExecutionSearch({ messages, onLocate }: { messages: Message[]; onLocate: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLDivElement>(null);
  return <div className="execution-search-owner" ref={trigger}>
    {!open ? <IconButton label="搜索执行记录" onClick={() => setOpen(true)}><RiSearchLine size={16} /></IconButton>
      : <ExecutionSearchForm messages={messages} onLocate={onLocate} onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.querySelector('button')?.focus()); }} />}
  </div>;
}

function ExecutionSearchForm({ messages, onLocate, onClose }: { messages: Message[]; onLocate: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const scopeId = useId();
  const hits = useMemo(() => searchExecutionRecords(messages, query), [messages, query]);
  const index = hits.findIndex(hit => hit.id === selected);
  const current = hits[Math.max(index, 0)];
  const locate = (direction: number) => {
    if (!hits.length) return;
    const next = index < 0 ? direction > 0 ? 0 : hits.length - 1 : (index + direction + hits.length) % hits.length;
    setSelected(hits[next].id); onLocate(hits[next].id);
  };
  const clear = () => { setDraft(''); setQuery(''); setSelected(null); input.current?.focus(); };
  return <section className="execution-search" aria-label="搜索执行记录">
    <div className="execution-search-controls">
      <label className="search-field"><RiSearchLine size={16} aria-hidden="true" /><span className="sr-only">搜索已载入记录</span>
        <input autoFocus ref={input} type="search" value={draft} placeholder="搜索记录" aria-describedby={scopeId} autoComplete="off"
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={event => { composing.current = false; setQuery(event.currentTarget.value); setSelected(null); }}
          onChange={event => { setDraft(event.target.value); if (!composing.current) { setQuery(event.target.value); setSelected(null); } }}
          onKeyDown={event => { if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); locate(event.shiftKey ? -1 : 1); } else if (event.key === 'Escape') { event.preventDefault(); onClose(); } }} />
        {draft && <IconButton label="清除记录搜索" onClick={clear}><RiCloseLine size={16} /></IconButton>}
      </label>
      {!!query.trim() && <div className="execution-search-navigation"><span role="status" aria-live="polite">{hits.length ? `${index + 1} / ${hits.length}` : '无匹配'}</span>
        <IconButton label="上一个搜索结果" disabled={!hits.length} onClick={() => locate(-1)}><RiArrowUpSLine size={18} /></IconButton>
        <IconButton label="下一个搜索结果" disabled={!hits.length} onClick={() => locate(1)}><RiArrowDownSLine size={18} /></IconButton>
      </div>}
      <IconButton label="关闭记录搜索" onClick={onClose}><RiCloseLine size={16} /></IconButton>
      <span id={scopeId} className="execution-search-scope">仅已载入正文 · {messages.length} 条</span>
    </div>
    {current && <button type="button" className="execution-search-hit" onClick={() => { setSelected(current.id); onLocate(current.id); }} aria-label={`定位搜索结果：${current.label} ${current.excerpt}`}><span>{current.label}</span><span>{current.excerpt || '无正文'}</span></button>}
  </section>;
}
