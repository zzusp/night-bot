import { RiArrowRightLine, RiCheckLine, RiSubtractLine } from '@remixicon/react';

interface ProgressItem { text: string; status: string; redacted?: boolean }

// Presentation only: completed steps and the current step come from committed TODOs.
// Unlike the upstream demo, time never advances or completes a step.
export function AgentProgress({ items }: { items: ProgressItem[] }) {
  const completed = items.filter(item => item.status === 'completed').length;
  const remaining = items.length - completed;
  const active = items.find(item => item.status === 'in_progress');
  const label = !items.length ? '暂无待办' : remaining ? `还剩 ${remaining} 步` : '步骤已完成';
  return <section className="execution-todos" aria-label="任务待办">
    <details className={`agent-progress pi-session-card${active ? ' is-running' : ''}`} open>
      <summary className="agent-progress-heading">
        <span className={`agent-progress-marker ${remaining ? active ? 'is-active' : 'is-pending' : items.length ? 'is-completed' : 'is-pending'}`} aria-hidden="true">{!!items.length && !remaining && <RiCheckLine size={10} />}</span>
        <span className="agent-progress-label">{label}</span>
        {active && <span className="agent-progress-current"><RiArrowRightLine size={14} aria-hidden="true" /><span>{active.text}</span></span>}
        <span className="agent-progress-collapse" aria-hidden="true"><RiSubtractLine size={14} /></span>
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
