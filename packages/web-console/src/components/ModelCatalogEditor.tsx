import {useEffect, useRef, useState} from 'react';
import {api, ApiError, errorText, type ModelCatalog, type ModelCatalogEntry, type ModelCatalogSaved} from '../api';
import {useResource} from '../hooks';
import {Button} from './BoardPrimitives';
import {Confirm} from './ConfirmDialog';
import {Loading, Notice} from './Shared';

const pageSize=10;
const referenceLabels:Record<string,string>={default:'默认模型','role:triage':'一级分诊','role:router':'Router','role:task':'任务执行','legacy:task':'任务默认配置','runtime:task':'当前任务默认配置','environment:triage':'分诊环境变量','environment:router':'Router 环境变量','environment:task':'执行环境变量'};
const referenceText=(values:string[])=>values.map(value=>referenceLabels[value]??'已有模型配置').join('、');
type Draft={originalId?:string;model:string;name:string;version:string;references:string[]};
type Mutation={action:'add'|'edit'|'remove';provider:string;id?:string;model?:string;name?:string;expectedVersion:string;confirm?:true};

export function ModelCatalogEditor({settingsVersion,onSaved,onStateChange}:{settingsVersion:string;onSaved:()=>void;onStateChange:(key:string,dirty:boolean,busy:boolean)=>void}) {
 const query=useResource<ModelCatalog>('/settings/model-catalog');
 const [providerId,setProviderId]=useState(''),[filter,setFilter]=useState(''),[page,setPage]=useState(0),[draft,setDraft]=useState<Draft|null>(null),[remove,setRemove]=useState<{entry:ModelCatalogEntry;provider:string;version:string}|null>(null);
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[fieldError,setFieldError]=useState(''),[pendingVersion,setPendingVersion]=useState<string|null>(null),[saveConfirmation,setSaveConfirmation]=useState<Mutation|null>(null);
 const mounted=useRef(true),inFlight=useRef(false),initialVersion=useRef(settingsVersion);
 const focusAdd=()=>document.getElementById('catalog-add-model')?.focus();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{if(initialVersion.current!==settingsVersion){initialVersion.current=settingsVersion;query.refresh()}},[settingsVersion,query.refresh]);
 useEffect(()=>{if(!providerId&&query.data?.providers.length)setProviderId(query.data.providers[0].provider)},[providerId,query.data]);
 useEffect(()=>{if(pendingVersion&&query.data?.version===pendingVersion)setPendingVersion(null)},[query.data,pendingVersion]);
 useEffect(()=>{onStateChange('model-catalog',!!draft||locked,busy);return()=>onStateChange('model-catalog',false,false)},[draft,locked,busy,onStateChange]);
 const provider=query.data?.providers.find(row=>row.provider===providerId),stale=!!draft&&draft.version!==query.data?.version;
 const unavailable=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);
 const disabled=busy||locked||stale||query.loading||!!pendingVersion||!!query.error;
 const filtered=provider?.models.filter(row=>`${row.id} ${row.name}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))??[];
 const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/pageSize)-1)),visible=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
 const reset=()=>{setDraft(null);setLocked(false);setError('');setFieldError('');setFeedback('');setPendingVersion(null);query.refresh();onSaved()};
 const edit=(row?:ModelCatalogEntry)=>{
  if(disabled||!query.data)return;
  setDraft({...(row?{originalId:row.id}:{}),model:row?.id??'',name:row?.configuredName??'',version:query.data.version,references:row?.references??[]});setError('');setFieldError('');setFeedback('');
 };
 useEffect(()=>{if(draft)document.getElementById(draft.references.length?'catalog-model-name':'catalog-model-id')?.focus()},[draft?.originalId,draft===null]);
 const save=async(body:Mutation)=>{
  if(inFlight.current||disabled)return;
  inFlight.current=true;setBusy(true);setError('');setFeedback('');
  let acknowledged=false;
  try{
   const receipt=await api<ModelCatalogSaved>('/settings/model-catalog',{method:'PUT',body});
   if(receipt?.ok!==true||typeof receipt.changed!=='boolean'||typeof receipt.version!=='string'||typeof receipt.restartRequired!=='boolean'||receipt.liveApplied!==false)throw new Error('UNKNOWN_SAVE');
   acknowledged=true;
   const latest=await api<ModelCatalog>('/settings/model-catalog');
   const entries=latest.providers.find(row=>row.provider===body.provider)?.models;
   const entry=entries?.find(row=>row.id===body.model);
   if(latest.version!==receipt.version||!entries||(body.action==='remove'?entries.some(row=>row.id===body.id):!entry||(entry.configuredName??'')!==body.name||body.action==='edit'&&body.id!==body.model&&entries.some(row=>row.id===body.id)))throw new Error('UNKNOWN_SAVE');
   if(!mounted.current)return;
   setDraft(null);setPendingVersion(latest.version);setPage(0);setFilter('');
   setFeedback(receipt.changed?`模型已${body.action==='remove'?'删除':body.action==='add'?'添加':'保存'}。正常重启后生效，不中断当前执行。`:'模型配置未变化。');
   query.refresh();onSaved();focusAdd();
  }catch(cause){
   if(!mounted.current)return;
   const rejected=!acknowledged&&cause instanceof ApiError&&(cause.status===400||cause.status===409&&cause.code!=='SETTINGS_VERSION_CONFLICT');
   setLocked(!rejected);
   setError(rejected?errorText(cause):`${cause instanceof ApiError&&cause.code==='SETTINGS_VERSION_CONFLICT'?errorText(cause):'无法确认最新保存结果。草稿已保留，不会自动重试。'} 请重新读取模型列表并核对，读取会替换草稿。`);
  }finally{inFlight.current=false;if(mounted.current)setBusy(false)}
 };
 const submit=()=>{
  if(!draft||disabled)return;
  if(!draft.model||draft.model.trim()!==draft.model||draft.model.length>256||/[\x00-\x1f\x7f]/.test(draft.model)){setFieldError('请填写准确的模型 ID，不要包含首尾空格或控制字符。');document.getElementById('catalog-model-id')?.focus();return}
  if(provider?.models.some(row=>row.id===draft.model&&row.id!==draft.originalId)){setFieldError('此路由已存在相同模型 ID。');document.getElementById('catalog-model-id')?.focus();return}
  if(draft.name.length>256||/[\x00-\x1f\x7f]/.test(draft.name)){setFieldError('显示名称不能超过 256 个字符或包含控制字符。');document.getElementById('catalog-model-name')?.focus();return}
  setSaveConfirmation({action:draft.originalId?'edit':'add',provider:providerId,...draft.originalId?{id:draft.originalId}:{},model:draft.model,name:draft.name.trim(),expectedVersion:draft.version});
 };
 return <section className="settings-card model-catalog" aria-labelledby="model-catalog-title">
  <div className="settings-card-heading"><h2 id="model-catalog-title">模型列表</h2><Button onClick={reset} disabled={busy} busy={query.loading}>{draft||locked?'重新读取模型列表并替换草稿':'重新读取模型列表'}</Button></div>
  <p className="field-help">同一路由的多个模型共用已有 API 地址和凭据。填写服务商实际支持的模型 ID，保存后可在下方为各角色选择；不会调用模型验证。</p>
  {query.error&&<Notice error={query.error} onRetry={busy?undefined:query.refresh}/>}
  {query.loading&&!query.data?<Loading/>:!unavailable&&query.data?<>
   {query.data.providers.length?<>
    <label htmlFor="catalog-provider">管理模型的路由</label><select id="catalog-provider" value={providerId} disabled={disabled||!!draft} onChange={event=>{setProviderId(event.target.value);setFilter('');setPage(0);setError('');setFeedback('')}}>{query.data.providers.map(row=><option key={row.provider} value={row.provider}>{row.name===row.provider?row.provider:`${row.name} (${row.provider})`}</option>)}</select>
    <div className="model-catalog-toolbar"><div><label htmlFor="catalog-filter">筛选模型</label><input id="catalog-filter" type="search" value={filter} onChange={event=>{setFilter(event.target.value);setPage(0)}} placeholder="按模型 ID 或显示名称筛选" disabled={busy}/></div><Button id="catalog-add-model" variant="primary" onClick={()=>edit()} disabled={disabled||!!draft}>添加模型</Button></div>
    {draft&&<form noValidate className="model-catalog-form" onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()}} onSubmit={event=>{event.preventDefault();submit()}}>
     <h3>{draft.originalId?'编辑模型':'添加模型'}</h3>
     <label htmlFor="catalog-model-id">模型 ID</label><input id="catalog-model-id" value={draft.model} disabled={disabled} readOnly={draft.references.length>0} maxLength={256} aria-invalid={!!fieldError} aria-describedby="catalog-entry-help catalog-field-error" onChange={event=>{setDraft({...draft,model:event.target.value});setFieldError('')}}/>
     <label htmlFor="catalog-model-name">模型显示名称（可选）</label><input id="catalog-model-name" value={draft.name} disabled={disabled} maxLength={256} aria-describedby="catalog-entry-help catalog-field-error" onChange={event=>{setDraft({...draft,name:event.target.value});setFieldError('')}}/>
     <p id="catalog-entry-help" className="field-help">显示名称仅用于识别，不改变实际模型。保留已有的推理能力、上下文与兼容配置。{draft.references.length>0?`此 ID 被${referenceText(draft.references)}引用，可改显示名称；改 ID 前请先切换相关配置。`:''}</p>
     <p id="catalog-field-error" className="field-error" role={fieldError?'alert':undefined}>{fieldError}</p>
     <div className="inline-actions"><Button type="submit" variant="primary" busy={busy} disabled={disabled}>保存模型</Button><Button disabled={busy||locked} onClick={()=>{setDraft(null);setFieldError('');setError('');focusAdd()}}>取消编辑</Button></div>
    </form>}
    <ul className="model-catalog-list" aria-label="已配置模型">{visible.map(row=><li key={row.id}><div><strong>{row.name}</strong>{row.name!==row.id&&<span className="model-catalog-id">{row.id}</span>}<p className="field-help">{row.references.length?`使用中：${referenceText(row.references)}`:'未被默认模型或角色配置引用'}</p></div><div className="inline-actions"><Button disabled={disabled||!!draft} aria-label={`编辑模型 ${row.id}`} onClick={()=>edit(row)}>编辑</Button><Button disabled={disabled||!!draft||row.references.length>0||provider!.models.length<=1} aria-label={`删除模型 ${row.id}`} onClick={()=>setRemove({entry:row,provider:providerId,version:query.data!.version})}>删除</Button></div></li>)}</ul>
    {!visible.length&&<p>{filter?'没有匹配的模型，请调整筛选条件。':'此路由没有可用模型，请检查配置。'}</p>}
    <div className="pagination"><span>{filtered.length?`${currentPage*pageSize+1}–${Math.min((currentPage+1)*pageSize,filtered.length)} / ${filtered.length} 个模型`:'0 个模型'}</span><div><Button disabled={currentPage===0||busy} onClick={()=>setPage(currentPage-1)}>上一页模型</Button><Button disabled={(currentPage+1)*pageSize>=filtered.length||busy} onClick={()=>setPage(currentPage+1)}>下一页模型</Button></div></div>
    <p className="field-help">使用中的模型及路由中最后一个模型不能删除。保存配置不改变当前运行模型，需正常重启。</p>
   </>:<p>尚未配置模型路由，请先在模型 API 中保存路由。</p>}
  </>:null}
  {stale&&!locked&&<p role="alert">设置已变化，草稿未被覆盖。请重新读取模型列表后再编辑。</p>}
  <p className="field-error" role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
  {remove&&<Confirm title="删除模型" actionLabel="确认删除" onClose={()=>setRemove(null)} onConfirm={()=>void save({action:'remove',provider:remove.provider,id:remove.entry.id,expectedVersion:remove.version,confirm:true})}><p>从 {remove.provider} 删除模型 {remove.entry.name}（{remove.entry.id}）。不会删除 API 凭据或历史任务；正常重启后不再可选。</p></Confirm>}
  {saveConfirmation&&<Confirm title="保存模型" onClose={()=>setSaveConfirmation(null)} onConfirm={()=>void save(saveConfirmation)}><p>在 {providerId} 中{saveConfirmation.action==='add'?'添加':'保存'}模型 {saveConfirmation.model}。共用此路由现有 API 地址与凭据，不会调用模型验证。正常重启后生效，不中断当前执行。</p></Confirm>}
 </section>;
}
