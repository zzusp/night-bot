import { useId, useState } from 'react';
import { dateTime, useResource } from '../hooks';
import { smoothStagePath, type ChartPoint } from '../stage-chart-path';
import { messageProcessDuration } from '../message-process-duration';

type Stage = { status: 'recorded' | 'running' | 'missing' | 'invalid'; durationMs: number | null; shared: boolean };
type Sample = { receivedAt: string | null; triage: Stage; router: Stage };
type StagePage = { status: string; items: Sample[] };
const valueOf = (stage: Stage) => stage.status === 'recorded' && typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) && stage.durationMs >= 0 ? stage.durationMs : null;
const stageText = (stage: Stage) => valueOf(stage) !== null ? messageProcessDuration(valueOf(stage)!) : stage.status === 'running' ? '结束未记录' : stage.status === 'invalid' ? '时间异常' : '未记录';

function StagePlot({items, stage, title}: {items: Sample[]; stage: 'triage'|'router'; title: string}) {
  const gradientId = useId();
  const [selected, select] = useState<number | null>(null);
  const values = items.map(item => valueOf(item[stage]));
  const maximum = Math.max(1000, ...values.filter((value): value is number => value !== null));
  const ceiling = Math.ceil(maximum / 1000) * 1000;
  const x = (index: number) => items.length === 1 ? 124 : 12 + index * 224 / Math.max(1, items.length - 1);
  const y = (value: number) => 76 - value / ceiling * 56;
  const segments: ChartPoint[][] = [[]];
  values.forEach((value,index) => { if (value === null) segments.push([]); else segments[segments.length-1].push({x:x(index),y:y(value)}); });
  const currentIndex = selected ?? items.length - 1;
  const current = items[currentIndex];
  return <div className={`stage-plot stage-plot-${stage}`}>
    <div className="stage-plot-heading"><span>{selected === null ? '最新一条' : '所选消息'}</span><strong>{current ? stageText(current[stage]) : '—'}</strong></div>
    <svg className="stage-plot-graph" viewBox="0 0 248 94" role="group" aria-label={`${title}最近消息耗时`}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--stage-color)" stopOpacity=".18"/><stop offset="100%" stopColor="var(--stage-color)" stopOpacity=".01"/></linearGradient></defs>
      <text x="12" y="11" className="stage-axis-label">{ceiling / 1000} 秒</text>
      <line x1="12" x2="236" y1="20" y2="20" className="stage-grid" />
      <line x1="12" x2="236" y1="48" y2="48" className="stage-grid" />
      <line x1="12" x2="236" y1="76" y2="76" className="stage-grid" />
      {segments.filter(segment=>segment.length>1).map((segment,index)=><g key={index} aria-hidden="true"><path d={`${smoothStagePath(segment)} L ${segment[segment.length-1].x},76 L ${segment[0].x},76 Z`} fill={`url(#${gradientId})`}/><path d={smoothStagePath(segment)} className="stage-line"/></g>)}
      {items.map((item,index)=>{
        const value=values[index];
        const label=`${dateTime(item.receivedAt ?? undefined)}，${title} ${stageText(item[stage])}${item[stage].shared ? '，批次共享耗时' : ''}`;
        return <g key={index} data-stage-sample={value !== null ? "measured" : "missing"} tabIndex={0} role="img" aria-label={label} onFocus={()=>select(index)} onBlur={()=>select(null)} onMouseEnter={()=>select(index)} onMouseLeave={()=>select(null)}>
          <title>{label}</title><rect x={x(index)-10} y="16" width="20" height="70" fill="transparent"/>
          {value === null && <text x={x(index)} y="88" textAnchor="middle" className="stage-missing">—</text>}
        </g>;
      })}
      <text x="2" y="79" className="stage-axis-zero">0</text>
    </svg>
    <div className="stage-plot-foot"><span>{selected === null ? items.length === 1 ? '仅 1 条记录' : '较早 → 最近' : dateTime(current?.receivedAt ?? undefined)}</span><span>{current?.[stage].shared ? '批次共享' : ''}</span></div>
  </div>;
}

export function StageTimingChart({kind, id}: {kind: 'chat'|'conversations'; id?: string}) {
  const resolvedId = id;
  const query = useResource<StagePage>(resolvedId ? `/${kind}/${encodeURIComponent(resolvedId)}/stage-times?limit=8` : null, 10000, {pauseWhenHidden:true});
  // Do not show a previous conversation or stale timings as current measurements.
  const failure = query.error;
  const items = !failure && query.data?.status === 'ready' ? [...query.data.items].reverse() : [];
  return <div className="stage-timing-charts" role="group" aria-label="最近处理耗时">{(['triage','router'] as const).map(stage => {
    const title = stage === 'triage' ? '分诊' : '路由';
    return <section key={stage} className={`rail-section stage-timing-card stage-timing-card-${stage}`} aria-label={`${title}耗时`}>
      <div className="rail-section-title"><h3><i className="stage-title-dot"/>{title}耗时</h3><span className="stage-scope">本会话 · {items.length ? `${items.length} 条消息` : '最近消息'}</span></div>
      {items.length ? <StagePlot key={`${resolvedId}:${stage}`} items={items} stage={stage} title={title}/> : <p className="rail-empty">{failure ? '耗时暂不可读' : query.data && query.data.status !== 'ready' ? '来源暂不可读' : query.loading || !resolvedId ? '读取中…' : '暂无耗时记录'}</p>}
    </section>;
  })}</div>;
}
