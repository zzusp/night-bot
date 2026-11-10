import {useEffect, useRef, useState} from 'react';
import {api, ApiError, errorText, type OperatorSettings, type WorkLogSelection, type WorkLogState} from '../api';
import {Button} from './BoardPrimitives';

const same=(a:WorkLogSelection,b:WorkLogSelection)=>a.enabled===b.enabled&&a.time===b.time&&a.timezone===b.timezone;
const describe=(value:WorkLogSelection)=>`${value.enabled?'已开启':'已关闭'} · 每天 ${value.time} · ${value.timezone==='local'?'服务器本地时区':value.timezone}`;
const validTimezone=(value:string)=>{if(value==='local')return true;if(!value||value!==value.trim())return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}};
export function WorkLogEditor({state,version,onSaved,onReload,reloading,onStateChange}:{state:WorkLogState;version:string;onSaved:()=>void;onReload:()=>void;reloading:boolean;onStateChange:(key:string,dirty:boolean,busy:boolean)=>void}){
 const [draft,setDraft]=useState(state.saved),[draftVersion,setDraftVersion]=useState(version),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[pendingVersion,setPendingVersion]=useState<string|null>(null);
 const inFlight=useRef(false),mounted=useRef(true),pendingBase=useRef(version);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{if(pendingVersion&&version===pendingBase.current&&version!==pendingVersion)return;if(pendingVersion)setPendingVersion(null);if(!dirty&&!busy&&!locked){setDraft(state.saved);setDraftVersion(version)}},[version,state.saved,dirty,busy,locked,pendingVersion]);
 useEffect(()=>{onStateChange('work-log',dirty,busy);return()=>onStateChange('work-log',false,false)},[dirty,busy,onStateChange]);
 const stale=dirty&&draftVersion!==version,disabled=busy||locked||stale||!!pendingVersion;
 const change=(patch:Partial<WorkLogSelection>)=>{if(!dirty)setDraftVersion(version);setDraft({...draft,...patch});setDirty(true);setError('');setFeedback('')};
 const invalidTime=!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time),invalidZone=!validTimezone(draft.timezone);
 const save=async()=>{
  if(disabled||inFlight.current)return;
  if(invalidTime||invalidZone){setError(invalidTime?'请填写 00:00 至 23:59 的 24 小时时间。':'请填写 local 或有效的 IANA 时区，例如 Asia/Shanghai。');document.getElementById(invalidTime?'work-log-time':'work-log-timezone')?.focus();return}
  inFlight.current=true;setBusy(true);setError('');setFeedback('');
  try{
   const receipt=await api<{ok:boolean;version:string;changed:boolean;workLog:WorkLogState}>('/settings/work-log',{method:'PUT',body:{...draft,expectedVersion:draftVersion}});
   if(!receipt?.ok||typeof receipt.version!=='string'||typeof receipt.changed!=='boolean'||!receipt.workLog||!same(receipt.workLog.saved,draft))throw new Error('UNKNOWN_SAVE');
   const latest=await api<OperatorSettings>('/settings');
   if(latest.version!==receipt.version||!latest.workLog||!same(latest.workLog.saved,draft))throw new Error('UNKNOWN_SAVE');
   if(!mounted.current)return;
   pendingBase.current=draftVersion;setPendingVersion(receipt.version);setDraftVersion(receipt.version);setDirty(false);
   setFeedback(receipt.workLog.environmentOverrides.length?'工作日志配置已保存。环境变量仍会覆盖对应字段，请核对后正常重启。':receipt.changed?'工作日志配置已保存，正常重启后生效。':'工作日志配置未变化。');onSaved();
  }catch(cause){if(!mounted.current)return;const rejected=cause instanceof ApiError&&cause.status===400;setLocked(!rejected);setError(rejected?errorText(cause):'无法确认最新保存结果。草稿已保留，不会自动重试，请重新读取设置并核对。')}
  finally{inFlight.current=false;if(mounted.current)setBusy(false)}
 };
 return <section className="settings-card" aria-labelledby="work-log-title"><h2 id="work-log-title">每日工作日志</h2>
  <p>当前运行：{describe(state.running)}</p><p>当前保存：{describe(state.saved)}</p>
  {state.restartRequired&&<p className="field-help">下次启动配置与当前运行不同，需正常重启。</p>}
  {state.environmentOverrides.length>0&&<div className="role-model-environment"><p>环境变量优先于保存配置，重启仍会覆盖对应字段。</p>{state.nextStart?<p>按当前环境重启：{describe(state.nextStart)}</p>:<p role="alert">当前环境变量无效，请修改或移除后再重启。</p>}<ul>{state.environmentOverrides.map(item=><li key={item.name}>{item.name}</li>)}</ul></div>}
  <form noValidate onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229))event.preventDefault()}} onSubmit={event=>{event.preventDefault();void save()}}>
   <label htmlFor="work-log-enabled">自动记录</label><select id="work-log-enabled" disabled={disabled} value={String(draft.enabled)} onChange={event=>change({enabled:event.target.value==='true'})}><option value="true">开启</option><option value="false">关闭</option></select>
   <label htmlFor="work-log-time">每天执行时间（24 小时制）</label><input id="work-log-time" value={draft.time} maxLength={5} placeholder="23:59" disabled={disabled} onChange={event=>change({time:event.target.value})} aria-invalid={!!error&&invalidTime} aria-describedby="work-log-help work-log-error"/>
   <label htmlFor="work-log-timezone">执行时区</label><input id="work-log-timezone" value={draft.timezone} maxLength={128} placeholder="local" disabled={disabled} onChange={event=>change({timezone:event.target.value})} aria-invalid={!!error&&invalidZone} aria-describedby="work-log-help work-log-error"/>
   <p className="field-help" id="work-log-help">默认每天 23:59；local 跟随 Bot 服务器时区，不是浏览器时区。可填写 Asia/Shanghai 等 IANA 时区。有消息或工作才记录，以 Markdown 按年/月保存到安装数据目录的 work-logs。正常重启后生效，不中断当前执行。</p>
   {stale&&!locked&&<p role="alert">设置已变化，草稿未被覆盖。请重新读取设置后再编辑。</p>}
   <p className="field-error" id="work-log-error" role={error?'alert':undefined}>{error}</p><p role="status">{feedback}</p>
   <Button type="submit" busy={busy} disabled={disabled}>保存工作日志配置</Button>
   {(stale||locked)&&<Button disabled={busy||reloading} busy={reloading} onClick={onReload}>重新读取设置并替换草稿</Button>}
  </form>
 </section>;
}
