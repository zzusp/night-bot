import type {ReactNode} from 'react';

export function ConversationFrame({label, channel = false, children}: {
  label?: string; channel?: boolean; children: ReactNode;
}) {
  return <section className={`chat-page conversation-page${channel ? ' channel-chat' : ''}`} aria-label={label || 'Web 对话'}>{children}</section>;
}
