export interface Session {
  authenticated: true;
  csrfToken: string;
  operator: { name: string };
  channelId: string;
}
export interface Page<T> { items: T[]; total: number; nextOffset?: number | null; revision?: string }
export interface TimelineEvent { id?: string; at?: string; createdAt?: string; startedAt?: string; kind?: string; type?: string; state?: string; status?: string; summary?: string; label?: string; description?: string }
export interface TimelineTrack { events?: TimelineEvent[]; segments?: TimelineEvent[]; milestones?: TimelineEvent[] }
export interface TaskBlocker { kind: 'execution' | 'operation' | 'legacy'; id: string; title: string; status: string | null; toolName?: string; drained?: boolean; recovering?: boolean }
export interface Task {
  taskId: string; title?: string; objective?: string; state: string; controlState?: string;
  createdAt?: string; updatedAt?: string; result?: unknown;
  session?: { sessionId?: string; role?: string; status?: string };
  timeline?: { task?: TimelineTrack; executions?: TimelineTrack[]; human?: TimelineTrack; version?: number }; blockers?: TaskBlocker[];
  notifications?: Record<string, unknown>[];
}
export interface Channel { channelId: string; type: string; enabled: boolean; connected?: boolean }
export interface Conversation { id: string; name: string; channelId: string; type: string; updatedAt?: string }
export interface ChatSummary { id: string; title: string; updatedAt: string; status: string }
export interface Message {
  id: string; role: 'user' | 'assistant' | 'tool'; text: string; createdAt?: string;
  status?: string; senderName?: string; requestId?: string; taskIds?: string[];
  kind?: string; toolName?: string; redacted?: boolean; truncated?: boolean;
}
export interface Chat { conversationId: string; messages: Message[]; status: string; truncated?: boolean }
export interface ExecutionPage extends Page<Message> { status: 'ready' | 'pending' | 'unavailable'; scope: string; reason?: string }
export interface Overview { tasks: Page<Task> | null; running: Page<Task> | null; waiting: Page<Task> | null; channels: Channel[] | null; conversations: Conversation[] | null; timestamp?: string; sectionErrors?: Record<string, string> }

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
let csrfToken = '';
export function setSession(session: Session | null) { csrfToken = session?.csrfToken ?? ''; }

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const signal = AbortSignal.any([AbortSignal.timeout(20000), ...(options.signal ? [options.signal] : [])]);
  const response = await fetch('/api' + path, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/session') window.dispatchEvent(new Event('night-session-expired'));
    throw new ApiError(response.status, data?.error ?? 'REQUEST_FAILED');
  }
  if (data === null) throw new ApiError(502, 'INVALID_RESPONSE');
  return data as T;
}

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已失效，请重新连接。';
    if (error.status === 403) return '当前连接没有访问权限，请重新登录或联系管理员。';
    if (error.status === 404) return '这条记录不存在，或已不再可用。';
    if (error.status === 409) return '记录已变化，请刷新后查看最新状态。';
    if (error.status === 429) return '请求过于频繁，请稍后重试。';
    if (error.status === 400) return '输入未被接纳，请检查内容后重试。';
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接超时，已保留当前内容。请检查连接后刷新。';
  return '暂时无法连接 Bot，已保留当前内容。请检查服务后刷新。';
}
