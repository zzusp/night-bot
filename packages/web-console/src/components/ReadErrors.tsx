import {createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {RiErrorWarningLine, RiRefreshLine} from '@remixicon/react';
import {ApiError, errorText, readErrorSource} from '../api';
import {readErrorLabel} from '../read-errors';
import {Button} from './BoardPrimitives';
type Failure = {error: unknown; retry?: () => void; retryKey?: () => void; stale?: boolean; message?: string; title?: string; source?: string};
function createStore() {
 let snapshot: ReadonlyArray<[string, Failure]> = [];
 const entries = new Map<string, Failure>(), listeners = new Set<() => void>();
 const publish = () => {snapshot = [...entries]; listeners.forEach(fn => fn());};
 return {subscribe: (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};}, snapshot: () => snapshot,
 set(id: string, value: Failure) {entries.set(id, value); publish();}, remove(id: string) {if(entries.delete(id)) publish();}};
}
const errorIds=new WeakMap<object,number>(); let nextErrorId=0;
function errorIdentity(error:unknown,fallback:string){if(!error||typeof error!=='object')return fallback;if(!errorIds.has(error))errorIds.set(error,++nextErrorId);return String(errorIds.get(error));}
const Scope = createContext<ReturnType<typeof createStore> | null>(null);
const Active = createContext(true);
export function ReadErrorScope({children}: {children: ReactNode}) {const [store] = useState(createStore); return <Scope.Provider value={store}>{children}</Scope.Provider>;}
export function ReadErrorVisibility({active, children}: {active: boolean; children: ReactNode}) {const parent=useContext(Active);return <Active.Provider value={parent && active}>{children}</Active.Provider>;}
/** Explicit read ownership; callbacks stay fresh without effect churn or render updates. */
export function useReadFailure(value: Failure, enabled = true) {
 const store=useContext(Scope), active=useContext(Active), id=useId(), retry=useRef(value.retry);retry.current=value.retry;
 const hasRetry=!!value.retry;
 useEffect(()=>{if(!store || !active || !enabled || !value.error)return;
  store.set(id,{...value,retryKey:value.retry,retry:hasRetry?()=>retry.current?.():undefined});return()=>store.remove(id);
 },[store,active,enabled,id,value.error,value.stale,value.message,value.title,value.source,hasRetry]);
 return !!store;
}
export function ReadErrorOutlet() {
 const store=useContext(Scope);if(!store)return null;
 return <Outlet store={store}/>;
}
function Outlet({store}: {store: ReturnType<typeof createStore>}) {
 const entries=useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot),[busy,setBusy]=useState(false);
 const rows=new Map<string,{value:Failure; retries:Map<()=>void,()=>void>}>();
 for(const [id,value] of entries){
  const source=value.source ?? readErrorSource(value.error);
  const code=value.error instanceof ApiError?`${value.error.status}:${value.error.code}`:value.error instanceof DOMException?value.error.name:'read';
  // Only the same resource + typed failure is shared. Equal status alone is not a cause.
  const key=source?`${source}\0${code}`:errorIdentity(value.error,id);
  const row=rows.get(key) ?? {value:{...value,source},retries:new Map<()=>void,()=>void>()};
  row.value={...row.value,stale:row.value.stale || value.stale,title:value.title ?? row.value.title,message:value.message ?? row.value.message};
  if(value.retry)row.retries.set(value.retryKey ?? value.retry,value.retry);rows.set(key,row);
 }
 if(!rows.size)return null;
 const values=[...rows.values()], retries=[...new Map(values.flatMap(row=>[...row.retries])).values()];
 const retry=async()=>{if(busy)return;setBusy(true);try{await Promise.allSettled(retries.map(fn=>Promise.resolve().then(fn)));}finally{setBusy(false);}};
 const permission = values.filter(({value})=>value.error instanceof ApiError && [401,403,404].includes(value.error.status));
 const stale = values.some(({value})=>value.stale);
 const labels = [...new Set(values.map(({value})=>readErrorLabel(value.source).replace('任务复盘','复盘')))];
 const order=['任务','执行记录','复盘']; labels.sort((a,b)=>(order.includes(a)?order.indexOf(a):10)-(order.includes(b)?order.indexOf(b):10));
 const areas=labels.length>3?`${labels.length}项内容`:labels.length>1?`${labels.slice(0,-1).join('、')}和${labels.at(-1)}`:labels[0];
 const generic=new Set(['暂时无法获取数据，请重试。','更新失败，当前显示上次记录','读取失败','读取失败 · 上次快照','部分工作动态暂不可读。']);
 const reasons=[...new Set(values.map(({value})=>value.message ?? errorText(value.error)).filter(text=>!generic.has(text)))];
 const title=permission.length ? '部分内容无法访问' : stale ? '部分内容未更新' : values.length===1 && values[0].value.title ? values[0].value.title : '内容暂不可用';
 const description=values.length===1 && reasons.length ? reasons[0] : `${areas}${stale?'暂未更新。':'暂时无法读取。'}`;
 const details=values.length>1?reasons:[];
 return <section className="read-error-summary" role="alert" aria-label="读取状态汇总" data-affected-count={values.length}>
  <span className="read-error-symbol"><RiErrorWarningLine size={20} aria-hidden="true"/></span>
  <div className="read-error-copy"><h2>{title}</h2><p>{description}</p>
   {details.map(text=><p className="read-error-reason" key={text}>{text}</p>)}
   {retries.length>0 && <Button variant="ghost" disabled={busy} onClick={()=>void retry()} icon={<RiRefreshLine size={14}/>}>重试</Button>}
  </div>
 </section>;
}
