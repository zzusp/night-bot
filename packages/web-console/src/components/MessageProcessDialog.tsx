import { useEffect, useId, useRef, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { ApiError, type Message } from '../api';
import { useResource } from '../hooks';
import { IconButton } from './BoardPrimitives';
import { ConversationRecords, type TaskHistory } from './ConversationRecords';
import { ResponseTimes } from './ResponseTimes';
import { Notice } from './Shared';

export function MessageProcessDialog({ endpoint, message, trigger, onDismiss, onAccessRevoked }: {
  endpoint: string; message: Message; trigger: HTMLButtonElement; onDismiss: () => void; onAccessRevoked: (error: Error) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [recordsOpen, setRecordsOpen] = useState(false);
  const records = useResource<TaskHistory>(recordsOpen ? `${endpoint}${endpoint.startsWith('/chat/') ? '' : '/tasks'}` : null, 2500);
  const recordsRevoked = records.error instanceof ApiError && [401, 403, 404].includes(records.error.status);
  useEffect(() => { if (recordsRevoked && records.error) onAccessRevoked(records.error); }, [recordsRevoked, records.error, onAccessRevoked]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger.isConnected && !document.querySelector('dialog[open]')) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);
  return <dialog ref={dialog} className="message-process-dialog" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }}>
    <header className="message-process-heading"><h2 id={title}>消息处理过程</h2><IconButton label="关闭消息处理过程" autoFocus onClick={onDismiss}><RiCloseLine size={20} /></IconButton></header>
    <div className="message-process-body">
      {recordsRevoked ? <Notice error={records.error} /> : <>
      <ResponseTimes endpoint={endpoint} message={message} onAccessRevoked={onAccessRevoked} />
      <details className="message-conversation-records" open={recordsOpen} onToggle={event => setRecordsOpen(event.currentTarget.open)}>
        <summary>本会话的任务与安排</summary>
        {recordsOpen && <><p className="message-process-scope">以下记录属于整个会话，不表示都由这条消息触发。</p><ConversationRecords endpoint={endpoint} query={records} /></>}
      </details>
      </>}
    </div>
  </dialog>;
}
