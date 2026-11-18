import {DeploymentInfo} from './components/DeploymentInfo';
import {ReadErrorVisibility} from './components/ReadErrors';
import {useCallback, useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {api, operationErrorText, type OperatorSettings} from './api';
import {useResource} from './hooks';
import {Button,IconButton} from './components/BoardPrimitives';
import {Loading, Notice} from './components/Shared';
import {Confirm} from './components/ConfirmDialog';
import {WorkLogEditor} from './components/WorkLogEditor';
import {ExecutionPrinciplesEditor} from './components/ExecutionPrinciplesEditor';
import {RoleModelEditor} from './components/RoleModelEditor';
import {ModelCatalogEditor} from './components/ModelCatalogEditor';
import {SecretEditor} from './components/SecretEditor';
import {RiCpuLine, RiGitBranchLine, RiRobot2Line, RiCalendarCheckLine, RiFileTextLine, RiKey2Line, RiServerLine, RiCloseLine} from '@remixicon/react';
import './styles/settings-workspace.css';

const sections = [
 {id:'models',label:'模型与 API',icon:RiCpuLine},
 {id:'roles',label:'模型分工',icon:RiGitBranchLine},
 {id:'principles',label:'工作原则',icon:RiFileTextLine},
 {id:'appearance',label:'助手外观',icon:RiRobot2Line},
 {id:'worklog',label:'工作日志',icon:RiCalendarCheckLine},
 {id:'credentials',label:'访问凭据',icon:RiKey2Line},
 {id:'deployment',label:'部署信息',icon:RiServerLine},
] as const;
type Section = typeof sections[number]['id'];

const preventCompositionSubmit=(event:KeyboardEvent<HTMLFormElement>)=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()};

function Configuration({data,refresh,onReload,reloading,onStateChange}: {onStateChange:(key:string,dirty:boolean,busy:boolean)=>void;data:OperatorSettings;refresh:()=>void;onReload:()=>void;reloading:boolean}) {
 const [name,setName]=useState(data.appearance.name),[icon,setIcon]=useState(data.appearance.icon),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 useEffect(()=>{setName(data.appearance.name);setIcon(data.appearance.icon)},[data.version]);
 useEffect(()=>onStateChange('appearance',name!==data.appearance.name||icon!==data.appearance.icon,busy),[name,icon,data.appearance.name,data.appearance.icon,busy,onStateChange]);
 const save=async()=>{if(busy)return;setBusy(true);setError('');setFeedback('');try{await api('/settings/appearance',{method:'PUT',body:{expectedVersion:data.version,name,icon}});setFeedback('外观已保存。');refresh();window.dispatchEvent(new Event('night-settings-updated'))}catch(error){setError(operationErrorText(error))}finally{setBusy(false)}};
 return <>
  <section className="settings-card"><div className="settings-card-heading"><h2>助手外观</h2><Button variant="secondary" onClick={onReload} disabled={reloading} busy={reloading}>重新读取设置</Button></div><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!name.trim()){setError('请输入助手名称。');document.getElementById('assistant-name')?.focus();return}void save()}}><label htmlFor="assistant-name">显示名称</label><input id="assistant-name" maxLength={64} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/><label htmlFor="assistant-icon">助手图标</label><select id="assistant-icon" value={icon} disabled={busy} onChange={event=>setIcon(event.target.value as typeof icon)}><option value="moon">月亮</option><option value="star">星光</option><option value="robot">机器人</option><option value="leaf">叶片</option></select><Button type="submit" variant="primary" disabled={busy} busy={busy}>保存外观</Button><p role="alert" hidden={!error}>{error}</p><p role="status" hidden={!feedback}>{feedback}</p></form></section>
 </>;
}

export default function SettingsPage({onClose,registerClose}:{onClose?:()=>void;registerClose?:(handler:()=>void)=>void}={}){
 const query=useResource<OperatorSettings>('/settings');
 const [section,setSection]=useState<Section>('models');
 const panels=useRef<HTMLDivElement>(null);
 useEffect(()=>{panels.current?.scrollTo({top:0})},[section]);
 const [roleStates,setRoleStates]=useState<Record<string,{dirty:boolean;busy:boolean;locked:boolean}>>({}),[leave,setLeave]=useState<string|null>(null),[navigationNotice,setNavigationNotice]=useState('');
 const onRoleState=useCallback((role:string,dirty:boolean,busy:boolean,locked=false)=>setRoleStates(states=>({...states,[role]:{dirty,busy,locked}})),[]);
 const lockedRoles=Object.values(roleStates).some(state=>state.locked);
 const dirtyRoles=Object.values(roleStates).some(state=>state.dirty),busyRoles=Object.values(roleStates).some(state=>state.busy);
 useEffect(()=>{
  if(!dirtyRoles&&!busyRoles&&!lockedRoles)return;
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
  const navigation=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
   const anchor=event.target.closest('a[href]');if(!(anchor instanceof HTMLAnchorElement)||anchor.target==='_blank')return;
   const url=new URL(anchor.href);if(url.origin!==location.origin||url.pathname!==location.pathname||url.hash===location.hash)return;
   event.preventDefault();event.stopPropagation();if(lockedRoles)setNavigationNotice('有保存结果尚未确认，请先重新读取并核对，再关闭设置。');else if(busyRoles)setNavigationNotice('设置正在保存，请等待结果后再离开。');else setLeave(url.hash);
  };
  window.addEventListener('beforeunload',unload);document.addEventListener('click',navigation,true);
  return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigation,true)};
 },[dirtyRoles,busyRoles,lockedRoles]);
 useEffect(()=>{const refresh=()=>query.refresh();window.addEventListener('night-settings-updated',refresh);return()=>window.removeEventListener('night-settings-updated',refresh)},[query.refresh]);
 const requestClose=useCallback(()=>{if(lockedRoles)setNavigationNotice('有保存结果尚未确认，请先重新读取并核对，再关闭设置。');else if(busyRoles)setNavigationNotice('设置正在保存，请等待结果后再离开。');else if(dirtyRoles)setLeave('__close__');else onClose?.()},[busyRoles,dirtyRoles,lockedRoles,onClose]);
 useEffect(()=>registerClose?.(requestClose),[registerClose,requestClose]);
 const [refreshKey,setRefreshKey]=useState(0);const reload=()=>{if(busyRoles)return;setRefreshKey(value=>value+1);query.refresh()};

 return <div className="page-content settings-page settings-workspace">
  {onClose&&<div className="settings-modal-close"><IconButton label="关闭设置" onClick={requestClose}><RiCloseLine size={18}/></IconButton></div>}
  {query.error&&<Notice read error={query.error} onRetry={busyRoles?undefined:query.refresh}/>}
  {query.loading&&!query.data?<Loading/>:query.data?<>
   <div className="settings-workspace-layout">
    <aside className="settings-sidebar"><h2 id="settings-modal-title" className="settings-sidebar-title">设置</h2><div className="settings-navigation" role="tablist" aria-label="设置分类" aria-orientation="vertical">
     {sections.filter(item=>item.id!=='worklog'||query.data?.workLog).map(item=>{
      const Icon=item.icon;
      return <button type="button" key={item.id} id={`settings-tab-${item.id}`} role="tab" aria-selected={section===item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={section===item.id?0:-1} onClick={()=>setSection(item.id)} onKeyDown={event=>{
       const available=sections.filter(item=>item.id!=='worklog'||query.data?.workLog);
       const index=available.findIndex(tab=>tab.id===item.id);
       const next=event.key==='Home'?0:event.key==='End'?available.length-1:['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%available.length:['ArrowUp','ArrowLeft'].includes(event.key)?(index+available.length-1)%available.length:-1;
       if(next<0)return;event.preventDefault();setSection(available[next].id);document.getElementById(`settings-tab-${available[next].id}`)?.focus();
      }}><Icon size={18} aria-hidden="true"/><span>{item.label}</span></button>
     })}
    </div></aside>
    <div className="settings-panels" ref={panels}>
     <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" hidden={section!=='models'} tabIndex={0}><ReadErrorVisibility active={section==='models'}>
      <ModelCatalogEditor key={`catalog-${refreshKey}`} settingsVersion={query.data.version} defaultProvider={query.data.model.provider} onSaved={query.refresh} onStateChange={onRoleState}/>
     </ReadErrorVisibility></div>
     <div role="tabpanel" id="settings-panel-roles" aria-labelledby="settings-tab-roles" hidden={section!=='roles'} tabIndex={0}><ReadErrorVisibility active={section==='roles'}>
      <div className="settings-role-stack">{query.data.roleModels?.roles.map(role=><RoleModelEditor key={`${role.role}-${refreshKey}`} state={role} onStateChange={onRoleState} catalog={query.data!.roleModels.catalog} version={query.data!.version} onSaved={query.refresh} onReload={reload} reloading={query.loading||busyRoles}/>)}</div></ReadErrorVisibility>
     </div>
     <div role="tabpanel" id="settings-panel-principles" aria-labelledby="settings-tab-principles" hidden={section!=='principles'} tabIndex={0}><ReadErrorVisibility active={section==='principles'}>
      <ExecutionPrinciplesEditor active={section==='principles'} onStateChange={onRoleState}/>
     </ReadErrorVisibility></div>
     <div role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance" hidden={section!=='appearance'} tabIndex={0}><ReadErrorVisibility active={section==='appearance'}>
      <Configuration onStateChange={onRoleState} key={refreshKey} data={query.data} refresh={query.refresh} onReload={reload} reloading={query.loading||busyRoles}/>
     </ReadErrorVisibility></div>
     {query.data.workLog&&<div role="tabpanel" id="settings-panel-worklog" aria-labelledby="settings-tab-worklog" hidden={section!=='worklog'} tabIndex={0}><ReadErrorVisibility active={section==='worklog'}>
      <WorkLogEditor key={`work-log-${refreshKey}`} state={query.data.workLog} version={query.data.version} onSaved={query.refresh} onReload={reload} reloading={query.loading||busyRoles} onStateChange={onRoleState}/>
     </ReadErrorVisibility></div>}
     <div role="tabpanel" id="settings-panel-credentials" aria-labelledby="settings-tab-credentials" hidden={section!=='credentials'} tabIndex={0}><ReadErrorVisibility active={section==='credentials'}>
      <SecretEditor key={`github-${refreshKey}`} kind="github" state={query.data.secrets.github} version={query.data.version} onSaved={query.refresh} onStateChange={onRoleState}/>
     </ReadErrorVisibility></div>
     <div role="tabpanel" id="settings-panel-deployment" aria-labelledby="settings-tab-deployment" hidden={section!=='deployment'} tabIndex={0}><ReadErrorVisibility active={section==='deployment'}><DeploymentInfo active={section==='deployment'}/></ReadErrorVisibility></div>
    </div>
   </div>
  </>:null}
  <p role="status" hidden={!navigationNotice}>{navigationNotice}</p>
  {leave&&<Confirm title="离开设置" actionLabel="放弃草稿并离开" onClose={()=>setLeave(null)} onConfirm={()=>{if(leave==='__close__')onClose?.();else location.hash=leave}}><p>设置还有未保存的修改，离开会丢弃这些草稿。</p></Confirm>}
 </div>;
}
