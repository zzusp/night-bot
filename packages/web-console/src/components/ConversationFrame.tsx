import {useId, useState, type ReactNode} from 'react';
import {ExecutionHistory} from './ExecutionHistory';

type View = 'dialogue' | 'triage' | 'router';
const tabs: {id: View; label: string}[] = [{id: 'dialogue', label: '对话'}, {id: 'triage', label: '分诊'}, {id: 'router', label: '路由'}];

// All conversation sources share the same frame; only the Web adapter supplies a composer.
// Keep the conversation mounted so drafts, pending sends and scroll survive a tab switch.
// Only the selected internal journal polls; hiding it cancels the old reader.
export function ConversationFrame({label, channel = false, endpoint, children}: {
  label?: string; channel?: boolean; endpoint?: string; children: ReactNode;
}) {
  const prefix = useId();
  const [selection, setSelection] = useState<{endpoint?: string; view: View}>({endpoint, view: 'dialogue'});
  const view = selection.endpoint === endpoint ? selection.view : 'dialogue';
  const select = (value: View) => setSelection({endpoint, view: value});
  return <section className={`chat-page conversation-page${channel ? ' channel-chat' : ''}${endpoint ? ' conversation-with-tabs' : ''}`} aria-label={label || 'Web 对话'}>
    {endpoint ? <>
      <div className="conversation-session-tabs" role="tablist" aria-label="会话记录">
        {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${prefix}-${tab.id}`} aria-controls={`${prefix}-panel-${tab.id}`} aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1}
          onClick={() => select(tab.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); select(tabs[next].id); document.getElementById(`${prefix}-${tabs[next].id}`)?.focus();
          }}>{tab.label}</button>)}
      </div>
      <div className="conversation-tab-content" role="tabpanel" id={`${prefix}-panel-dialogue`} aria-labelledby={`${prefix}-dialogue`} hidden={view !== 'dialogue'}>{children}</div>
      {tabs.slice(1).map(tab => <div key={tab.id} className="conversation-tab-content conversation-session-records" role="tabpanel" id={`${prefix}-panel-${tab.id}`} aria-labelledby={`${prefix}-${tab.id}`} hidden={view !== tab.id} tabIndex={0}>
        {view === tab.id && <ExecutionHistory key={`${endpoint}:${tab.id}`} endpoint={`${endpoint}/${tab.id === 'triage' ? 'triage/session' : 'session'}`} router controlsTarget={null} />}
      </div>)}
    </> : children}
  </section>;
}
