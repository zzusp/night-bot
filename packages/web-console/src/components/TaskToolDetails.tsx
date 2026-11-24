import type {TaskToolPresentation} from '../task-tool-presentation';

const statuses={pending:'待处理',in_progress:'进行中',completed:'已完成'} as const;
const actions={complete:'请求完成',wait:'请求等待',blocked:'报告受阻'} as const;
type TodoCounts=Extract<TaskToolPresentation,{kind:'todos'}>['counts'];
export function TodoCountsRow({counts}: {counts:TodoCounts}) {
  const keys=(Object.keys(statuses) as (keyof TodoCounts)[]).filter(status=>counts[status]>0);
  return keys.length>0 ? <span className="task-tool-counts">{keys.map(status=>
    <span key={status}>{statuses[status]} <strong>{counts[status]}</strong></span>)}</span> : null;
}
export function TaskToolDetails({view,recorded}: {view:TaskToolPresentation;recorded?:boolean}){
  if(view.kind==='todos')return <div className="task-tool-details">
    <div className="task-tool-heading"><strong>{recorded?'待办已更新':'提交的待办'}</strong><TodoCountsRow counts={view.counts} /></div>
    {view.todos.length ? <ul className="task-tool-todos">{view.todos.map((todo,index)=><li key={index}>
      <span>{todo.content}</span><span className="task-tool-todo-state">{statuses[todo.status]}</span>
    </li>)}</ul> : <p>清空列表</p>}
  </div>;
  const lines=(label:string,items:string[])=>items.length>0&&<div key={label}><dt>{label}</dt><dd><ul>
    {items.map((line,index)=><li key={index}>{line}</li>)}</ul></dd></div>;
  return <div className="task-tool-details">
    <div className="task-tool-heading"><strong>提交的结果</strong>{view.action && <span>{actions[view.action]}</span>}</div>
    <dl className="resident-action-copy">
      {view.summary && <div><dt>结论</dt><dd>{view.summary}</dd></div>}
      {view.question && <div><dt>待确认</dt><dd>{view.question}</dd></div>}
      {lines('依据',view.evidence)}{lines('限制',view.limitations)}{lines('交付说明',view.files)}
    </dl>
  </div>;
}
