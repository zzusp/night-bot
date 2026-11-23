import type {Message} from './api';

export type TaskInputPreview = Pick<Message, 'text' | 'attachments'> & {requestId: string; sessionId: string; createdAt: string};

export type TaskInputAttempt = {
  requestId: string;
  sessionId: string;
  text: string;
  files: File[];
  createdAt: string;
  state: 'sending' | 'unknown' | 'missing';
};
export type TaskInputDraft = {
  text: string;
  files: File[];
  attempt?: TaskInputAttempt;
  checking?: boolean;
  error?: string;
  accepted?: string;
  previews?: TaskInputPreview[];
};
const empty: TaskInputDraft = {text: '', files: []};

// Indexed by task, not by the mounted route. One in-memory store per authenticated workspace.
export function createTaskInputDrafts() {
  const values = new Map<string, TaskInputDraft>();
  const listeners = new Set<() => void>();
  return {
    get: (id: string) => values.get(id) ?? empty,
    update(id: string, edit: (draft: TaskInputDraft) => TaskInputDraft) {
      const previous = values.get(id) ?? empty;
      const next = edit(previous);
      if (next === previous) return;
      if (!next.text && !next.files.length && !next.attempt && !next.error && !next.accepted && !next.previews?.length) values.delete(id);
      else values.set(id, next);
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
  };
}
export type TaskInputDrafts = ReturnType<typeof createTaskInputDrafts>;
