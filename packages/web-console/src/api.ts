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
export interface ChannelIngress {
  supported: boolean; available: boolean; backfill: 'history' | 'none' | null; requestedPaused: boolean;
  state: 'paused' | 'pausing' | 'receiving' | 'recovering' | 'error' | 'unavailable'; errorCode: string | null;
}
export interface Channel {
  channelId: string; type: string; enabled: boolean; connected?: boolean;
  connectionState?: ChannelConnectionState; errorCode?: 'CHANNEL_MESSAGE_ID_CONFLICT' | 'CHANNEL_HISTORY_INCOMPLETE' | 'CHANNEL_HISTORY_RECOVERY_FAILED' | 'CHANNEL_AUTH_REQUIRED' | 'CHANNEL_ADAPTER_ERROR' | 'DINGTALK_CHANNEL_SWITCH_BLOCKED' | 'CHANNEL_DRAIN_FAILED' | 'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN' | null;
  name?: string; conversationType?: 'chat' | 'chat-room'; promptConfigured?: boolean; restartRequired?: boolean; liveApplied?: boolean; writesAuthorized?: boolean; savedVersion?: string; runningVersion?: string | null;
  runningConnectionState?: ChannelConnectionState; runningErrorCode?: Channel['errorCode']; runningConnected?: boolean; runningName?: string; runningConversationType?: 'chat' | 'chat-room';
  ingress?: ChannelIngress;
}
export interface DingtalkChannelInput {
  channelId: string; conversationType: 'chat' | 'chat-room'; targetKind: 'id' | 'name'; target: string; name?: string; prompt?: string; writesAuthorized?: boolean;
}
export interface DingtalkChannelCreated {
  ok: true; changed: true; restartRequired: boolean; liveApplied: boolean; channel: Channel;
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
export interface RecentConversation { id: string; title: string; updatedAt: string; kind: 'web' | 'channel' }
export interface ChatSummary { id: string; title: string; updatedAt: string; status: string }
export interface MessageSource { sessionId: string; entryId: string; callId?: string }
export interface MessageBodyPage { messageId: string; text: string; offset: number; nextOffset: number | null; total: number; revision: string; source: MessageSource; redacted: boolean }
export interface HistoryReader { endpoint: string; revision: string; onRecover?: () => void }
export interface Message {
  messageVersion?: number;
  id: string; role: 'user' | 'assistant' | 'tool'; text: string; createdAt?: string;
  status?: string; senderName?: string; requestId?: string; taskIds?: string[];
  kind?: string; toolName?: string; callId?: string; isError?: boolean; redacted?: boolean; truncated?: boolean;
  source?: MessageSource; textTotal?: number; textNextOffset?: number | null;
}
export interface Chat {
  conversationId: string; messages: Message[]; status: string; truncated?: boolean; canonicalConversationId?: string;
  taskSummaries?: Pick<Task, 'taskId' | 'title' | 'state' | 'updatedAt'>[] | null;
  taskIds: string[] | null; taskHistoryStatus: 'ready' | 'unavailable'; taskHistoryReason?: string;
}
export interface ExecutionPage extends Page<Message> { status: 'ready' | 'pending' | 'unavailable'; scope: string; reason?: string; generation?: number; activeGeneration?: number; checkpoint?: string | null; before?: string | null; hasNewer?: boolean }
export interface LearningSource { taskId: string; eventId: string; reviewId: string }
export interface TaskReview { reviewId: string; taskId: string; status: 'done' | 'skipped' | 'failed'; summary: string; at: string; eventId: string }
export interface LearningChange {
  id: string; reviewId: string; taskId: string; kind: 'memory' | 'skill'; action: 'upsert' | 'current-version';
  status: 'applied' | 'candidate' | 'not-applied'; scope: 'bot'|'personal' | 'group' | 'project'; name: string;
  version: string | number; canRead: boolean; source: LearningSource;
}
export interface TaskLearning { status: 'ready' | 'unavailable'; reason?: string; revision?: string; reviews: TaskReview[] | null; changes: LearningChange[] | null }
export interface LearningBody { id: string; kind: 'memory' | 'skill'; text: string; version: string | number; source: LearningSource; redacted: boolean; truncated?: boolean }
export interface Overview { tasks: Page<Task> | null; running: Page<Task> | null; waiting: Page<Task> | null; channels: Channel[] | null; conversations: Conversation[] | null; timestamp?: string; sectionErrors?: Record<string, string> }

export interface MemoryProvenance {channelId?: string;conversationId?: string;conversationName?: string;conversationType?: 'chat'|'chat-room';conversationKey?: string;taskId?: string;taskTitle?: string;messageId?: string;resolvedFrom?: string}
export interface EvolutionItem {
  id: string; kind: 'memory' | 'skill'; name: string; scope: 'bot'|'personal'|'group'|'project';
  status: 'applied'|'candidate'|'disabled'|'invalid'|'shadowed'|'undiscovered'|'unsupported'; revision: string | number; updatedAt: string | null; taskId?: string;
  origin?: 'installed'|'learned';location?:string;modelUseCount?:number|null;userUseCount?:number|null;fileReadCount?:number|null;lastUsedAt?:string|null;updatedSinceUse?:boolean;
  memoryUse?:{readCount:number;searchCount:number;lastAccess?:{counter:string;at:string;provenance:MemoryProvenance|null}|null}|null;
  provenance?:MemoryProvenance|null;origins?:MemoryProvenance[];taskIds?:string[];migration?:{conflict?:boolean};
}
export interface EvolutionBody {
  id: string; name: string; kind: 'memory' | 'skill'; revision: string | number;
  current: {text: string; updatedAt: string | null; revision: string | number};
  previous: {text: string; updatedAt: string | null; revision: string | number} | null;
  comparison: {basis?: 'observed' | 'saved'; status: 'available' | 'no_previous'; reason?: 'not_recorded' | 'new_entry' | 'unsafe_previous'; added: number; removed: number; lines: {type: 'unchanged' | 'added' | 'removed'; text: string}[]};
  redacted: boolean;
}
export interface EvolutionReady extends Page<EvolutionItem> {
  usageCoverage?: {status: 'ready'|'partial'|'unrecorded'; sessionsRead?:number};
  status: 'ready'; coverage: 'authorized-scopes-current-state'|'bot-shared-current-state'; offset: number; limit: number;
  memory: {trackingStatus?:string;entryTrackingSince?:string|null; acceptedCount: number; candidateCount: number; readCount: number | null; searchCount: number | null; lastUsedAt: string | null; trackingSince: string | null;lastAccess?:{counter:string;at:string;provenance:MemoryProvenance|null}|null };
  skills: { contentTrackingStatus?: 'ready' | 'degraded'; activeCount: number; candidateCount: number; loadCount: number | null; lastUsedAt: string | null; trackingSince: string | null; coverage: 'learned-skills-only'|'bot-installed-and-learned';installedCount?:number;installedAvailableCount?:number;modelUseCount?:number|null;userUseCount?:number|null;fileReadCount?:number|null;callTrackingSince?:string|null;lastInvocationAt?:string|null;trackingStatus?:string;inventoryComplete?:boolean;inventoryIssues?:string[] };
}
export type Evolution = EvolutionReady | { status: 'unavailable'; reason?: string };

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
    // A resource/proxy failure is not proof that the browser session ended.
    // Confirm through the session endpoint; never replay the original operation.
    if (path !== '/login' && path !== '/session' && path !== '/appearance' && current() &&
      (response.status === 401 || (response.status === 403 && data?.error === 'CSRF_INVALID'))) {
      try {
        const check = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
        const session = await check.json().catch(() => null);
        if (check.status === 401 && session?.error === 'AUTH_REQUIRED') {
          if (current()) window.dispatchEvent(new Event('night-session-expired'));
          throw new ApiError(401, 'AUTH_REQUIRED');
        }
        if (!check.ok || session?.authenticated !== true || typeof session.csrfToken !== 'string' || !session.csrfToken) throw new ApiError(503, 'SESSION_CHECK_UNAVAILABLE');
        if (current() && session.csrfToken !== csrfToken) { setSession(session); window.dispatchEvent(new CustomEvent('night-session-refreshed', { detail: session })); }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'SESSION_CHECK_UNAVAILABLE');
      }
      throw new ApiError(response.status === 401 ? 503 : 403, response.status === 401 ? 'SESSION_RESOURCE_UNAVAILABLE' : 'SESSION_CHANGED');
    }
    if (response.status === 403 && data?.error === 'CSRF_INVALID') throw new ApiError(403, 'SESSION_CHANGED');
    throw new ApiError(response.status, data?.error ?? 'REQUEST_FAILED');
  }
  if (data === null) throw new ApiError(502, 'INVALID_RESPONSE');
  return data as T;
}

export function errorText(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'SESSION_PAGE_STALE') return '执行上下文已改变，已暂停续读。重新获取后查看当前记录。';
    if (error.code === 'SESSION_COMMIT_PENDING') return '新记录正在提交，完成后会自动更新。';
    if (error.code === 'SETTINGS_VERSION_CONFLICT') return '设置已被修改，未覆盖新版本。草稿已保留，请重新读取设置后再编辑。';
    if (error.code === 'INVALID_CONFIG') return '模型或推理深度不受当前路由支持，请重新读取可用模型并检查选择。';
    if (error.code === 'EVOLUTION_CONTENT_TOO_LARGE') return '此条目内容过大，暂不能在此查看。';
    if (error.code === 'EVOLUTION_READ_FAILED' || error.code === 'EVOLUTION_UNAVAILABLE') return '内容暂不可读，请检查连接或稍后重试。';
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
    if (error.code === 'WEB_CHAT_SINGLETON') return 'Web 仅保留一个可继续的对话。请返回当前 Web 对话；原历史记录未被修改。';
    if (error.code === 'SETTINGS_VERSION_CONFLICT') return '设置已被修改，请重新读取后再保存。';
    if (error.code === 'SETTINGS_SECRET_READ_ONLY') return '此凭据由启动环境提供，请在环境中修改。';
    if (error.code === 'SETTINGS_INPUT_INVALID') return '设置未被保存，请检查字段格式。';
    if (error.code === 'SETTINGS_MODEL_IN_USE') return '此模型仍被默认、角色或环境变量配置使用，请先切换相关配置再改 ID 或删除。';
    if (error.code === 'SETTINGS_MODEL_EXISTS') return '此路由已存在相同模型 ID，请使用不同 ID。';
    if (error.code === 'SETTINGS_MODEL_LAST_REQUIRED') return '路由必须至少保留一个模型，不能删除最后一个模型。';
    if (error.code === 'SETTINGS_MODEL_DELETE_CONFIRMATION_REQUIRED') return '请确认删除模型后再提交。';
    if (error.code === 'SETTINGS_MODEL_CATALOG_INVALID') return '已有模型或角色引用配置无效，请先修正配置再编辑模型列表。';
    if (error.code === 'SETTINGS_TASK_ROLE_REQUIRED') return '请先保存任务执行的模型选择，再删除模型或更改 ID。';
    if (error.code === 'SETTINGS_RESIDENT_REQUIRED') return '此操作需要连接正在运行的 Bot 核对配置，请使用在线设置入口。';
    if (error.code === 'CHANNEL_INSTANCE_EXISTS') return '该渠道标识已存在，请换一个；新增不会覆盖已有配置。';
    if (error.code === 'CHANNEL_EDIT_REQUIRES_STOP') return '此渠道仍在运行，请先按运维流程停用并重启后再修改。';
    if (error.code === 'CHANNEL_WEB_CONFIGURATION_UNSUPPORTED') return '此插件尚未声明网页配置表单，请按插件说明配置。';
    if (error.code === 'SETTINGS_UNAVAILABLE' || error.code === 'SETTINGS_SAVE_UNAVAILABLE') return '设置暂不可用，请恢复服务后重新读取；保存结果可能需要核对。';
    if (error.code === 'SESSION_RESOURCE_UNAVAILABLE') return '当前请求暂不可用，登录状态正常。请稍后重试。';
    if (error.code === 'SESSION_CHECK_UNAVAILABLE') return '暂时无法核对登录状态，当前内容已保留。请恢复连接后重试。';
    if (error.code === 'SESSION_CHANGED') return '连接状态已变化，内容已保留。请重新确认连接后重试刚才的操作。';
    if (error.status === 401) return '浏览器会话已结束，请使用访问令牌重新连接。';
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

export type ModelRole = 'triage'|'router'|'task';
export interface RoleModelSelection {provider:string;model:string;reasoningEffort?:string}
export interface RoleModelState {
 role:ModelRole;saved:RoleModelSelection;savedExplicit:boolean;running:RoleModelSelection;nextStart:RoleModelSelection|null;environmentError?:boolean;
 environmentOverrides:{name:string;source:string}[];restartRequired:boolean;
}
export interface RoleModelCatalog {provider:string;name:string;models:{id:string;name:string;reasoningEfforts:string[]}[]}
export interface RoleModelSaved {ok:true;changed:boolean;version:string;role:RoleModelState;restartRequired:boolean}
export interface ModelCatalogEntry {id:string;name:string;configuredName:string|null;reasoningEfforts:string[];references:string[]}
export interface SecretState {configured:boolean;writable:boolean;source:string;sharedWith?:string[]}
export interface ModelProvider {provider:string;name:string;api:string;baseURL:string;baseURLConfigured:boolean;secret:SecretState;models:ModelCatalogEntry[]}
export interface ModelCatalog {version:string;providers:ModelProvider[]}
export interface ModelCatalogSaved {ok:true;changed:boolean;checkOnly:boolean;version:string;restartRequired:boolean;liveApplied:false}
export interface WorkLogSelection {enabled:boolean;time:string;timezone:string}
export interface WorkLogState {saved:WorkLogSelection;running:WorkLogSelection;nextStart:WorkLogSelection|null;environmentOverrides:{name:string;source:string}[];restartRequired:boolean}
export interface OperatorSettings {
 workLog?: WorkLogState;
 roleModels: {catalog:RoleModelCatalog[];roles:RoleModelState[]};
 version: string; appearance: import('./components/AssistantBrand').AssistantBrand;
 model: {provider:string;model:string;api:string;baseURL:string};
 secrets: Record<'model'|'github',{configured:boolean;writable:boolean;source:string}>;
 restartRequired:boolean; githubScope:string;
}
export interface ChannelField {name:string;label:string;type:'string'|'boolean'|'credential-ref';required:boolean}
export interface ChannelSettings {version:string;items:{type:string;name:string;configurable:boolean;fields:ChannelField[]|null}[];channels:{type:string;channelId:string;enabled:boolean;editable:boolean;config:Record<string,string|boolean>|null}[]}
