import { useState } from 'react';
import { dateTime, useResource } from '../hooks';
import { messageProcessDuration } from '../message-process-duration';

type Stage = { status: 'recorded' | 'running' | 'missing' | 'invalid'; durationMs: number | null; shared: boolean };
type Sample = { receivedAt: string | null; triage: Stage; router: Stage };
type StagePage = { status: string; items: Sample[] };
const valueOf = (stage: Stage) => stage.status === 'recorded' && typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) && stage.durationMs >= 0 ? stage.durationMs : null;
const stageText = (stage: Stage) => valueOf(stage) !== null ? messageProcessDuration(valueOf(stage)!) : stage.status === 'running' ? '结束未记录' : stage.status === 'invalid' ? '时间异常' : '未记录';

function StagePlot({items, stage, title}: {items: Sample[]; stage: 'triage'|'router'; title: string}) {
  const [selected, select] = useState<number | null>(null);
  const values = items.map(item => valueOf(item[stage]));
  const maximum = Math.max(1000, ...values.filter((value): value is number => value !== null));
  const ceiling = Math.ceil(maximum / 1000) * 1000;
  const x = (index: number) => items.length === 1 ? 124 : 12 + index * 224 / Math.max(1, items.length - 1);
  const y = (value: number) => 76 - value / ceiling * 56;
  const segments: string[][] = [[]];
  values.forEach((value,index) => { if (value === null) segments.push([]); else segments[segments.length-1].push(`${x(index)},${y(value)}`); });
  const currentIndex = selected ?? items.length - 1;
  const current = items[currentIndex];
  return <div className={`stage-plot stage-plot-${stage}`}>
    <div className="stage-plot-heading"><span><i/>{title}</span><strong>{current ? stageText(current[stage]) : '—'}</strong></div>
    <svg className="stage-plot-graph" viewBox="0 0 248 94" role="group" aria-label={`${title}最近消息耗时`}>
      <text x="12" y="11" className="stage-axis-label">{ceiling / 1000} 秒</text>
      <line x1="12" x2="236" y1="20" y2="20" className="stage-grid" />
      <line x1="12" x2="236" y1="48" y2="48" className="stage-grid" />
      <line x1="12" x2="236" y1="76" y2="76" className="stage-grid" />
      {segments.filter(segment=>segment.length>1).map((segment,index)=><polyline key={index} points={segment.join(' ')} className="stage-line"/>)}
      {items.map((item,index)=>{
        const value=values[index];
        const label=`${dateTime(item.receivedAt ?? undefined)}，${title} ${stageText(item[stage])}${item[stage].shared ? '，批次共享耗时' : ''}`;
        return <g key={index} tabIndex={0} role="img" aria-label={label} onFocus={()=>select(index)} onBlur={()=>select(null)} onMouseEnter={()=>select(index)} onMouseLeave={()=>select(null)}>
          <title>{label}</title><rect x={x(index)-10} y="16" width="20" height="70" fill="transparent"/>
          {value !== null ? <circle cx={x(index)} cy={y(value)} r={selected===index?4:3} className="stage-point"/> : <text x={x(index)} y="88" textAnchor="middle" className="stage-missing">—</text>}
        </g>;
      })}
      <text x="2" y="79" className="stage-axis-zero">0</text>
    </svg>
    <div className="stage-plot-foot"><span>{selected === null ? '较早 → 最近' : dateTime(current?.receivedAt ?? undefined)}</span><span>{current?.[stage].shared ? '批次共享' : selected === null ? '最新一条' : ''}</span></div>
  </div>;
}

export function StageTimingChart({kind, id}: {kind: 'chat'|'conversations'; id?: string}) {
  const current = useResource<{conversationId: string}>(kind === 'chat' && !id ? '/chat-current' : null);
  const resolvedId = id || current.data?.conversationId;
  const query = useResource<StagePage>(resolvedId ? `/${kind}/${encodeURIComponent(resolvedId)}/stage-times?limit=8` : null, 10000, {pauseWhenHidden:true});
  // Do not show a previous conversation or stale timings as current measurements.
  const failure = query.error || current.error;
  const items = !failure && query.data?.status === 'ready' ? [...query.data.items].reverse() : [];
  return <section className="rail-section stage-timing-card" aria-label="最近处理耗时">
    <div className="rail-section-title"><h3>最近处理耗时</h3><span className="stage-scope">本会话 · {items.length ? `${items.length} 条消息` : '最近消息'}</span></div>
    {items.length ? <><StagePlot key={`${resolvedId}:triage`} items={items} stage="triage" title="分诊"/><StagePlot key={`${resolvedId}:router`} items={items} stage="router" title="路由"/></> : <p className="rail-empty">{failure ? '耗时暂不可读' : query.data && query.data.status !== 'ready' ? '来源暂不可读' : query.loading || current.loading ? '读取中…' : '暂无耗时记录'}</p>}
  </section>;
}
