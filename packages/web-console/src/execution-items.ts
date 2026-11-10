import type { Message } from './api';

export type ToolItem = { kind: 'tool'; id: string; call?: Message; results: Message[]; resultStatus?: string; inputElsewhere?: boolean };
export type TranscriptItem = { kind: 'message'; message: Message } | ToolItem;
export type ExecutionItem = TranscriptItem | { kind: 'tool-group'; id: string; tools: ToolItem[] };

export function toolState(item: ToolItem): string {
  const result = item.results.at(-1);
  return item.resultStatus || (result ? result.isError ? 'error' : result.status || 'completed' : item.call?.status || 'pending');
}

// Pair only within an uninterrupted segment and the same session/call/name.
// Conversation messages are hard boundaries for every tool.
// Earlier inputs may learn a later result status, but never consume its body.
export function transcriptItems(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolItem>();
  const callSegments = new WeakMap<ToolItem, number>();
  let segment = 0;
  for (const message of messages) {
    if (message.role !== 'tool') {
      segment++;
      items.push({ kind: 'message', message });
      continue;
    }
    const key = message.callId ? JSON.stringify([message.source?.sessionId || '', message.callId]) : undefined;
    if (message.kind === 'tool-call') {
      const item: ToolItem = { kind: 'tool', id: message.id, call: message, results: [] };
      items.push(item);
      callSegments.set(item, segment);
      if (key) calls.set(key, item);
    } else {
      const call = key ? calls.get(key) : undefined;
      if (call && call.call?.toolName === message.toolName && callSegments.get(call) !== segment) {
        // Visible output stays at its raw position. Keep only its status on the
        // earlier input row, so polling neither duplicates text nor says waiting.
        call.resultStatus = toolState({ kind: 'tool', id: message.id, results: [message] });
        items.push({ kind: 'tool', id: message.id, results: [message], inputElsewhere: true });
      } else if (call && call.call?.toolName === message.toolName) call.results.push(message);
      else items.push({ kind: 'tool', id: message.id, results: [message] });
    }
  }
  return items;
}

const settled = new Set(['completed', 'complete', 'done', 'succeeded', 'error', 'failed', 'cancelled', 'canceled', 'aborted']);
export function executionItems(messages: Message[]): ExecutionItem[] {
  const items: ExecutionItem[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length > 1) items.push({ kind: 'tool-group', id: run[0].id, tools: run });
    else items.push(...run);
    run = [];
  };
  for (const item of transcriptItems(messages)) {
    // Missing output is not evidence of completion or of currently executing.
    // Every pending/running/unknown activity stays individually visible.
    if (item.kind !== 'tool' || !item.results.length || !settled.has(toolState(item))) {
      flush();
      items.push(item);
      continue;
    }
    const session = (item.call || item.results[0]).source?.sessionId;
    const previous = run.at(-1);
    if (previous && (previous.call || previous.results[0]).source?.sessionId !== session) flush();
    run.push(item);
  }
  flush();
  return items;
}
