import { ApiError, type TokenUsage } from '../api';
import { exactTokenCount as format, formatTokenCount } from '../token-format';
import { tokenArc } from '../token-arc';
import { Notice } from './Shared';
const metrics = [['input','输入'],['output','输出'],['cacheWrite','缓存写入'],['cacheRead','缓存命中']] as const;
export function TaskTokenUsage({usage,error,stale,onRetry}: {usage?:TokenUsage;error?:Error|null;stale?:boolean;onRetry:()=>void}) {
  const forbidden=error instanceof ApiError && ([401,403,404].includes(error.status) || /IDENTITY|SOURCE_IDENTITY|USAGE_INVALID/.test(error.code));
  const data=forbidden?undefined:usage;
  const complete=!!data && metrics.every(([key])=>format(data[key])!=='未知') && format(data.total)!=='未知';
  let offset=0;
  const segments=complete && data.total! > 0 ? metrics.map(([key])=>{const share=data[key]!/data.total!*100;const segment={key,...tokenArc(share,offset)};offset+=share;return segment;}).filter(segment=>segment.share>0) : [];
  const description=metrics.map(([key,label])=>`${label} ${format(data?.[key])} Tokens`).join('，');
  return <section className="detail-section task-token-card" aria-label="消耗 Tokens">
    <h3>消耗 Tokens</h3>
    <div className="task-token-overview">
      <svg className="task-token-ring" viewBox="0 0 100 100" role="img" aria-label={`${description}；总量 ${format(data?.total)} Tokens，仅已提交原生记录${segments.some(segment=>segment.tiny) ? '；外缘短线仅定位极小非零份额，不表示比例' : ''}`}>
        <circle className="token-ring-track" cx="50" cy="50" r="41" />
        <g transform="rotate(-90 50 50)">{segments.map(segment=><g key={segment.key}>
          {segment.full ? <circle className={`token-ring-segment token-${segment.key}`} data-share={segment.share} cx="50" cy="50" r="41" /> : <path className={`token-ring-segment token-${segment.key}`} data-share={segment.share} d={segment.d} strokeWidth={segment.width} strokeLinecap="round" />}
          {segment.tiny && segment.marker && <line className={`token-ring-marker token-${segment.key}`} {...segment.marker} strokeWidth="1.5" strokeLinecap="round"><title>{`${metrics.find(([key])=>key===segment.key)![1]}：${format(data?.[segment.key])} Tokens；极小份额定位标记，不代表比例`}</title></line>}
        </g>)}</g>
        <text className="token-ring-label" x="50" y="54" textAnchor="middle" aria-hidden="true">{complete ? data.total === 0 ? '0' : '' : '—'}</text>
      </svg>
      <div className="task-token-total"><span>总量</span><strong title={`总量：${format(data?.total)} Tokens`}>{formatTokenCount(data?.total)}</strong></div>
    </div>
    <dl className="task-token-values">{metrics.map(([key,label])=><div key={key}><dt><i className={`token-${key}`} aria-hidden="true" />{label}</dt><dd title={`${label}：${format(data?.[key])} Tokens`}>{formatTokenCount(data?.[key])}</dd></div>)}</dl>
    {error && <Notice error={error} stale={!forbidden && stale} onRetry={onRetry} />}
  </section>;
}
