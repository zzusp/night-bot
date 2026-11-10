import {useCallback, useEffect, useState, type KeyboardEvent} from 'react';
import {api, errorText, type OperatorSettings} from './api';
import {useResource} from './hooks';
import {Button, IconButton} from './components/BoardPrimitives';
import {Loading, Notice} from './components/Shared';
import {Confirm} from './components/ConfirmDialog';
import {WorkLogEditor} from './components/WorkLogEditor';
import {RoleModelEditor} from './components/RoleModelEditor';

const preventCompositionSubmit=(event:KeyboardEvent<HTMLFormElement>)=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()};

function SecretEditor({kind,state,version,onSaved}: {kind:'model'|'github';state:OperatorSettings['secrets']['model'];version:string;onSaved:()=>void}) {
 const [value,setValue]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[confirm,setConfirm]=useState<'replace'|'clear'|null>(null);
 const label=kind==='model'?'模型 API Key':'GitHub Token';
 const save=async(action:'replace'|'clear')=>{if(busy)return;setBusy(true);setError('');setFeedback('');const input=value;setValue('');setShow(false);
  try{await api(`/settings/secrets/${kind}`,{method:'PUT',body:{action,...action==='replace'?{value:input}:{},confirm:true,expectedVersion:version}});setFeedback('已保存。');onSaved()}
  catch(error){setError(errorText(error)+' 密钥输入已清空，请先重新读取状态；不会自动重试。')}finally{setBusy(false)}
 };
 return <section className="settings-card"><h2>{label}</h2><p>{state.configured?'已配置':'未配置'} · {state.writable?'安装密钥存储':'由环境提供，只读'}</p>
  <p className="field-help">{kind==='github'?'仅供已获准的完全访问 Shell 使用，保存不授予 GitHub 操作权限。':'用于当前保存的模型配置，已保存内容不会回显。'}</p>
  <form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(value.trim())setConfirm('replace');else setError('请输入新凭据。')}}>
   <label htmlFor={`secret-${kind}`}>新的{label}</label><div className="settings-secret"><input id={`secret-${kind}`} type={show?'text':'password'} autoComplete="new-password" spellCheck={false} value={value} disabled={busy||!state.writable} onChange={event=>setValue(event.target.value)} aria-describedby={`secret-${kind}-error`} aria-invalid={!!error}/><IconButton label={show?`隐藏${label}`:`显示${label}`} disabled={busy||!state.writable} onClick={()=>setShow(!show)}>{show?'隐藏':'显示'}</IconButton></div>
   <p className="field-error" id={`secret-${kind}-error`} role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
   <div className="inline-actions"><Button type="submit" busy={busy} disabled={busy||!state.writable}>替换{label}</Button><Button disabled={busy||!state.writable||!state.configured} onClick={()=>setConfirm('clear')}>清除{label}</Button></div>
  </form>
  {confirm&&<Confirm actionLabel={confirm==='clear'?'确认清除':'确认替换'} title={`${confirm==='clear'?'清除':'替换'}${label}`} onClose={()=>setConfirm(null)} onConfirm={()=>void save(confirm)}><p>{confirm==='clear'?'清除安装中保存的凭据，相关调用可能无法继续；本页无法恢复旧值，需重新填写。':'将替换当前保存的凭据，后续授权调用将使用新值。'}不会发送外部验证请求。</p></Confirm>}
 </section>;
}
function Configuration({data,refresh,onReload,reloading}: {data:OperatorSettings;refresh:()=>void;onReload:()=>void;reloading:boolean}) {
 const [name,setName]=useState(data.appearance.name),[icon,setIcon]=useState(data.appearance.icon),[model,setModel]=useState(data.model.model),[baseURL,setURL]=useState(data.model.baseURL),[protocol,setProtocol]=useState(data.model.api),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[confirm,setConfirm]=useState(false);
 useEffect(()=>{setName(data.appearance.name);setIcon(data.appearance.icon);setModel(data.model.model);setURL(data.model.baseURL);setProtocol(data.model.api)},[data.version]);
 const save=async(kind:'appearance'|'model')=>{if(busy)return;setBusy(true);setError('');setFeedback('');try{await api(`/settings/${kind}`,{method:'PUT',body:{expectedVersion:data.version,...kind==='appearance'?{name,icon}:{model,api:protocol,baseURL}}});setFeedback(kind==='model'?'模型配置已保存，正常重启后生效。':'外观已保存。');refresh();window.dispatchEvent(new Event('night-settings-updated'))}catch(error){setError(errorText(error))}finally{setBusy(false)}};
 return <>
  <section className="settings-card"><div className="settings-card-heading"><h2>助手外观</h2><Button variant="secondary" onClick={onReload} disabled={reloading} busy={reloading}>重新读取设置</Button></div><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!name.trim()){setError('请输入助手名称。');document.getElementById('assistant-name')?.focus();return}void save('appearance')}}><label htmlFor="assistant-name">显示名称</label><input id="assistant-name" maxLength={64} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/><label htmlFor="assistant-icon">助手图标</label><select id="assistant-icon" value={icon} disabled={busy} onChange={event=>setIcon(event.target.value as typeof icon)}><option value="moon">月亮</option><option value="star">星光</option><option value="robot">机器人</option><option value="leaf">叶片</option></select><p className="field-help">使用内置图标，不读取本地文件或加载外部图片。名称不修改项目标识、渠道或会话 ID。</p><Button type="submit" disabled={busy} busy={busy}>保存外观</Button></form></section>
  <section className="settings-card"><h2>模型 API</h2><p>当前保存路由：{data.model.provider}。{data.restartRequired?'配置待重启。':''}</p><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!model.trim()||!baseURL.trim()){setError('请填写模型名称和 API 地址。');document.getElementById(!baseURL.trim()?'model-endpoint':'model-id')?.focus();return}setConfirm(true)}}><label htmlFor="model-api">API 协议</label><select id="model-api" value={protocol} onChange={event=>setProtocol(event.target.value)} disabled={busy}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select><label htmlFor="model-endpoint">API 地址</label><input id="model-endpoint" type="url" value={baseURL} disabled={busy} onChange={event=>setURL(event.target.value)} placeholder="https://api.example.com/v1"/><label htmlFor="model-id">模型名称</label><input id="model-id" value={model} disabled={busy} maxLength={128} onChange={event=>setModel(event.target.value)}/><p className="field-help">HTTPS 地址或本机 HTTP；不接受带账号、查询参数或密钥的地址。保存为独立 web-model 默认路由，再配置其 API Key；其它已有路由保留。正常重启后生效，不中断当前执行。</p><Button type="submit" disabled={busy} busy={busy}>保存模型配置</Button></form></section>
  {confirm&&<Confirm title="保存模型配置" onClose={()=>setConfirm(false)} onConfirm={()=>void save('model')}><p>默认模型将改为 {model}，地址 {baseURL}。此路由已保存的密钥会用于新地址。正常重启后生效；不会调用模型验证。</p></Confirm>}
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
 const [refreshKey,setRefreshKey]=useState(0);const reload=()=>{setRefreshKey(value=>value+1);query.refresh()};

 return <div className="page-content settings-page">{query.error&&<Notice error={query.error} onRetry={busyRoles?undefined:reload}/>}{query.loading&&!query.data?<Loading/>:query.data?<><Configuration key={refreshKey} data={query.data} refresh={query.refresh} onReload={reload} reloading={query.loading||busyRoles}/>{query.data.workLog&&<WorkLogEditor key={`work-log-${refreshKey}`} state={query.data.workLog} version={query.data.version} onSaved={query.refresh} onReload={reload} reloading={query.loading} onStateChange={onRoleState}/>}<div className="settings-grid">{query.data.roleModels?.roles.map(role=><RoleModelEditor key={`${role.role}-${refreshKey}`} state={role} onStateChange={onRoleState} catalog={query.data!.roleModels.catalog} version={query.data!.version} onSaved={query.refresh} onReload={reload} reloading={query.loading}/>)}</div><div className="settings-grid"><SecretEditor key={`model-${refreshKey}-${query.data.version}`} kind="model" state={query.data.secrets.model} version={query.data.version} onSaved={query.refresh}/><SecretEditor key={`github-${refreshKey}-${query.data.version}`} kind="github" state={query.data.secrets.github} version={query.data.version} onSaved={query.refresh}/></div></>:null}<p role="status">{navigationNotice}</p>{leave&&<Confirm title="离开设置" actionLabel="放弃草稿并离开" onClose={()=>setLeave(null)} onConfirm={()=>{location.hash=leave}}><p>设置还有未保存的修改，离开会丢弃这些草稿。</p></Confirm>}</div>;

}
