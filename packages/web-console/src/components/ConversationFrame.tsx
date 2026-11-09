import {type ReactNode} from 'react';

// All conversation sources share the same frame; only the Web adapter supplies a composer.
export function ConversationFrame({path, execution, label, channel = false, children}: {
  path: string; execution: boolean; label?: string; channel?: boolean; children: ReactNode;
}) {
  return <section className={`chat-page conversation-page${channel ? ' channel-chat' : ''}`} aria-label={label || 'Web 对话'}>
    <nav className="filter-tabs chat-history-tabs" aria-label="会话视图">
      <a href={`#${path}`} aria-current={!execution ? 'page' : undefined}>对话</a>
      <a href={`#${path}?view=execution`} aria-current={execution ? 'page' : undefined}>执行过程</a>
    </nav>
    {children}
  </section>;
}
