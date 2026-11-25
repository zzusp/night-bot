const kinds = {messages: '消息与摘要', skills: 'Skills', memory: '记忆', systemTools: '系统工具定义', system: '系统提示', tools: '其他工具返回', unclassified: '未分类'};
const unavailableDetails = {
  'not-started': '该会话还没有 Router 运行记录。',
  'task-not-started': '任务会话还未开始。',
  'task-not-loaded': '暂无已保存的上下文记录。',
  'task-history-unavailable': '暂时无法读取已保存的上下文。',
  'not-loaded': '当前进程尚未加载此 Router；加载完成后会自动更新。',
  'awaiting-model-usage': '上下文刚压缩，等待下一次有效的模型响应。',
};
export type ContextWindowSnapshot = {status: string; basis?: string; windowBasis?: string; reason?: keyof typeof unavailableDetails; tokens?: number; contextWindow?: number; categories?: {key: string; tokens: number}[]};
const compact = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);

export function ContextWindow({snapshot, loading, task = false}: {snapshot?: ContextWindowSnapshot; loading: boolean; task?: boolean}) {
  const total = snapshot?.tokens, window = snapshot?.contextWindow;
  const committed = task && snapshot?.basis === 'pi-committed-context-estimate';
  const hasWindow = Number.isSafeInteger(window) && window! > 0;
  const ready = snapshot?.status === 'ready' && Number.isSafeInteger(total) && total! > 0 && (hasWindow || committed);
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
  const available = valid && hasWindow ? Math.max(0, window! - total!) : 0;
  const percent = (n: number) => `${(n / window! * 100).toFixed(1)}%`;
  return <section className={task ? "detail-section context-window task-context-window" : "rail-section context-window"} aria-label="上下文窗口">
    <div className="context-window-heading">
      <h3>上下文窗口</h3><span className="context-window-summary">{valid ? `${compact(total!)}${hasWindow ? ` / ${compact(window!)} (${+(total! / window! * 100).toFixed(1)}%)` : ' tokens'}` : '—'}</span>
    </div>
    {valid && committed && <p className="rail-empty">已保存上下文估算{snapshot.windowBasis === 'current-model-config' ? ' · 上限按当前模型配置' : ' · 未知窗口上限'}</p>}
    {valid && hasWindow && <div className="context-window-bar" role="img" aria-label={`上下文占用 ${percent(total!)}，可用 ${percent(available)}`}>
          {rows.map((row,index) => <i key={`${row.key}-${index}`} className={`context-color-${row.key}`} style={{width:`${row.tokens / Math.max(window!,total!) * 100}%`}}/>)}
        </div>}
    <div>
      {valid ? <div className="context-window-legend">
        {rows.map((row,index) => <div className="context-window-row" key={`${row.key}-${index}`}><i className={`context-color-${row.key}`}/><span>{kinds[row.key as keyof typeof kinds]}</span><span className="context-window-tokens">{compact(row.tokens)}</span><span className="context-window-percent">{hasWindow ? percent(row.tokens) : ''}</span></div>)}
        {hasWindow && <div className="context-window-row"><i className="context-color-available"/><span>可用空间</span><span className="context-window-tokens">{compact(available)}</span><span className="context-window-percent">{percent(available)}</span></div>}
      </div> : <p className="rail-empty">{loading ? '读取中…' : '暂无可靠的上下文计数'}{!loading && snapshot?.status === 'unavailable' && snapshot.reason && Object.hasOwn(unavailableDetails, snapshot.reason) && <><br/>{unavailableDetails[snapshot.reason]}</>}</p>}
    </div>
  </section>;
}
