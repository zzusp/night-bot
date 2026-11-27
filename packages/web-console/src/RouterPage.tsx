import {useState} from 'react';
import {RiLayoutRightLine} from '@remixicon/react';
import {ApiError,type ChatSummary,type Conversation,type Page} from './api';
import {navigate,useResource} from './hooks';
import {BoardSelect} from './components/BoardSelect';
import {EmptyState,IconButton} from './components/BoardPrimitives';
import {Loading,Notice} from './components/Shared';
import {ExecutionHistory} from './components/ExecutionHistory';
import {ExecutionSearchToolbar} from './components/ExecutionSearch';
import {ActivityPanel} from './components/ActivityPanel';

type Target = {kind:'chat'|'conversations';id:string;name:string;href:string};
function targetKey(target:Target){return target.kind+':'+target.id}

export default function RouterPage({route,channels,web}:{
  route:URL;
  channels:ReturnType<typeof useResource<{items:Conversation[]}>>;
  web:ReturnType<typeof useResource<Page<ChatSummary>>>;
}){
  const channelTargets:Target[]=(channels.error?[]:channels.data?.items??[]).map(row=>({
    kind:'conversations',id:row.id,name:row.name||'未命名渠道对话',href:`#/channels/${encodeURIComponent(row.id)}`,
  }));
  const webTargets:Target[]=(web.error?[]:web.data?.items??[]).map(row=>({
    kind:'chat',id:row.id,name:row.title||'Web 对话',href:`#/chat/${encodeURIComponent(row.id)}`,
  }));
  const listed=[...channelTargets,...webTargets];
  const requested=route.searchParams.get('conversation');
  const [initial,setInitial]=useState<string>();
  const defaultScope=initial??(!channels.loading&&!web.loading&&listed[0]?targetKey(listed[0]):undefined);
  if(!requested&&!initial&&defaultScope)setInitial(defaultScope);
  const selection=requested??defaultScope;
  const listedTarget=listed.find(item=>targetKey(item)===selection);
  const historicalId=!listedTarget && requested?.startsWith('chat:') ? requested.slice(5) : null;
  const historical=useResource<ChatSummary>(historicalId?'/chat/'+encodeURIComponent(historicalId)+'/summary':null);
  const entry=!historical.error&&historical.data?.id===historicalId?historical.data:null;
  const target=listedTarget??(entry?{kind:'chat' as const,id:entry.id,name:entry.title||'Web 对话',href:'#/chat/'+encodeURIComponent(entry.id)}:undefined);
  const options=target&&!listedTarget?[...listed,target]:listed;
  const historicalError=historical.error instanceof ApiError&&[403,404].includes(historical.error.status)?null:historical.error;
  const legacy=route.searchParams.get('history')==='legacy';
  const endpoint=target?`/${target.kind}/${encodeURIComponent(target.id)}/${legacy?'legacy-session':'session'}`:null;
  const historyHref=target?'#/router?conversation='+encodeURIComponent(targetKey(target))+(legacy?'':'&history=legacy'):null;
  const [toolbar,setToolbar]=useState<HTMLDivElement|null>(null);
  const [rail,setRail]=useState(()=>window.matchMedia('(min-width: 1251px)').matches);
  const loading=channels.loading||web.loading||historical.loading;
  return <div className="router-workspace">
    <section className="router-records" aria-label="Router">
      <div className="router-toolbar">
        <label htmlFor="router-conversation" className="sr-only">选择对话</label>
        <BoardSelect id="router-conversation" className="router-conversation-select" value={target?targetKey(target):''} disabled={!options.length}
          onChange={event=>navigate('/router?conversation='+encodeURIComponent(event.target.value))}>
          <option value="" disabled>{loading?'正在读取对话…':'选择对话'}</option>
          {options.map(item=><option value={targetKey(item)} key={targetKey(item)}>{item.name} · {item.kind==='chat'?'Web':'渠道'}</option>)}
        </BoardSelect>
        <div className="router-tools">
          {target&&<a href={target.href} className="text-link router-origin-link">原对话</a>}
          {historyHref&&<a href={historyHref} className="text-link router-origin-link">{legacy?'当前记录':'旧记录'}</a>}
          <div ref={setToolbar} className="router-search-slot"/>
          {target&&!legacy&&<IconButton label={rail?'隐藏工作动态':'显示工作动态'} aria-expanded={rail} aria-controls={rail?'activity-panel':undefined} onClick={()=>setRail(value=>!value)}><RiLayoutRightLine size={18}/></IconButton>}
        </div>
      </div>
      {channels.error&&<Notice error={channels.error} source="/conversations" onRetry={channels.refresh}/>}
      {web.error&&<Notice error={web.error} source="/chat" onRetry={web.refresh}/>}
      {historicalError&&historicalId&&<Notice error={historicalError} source="/chat" onRetry={historical.refresh}/>}
      <div className="conversation-session-records" role="region" aria-label={legacy?'旧路由记录（只读）':'路由记录'}>
        {endpoint?<ExecutionSearchToolbar.Provider value={toolbar}><ExecutionHistory key={endpoint} endpoint={endpoint} router sessionKind="router" controlsTarget={null}/></ExecutionSearchToolbar.Provider>
          :loading?<Loading>正在读取对话…</Loading>
          :<EmptyState title={selection?'所选对话暂不可用':options.length?'选择对话查看路由记录':'暂无可查看的对话'}/>}
      </div>
    </section>
    {target&&rail&&!legacy&&<ActivityPanel key={targetKey(target)} conversation={target}/>}
  </div>;
}
