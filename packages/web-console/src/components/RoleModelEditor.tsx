import {useEffect, useRef, useState} from 'react';
import {api, ApiError, errorText, type RoleModelCatalog, type RoleModelSelection, type RoleModelState, type RoleModelSaved} from '../api';
import {Badge, Button} from './BoardPrimitives';
import {Confirm} from './ConfirmDialog';

const labels = {triage:'一级分诊',router:'Router',task:'任务执行'};
const effortLabels:Record<string,string> = {'model-default':'模型默认',off:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
const sourceLabels:Record<string,string> = {process:'进程环境', 'project-env':'安装环境文件', 'user-env':'用户环境文件',environment:'启动环境'};
const describe = (selection:RoleModelSelection) => `${selection.provider} / ${selection.model} · ${effortLabels[selection.reasoningEffort??'model-default']??selection.reasoningEffort}`;
const same = (a:RoleModelSelection,b:RoleModelSelection) => a.provider===b.provider&&a.model===b.model&&a.reasoningEffort===b.reasoningEffort;

export function RoleModelEditor({state,catalog,version,onSaved,onReload,reloading,onStateChange}:{state:RoleModelState;catalog:RoleModelCatalog[];version:string;onSaved:()=>void;onReload:()=>void;reloading:boolean;onStateChange:(role:string,dirty:boolean,busy:boolean)=>void}) {
 const [draft,setDraft]=useState(state.saved),[draftVersion,setDraftVersion]=useState(version),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[pendingVersion,setPendingVersion]=useState<string|null>(null);
 const mounted=useRef(true),inFlight=useRef(false),pendingBaseVersion=useRef(version);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{if(pendingVersion&&version===pendingBaseVersion.current&&version!==pendingVersion)return;if(pendingVersion){if(version!==pendingVersion)setFeedback('设置已再次变化，当前显示最新保存值。');setPendingVersion(null)}if(!dirty&&!busy&&!locked){setDraft(state.saved);setDraftVersion(version)}},[state.saved,version,dirty,busy,locked,pendingVersion]);
 useEffect(()=>{onStateChange(state.role,dirty,busy);return()=>onStateChange(state.role,false,false)},[state.role,dirty,busy,onStateChange]);
 const label=labels[state.role],prefix=`role-${state.role}`,stale=dirty&&draftVersion!==version;
 const provider=catalog.find(row=>row.provider===draft.provider),model=provider?.models.find(row=>row.id===draft.model),effort=draft.reasoningEffort??'model-default';
 const invalid=!model||effort!=='model-default'&&!model.reasoningEfforts.includes(effort),disabled=busy||locked||stale||!!pendingVersion;
 const change=(selection:RoleModelSelection)=>{setDraft(selection);if(!dirty)setDraftVersion(version);setDirty(true);setError('');setFeedback('')};
 const save=async()=>{
  if(inFlight.current||disabled||invalid)return;
  inFlight.current=true;setBusy(true);setError('');setFeedback('');
  try {
   const receipt=await api<RoleModelSaved>('/settings/role-model',{method:'PUT',body:{role:state.role,...draft,reasoningEffort:effort,expectedVersion:draftVersion}});
   if(!receipt||receipt.ok!==true||typeof receipt.changed!=='boolean'||typeof receipt.version!=='string'||typeof receipt.restartRequired!=='boolean'||receipt.role?.role!==state.role||!same(receipt.role.saved,draft)||!Array.isArray(receipt.role.environmentOverrides))throw new Error('UNKNOWN_SAVE');
   // A write acknowledgement alone does not prove this is still the saved version.
   const latest=await api<import('../api').OperatorSettings>('/settings');
   const saved=latest.roleModels?.roles.find(row=>row.role===state.role);
   if(latest.version!==receipt.version||!saved||!same(saved.saved,draft))throw new Error('UNKNOWN_SAVE');
   if(!mounted.current)return;
   pendingBaseVersion.current=draftVersion;setDirty(false);setDraftVersion(receipt.version);setPendingVersion(receipt.version);
   setFeedback(saved.environmentError?`${label}配置已保存，但与当前环境变量不兼容。请修改或移除环境变量后再重启。`:receipt.role.environmentOverrides.length?`${label}配置已保存。环境变量仍会覆盖对应字段，请修改或移除环境变量后正常重启。`:receipt.changed?`${label}配置已保存，正常重启后生效。`:`${label}配置未变化。${saved.restartRequired?'仍需正常重启后生效。':''}`);
   onSaved();
  } catch(cause) {
   if(!mounted.current)return;
   const rejected=cause instanceof ApiError&&cause.status===400;
   setLocked(!rejected);
   setError(rejected?errorText(cause):`${cause instanceof ApiError&&cause.code==='SETTINGS_VERSION_CONFLICT'?errorText(cause):'无法确认最新保存结果。草稿已保留，不会自动重试。'} 请重新读取设置并核对，读取会替换当前草稿。`);
  } finally {inFlight.current=false;if(mounted.current)setBusy(false)}
 };
 return <section className="settings-card" aria-labelledby={`${prefix}-title`}>
  <h2 id={`${prefix}-title`}>{label}</h2>
  {!state.nextStart&&!state.environmentOverrides.length&&<p role="alert">无法核验下次启动模型，请检查路由与推理深度配置。</p>}
  {state.restartRequired&&<Badge tone="warning">待重启</Badge>}
  {state.environmentOverrides.length>0&&<div className="role-model-environment"><p>环境变量优先于保存配置，重启仍会覆盖对应字段。请修改或移除环境变量后再重启。</p>{state.nextStart?<p>按当前环境重启：{describe(state.nextStart)}</p>:<p role="alert">当前环境变量与保存配置不兼容，需修改或移除后才能正常启动。</p>}<ul>{state.environmentOverrides.map(item=><li key={item.name}>{item.name} · {sourceLabels[item.source]??'启动环境'}</li>)}</ul></div>}
  <form noValidate onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()}} onSubmit={event=>{event.preventDefault();if(disabled)return;if(invalid){setError('请选择此路由支持的模型与推理深度。');document.getElementById(`${prefix}-model`)?.focus();return}setConfirm(true)}}>
   <label htmlFor={`${prefix}-provider`}>{label}模型路由</label>
   <select id={`${prefix}-provider`} value={draft.provider} disabled={disabled} aria-describedby={error ? `${prefix}-error` : undefined} onChange={event=>{const next=catalog.find(row=>row.provider===event.target.value);change({provider:event.target.value,model:next?.models[0]?.id??''})}}>
    {!provider&&<option value={draft.provider} disabled>{draft.provider}（不可用）</option>}
    {catalog.map(row=><option key={row.provider} value={row.provider} disabled={!row.models.length}>{row.name===row.provider?row.provider:`${row.name} (${row.provider})`}{!row.models.length?'（无可用模型）':''}</option>)}
   </select>
   <label htmlFor={`${prefix}-model`}>{label}模型</label>
   <select id={`${prefix}-model`} value={draft.model} disabled={disabled||!provider?.models.length} aria-invalid={!!error&&invalid} aria-describedby={error ? `${prefix}-error` : undefined} onChange={event=>change({provider:draft.provider,model:event.target.value})}>
    {!model&&<option value={draft.model} disabled>{draft.model||'未选择模型'}（不可用）</option>}
    {provider?.models.map(row=><option key={row.id} value={row.id}>{row.name===row.id?row.id:`${row.name} (${row.id})`}</option>)}
   </select>
   <label htmlFor={`${prefix}-effort`}>{label}推理深度</label>
   <select id={`${prefix}-effort`} value={effort} disabled={disabled||!model} aria-invalid={!!error&&invalid} aria-describedby={error ? `${prefix}-error` : undefined} onChange={event=>change({provider:draft.provider,model:draft.model,...event.target.value==='model-default'?{}:{reasoningEffort:event.target.value}})}>
    <option value="model-default">模型默认</option>
    {effort!=='model-default'&&!model?.reasoningEfforts.includes(effort)&&<option value={effort} disabled>{effortLabels[effort]??effort}（不支持）</option>}
    {model?.reasoningEfforts.map(value=><option key={value} value={value}>{effortLabels[value]??value} ({value})</option>)}
   </select>

   {stale&&!locked&&<p role="alert">设置已变化，当前草稿未被覆盖。请重新读取设置后再编辑。</p>}
   <p id={`${prefix}-error`} className="field-error" hidden={!error} role={error?'alert':undefined}>{error}</p>
   <p role="status" hidden={!feedback}>{feedback}</p>
   <Button type="submit" busy={busy} disabled={disabled||invalid}>{`保存${label}配置`}</Button>
   {(locked||stale)&&<Button disabled={busy||reloading} busy={reloading} onClick={onReload}>重新读取设置并替换草稿</Button>}
  </form>
  {confirm&&<Confirm title={`保存${label}配置`} onClose={()=>setConfirm(false)} onConfirm={()=>void save()}><p>{label}将保存为 {describe(draft)}。正常重启后生效，不中断当前执行；不会调用模型验证。</p>{state.environmentOverrides.length>0&&<p>当前存在环境变量覆盖。只保存网页配置不会移除覆盖，需修改或移除环境变量。</p>}</Confirm>}
 </section>;
}
