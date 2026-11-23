import {useEffect,useRef,useState} from 'react';
import {api,ApiError,errorText} from '../api';
import {Button} from './BoardPrimitives';
import {Loading} from './Shared';

type Snapshot={text:string;version:string};
const labels={
 router:{title:'Router 工作原则',scope:'仅 Router 会话使用。',saved:'Router 下一轮生效'},
 execution:{title:'执行会话工作原则',scope:'仅任务执行会话使用。',saved:'执行会话下次刷新上下文时生效'},
} as const;
type Role=keyof typeof labels;

export function WorkPrinciplesEditor({role,active,onStateChange}:{role:Role;active:boolean;onStateChange:(key:string,dirty:boolean,busy:boolean,locked?:boolean)=>void}){
 const key=`${role}-principles`,path=`/settings/${key}`,{title,scope,saved:savedHint}=labels[role];
 const [saved,setSaved]=useState<Snapshot|null>(null),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [recovery,setRecovery]=useState<'conflict'|'unknown'|null>(null),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
 const started=useRef(false),operation=useRef(false),mounted=useRef(true);
 const editText=(text:string)=>text.replace(/\r\n?/g,'\n');
 const dirty=!!saved&&draft!==editText(saved.text);
 const locked=recovery==='unknown';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 useEffect(()=>{onStateChange(key,dirty,busy,locked);return()=>onStateChange(key,false,false)},[onStateChange,key,dirty,busy,locked]);
 const reload=async()=>{
  if(operation.current)return;
  operation.current=true;setLoading(true);setError('');setFeedback('');
  try{
   const latest=await api<Snapshot>(path);
   if(mounted.current){setSaved(latest);setDraft(editText(latest.text));setRecovery(null)}
  }catch(cause){if(mounted.current)setError(errorText(cause))}
  finally{operation.current=false;if(mounted.current)setLoading(false)}
 };
 useEffect(()=>{if(active&&!started.current){started.current=true;void reload()}},[active]);
 const save=async()=>{
  if(!saved||!dirty||recovery||operation.current)return;
  operation.current=true;setBusy(true);setError('');setFeedback('');
  try{
   const receipt=await api<Snapshot>(path,{method:'PUT',body:{text:draft,expectedVersion:saved.version}});
   const latest=await api<Snapshot>(path);
   if(latest?.version!==receipt?.version||latest?.text!==draft)throw new Error('UNKNOWN_SAVE');
   if(mounted.current){setSaved(latest);setFeedback(`已保存。${savedHint}，无需重启。`)}
  }catch(cause){
   if(!mounted.current)return;
   if(cause instanceof ApiError&&cause.code==='SETTINGS_VERSION_CONFLICT'){
    setRecovery('conflict');setError('文件已被其他操作修改，未覆盖新版本。草稿已保留。');
   }else if(cause instanceof ApiError&&[400,413].includes(cause.status))setError('正文须为有效 UTF-8 文本，不超过 64 KiB。');
   else{setRecovery('unknown');setError('无法确认保存结果。草稿已保留，请重新读取核对。')}
  }finally{operation.current=false;if(mounted.current)setBusy(false)}
 };
 return <section className="settings-card settings-principles-card" aria-labelledby={`${key}-title`}>
  <h2 id={`${key}-title`}>{title}</h2>
  <p className="settings-principles-help" id={`${key}-help`}>{scope}留空则不加载。请勿填写凭据。</p>
  {!saved&&loading&&<div className="settings-principles-loading"><Loading/></div>}
  {saved&&<form noValidate onSubmit={event=>{event.preventDefault();void save()}}>
   <label htmlFor={`${key}-text`}>AGENTS.md 正文（Markdown）</label>
   <textarea id={`${key}-text`} aria-describedby={`${key}-help`} rows={7} value={draft} disabled={busy||loading} onChange={event=>{setDraft(event.target.value);setFeedback('');if(!recovery)setError('')}}/>
   <Button type="submit" busy={busy} disabled={!dirty||busy||loading||!!recovery}>保存</Button>
  </form>}
  {error&&<p className="field-error" role="alert">{error}</p>}
  {feedback&&<p role="status">{feedback}</p>}
  {(!saved||recovery)&&!loading&&<Button variant="secondary" onClick={()=>void reload()}>{saved?'重新读取并替换草稿':'重新读取'}</Button>}
 </section>;
}
