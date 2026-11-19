export interface Attempt { conversationId: string; requestId: string; text: string; createdAt: string; state: 'sending' | 'pending' | 'unknown' | 'missing' }
export interface Draft { text: string; attempt?: Attempt; error?: string; checking?: boolean }
export const emptyDraft: Draft = { text: '' };
// 请求归属于对话，不能归属于可能随切页卸载的组件；退出时替换整个内存容器。
export function createDrafts() {
  const values = new Map<string, Draft>(), listeners = new Set<() => void>();
  return {
    get: (key: string) => values.get(key) || emptyDraft,
    update(key: string, change: (previous: Draft) => Draft) {
      const previous = values.get(key) || emptyDraft, next = change(previous);
      if (previous === next) return;
      if (next === emptyDraft) values.delete(key); else values.set(key, next);
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type Drafts = ReturnType<typeof createDrafts>;
