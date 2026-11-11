import {useCallback, useEffect, useState, type KeyboardEvent} from 'react';
import {api, errorText, type OperatorSettings} from './api';
import {useResource} from './hooks';
import {Button} from './components/BoardPrimitives';
import {Loading, Notice} from './components/Shared';
import {Confirm} from './components/ConfirmDialog';
import {WorkLogEditor} from './components/WorkLogEditor';
import {RoleModelEditor} from './components/RoleModelEditor';
import {ModelCatalogEditor} from './components/ModelCatalogEditor';
import {SecretEditor} from './components/SecretEditor';

const preventCompositionSubmit=(event:KeyboardEvent<HTMLFormElement>)=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()};

function Configuration({data,refresh,onReload,reloading}: {data:OperatorSettings;refresh:()=>void;onReload:()=>void;reloading:boolean}) {
 const [name,setName]=useState(data.appearance.name),[icon,setIcon]=useState(data.appearance.icon),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 useEffect(()=>{setName(data.appearance.name);setIcon(data.appearance.icon)},[data.version]);
 const save=async()=>{if(busy)return;setBusy(true);setError('');setFeedback('');try{await api('/settings/appearance',{method:'PUT',body:{expectedVersion:data.version,name,icon}});setFeedback('外观已保存。');refresh();window.dispatchEvent(new Event('night-settings-updated'))}catch(error){setError(errorText(error))}finally{setBusy(false)}};
 return <>
  <section className="settings-card"><div className="settings-card-heading"><h2>助手外观</h2><Button variant="secondary" onClick={onReload} disabled={reloading} busy={reloading}>重新读取设置</Button></div><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!name.trim()){setError('请输入助手名称。');document.getElementById('assistant-name')?.focus();return}void save()}}><label htmlFor="assistant-name">显示名称</label><input id="assistant-name" maxLength={64} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/><label htmlFor="assistant-icon">助手图标</label><select id="assistant-icon" value={icon} disabled={busy} onChange={event=>setIcon(event.target.value as typeof icon)}><option value="moon">月亮</option><option value="star">星光</option><option value="robot">机器人</option><option value="leaf">叶片</option></select><p className="field-help">使用内置图标，不读取本地文件或加载外部图片。名称不修改项目标识、渠道或会话 ID。</p><Button type="submit" disabled={busy} busy={busy}>保存外观</Button></form></section>
  <p role="alert">{error}</p><p role="status">{feedback}</p>
 </>;
}

export default function SettingsPage(){
 const query=useResource<OperatorSettings>('/settings');
 const [roleStates,setRoleStates]=useState<Record<string,{dirty:boolean;busy:boolean}>>({}),[leave,setLeave]=useState<string|null>(null),[navigationNotice,setNavigationNotice]=useState('');
 const onRoleState=useCallback((role:string,dirty:boolean,busy:boolean)=>setRoleStates(states=>({...states,[role]:{dirty,busy}})),[]);
 const dirtyRoles=Object.values(roleStates).some(state=>state.dirty),busyRoles=Object.values(roleStates).some(state=>state.busy);
 useEffect(()=>{
  if(!dirtyRoles&&!busyRoles)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
  const navigation=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
   const anchor=event.target.closest('a[href]');if(!(anchor instanceof HTMLAnchorElement)||anchor.target==='_blank')return;
   const url=new URL(anchor.href);if(url.origin!==location.origin||url.pathname!==location.pathname||url.hash===location.hash)return;
   event.preventDefault();event.stopPropagation();if(busyRoles)setNavigationNotice('设置正在保存，请等待结果后再离开。');else setLeave(url.hash);
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',navigation,true);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigation,true)};
 },[dirtyRoles,busyRoles]);
 useEffect(()=>{const refresh=()=>query.refresh();window.addEventListener('night-settings-updated',refresh);return()=>window.removeEventListener('night-settings-updated',refresh)},[query.refresh]);
 const [refreshKey,setRefreshKey]=useState(0);const reload=()=>{if(busyRoles)return;setRefreshKey(value=>value+1);query.refresh()};

 return <div className="page-content settings-page">{query.error&&<Notice error={query.error} onRetry={busyRoles?undefined:reload}/>}{query.loading&&!query.data?<Loading/>:query.data?<><Configuration key={refreshKey} data={query.data} refresh={query.refresh} onReload={reload} reloading={query.loading||busyRoles}/>{query.data.workLog&&<WorkLogEditor key={`work-log-${refreshKey}`} state={query.data.workLog} version={query.data.version} onSaved={query.refresh} onReload={reload} reloading={query.loading||busyRoles} onStateChange={onRoleState}/>}<ModelCatalogEditor key={`catalog-${refreshKey}`} settingsVersion={query.data.version} defaultProvider={query.data.model.provider} onSaved={query.refresh} onStateChange={onRoleState}/><div className="settings-grid">{query.data.roleModels?.roles.map(role=><RoleModelEditor key={`${role.role}-${refreshKey}`} state={role} onStateChange={onRoleState} catalog={query.data!.roleModels.catalog} version={query.data!.version} onSaved={query.refresh} onReload={reload} reloading={query.loading||busyRoles}/>)}</div><div className="settings-grid"><SecretEditor key={`github-${refreshKey}`} kind="github" state={query.data.secrets.github} version={query.data.version} onSaved={query.refresh} onStateChange={onRoleState}/></div></>:null}<p role="status">{navigationNotice}</p>{leave&&<Confirm title="离开设置" actionLabel="放弃草稿并离开" onClose={()=>setLeave(null)} onConfirm={()=>{location.hash=leave}}><p>设置还有未保存的修改，离开会丢弃这些草稿。</p></Confirm>}</div>;

}
