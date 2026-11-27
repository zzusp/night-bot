import type {WorkOrigin as Origin, WorkRole} from '../api';

export const workRoleLabels: Record<WorkRole,string> = {
  development:'开发', verification:'验证', investigation:'调查', general:'执行',
};

export function WorkOrigin({origin}: {origin: Origin}) {
  if(origin.kind==='unavailable')return <span>原对话不可用</span>;
  return <a className="work-origin-link" href={`#/${origin.kind==='web'?'chat':'channels'}/${encodeURIComponent(origin.id)}`}>{origin.name}</a>;
}
