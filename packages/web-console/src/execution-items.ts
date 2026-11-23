import type { Message } from './api';

export type ToolItem = { kind: 'tool'; id: string; call?: Message; results: Message[]; resultStatus?: string; inputElsewhere?: boolean; timing?: Message['timing'] };
export type TranscriptItem = { kind: 'message'; message: Message } | ToolItem;
export type ExecutionItem = TranscriptItem | { kind: 'tool-group'; id: string; tools: ToolItem[] };

// Timing is server evidence, never inferred from a timeout or record timestamp.
// A result can supply duration while its exact matching call supplies the clock.
export function toolTiming(...records: Array<Message['timing']>): Message['timing'] {
  const timing: NonNullable<Message['timing']> = {};
  for (const record of records) {
    if (!record) continue;
    for (const key of ['durationMs', 'modelWaitMs', 'modelDurationMs'] as const) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) timing[key] = value;
    }
    if (typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt))) timing.startedAt = record.startedAt;
  }
  return Object.keys(timing).length ? timing : undefined;
}

export function toolState(item: ToolItem): string {
  const result = item.results.at(-1);
  if (item.resultStatus) return item.resultStatus;
  if (result) return result.isError ? 'error' : result.status || 'completed';
  const status = item.call?.status;
  return !status || status === 'pending' ? 'result-unrecorded' : status;
}

// Pair only within an uninterrupted segment and the same session/call/name.
// Conversation messages are hard boundaries for every tool.
// Earlier inputs may learn a later result status, but never consume its body.
export function transcriptItems(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolItem>();
  const callSegments = new WeakMap<ToolItem, number>();
  let segment = 0;
  const resultCalls = new Set(messages.filter(message => ['task-result', 'router-reply'].includes(message.kind || '') && !message.transient && message.callId)
    .map(message => JSON.stringify([message.source?.sessionId || '', message.callId, message.kind === 'task-result' ? 'task_result' : 'resident_router_reply'])));
  for (const message of messages) {
    if (message.role !== 'tool') {
      segment++;
      items.push({ kind: 'message', message });
      continue;
    }
    const key = message.callId ? JSON.stringify([message.source?.sessionId || '', message.callId]) : undefined;
    if (['task_result', 'resident_router_reply'].includes(message.toolName || '') && key && resultCalls.has(JSON.stringify([message.source?.sessionId || '', message.callId, message.toolName]))) continue;
    if (message.kind === 'tool-call') {
      const item: ToolItem = { kind: 'tool', id: message.id, call: message, results: [], timing: toolTiming(message.timing) };
      items.push(item);
      callSegments.set(item, segment);
      if (key) calls.set(key, item);
    } else {
      const call = key ? calls.get(key) : undefined;
      if (call && call.call?.toolName === message.toolName && callSegments.get(call) !== segment) {
        // Visible output stays at its raw position. Keep only its status on the
        // earlier input row, so polling neither duplicates text nor says waiting.
        call.resultStatus = toolState({ kind: 'tool', id: message.id, results: [message] });
        call.timing = toolTiming(call.timing, message.timing);
        items.push({ kind: 'tool', id: message.id, results: [message], inputElsewhere: true, timing: call.timing });
      } else if (call && call.call?.toolName === message.toolName) {
        call.results.push(message);
        call.timing = toolTiming(call.timing, message.timing);
      } else items.push({ kind: 'tool', id: message.id, results: [message], timing: toolTiming(message.timing) });
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
    if (item.kind !== 'tool' || ['task_result', 'resident_router_reply'].includes((item.call || item.results[0])?.toolName || '') || !item.results.length || !settled.has(toolState(item))) {
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
