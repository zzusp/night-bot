const kinds = {unclassified: '未分类'};
export type ContextWindowSnapshot = {status: string; tokens?: number; contextWindow?: number; categories?: {key: string; tokens: number}[]};
const compact = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);

export function RouterContextWindow({snapshot, loading}: {snapshot?: ContextWindowSnapshot; loading: boolean}) {
  const total = snapshot?.tokens, window = snapshot?.contextWindow;
  const ready = snapshot?.status === 'ready' && Number.isSafeInteger(total) && total! > 0 && Number.isSafeInteger(window) && window! > 0;
  const categories = ready ? snapshot.categories ?? [] : [];
  const sum = categories.reduce((n,row) => n + row.tokens, 0);
  const valid = ready && categories.every(row => Object.hasOwn(kinds, row.key) && Number.isSafeInteger(row.tokens) && row.tokens > 0) && sum <= total! && new Set(categories.map(row => row.key)).size === categories.length;
  const rows = valid ? categories.map(row => ({...row})) : [];
  if (valid && sum < total!) {
    const unknown = rows.find(row => row.key === 'unclassified');
    if (unknown) unknown.tokens += total! - sum;
    else rows.push({key:'unclassified',tokens:total! - sum});
  }
  // Never fabricate free space when usage is unknown, or let an overflow grow
  // the chart beyond its frame. Text retains the actual over-window estimate.
  const available = valid ? Math.max(0, window! - total!) : 0;
  const percent = (n: number) => `${(n / window! * 100).toFixed(1)}%`;
  return <section className="rail-section router-context-window" aria-label="上下文窗口">
    <div className="context-window-heading">
      <h3>上下文窗口</h3><span className="context-window-summary">{valid ? `${compact(total!)} / ${compact(window!)} (${+(total! / window! * 100).toFixed(1)}%)` : '—'}</span>
    </div>
    {valid && <div className="context-window-bar" role="img" aria-label={`上下文占用 ${percent(total!)}，可用 ${percent(available)}`}>
          {rows.map((row,index) => <i key={`${row.key}-${index}`} className={`context-color-${row.key}`} style={{width:`${row.tokens / Math.max(window!,total!) * 100}%`}}/>)}
        </div>}
    <div>
      {valid ? <>
        <div className="context-window-legend">
          {rows.map((row,index) => <div className="context-window-row" key={`${row.key}-${index}`}><i className={`context-color-${row.key}`}/><span>{kinds[row.key as keyof typeof kinds]}</span><span className="context-window-tokens">{compact(row.tokens)}</span><span className="context-window-percent">{percent(row.tokens)}</span></div>)}
          <div className="context-window-row"><i className="context-color-available"/><span>可用空间</span><span className="context-window-tokens">{compact(available)}</span><span className="context-window-percent">{percent(available)}</span></div>
        </div>
        <p className="context-window-note">Pi 估算 · 未分类部分暂无可靠明细</p>
      </> : <p className="rail-empty">{loading ? '读取中…' : '暂无可靠的上下文计数'}</p>}
    </div>
  </section>;
}
