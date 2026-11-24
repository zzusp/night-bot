import {specializedToolPresentation} from '../specialized-tool-content';
import {planStatusText, type ResidentPlan, type ResidentField} from '../resident-tool-content';
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
  isError?: boolean;
}

/** Inner content only. Shared MessageBody owns disclosure, paging and revocation. */
export default function SpecializedToolContent(props: SpecializedToolContentProps) {
  const view = specializedToolPresentation(props);
  const plan = props.plan ?? view?.plan;
  if (!view) return null;
  return <div className={`specialized-tool-content specialized-tool-content--${view.kind}`}>
    {view.fields.length > 0 && <dl className="specialized-tool-fields">{view.fields.map(field => <div key={field.label}>
      <dt>{field.label}</dt><dd>{field.value}</dd>
    </div>)}</dl>}
    {plan && <ResidentPlanBody plan={plan} />}
    {view.resident && <ResidentFields fields={view.resident} />}
    {view.text !== undefined && <pre className="tool-content specialized-tool-text" tabIndex={0}><code>{view.text}</code></pre>}
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
function ResidentFields({fields}: {fields: ResidentField[]}) {
  return <dl className="specialized-tool-fields">{fields.map((field,index) => <div key={index}>
    <dt>{field.label}</dt><dd>{'value' in field ? field.value : field.groups.map((group,i) => <ResidentFields key={i} fields={group} />)}</dd>
  </div>)}</dl>;
}
