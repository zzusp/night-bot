import {useEffect, useRef, useState} from 'react';
import {api, ApiError, errorText, type ModelCatalog, type ModelCatalogSaved, type ModelProvider} from '../api';
import {Button} from './BoardPrimitives';
import {Confirm} from './ConfirmDialog';

const protocols:Record<string,string>={'openai-completions':'OpenAI Chat Completions','openai-responses':'OpenAI Responses','anthropic-messages':'Anthropic Messages'};
type Draft={provider:string;api:string;baseURL:string;model:string};
export function ProviderApiEditor({provider,version,onSaved,onStateChange,disabled=false,onCancel}:{provider?:ModelProvider;version:string;onSaved:(provider?:string)=>void;onStateChange:(key:string,dirty:boolean,busy:boolean)=>void;disabled?:boolean;onCancel?:()=>void}) {
 const initial=():Draft=>({provider:provider?.provider??'',api:provider?.api??'openai-completions',baseURL:provider?.baseURL??'',model:''});
 const [draft,setDraft]=useState<Draft>(initial),[base,setBase]=useState<Draft>(initial),[draftVersion,setDraftVersion]=useState(version),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[field,setField]=useState(''),[feedback,setFeedback]=useState(''),[confirmation,setConfirmation]=useState<{body:Record<string,string>;draft:Draft}|null>(null);
 const inFlight=useRef(false),mounted=useRef(true),pendingVersion=useRef<string|null>(null),creating=!provider;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{if(pendingVersion.current&&pendingVersion.current!==version)return;pendingVersion.current=null;if(!dirty&&!busy&&!locked){const next=initial();setDraft(next);setBase(next);setDraftVersion(version)}},[provider,version,dirty,busy,locked]);
 useEffect(()=>{onStateChange('provider-api',dirty||locked||creating,busy);return()=>onStateChange('provider-api',false,false)},[dirty,locked,creating,busy,onStateChange]);
 const stale=dirty&&draftVersion!==version,blocked=disabled||busy||locked||stale;
 const change=(key:keyof Draft,value:string)=>{if(!dirty)setDraftVersion(version);setDraft({...draft,[key]:value});setDirty(true);setError('');setField('');setFeedback('')};
 const invalid=(key:string,message:string)=>{setField(key);setError(message);document.getElementById(key)?.focus()};
 const submit=()=>{
  if(blocked)return;
  if(creating&&!/^[a-z][a-z0-9-]{0,63}$/.test(draft.provider))return invalid('provider-id','路由标识须以小写字母开头，最多 64 个小写字母、数字或连字符。');
  if(creating&&(!draft.model||draft.model.trim()!==draft.model||/[\x00-\x1f\x7f]/.test(draft.model)))return invalid('provider-first-model','请填写准确的首个模型 ID，不要包含首尾空格或控制字符。');
  if(creating||draft.baseURL!==base.baseURL){try{if(draft.baseURL){const url=new URL(draft.baseURL);if(url.username||url.password||url.href.includes('?')||url.href.includes('#')||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error();}else if(creating)throw new Error()}catch{return invalid('provider-endpoint','请填写 HTTPS 或本机 HTTP 地址，不要包含账号、查询参数或密钥。')}}
  const body:Record<string,string>={provider:draft.provider,expectedVersion:draftVersion,...creating?{action:'create',model:draft.model,api:draft.api,baseURL:draft.baseURL}:{...draft.api!==base.api?{api:draft.api}:{},...draft.baseURL!==base.baseURL?{baseURL:draft.baseURL}:{}}};
  setConfirmation({body,draft:{...draft}});
 };
 const save=async(snapshot:{body:Record<string,string>;draft:Draft})=>{
  if(inFlight.current||blocked)return;inFlight.current=true;setBusy(true);setError('');setFeedback('');let acknowledged=false;
  try{
   const receipt=await api<ModelCatalogSaved>('/settings/provider',{method:'PUT',body:snapshot.body});
   if(receipt?.ok!==true||typeof receipt.changed!=='boolean'||typeof receipt.version!=='string'||typeof receipt.restartRequired!=='boolean'||receipt.liveApplied!==false)throw new Error('UNKNOWN_SAVE');acknowledged=true;
   const latest=await api<ModelCatalog>('/settings/model-catalog'),saved=latest.providers.find(row=>row.provider===snapshot.body.provider);
   const expectedURL=snapshot.body.baseURL?new URL(snapshot.body.baseURL).href.replace(/\/$/,''):'';
   if(latest.version!==receipt.version||!saved||snapshot.body.api!==undefined&&saved.api!==snapshot.body.api||snapshot.body.baseURL!==undefined&&saved.baseURL!==expectedURL||creating&&!saved.models.some(row=>row.id===snapshot.body.model))throw new Error('UNKNOWN_SAVE');
   if(!mounted.current)return;
   pendingVersion.current=latest.version;setDirty(false);setDraftVersion(latest.version);setBase({...snapshot.draft,api:saved.api,baseURL:saved.baseURL});setDraft({...snapshot.draft,api:saved.api,baseURL:saved.baseURL});setFeedback(receipt.changed?'API 配置已保存，正常重启后生效。':'API 配置未变化。');onSaved(creating?saved.provider:undefined);
  }catch(cause){if(!mounted.current)return;const rejected=!acknowledged&&cause instanceof ApiError&&(cause.status===400||cause.status===409&&cause.code==='SETTINGS_MODEL_EXISTS');setLocked(!rejected);setError(rejected?(creating&&cause instanceof ApiError&&cause.code==='SETTINGS_MODEL_EXISTS'?'此路由标识已存在，请使用其它标识。':errorText(cause)):`${cause instanceof ApiError&&cause.code==='SETTINGS_VERSION_CONFLICT'?errorText(cause):'无法确认最新保存结果。'} 草稿已保留，不会自动重试。请重新读取路由配置并核对。`)}finally{inFlight.current=false;if(mounted.current)setBusy(false)}
 };
 return <section className="provider-api" aria-label={creating?'添加路由':'模型 API'}>
  <h3>{creating?'添加路由':'模型 API'}</h3>
  <form noValidate onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()}} onSubmit={event=>{event.preventDefault();submit()}}>
   {creating&&<><label htmlFor="provider-id">路由标识</label><input id="provider-id" value={draft.provider} maxLength={64} disabled={blocked} onChange={event=>change('provider',event.target.value)} aria-invalid={field==='provider-id'} aria-describedby="provider-api-error"/></>}
   <label htmlFor="provider-api">API 协议</label><select id="provider-api" value={draft.api} disabled={blocked} onChange={event=>change('api',event.target.value)} aria-describedby="provider-api-help provider-api-error">{!creating&&<option value="">沿用服务商默认</option>}{draft.api&&!protocols[draft.api]&&<option value={draft.api}>{draft.api}（保留已有协议）</option>}{Object.entries(protocols).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <label htmlFor="provider-endpoint">API 地址</label><input id="provider-endpoint" type="url" value={draft.baseURL} maxLength={1024} disabled={blocked} onChange={event=>change('baseURL',event.target.value)} placeholder={provider?.baseURLConfigured&&!provider.baseURL?'已有地址包含私密参数，不回显':'https://api.example.com/v1'} aria-invalid={field==='provider-endpoint'} aria-describedby="provider-api-help provider-api-error"/>
   {creating&&<><label htmlFor="provider-first-model">首个模型 ID</label><input id="provider-first-model" value={draft.model} maxLength={256} disabled={blocked} onChange={event=>change('model',event.target.value)} aria-invalid={field==='provider-first-model'} aria-describedby="provider-api-error"/></>}
   <p id="provider-api-help" className="field-help">{creating?'创建后在本卡继续配置密钥与更多模型。':'地址留空可沿用服务商默认；自定义路由需明确地址与协议。'} HTTPS 或本机 HTTP，不接受账号、查询参数或密钥。{provider?.baseURLConfigured&&!provider.baseURL?'现有私密地址不回显；未修改地址时会保留。':''} 保存不改变默认或角色模型，正常重启后生效。</p>
   {stale&&!locked&&<p role="alert">设置已变化，草稿未被覆盖。请重新读取路由配置后再编辑。</p>}
   <p id="provider-api-error" className="field-error" role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
   <div className="inline-actions"><Button type="submit" variant="primary" busy={busy} disabled={blocked||!creating&&!dirty}>{creating?'创建路由':'保存 API 配置'}</Button>{onCancel&&<Button disabled={busy||locked} onClick={onCancel}>取消添加路由</Button>}</div>
  </form>
  {confirmation&&<Confirm title={creating?'创建路由':'保存 API 配置'} onClose={()=>setConfirmation(null)} onConfirm={()=>void save(confirmation)}><p>路由：{confirmation.draft.provider}。{confirmation.body.baseURL!==undefined?`地址：${confirmation.draft.baseURL||'服务商默认地址'}。`:'保留当前地址。'}{creating?'创建后需为此路由配置凭据。':'此路由的已有凭据将用于保存后的地址。'}正常重启后生效，不中断当前执行，不会调用模型验证。</p></Confirm>}
 </section>;
}
