import {useEffect,useState} from 'react';
import {ApiError} from '../api';
import {useResource} from '../hooks';
import {Button} from './BoardPrimitives';
import {Loading,Notice} from './Shared';
interface ReplyTiming {messageId:string;preview:string;status:string;receivedAt:string|null;firstReplyAt:string|null;durationMs:number|null;reason:string|null;replyPreview?:string|null;steps:{label:string;at:string}[]}
interface TimingPage {status:string;items:ReplyTiming[];nextOffset:number|null;total:number}
const exactTime=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}).format(new Date(value)):'未记录';
const labels:Record<string,string>={confirmed:'首答已确认',unavailable:'历史记录不足','invalid-time':'时间记录异常',unconfirmed:'回复尚未确认可见',failed:'回复发送失败',pending:'等待发送','no-reply':'尚无可核实的首答'};
export function ResponseTimes({endpoint}:{endpoint:string}){
 const [offset,setOffset]=useState(0);const query=useResource<TimingPage>(`${endpoint}/response-times?offset=${offset}&limit=20`,offset?0:2500);
 const revoked=query.error instanceof ApiError&&[401,403,404].includes(query.error.status);const [denied,setDenied]=useState(false);useEffect(()=>{if(revoked)setDenied(true)},[revoked]);useEffect(()=>{if(!query.error&&query.updatedAt)setDenied(false)},[query.updatedAt]);const data=revoked||denied?null:query.data;
 return <section className="response-times" aria-label="消息首答与处理过程"><header><h2>消息首答</h2><p>从 Host 接收至首条承接／直接答复确认可见；不含任务后续结果。时间缺失或用途不明不计算；Web 仅覆盖当前保留的消息窗口。</p></header>
 {query.error&&<Notice error={query.error} stale={!!data} onRetry={query.refresh}/>}
 {!data?query.loading?<Loading>正在读取消息处理记录…</Loading>:<p>首答记录暂不可读。</p>:data.status!=='ready'?<p>当前 Host 未提供首答记录。</p>:<>
 {!data.items.length&&<p className="muted">尚无可核实的入站消息。</p>}
 {data.items.map(row=><details className="response-time-row" key={row.messageId}><summary><span>{row.preview||'消息正文未提供'}</span><strong>{row.durationMs!==null?`${(row.durationMs/1000).toLocaleString('zh-CN',{maximumFractionDigits:2})} 秒`:(labels[row.status]||'记录不足')}</strong></summary><p>{row.reason||labels[row.status]}</p>{row.replyPreview&&<p><strong>首条回复：</strong>{row.replyPreview}</p>}<dl><dt>Host 接收</dt><dd>{exactTime(row.receivedAt)}</dd><dt>首答确认</dt><dd>{exactTime(row.firstReplyAt)}</dd></dl><ol>{row.steps.map((step,index)=><li key={index}>{step.label} <time dateTime={step.at}>{exactTime(step.at)}</time></li>)}</ol></details>)}
 <div className="execution-pagination">{offset>0&&<Button onClick={()=>setOffset(0)}>回到最新</Button>}{data.nextOffset!==null&&<Button onClick={()=>setOffset(data.nextOffset!)}>更早消息</Button>}</div></>}
 </section>
}
