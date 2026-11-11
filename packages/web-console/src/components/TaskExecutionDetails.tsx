import type { Task } from '../api';
import { dateTime, textOf } from '../hooks';
import { Markdown, Status } from './Shared';

const eventLabels: Record<string, string> = { created: '任务已创建', completed: '任务已完成', reopened: '任务已重新打开', cancelled: '任务已取消' };

function DeliveryRecord({ item }: { item: Record<string, unknown> }) {
  const text = textOf(item);
  const normalized = text.replace(/\s+/g, ' ').trim();
  const preview = normalized.length > 80 ? normalized.slice(0, 80) + '…' : normalized;
  const at = typeof item.createdAt === 'string' ? item.createdAt : undefined;
  const status = String(item.state || item.status || 'unknown');
  return <details className="task-delivery">
    <summary><span className="task-delivery-heading"><Status value={status} /><time dateTime={at}>{dateTime(at)}</time></span>
      <span className="task-delivery-preview">{preview || '通知正文未记录'}</span>
      <span className="task-disclosure-label"><span className="when-closed">展开交付</span><span className="when-open">收起交付</span></span>
    </summary>
    {text && <div className="task-delivery-body"><Markdown text={text} /></div>}
  </details>;
}

export function TaskExecutionDetails({ task }: { task: Task }) {
  const raw = task.timeline;
  const timeline = [...(raw?.task?.events || []), ...(raw?.human?.segments || []), ...(raw?.executions || []).flatMap(track => track.milestones || [])]
    .sort((a, b) => String(a.at || a.startedAt || '').localeCompare(String(b.at || b.startedAt || '')));
  return <>
    <section className="detail-section task-activity-section"><h3>执行动态 <span className="task-section-count">{raw ? timeline.length : '未记录'}</span></h3>
      {timeline.length ? <ol className="task-activity-list">{timeline.map((event, index) => {
        const at = event.at || event.startedAt;
        return <li key={String(event.id || index)}><div className="task-activity-heading"><time dateTime={at}>{dateTime(at)}</time>{event.status && <Status value={event.status} />}</div>
          <p>{event.summary || event.label || eventLabels[event.kind || ''] || event.description || event.kind || '状态更新'}</p>
        </li>;
      })}</ol> : <p className="task-empty">暂无执行动态</p>}
    </section>
    <section className="detail-section"><h3>交付记录 <span className="task-section-count">{task.notifications ? task.notifications.length : '未记录'}</span></h3>
      {task.notifications?.length ? task.notifications.map((item, index) => <DeliveryRecord key={String(item.id || index)} item={item} />) : <p className="task-empty">暂无交付记录</p>}
    </section>
  </>;
}
