import { mdiConsoleLine } from '@mdi/js';
import { PiIcon } from './PiIcon';
import { RiArrowRightLine, RiCheckLine, RiArrowDownSLine } from '@remixicon/react';

interface ProgressItem { text: string; status: string; redacted?: boolean }

// Presentation only: completed steps and the current step come from committed TODOs.
// Unlike the upstream demo, time never advances or completes a step.
export function AgentProgress({ items, title, status }: { items: ProgressItem[]; title?: string; status?: string }) {
  const completed = items.filter(item => item.status === 'completed').length;
  const remaining = items.length - completed;
  const active = items.find(item => item.status === 'in_progress');
  const running = status ? status === 'running' : !!active;
  const stateLabel = status ? ({completed: '已完成', failed: '失败', waiting: '等待中', running: '执行中', cancelled: '已取消', queued: '排队中'}[status] || status) : running ? '执行中' : items.length && !remaining ? '已完成' : '待处理';
  const label = !items.length ? '暂无待办' : remaining ? `还剩 ${remaining} 步` : '步骤已完成';
  return <section className="execution-todos" aria-label="任务待办">
    <details className={`agent-progress pi-session-card${running ? ' is-running' : ''}`}>
      <summary className="agent-progress-heading">
        <span className="pi-task-heading">
          <span className={`pi-task-status${running ? ' is-running' : ''}`} title={stateLabel} aria-label={stateLabel}><PiIcon path={mdiConsoleLine} size={12} /><span className="pi-task-status-dot" aria-hidden="true" /></span>
          <strong className="pi-task-title">{title || '任务进展'}</strong>
          <RiArrowDownSLine className="agent-progress-collapse" size={14} aria-hidden="true" />
        </span>
        {active && <span className="agent-progress-current"><RiArrowRightLine size={12} aria-hidden="true" /><span>{active.text}</span></span>}
        <span className="pi-task-meta"><span className="agent-progress-label">{label}</span><span>{completed} / {items.length}</span></span>
        <span className="sr-only">任务待办，{completed} / {items.length} 步已完成，展开或收起</span>
      </summary>
      {!!items.length && <ol className="agent-progress-steps">{items.map((item, index) => <li className={`agent-progress-step todo-${item.status}`} key={index} aria-current={item.status === 'in_progress' ? 'step' : undefined}>
        <span className={`agent-progress-marker ${item.status === 'completed' ? 'is-completed' : item.status === 'in_progress' ? 'is-active' : 'is-pending'}`} aria-hidden="true">{item.status === 'completed' && <RiCheckLine size={10} />}</span>
        <span className="sr-only">{item.status === 'completed' ? '已完成' : item.status === 'in_progress' ? '进行中' : '待处理'}：</span>
        <span className="agent-progress-text">{item.text}{item.redacted && <small>敏感信息已隐藏</small>}</span>
      </li>)}</ol>}
    </details>
  </section>;
}
