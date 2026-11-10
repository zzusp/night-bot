import { useEffect, useState, type ComponentProps } from 'react';
import { ApiError, type Message } from '../api';
import { MessageList, Notice } from './Shared';
import { MessageProcessDialog } from './MessageProcessDialog';

export function ConversationMessages({ endpoint, accessError, accessUpdatedAt, onRefresh, ...props }: ComponentProps<typeof MessageList> & { endpoint: string | null; accessError: Error | null; accessUpdatedAt: number | null; onRefresh: () => void }) {
  const [selected, setSelected] = useState<{ message: Message; trigger: HTMLButtonElement } | null>(null);
  const revoked = accessError instanceof ApiError && [401, 403, 404].includes(accessError.status);
  const [denied, setDenied] = useState(false);
  const [permissionError, setPermissionError] = useState<Error | null>(null);
  useEffect(() => {
    if (revoked) { setDenied(true); setSelected(null); }
  }, [revoked]);
  useEffect(() => { if (!accessError && accessUpdatedAt) { setDenied(false); setPermissionError(null); } }, [accessUpdatedAt]);
  if (revoked || denied) return <>{permissionError && !accessError && <Notice error={permissionError} onRetry={onRefresh} />}<p className="execution-empty">会话暂不可读，已隐藏消息和处理记录。</p></>;
  return <>
    <MessageList {...props} onInspect={endpoint ? (message, trigger) => setSelected({ message, trigger }) : undefined} />
    {selected && endpoint && <MessageProcessDialog key={`${endpoint}:${selected.message.id}:${selected.message.messageVersion ?? ''}`} endpoint={endpoint} message={selected.message} trigger={selected.trigger} onAccessRevoked={error => { setDenied(true); setPermissionError(error); setSelected(null); }} onDismiss={() => setSelected(null)} />}
  </>;
}
