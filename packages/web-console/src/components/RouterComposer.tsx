import {useSyncExternalStore} from 'react';
import {Composer,Button} from './BoardPrimitives';
import {api,ApiError,errorText} from '../api';
import type {Drafts,Attempt} from '../chat-drafts';
interface Receipt {requestId:string;status:string;webOnly:boolean}

export function RouterComposer({endpoint,drafts}:{endpoint:string;drafts:Drafts}){
 const key='router:'+endpoint;
 const draft=useSyncExternalStore(drafts.subscribe,()=>drafts.get(key));
 const edit=(text:string)=>drafts.update(key,previous=>previous.attempt?previous:{text});
 const send=async()=>{
  const previous=drafts.get(key);
  if(previous.attempt?.state==='sending'||!previous.text.trim())return;
  const attempt:Attempt=previous.attempt??{conversationId:endpoint,requestId:crypto.randomUUID(),text:previous.text,createdAt:new Date().toISOString(),state:'sending'};
  const settle=(change:Parameters<Drafts['update']>[1])=>drafts.update(key,value=>value.attempt?.requestId===attempt.requestId?change(value):value);
  drafts.update(key,value=>({...value,attempt:{...attempt,state:'sending'},error:undefined}));
  const accepted=(receipt:Receipt)=>{if(receipt.requestId!==attempt.requestId||receipt.status!=='accepted'||receipt.webOnly!==true)throw Error('Invalid Router receipt')};
  try{
   accepted(await api<Receipt>(endpoint+'/router/messages',{method:'POST',body:{requestId:attempt.requestId,text:attempt.text}}));
   settle(()=>({text:''}));
  }catch(error){
   // A lost response is reconciled by the same durable request identity. Never
   // generate another request ID or target when retrying an uncertain send.
   if(error instanceof ApiError&&([400,401,403,413,429].includes(error.status)||error.code==='ROUTER_OPERATOR_REQUEST_CONFLICT'))settle(value=>({text:value.text,error:errorText(error)}));
   else try{accepted(await api<Receipt>(endpoint+'/router/requests/'+encodeURIComponent(attempt.requestId)));settle(()=>({text:''}));}
   catch{settle(value=>({...value,attempt:{...attempt,state:'unknown'},error:'发送结果暂时无法确认。草稿已保留，可重试发送。'}));}
  }
 };
 return <div className="composer-dock router-composer"><div>
  <p className="muted router-composer-hint">与这个渠道的 Router 对话，仅在网页回复。</p>
  <Composer value={draft.text} onChange={edit} onSend={send} busy={draft.attempt?.state==='sending'} disabled={!!draft.attempt} error={draft.error} placeholder="向 Router 询问…" />
  {draft.attempt?.state==='unknown'&&<Button className="router-composer-retry" onClick={()=>void send()}>重试发送</Button>}
 </div></div>;
}
