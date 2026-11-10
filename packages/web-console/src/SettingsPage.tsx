import {useEffect, useState, type KeyboardEvent} from 'react';
import {api, errorText, type OperatorSettings, type ChannelSettings} from './api';
import {useResource} from './hooks';
import {Button, IconButton} from './components/BoardPrimitives';
import {Loading, Notice} from './components/Shared';
import {Confirm} from './components/ConfirmDialog';
import {CustomChannelForm} from './components/CustomChannelForm';

const preventCompositionSubmit=(event:KeyboardEvent<HTMLFormElement>)=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()};

function SecretEditor({kind,state,version,onSaved}: {kind:'model'|'github';state:OperatorSettings['secrets']['model'];version:string;onSaved:()=>void}) {
 const [value,setValue]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[confirm,setConfirm]=useState<'replace'|'clear'|null>(null);
 const label=kind==='model'?'模型 API Key':'GitHub Token';
 const save=async(action:'replace'|'clear')=>{if(busy)return;setBusy(true);setError('');setFeedback('');const input=value;setValue('');setShow(false);
  try{await api(`/settings/secrets/${kind}`,{method:'PUT',body:{action,...action==='replace'?{value:input}:{},confirm:true,expectedVersion:version}});setFeedback('已保存。');onSaved()}
  catch(error){setError(errorText(error)+' 密钥输入已清空，请先重新读取状态；不会自动重试。')}finally{setBusy(false)}
 };
 return <section className="settings-card"><h3>{label}</h3><p>{state.configured?'已配置':'未配置'} · {state.writable?'安装密钥存储':'由环境提供，只读'}</p>
  <p className="field-help">{kind==='github'?'仅供已获准的完全访问 Shell 使用，保存不授予 GitHub 操作权限。':'用于当前保存的模型配置，已保存内容不会回显。'}</p>
  <form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(value.trim())setConfirm('replace');else setError('请输入新凭据。')}}>
   <label htmlFor={`secret-${kind}`}>新的{label}</label><div className="settings-secret"><input id={`secret-${kind}`} type={show?'text':'password'} autoComplete="new-password" spellCheck={false} value={value} disabled={busy||!state.writable} onChange={event=>setValue(event.target.value)} aria-describedby={`secret-${kind}-error`} aria-invalid={!!error}/><IconButton label={show?`隐藏${label}`:`显示${label}`} disabled={busy||!state.writable} onClick={()=>setShow(!show)}>{show?'隐藏':'显示'}</IconButton></div>
   <p className="field-error" id={`secret-${kind}-error`} role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
   <div className="inline-actions"><Button type="submit" busy={busy} disabled={busy||!state.writable}>替换{label}</Button><Button disabled={busy||!state.writable||!state.configured} onClick={()=>setConfirm('clear')}>清除{label}</Button></div>
  </form>
  {confirm&&<Confirm actionLabel={confirm==='clear'?'确认清除':'确认替换'} title={`${confirm==='clear'?'清除':'替换'}${label}`} onClose={()=>setConfirm(null)} onConfirm={()=>void save(confirm)}><p>{confirm==='clear'?'清除安装中保存的凭据，相关调用可能无法继续；本页无法恢复旧值，需重新填写。':'将替换当前保存的凭据，后续授权调用将使用新值。'}不会发送外部验证请求。</p></Confirm>}
 </section>;
}
function Configuration({data,refresh}: {data:OperatorSettings;refresh:()=>void}) {
 const [name,setName]=useState(data.appearance.name),[icon,setIcon]=useState(data.appearance.icon),[model,setModel]=useState(data.model.model),[baseURL,setURL]=useState(data.model.baseURL),[protocol,setProtocol]=useState(data.model.api),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[confirm,setConfirm]=useState(false);
 useEffect(()=>{setName(data.appearance.name);setIcon(data.appearance.icon);setModel(data.model.model);setURL(data.model.baseURL);setProtocol(data.model.api)},[data.version]);
 const save=async(kind:'appearance'|'model')=>{if(busy)return;setBusy(true);setError('');setFeedback('');try{await api(`/settings/${kind}`,{method:'PUT',body:{expectedVersion:data.version,...kind==='appearance'?{name,icon}:{model,api:protocol,baseURL}}});setFeedback(kind==='model'?'模型配置已保存，正常重启后生效。':'外观已保存。');refresh();window.dispatchEvent(new Event('night-settings-updated'))}catch(error){setError(errorText(error))}finally{setBusy(false)}};
 return <>
  <section className="settings-card"><h3>助手外观</h3><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!name.trim()){setError('请输入助手名称。');document.getElementById('assistant-name')?.focus();return}void save('appearance')}}><label htmlFor="assistant-name">显示名称</label><input id="assistant-name" maxLength={64} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/><label htmlFor="assistant-icon">助手图标</label><select id="assistant-icon" value={icon} disabled={busy} onChange={event=>setIcon(event.target.value as typeof icon)}><option value="moon">月亮</option><option value="star">星光</option><option value="robot">机器人</option><option value="leaf">叶片</option></select><p className="field-help">使用内置图标，不读取本地文件或加载外部图片。名称不修改项目标识、渠道或会话 ID。</p><Button type="submit" disabled={busy} busy={busy}>保存外观</Button></form></section>
  <section className="settings-card"><h3>模型 API</h3><p>当前保存路由：{data.model.provider}。{data.restartRequired?'配置待重启。':''}</p><form noValidate onKeyDown={preventCompositionSubmit} onSubmit={event=>{event.preventDefault();if(!model.trim()||!baseURL.trim()){setError('请填写模型名称和 API 地址。');document.getElementById(!baseURL.trim()?'model-endpoint':'model-id')?.focus();return}setConfirm(true)}}><label htmlFor="model-api">API 协议</label><select id="model-api" value={protocol} onChange={event=>setProtocol(event.target.value)} disabled={busy}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select><label htmlFor="model-endpoint">API 地址</label><input id="model-endpoint" type="url" value={baseURL} disabled={busy} onChange={event=>setURL(event.target.value)} placeholder="https://api.example.com/v1"/><label htmlFor="model-id">模型名称</label><input id="model-id" value={model} disabled={busy} maxLength={128} onChange={event=>setModel(event.target.value)}/><p className="field-help">HTTPS 地址或本机 HTTP；不接受带账号、查询参数或密钥的地址。保存为独立 web-model 默认路由，再配置其 API Key；其它已有路由保留。正常重启后生效，不中断当前执行。</p><Button type="submit" disabled={busy} busy={busy}>保存模型配置</Button></form></section>
  {confirm&&<Confirm title="保存模型配置" onClose={()=>setConfirm(false)} onConfirm={()=>void save('model')}><p>默认模型将改为 {model}，地址 {baseURL}。此路由已保存的密钥会用于新地址。正常重启后生效；不会调用模型验证。</p></Confirm>}
  <p role="alert">{error}</p><p role="status">{feedback}</p>
 </>;
}
function CustomChannels() {
 const query=useResource<ChannelSettings>('/settings/channels');
 const [type,setType]=useState(''),[editing,setEditing]=useState<ChannelSettings['channels'][number]|undefined>(),[formKey,setFormKey]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{const refresh=()=>query.refresh();window.addEventListener('night-settings-updated',refresh);return()=>window.removeEventListener('night-settings-updated',refresh)},[query.refresh]);
 const plugin=query.data?.items.find(item=>item.type===type);
 const select=(value:string,channel?:ChannelSettings['channels'][number])=>{setType(value);setEditing(channel);setFormKey(key=>key+1)};
 return <section className="settings-card"><h3>自定义渠道</h3><p className="field-help">仅配置管理员已安装且声明网页表单的可信插件。未声明表单时按插件说明配置；网页不安装代码。新渠道默认停用，启用后是否在线接入或待重启以保存结果为准。</p>
  {query.error&&<Notice error={query.error} onRetry={query.refresh}/>}<Button disabled={query.loading||busy} onClick={query.refresh}>重新发现插件</Button>
  {query.loading&&!query.data&&<Loading>正在发现插件…</Loading>}{query.data&&!query.data.items.length&&<p>尚无自定义插件，请由管理员安装并声明网页表单。</p>}
  <ul>{query.data?.items.map(item=><li key={item.type}>{item.name} · {item.type} · {item.configurable?'支持网页配置':'未提供网页表单'}</li>)}</ul>
  <label htmlFor="custom-channel-type">渠道插件</label><select id="custom-channel-type" value={type} disabled={busy} onChange={event=>select(event.target.value)}><option value="">选择插件</option>{query.data?.items.filter(item=>item.configurable).map(item=><option key={item.type} value={item.type}>{item.name}</option>)}</select>
  {plugin?.configurable&&query.data&&<CustomChannelForm key={formKey} plugin={plugin} snapshot={query.data} initial={editing} onSaved={query.refresh} onBusyChange={setBusy}/>}
  <ul>{query.data?.channels.map(item=><li key={item.channelId}>{item.channelId} · {item.type} · {item.enabled?'已启用':'已停用'} {item.editable&&item.config?<Button disabled={busy} onClick={()=>select(item.type,item)}>编辑 {item.channelId}</Button>:<span>运行中或未提供表单，请按插件运维说明修改</span>}</li>)}</ul>
 </section>;
}
export default function SettingsPage(){
 const query=useResource<OperatorSettings>('/settings');
 useEffect(()=>{const refresh=()=>query.refresh();window.addEventListener('night-settings-updated',refresh);return()=>window.removeEventListener('night-settings-updated',refresh)},[query.refresh]);
 const [refreshKey,setRefreshKey]=useState(0);const reload=()=>{setRefreshKey(value=>value+1);query.refresh()};
 return <div className="page-content settings-page"><div className="page-heading"><h2>设置</h2><Button onClick={reload} disabled={query.loading}>重新读取设置</Button></div>{query.error&&<Notice error={query.error} onRetry={reload}/>}<p className="field-help">设置由安装操作者管理。密钥不回显，保存不代表已验证连接。</p>{query.loading&&!query.data?<Loading/>:query.data&&!query.error?<><Configuration key={refreshKey} data={query.data} refresh={query.refresh}/><div className="settings-grid"><SecretEditor key={`model-${refreshKey}-${query.data.version}`} kind="model" state={query.data.secrets.model} version={query.data.version} onSaved={query.refresh}/><SecretEditor key={`github-${refreshKey}-${query.data.version}`} kind="github" state={query.data.secrets.github} version={query.data.version} onSaved={query.refresh}/></div></>:null}<CustomChannels/></div>;
}
