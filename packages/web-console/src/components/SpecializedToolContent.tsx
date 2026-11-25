import type {ReactNode} from 'react';
import {dateTime} from '../hooks';
import {specializedToolPresentation} from '../specialized-tool-content';
import {planStatusText, type ResidentPlan, type ResidentField} from '../resident-tool-content';
import type {CompactToolView} from '../compact-tool-presentation';
import type {ActionCopy, ResidentAction, ResidentSettlement, ResidentTaskQuery, SettleItem} from '../resident-activity-presentation';
import {TaskToolDetails, TodoCountsRow} from './TaskToolDetails';
import '../styles/specialized-tool-content.css';
export {hasSpecializedToolContent, specializedToolLabel, specializedToolSummary} from '../specialized-tool-content';

export interface SpecializedToolContentProps {
  toolName: string;
  phase: 'input' | 'output';
  text: string;
  offset?: number;
  status?: string;
  complete?: boolean;
  plan?: ResidentPlan | null;
  action?: ResidentAction | null;
  todoRecorded?: boolean;
  isError?: boolean;
}

/** Inner content only. Shared MessageBody owns disclosure, paging and revocation. */
export default function SpecializedToolContent(props: SpecializedToolContentProps) {
  const view = specializedToolPresentation(props);
  const plan = props.plan ?? view?.plan;
  const action = props.action ?? view?.action;
  if (!view) return null;
  return <div className={`specialized-tool-content specialized-tool-content--${view.kind}`}>
    {view.fields.length > 0 && <dl className="specialized-tool-fields">{view.fields.map(field => <div key={field.label}>
      <dt>{field.label}</dt><dd>{field.value}</dd>
    </div>)}</dl>}
    {plan && <ResidentPlanBody plan={plan} />}
    {action && <ResidentActionBody action={action} />}
    {view.task && <TaskToolDetails view={view.task} recorded={props.todoRecorded} />}
    {view.todoReceipt && <div className="task-tool-heading"><strong>待办已更新</strong><TodoCountsRow counts={view.todoReceipt} /></div>}
    {view.taskFailure !== undefined && <p className="task-tool-failure">{view.taskFailure}</p>}
    {view.queryParameters && <MoreToolDetails label="查询参数"><ResidentFields fields={view.queryParameters} /></MoreToolDetails>}
    {view.taskQuery && <TaskQueryBody query={view.taskQuery} />}
    {view.compact && <CompactToolBody view={view.compact} />}
    {view.settlement && <SettlementBody settlement={view.settlement} result={props.phase==='output'} />}
    {!action && view.resident && <ResidentFields fields={view.resident} />}
    {!action && view.text !== undefined && <pre className="tool-content specialized-tool-text" tabIndex={0}><code>{view.text}</code></pre>}
  </div>;
}

function ResidentPlanBody({plan}: {plan: ResidentPlan}) {
  return <div className="resident-plan">
    <p className="resident-plan-heading">{plan.committed ? '安排结果' : '提交的安排'}<span>{plan.tasks.length} 项任务</span>{plan.replayed && <span>沿用原回执</span>}{plan.dispatchEligible === false && <span>本次未开放调度</span>}</p>
    <ol className="resident-plan-tasks">{plan.tasks.map((task,index) => <li key={index}>
      <div className="resident-plan-task-heading"><strong>{task.title}</strong>{planStatusText(task) && <span>{planStatusText(task)}</span>}</div>
      {task.objective && <p>{task.objective}</p>}
      {!!task.requirements?.length && <ul aria-label="任务要求">{task.requirements.map((line,i) => <li key={i}>{line}</li>)}</ul>}
      {task.request && task.request !== task.objective && <p><span className="resident-plan-note">交办：</span>{task.request}</p>}
      {task.submittedRequest && task.submittedRequest !== task.objective && <p><span className="resident-plan-note">提交的交接：</span>{task.submittedRequest}</p>}
      {task.quote && task.quote !== task.request && <p><span className="resident-plan-note">引用：</span>{task.quote}</p>}
    </li>)}</ol>
    {!!plan.dependencies.length && <div className="resident-plan-dependencies"><strong>依赖</strong><ul>{plan.dependencies.map((dependency,index) =>
      <li key={index}>{dependency.prerequisiteTitle && dependency.taskTitle && <><strong>{dependency.prerequisiteTitle}</strong> → <strong>{dependency.taskTitle}</strong>： </>}
        {dependency.condition}{dependency.state && <span className="resident-plan-note">（{dependency.state === 'pending' ? '待满足' : dependency.state === 'satisfied' ? '已满足' : dependency.state}）</span>}</li>)}</ul></div>}
  </div>;
}
function MoreToolDetails({children, label = '更多详情'}: {children: ReactNode; label?: string}) {
  return <details className="resident-more"><summary>{label}</summary><div className="resident-more-body">{children}</div></details>;
}
function TaskStatus({state, control}: {state?: string; control?: string}) {
  const display = [...new Set([state, control === '启用' && state ? undefined : control].filter(Boolean))].join(' · ');
  return display ? <span className="resident-action-state">{display}</span> : null;
}
function ActionFields({fields}: {fields: ActionCopy[]}) {
  return <dl className="resident-action-copy">{fields.map((item,i) =>
      <div key={i}><dt>{item.label}</dt><dd>{item.list ? <ul>{item.list.map((line,n)=><li key={n}>{line}</li>)}</ul> : item.text}</dd></div>
    )}</dl>;
}
// Keep the current task brief visible, without repeating identical text.
function taskBrief(copy: ActionCopy[], outcome?: ActionCopy) {
  const seen = new Set<string>();
  return [...(outcome ? [outcome] : []), ...copy].filter(item => {
    if (!item.text) return true;
    const value = item.text.trim();
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function TaskQueryBody({query}: {query: ResidentTaskQuery}) {
  return <div className="resident-action">
    <ul className="resident-query-tasks">{query.tasks.map((task,i) => {
      const fields = taskBrief(task.copy,task.outcome);
      return <li key={i}>
        <div className="resident-action-heading"><strong>{task.title}</strong><TaskStatus state={task.state} control={task.control} /></div>
        {fields.length > 0 && <ActionFields fields={fields} />}
      </li>;
    })}</ul>
    {query.notice && <p className="resident-action-notice">{query.notice}</p>}
    {query.extra.length > 0 && <MoreToolDetails><ResidentFields fields={query.extra} /></MoreToolDetails>}
  </div>;
}
function ResidentActionBody({action}: {action: ResidentAction}) {
  const secondary = action.copy.filter(item=>item.label.startsWith('提交的'));
  const primary = taskBrief(action.copy.filter(item=>!secondary.includes(item)),action.outcome);
  return <div className="resident-action">
    <div className="resident-action-heading">
      {(action.title || action.action) && <strong>{action.title || action.action}</strong>}
      <TaskStatus state={action.state} control={action.control} />
    </div>
    {action.notice && <p className="resident-action-notice">{action.notice}</p>}
    {primary.length > 0 && <ActionFields fields={primary} />}
    {(secondary.length > 0 || action.extra.length > 0) && <MoreToolDetails>
      {secondary.length > 0 && <ActionFields fields={secondary} />}
      {action.extra.length > 0 && <ResidentFields fields={action.extra} />}
    </MoreToolDetails>}
  </div>;
}
function CompactToolBody({view}: {view: CompactToolView}) {
  return <div className="resident-action compact-tool-data">
    {view.notice && <p className="resident-action-notice">{view.notice}</p>}
    {!!view.terms?.length && <div className="compact-tool-terms"><strong>检索词</strong><ul>{view.terms.map((term,index)=><li key={index}>{term}</li>)}</ul></div>}
    {!!view.items?.length && <ul className="compact-tool-items">{view.items.map((item,index)=><li key={index}>
      <div className="resident-action-heading"><strong>{item.title}</strong>{item.state && <span className="resident-action-state">{item.state}</span>}</div>
      {!!item.fields?.length && <ResidentFields fields={item.fields} />}
    </li>)}</ul>}
    {!!view.fields?.length && <ResidentFields fields={view.fields} />}
  </div>;
}
function SettlementBody({settlement, result}: {settlement: ResidentSettlement; result: boolean}) {
  const buckets = (label:string, items:SettleItem[]) => items.length > 0 && <div key={label}>
    <dt>{label}</dt><dd><ul>{items.map(item => <li key={item.label}>{item.label} <strong>{item.count}</strong></li>)}</ul></dd>
  </div>;
  return <div className="resident-settlement">
    <p>提交 <strong>{settlement.requested}</strong> 项事件</p>
    {settlement.events ? <ol className="resident-settlement-events" aria-label="提交的事件">
      {settlement.events.map((event,index)=>{
        const caption=event.title || (event.snippet && <q>{event.snippet}{event.snippetTruncated && '…'}</q>);
        return <li key={index}>
          <strong className="resident-settlement-event-title">{caption || event.label}</strong>
          {event.recorded && <div className="resident-settlement-event-meta">
            {caption && <span>{event.label}</span>}
            {event.at && <time dateTime={event.at}>{dateTime(event.at)}</time>}
            {event.disposition && <span>来源处理：{event.disposition}</span>}
            {event.inspectionReview && <span>巡查处理：{event.inspectionReview}</span>}
            {!caption && <span>无可查看的标题或摘录</span>}
          </div>}
        </li>;
      })}
    </ol> : result && <p className="resident-settlement-unlisted">该记录未保存可核对的逐项事件明细。</p>}
    {(settlement.dispositions.length > 0 || settlement.reviews.length > 0) && <dl>
      {buckets(settlement.events ? '未列出的来源处理' : '来源处理', settlement.dispositions)}
      {buckets(settlement.events ? '未列出的巡查处理' : '巡查处理', settlement.reviews)}
    </dl>}
  </div>;
}
function ResidentFields({fields}: {fields: ResidentField[]}) {
  return <dl className="specialized-tool-fields">{fields.map((field,index) => <div key={index}>
    <dt>{field.label}</dt><dd>{'value' in field ? field.value : field.groups.map((group,i) => <ResidentFields key={i} fields={group} />)}</dd>
  </div>)}</dl>;
}
