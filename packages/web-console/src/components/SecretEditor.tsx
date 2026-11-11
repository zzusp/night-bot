import {useEffect, useRef, useState} from 'react';
import {api, errorText, type SecretState} from '../api';
import {Button, IconButton} from './BoardPrimitives';
import {Confirm} from './ConfirmDialog';

export function SecretEditor({kind,provider,state,version,onSaved,onStateChange,disabled=false,embedded=false}: {kind:'model'|'github';provider?:string;state:SecretState;version:string;onSaved:()=>void;onStateChange:(key:string,dirty:boolean,busy:boolean)=>void;disabled?:boolean;embedded?:boolean}) {
 const [value,setValue]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[confirm,setConfirm]=useState<{action:'replace'|'clear';version:string}|null>(null);
 const inFlight=useRef(false),mounted=useRef(true),draftVersion=useRef(version);
 const label=kind==='model'?'模型 API Key':'GitHub Token',key=`secret-${kind}`,blocked=disabled||busy||locked||!state.writable,stale=!!value&&draftVersion.current!==version;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{onStateChange(key,!!value||locked,busy);return()=>onStateChange(key,false,false)},[key,value,locked,busy,onStateChange]);
 const save=async(action:'replace'|'clear',expectedVersion:string)=>{if(inFlight.current||blocked||stale)return;inFlight.current=true;setBusy(true);setError('');setFeedback('');const input=value;setValue('');setShow(false);
  try{const result=await api<{ok:boolean;state:SecretState}>(`/settings/secrets/${kind}`,{method:'PUT',body:{action,...provider?{provider}:{},...action==='replace'?{value:input}:{},confirm:true,expectedVersion}});if(result?.ok!==true||typeof result.state?.configured!=='boolean'||result.state.configured!==(action==='replace'))throw new Error('UNKNOWN_SAVE');if(mounted.current){setFeedback('已保存。');onSaved()}}
  catch(cause){if(mounted.current){setLocked(true);setError(errorText(cause)+' 密钥输入已清空，请先重新读取状态；不会自动重试。')}}finally{inFlight.current=false;if(mounted.current)setBusy(false)}
 };
 return <section className={embedded?'provider-secret':'settings-card'} aria-label={label}>
  {embedded?<h3>{label}</h3>:<h2>{label}</h2>}<p>{state.configured?'已配置':'未配置'} · {state.writable?'安装密钥存储':'由环境提供，只读'}</p>
  <p className="field-help">{kind==='github'?'仅供已获准的完全访问 Shell 使用，保存不授予 GitHub 操作权限。':`用于 ${provider} 路由下的模型，已保存内容不会回显。`}</p>
  {!!state.sharedWith?.length&&<p className="field-help">此凭据还供 {state.sharedWith.join('、')} 使用；替换或清除会同时影响这些路由。</p>}
  <form noValidate onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()}} onSubmit={event=>{event.preventDefault();if(blocked||stale)return;if(value.trim())setConfirm({action:'replace',version:draftVersion.current});else{setError('请输入新凭据。');document.getElementById(key)?.focus()}}}>
   <label htmlFor={key}>新的{label}</label><div className="settings-secret"><input id={key} type={show?'text':'password'} autoComplete="new-password" spellCheck={false} value={value} disabled={blocked||stale} onChange={event=>{if(!value)draftVersion.current=version;setValue(event.target.value);setError('');setFeedback('')}} aria-describedby={`${key}-error`} aria-invalid={!!error}/><IconButton label={show?`隐藏${label}`:`显示${label}`} disabled={blocked||stale} onClick={()=>setShow(!show)}>{show?'隐藏':'显示'}</IconButton></div>
   {stale&&<p role="alert">设置已变化，请重新读取设置后再填写凭据。</p>}
   <p className="field-error" id={`${key}-error`} role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
   <div className="inline-actions"><Button type="submit" busy={busy} disabled={blocked||stale}>替换{label}</Button><Button disabled={blocked||stale||!state.configured} onClick={()=>setConfirm({action:'clear',version})}>清除{label}</Button></div>
  </form>
  {confirm&&<Confirm actionLabel={confirm.action==='clear'?'确认清除':'确认替换'} title={`${confirm.action==='clear'?'清除':'替换'}${label}`} onClose={()=>setConfirm(null)} onConfirm={()=>void save(confirm.action,confirm.version)}><p>{provider?`路由：${provider}。`:''}{confirm.action==='clear'?'清除安装中保存的凭据，相关调用可能无法继续；本页无法恢复旧值，需重新填写。':'将替换当前保存的凭据，后续授权调用将使用新值。'}不会发送外部验证请求。</p>{!!state.sharedWith?.length&&<p>同时影响共用此凭据的路由：{state.sharedWith.join('、')}。</p>}</Confirm>}
 </section>;
}
