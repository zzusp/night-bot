import type { Message } from './api';

export type ToolItem = { kind: 'tool'; id: string; call?: Message; results: Message[] };
export type TranscriptItem = { kind: 'message'; message: Message } | ToolItem;
export type ExecutionItem = TranscriptItem | { kind: 'tool-group'; id: string; tools: ToolItem[] };

export function toolState(item: ToolItem): string {
  const result = item.results.at(-1);
  return result ? result.isError ? 'error' : result.status || 'completed' : item.call?.status || 'pending';
}

// Pair only within contiguous tool records and the same session/call/name.
// An intervening conversation message is an ordering boundary, not a place to
// move a later result backwards across the transcript.
export function transcriptItems(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolItem>();
  for (const message of messages) {
    if (message.role !== 'tool') {
      calls.clear();
      items.push({ kind: 'message', message });
      continue;
    }
    const key = message.callId ? JSON.stringify([message.source?.sessionId || '', message.callId]) : undefined;
    if (message.kind === 'tool-call') {
      const item: ToolItem = { kind: 'tool', id: message.id, call: message, results: [] };
      items.push(item);
      if (key) calls.set(key, item);
    } else {
      const call = key ? calls.get(key) : undefined;
      if (call && call.call?.toolName === message.toolName) call.results.push(message);
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
    if (item.kind !== 'tool' || (item.call || item.results[0]).toolName === 'job_output' || !item.results.length || !settled.has(toolState(item))) {
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
