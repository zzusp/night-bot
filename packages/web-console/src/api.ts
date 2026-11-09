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
export type ChannelConnectionState = 'starting' | 'waiting-auth' | 'ready' | 'paused' | 'recovering' | 'listening' | 'error' | 'stopped' | 'unknown' | 'pending-restart';
export interface Channel {
  channelId: string; type: string; enabled: boolean; connected?: boolean;
  connectionState?: ChannelConnectionState; errorCode?: 'CHANNEL_AUTH_REQUIRED' | 'CHANNEL_ADAPTER_ERROR' | 'DINGTALK_CHANNEL_SWITCH_BLOCKED' | null;
  name?: string; conversationType?: 'chat' | 'chat-room'; promptConfigured?: boolean; restartRequired?: boolean; liveApplied?: boolean; writesAuthorized?: boolean; savedVersion?: string; runningVersion?: string | null;
  runningConnectionState?: ChannelConnectionState; runningErrorCode?: Channel['errorCode']; runningConnected?: boolean; runningName?: string; runningConversationType?: 'chat' | 'chat-room';
}
export interface DingtalkChannelInput {
  channelId: string; conversationType: 'chat' | 'chat-room'; targetKind: 'id' | 'name'; target: string; name?: string; prompt?: string; writesAuthorized?: boolean;
}
export interface DingtalkChannelCreated {
  ok: true; changed: true; restartRequired: true; liveApplied: false; channel: Channel;
}
export interface DingtalkChannelDetail {
  channelId: string; version: string; name: string; prompt: string; conversationType: 'chat' | 'chat-room'; targetKind: 'id' | 'name'; target: string; writesAuthorized: boolean;
}
export interface DingtalkChannelEdit {
  expectedVersion: string; name: string; prompt: string; conversationType: 'chat' | 'chat-room'; targetKind: 'id' | 'name'; target: string; writesAuthorized?: boolean;
}
export interface DingtalkChannelUpdated {
  ok: true; changed: boolean; restartRequired: boolean; liveApplied: boolean; channel: Channel; detail: DingtalkChannelDetail;
}
export interface Conversation { id: string; name: string; channelId: string; type: string; updatedAt?: string }
export interface ChatSummary { id: string; title: string; updatedAt: string; status: string }
export interface MessageSource { sessionId: string; entryId: string; callId?: string }
export interface MessageBodyPage { messageId: string; text: string; offset: number; nextOffset: number | null; total: number; revision: string; source: MessageSource; redacted: boolean }
export interface HistoryReader { endpoint: string; revision: string }
export interface Message {
  id: string; role: 'user' | 'assistant' | 'tool'; text: string; createdAt?: string;
  status?: string; senderName?: string; requestId?: string; taskIds?: string[];
  kind?: string; toolName?: string; callId?: string; isError?: boolean; redacted?: boolean; truncated?: boolean;
  source?: MessageSource; textTotal?: number; textNextOffset?: number | null;
}
export interface Chat {
  conversationId: string; messages: Message[]; status: string; truncated?: boolean;
  taskIds: string[] | null; taskHistoryStatus: 'ready' | 'unavailable'; taskHistoryReason?: string;
}
export interface ExecutionPage extends Page<Message> { status: 'ready' | 'pending' | 'unavailable'; scope: string; reason?: string }
export interface LearningSource { taskId: string; eventId: string; reviewId: string }
export interface TaskReview { reviewId: string; taskId: string; status: 'done' | 'skipped' | 'failed'; summary: string; at: string; eventId: string }
export interface LearningChange {
  id: string; reviewId: string; taskId: string; kind: 'memory' | 'skill'; action: 'upsert' | 'current-version';
  status: 'applied' | 'candidate' | 'not-applied'; scope: 'personal' | 'group' | 'project'; name: string;
  version: string | number; canRead: boolean; source: LearningSource;
}
export interface TaskLearning { status: 'ready' | 'unavailable'; reason?: string; revision?: string; reviews: TaskReview[] | null; changes: LearningChange[] | null }
export interface LearningBody { id: string; kind: 'memory' | 'skill'; text: string; version: string | number; source: LearningSource; redacted: boolean; truncated?: boolean }
export interface Overview { tasks: Page<Task> | null; running: Page<Task> | null; waiting: Page<Task> | null; channels: Channel[] | null; conversations: Conversation[] | null; timestamp?: string; sectionErrors?: Record<string, string> }

export type PermissionMode = 'ask' | 'auto' | 'full';
export interface PermissionRequest {
  id: string; actorId: string; taskId: string | null; conversationId: string | null; callId: string; toolName: string;
  status: 'pending' | 'allowed-once' | 'rejected' | 'cancelled'; createdAt: string; decidedAt?: string; revocable: boolean;
  display: { summary: string; target: string | null; cwd: string; command: string | null; parametersDigest: string };
}
export interface PermissionsView {
  mode: PermissionMode; options: { value: PermissionMode; label: string; description: string }[]; requests: PermissionRequest[];
  protection: { status: 'unconfined' | 'not-attested' | 'unavailable'; backend: 'direct' | null; description: string };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
let csrfToken = '';
let sessionVersion = 0;
export function setSession(session: Session | null) { csrfToken = session?.csrfToken ?? ''; sessionVersion += 1; }

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const requestVersion = sessionVersion;
  const signal = AbortSignal.any([AbortSignal.timeout(20000), ...(options.signal ? [options.signal] : [])]);
  const response = await fetch('/api' + path, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const current = () => requestVersion === sessionVersion && !signal.aborted;
    if (response.status === 401 && path !== '/login' && path !== '/session' && current()) window.dispatchEvent(new Event('night-session-expired'));
    // 同浏览器另一标签登录会替换共享 cookie。只读同步新会话，不重放被拒绝的写操作。
    if (response.status === 403 && data?.error === 'CSRF_INVALID' && current()) {
      try {
        const check = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
        if (!check.ok) throw new Error('SESSION_REFRESH_FAILED');
        const session = await check.json() as Session;
        if (current()) { setSession(session); window.dispatchEvent(new CustomEvent('night-session-refreshed', { detail: session })); }
      } catch { if (current()) window.dispatchEvent(new Event('night-session-expired')); }
      throw new ApiError(403, 'SESSION_CHANGED');
    }
    throw new ApiError(response.status, data?.error ?? 'REQUEST_FAILED');
  }
  if (data === null) throw new ApiError(502, 'INVALID_RESPONSE');
  return data as T;
}

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'DINGTALK_AUTH_REQUIRED') return 'Bot 运行环境尚未登录钉钉，请先完成登录再保存渠道。';
    if (error.code === 'DINGTALK_CURRENT_PROFILE_NOT_FOUND') return 'Bot 运行环境未找到当前登录账号，请先确认当前账号再保存。';
    if (error.code === 'DINGTALK_CURRENT_PROFILE_AMBIGUOUS') return 'Bot 运行环境存在多个当前账号，请先消除账号歧义；不会自动选择账号。';
    if (error.code === 'DINGTALK_CLI_UNAVAILABLE') return 'Bot 运行环境的钉钉命令不可用或没有执行权限，未保存配置，请检查运行环境。';
    if (error.code === 'DINGTALK_PROFILE_LOOKUP_FAILED') return '暂时无法读取 Bot 运行环境当前账号，未保存配置，请检查连接后重试。';
    if (['DINGTALK_PROFILE_RESPONSE_INVALID', 'DINGTALK_QUERY_INVALID_JSON', 'DINGTALK_QUERY_INCOMPLETE', 'DINGTALK_QUERY_FAILED'].includes(error.code)) return '钉钉账号查询返回异常，未保存配置，请检查 Bot 运行环境后重试。';
    if (error.code === 'DINGTALK_CHANNEL_VERSION_CONFLICT') return '渠道配置已被修改，未覆盖新版本。原草稿已保留，请明确重新加载最新配置后再编辑。';
    if (error.code === 'DINGTALK_CHANNEL_SWITCH_BLOCKED') return '旧目标仍有未决任务、输入或投递依赖，暂不能切换目标。请先处理这些依赖；原草稿已保留。';
    if (error.code === 'DINGTALK_CHANNEL_NOT_FOUND') return '未找到这条钉钉渠道配置。原草稿已保留，请重新核对渠道列表。';
    if (error.code === 'DINGTALK_CHANNEL_EXISTS') return '此渠道标识已存在，未覆盖原配置。请使用新的渠道标识。';
    if (['DINGTALK_CONFIG_INVALID', 'DINGTALK_CHANNEL_REQUEST_INVALID'].includes(error.code)) return '钉钉渠道配置未被接纳，请检查渠道标识和目标。';
    if (error.code === 'CHANNEL_CONFIGURATION_UNAVAILABLE') return '当前安装暂不支持保存渠道配置。请检查运行方式或稍后重试。';
    if (error.code === 'SESSION_CHANGED') return '连接状态已变化，内容已保留。请重新确认连接后重试刚才的操作。';
    if (error.status === 401) return '登录已失效，请重新连接。';
    if (error.status === 403) return '当前连接没有访问权限，请重新登录或联系管理员。';
    if (error.status === 404) return '这条记录不存在，或已不再可用。';
    if (error.status === 409) return '记录已变化，请刷新后查看最新状态。';
    if (error.status === 429) return '请求过于频繁，请稍后重试。';
    if (error.status === 400) return '输入未被接纳，请检查内容后重试。';
    if (error.status === 413) return '内容过大，请缩短消息后重试。';
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接超时，已保留当前内容。请检查连接后刷新。';
  return '暂时无法连接 Bot，已保留当前内容。请检查服务后刷新。';
}
