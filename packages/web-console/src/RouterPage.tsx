import {useState} from 'react';
import {RiLayoutRightLine} from '@remixicon/react';
import type {Overview} from './api';
import type {useResource} from './hooks';
import {IconButton} from './components/BoardPrimitives';
import {ExecutionHistory} from './components/ExecutionHistory';
import {ExecutionSearchToolbar} from './components/ExecutionSearch';
import {ActivityPanel} from './components/ActivityPanel';

export default function RouterPage({overview}:{overview:ReturnType<typeof useResource<Overview>>}){
  const [toolbar,setToolbar]=useState<HTMLDivElement|null>(null);
  const [rail,setRail]=useState(()=>window.matchMedia('(min-width: 1251px)').matches);
  return <div className="router-workspace">
    <section className="router-records" aria-label="Router">
      <div className="router-toolbar">
        <div className="router-tools">
          <div ref={setToolbar} className="router-search-slot"/>
          <IconButton label={rail?'隐藏工作动态':'显示工作动态'} aria-expanded={rail} aria-controls={rail?'activity-panel':undefined} onClick={()=>setRail(value=>!value)}><RiLayoutRightLine size={18}/></IconButton>
        </div>
      </div>
      <div className="conversation-session-records" role="region" aria-label="路由记录">
        <ExecutionSearchToolbar.Provider value={toolbar}>
          <ExecutionHistory endpoint="/router/session" router sessionKind="router" controlsTarget={null}/>
        </ExecutionSearchToolbar.Provider>
      </div>
    </section>
    {rail&&<ActivityPanel overview={overview}/>}
  </div>;
}
