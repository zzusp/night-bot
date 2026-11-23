import type { Message } from './api';

export interface ExecutionSearchHit { id: string; excerpt: string; label: string }
// Only the public initial body projection is searchable. Never serialize the DTO:
// provenance IDs, request IDs and non-displayed metadata are not search content.
export function searchExecutionRecords(messages: Message[], query: string): ExecutionSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages.flatMap(message => {
    if (message.transient) return [];
    const text = message.text || '';
    const label = message.role === 'tool' ? message.toolName || '工具' : message.kind === 'thinking' ? '思考' : message.role === 'user' ? '用户' : '助手';
    const at = text.toLocaleLowerCase().indexOf(needle);
    if (at < 0 && !label.toLocaleLowerCase().includes(needle)) return [];
    const start = Math.max(0, at - 30), end = Math.min(text.length, Math.max(at, 0) + 110);
    return [{id: message.id, label, excerpt: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`}];
  });
}
