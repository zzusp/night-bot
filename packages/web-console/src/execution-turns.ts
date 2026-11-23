import type { Message } from './api';
import { transcriptItems, type TranscriptItem } from './execution-items.ts';

export type ExecutionTurn = {
  kind: 'turn'; id: string; rows: TranscriptItem[]; complete: boolean;
  durationMs?: number; toolCount?: number;
};
export type ExecutionTurnRow = ExecutionTurn | { kind: 'standalone'; row: TranscriptItem };

const standalone = (message: Message) => ['task-result', 'router-reply', 'compaction', 'context-summary', 'run-boundary'].includes(message.kind || '');
const interruption = (message: Message) => message.role === 'assistant' && ['error', 'failed', 'aborted', 'length'].includes(message.status || '');
const ordinaryAnswer = (message: Message) => message.role === 'assistant' && !message.transient && (message.kind === 'message' || !message.kind) && message.status === 'stop';

export function executionTurns(messages: Message[], earlierNotLoaded = false): ExecutionTurnRow[] {
  const items = transcriptItems(messages);
  const output: ExecutionTurnRow[] = [];
  let rows: TranscriptItem[] = [];
  let anchor: Message | undefined, anchored = false;
  const flush = (complete = false, end?: Message) => {
    if (rows.length) {
      const first = rows[0], id = anchor?.id ?? (first.kind === 'message' ? first.message.id : first.id);
      const tools = rows.filter(row => row.kind === 'tool' && row.call).length;
      // Two native timestamps delimit wall time. Never add tool durations or
      // substitute one SDK model turn for several tool/model iterations.
      const from = Date.parse(anchor?.createdAt || ''), to = Date.parse(end?.createdAt || '');
      const durationMs = anchored && complete && anchor?.source?.sessionId && end?.source?.sessionId === anchor.source.sessionId
        && Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : undefined;
      output.push({kind:'turn', id, rows, complete,
        ...(anchored || !earlierNotLoaded ? {toolCount:tools} : {}),
        ...(durationMs !== undefined ? {durationMs} : {})});
    }
    rows = [];
  };
  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    if (row.kind === 'message') {
      const {message} = row;
      const boundary = standalone(message);
      const final = ordinaryAnswer(message) && (i === items.length - 1
        || items[i+1].kind === 'message' && ((items[i+1] as { message: Message }).message.role === 'user' || standalone((items[i+1] as { message: Message }).message)));
      const aborted = interruption(message) && message.kind !== 'thinking';
      if (boundary || final || aborted || message.role === 'user') {
        flush((boundary && ['task-result', 'router-reply'].includes(message.kind || '')) || final, message);
        output.push({kind:'standalone', row});
        // Compaction and interruptions split process folds without counting
        // a partial suffix as a complete turn.
        anchor = message; anchored = message.role === 'user' && message.kind !== 'local-task-input'
          || ['task-result', 'router-reply'].includes(message.kind || '');
        continue;
      }
    }
    rows.push(row);
  }
  flush();
  return output;
}
