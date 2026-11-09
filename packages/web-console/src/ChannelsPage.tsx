import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react';
import { RiChat3Line, RiGroupLine, RiArrowRightLine, RiGlobalLine, RiCheckboxCircleFill, RiAddLine, RiCloseLine, RiEditLine } from '@remixicon/react';
import { api, ApiError, type Channel, type Conversation, type DingtalkChannelCreated, type DingtalkChannelDetail, type DingtalkChannelEdit, type DingtalkChannelInput, type DingtalkChannelUpdated, type Message } from './api';
import { useResource, useRoute } from './hooks';
import { ConversationFrame } from './components/ConversationFrame';
import { ConversationExecution, type TaskHistory } from './components/ConversationExecution';
import { Badge, Button, EmptyState, IconButton } from './components/BoardPrimitives';
import { Loading, MessageList, Notice, Search, Status } from './components/Shared';

const conversationType = (type?: string | null) => type === 'chat-room' ? '群聊' : type === 'chat' ? '单聊' : '会话类型未记录';

const emptyChannel = (): DingtalkChannelInput => ({ channelId: '', conversationType: 'chat-room', targetKind: 'id', target: '', name: '', prompt: '', writesAuthorized: false });
type FieldErrors = Partial<Record<keyof DingtalkChannelInput, string>>;

type PendingSave = { channelId: string; edit?: DingtalkChannelEdit };
const detailPath = (channelId: string) => `/channels/dingtalk/${encodeURIComponent(channelId)}`;
const validDetail = (value: DingtalkChannelDetail, channelId: string) => value?.channelId === channelId &&
  typeof value.version === 'string' && /^[a-f0-9]{64}$/.test(value.version) && typeof value.name === 'string' && typeof value.prompt === 'string' &&
  ['chat', 'chat-room'].includes(value.conversationType) && ['id', 'name'].includes(value.targetKind) && typeof value.target === 'string' && typeof value.writesAuthorized === 'boolean';
const detailDraft = (value: DingtalkChannelDetail): DingtalkChannelInput => ({ channelId: value.channelId, name: value.name, prompt: value.prompt,
  conversationType: value.conversationType, targetKind: value.targetKind, target: value.target, writesAuthorized: value.writesAuthorized });
const sameFields = (value: DingtalkChannelDetail, fields: DingtalkChannelEdit) => value.name === fields.name && value.prompt === fields.prompt &&
  value.conversationType === fields.conversationType && value.targetKind === fields.targetKind && value.target === fields.target && value.writesAuthorized === fields.writesAuthorized;

function DingtalkConfiguration({ onSaved, channelId }: { onSaved: () => void; channelId?: string }) {
  const editing = channelId !== undefined;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...emptyChannel(), channelId: channelId ?? '' }));
  const [loadedDetail, setLoadedDetail] = useState<DingtalkChannelDetail | null>(null);
  const version = loadedDetail?.version ?? null;
  const targetEdited = editing && loadedDetail !== null && (draft.conversationType !== loadedDetail.conversationType || draft.targetKind !== loadedDetail.targetKind || draft.target.trim() !== loadedDetail.target);
  const [stale, setStale] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<'loading' | 'saving' | 'checking' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(false);
  const [unknownSave, setUnknownSave] = useState<PendingSave | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), form = useRef<HTMLFormElement>(null);
  const live = useRef(true), writing = useRef(false), composing = useRef(false);
  const prefix = useId();
  const locked = !!busy || saved || !!unknownSave || stale || (editing && !version);
  const title = editing ? '编辑钉钉渠道' : '添加钉钉渠道';
  const targetLabel = `${draft.conversationType === 'chat-room' ? '群' : '用户'}${draft.targetKind === 'id' ? ' ID' : '名称'}`;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  const field = (key: keyof DingtalkChannelInput) => ({
    id: `${prefix}-${key}`, name: key, 'aria-invalid': !!errors[key] || undefined,
    'aria-describedby': `${prefix}-${key}-help${errors[key] ? ` ${prefix}-${key}-error` : ''}`,
  });
  const edit = (key: 'channelId' | 'target' | 'name' | 'prompt', value: string) => {
    setDraft(previous => ({ ...previous, [key]: value, ...(key === 'target' ? {writesAuthorized: false} : {}) }));
    setErrors(previous => ({ ...previous, [key]: undefined }));
  };
  const load = async () => {
    if (!channelId || writing.current || unknownSave) return;
    writing.current = true; setBusy('loading'); setError(null);
    try {
      const result = await api<DingtalkChannelDetail>(detailPath(channelId));
      if (!live.current) return;
      if (!validDetail(result, channelId)) throw new ApiError(502, 'INVALID_RESPONSE');
      setDraft(detailDraft(result)); setLoadedDetail(result); setStale(false); setSaved(false);
      setErrors({}); setFeedback('');
    } catch (cause) { if (live.current) setError(cause); }
    finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const verify = async (pending: PendingSave) => {
    setBusy('checking'); setError(null);
    try {
      if (pending.edit) {
        const result = await api<DingtalkChannelDetail>(detailPath(pending.channelId));
        if (!live.current) return;
        if (!validDetail(result, pending.channelId)) throw new ApiError(502, 'INVALID_RESPONSE');
        if (result.version !== pending.edit.expectedVersion && sameFields(result, pending.edit)) {
          setFeedback('只读核对确认当前保存配置与本次字段一致，版本已更新。实际应用与连接状态请查看渠道列表。');
          setLoadedDetail(result); setDraft(detailDraft(result)); setSaved(true); setUnknownSave(null);
        } else setFeedback(result.version === pending.edit.expectedVersion
          ? '保存版本未变化，仍不能确认本次保存结果。原草稿保持锁定，请继续只读核对，不要重复保存。'
          : '当前保存版本或字段与本次请求不一致，保存结果仍未知。原草稿保持锁定，请继续只读核对，不要重复保存。');
      } else {
        // 新增摘要不含账号/目标；同 ID 存在不能证明本次写入全部字段。
        const result = await api<{ items: Channel[] }>('/channels');
        if (!live.current) return;
        const found = result.items.find(item => item.channelId === pending.channelId);
        setFeedback(found
          ? `已找到渠道标识「${pending.channelId}」的配置。安全摘要不含账号和目标，无法确认本次写入；请核对渠道列表，不要重复保存。`
          : `暂未找到渠道标识「${pending.channelId}」的配置，保存结果仍未知。保留原字段，请稍后再次核对，不要重复保存。`);
      }
      onSaved();
    } catch (cause) {
      if (live.current) { setError(cause); setFeedback('暂时无法核对，保存结果仍未知。保留原字段，请稍后只读核对，不要重复保存。'); }
    } finally { if (live.current) setBusy(null); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (writing.current || locked || composing.current) return;
    const body: DingtalkChannelInput = { ...draft, channelId: draft.channelId.trim(), target: draft.target.trim(),
      name: draft.name?.trim() || undefined, prompt: draft.prompt || undefined };
    const invalid: FieldErrors = {};
    if (!body.channelId || body.channelId.length > 128 || body.channelId.includes(String.fromCharCode(0))) invalid.channelId = '请输入不超过 128 个字符的渠道标识，不含空字符。';
    if (!body.target || body.target.includes(String.fromCharCode(0))) invalid.target = `请输入${targetLabel}，不含空字符。`;
    if (body.name?.includes(String.fromCharCode(0))) invalid.name = '显示名称不能包含空字符。';
    if (body.prompt?.includes(String.fromCharCode(0))) invalid.prompt = '渠道职责不能包含空字符。';
    setErrors(invalid); setError(null); setFeedback('');
    const first = Object.keys(invalid)[0];
    if (first) { (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus(); return; }
    const patch: DingtalkChannelEdit | undefined = editing ? { expectedVersion: version!, name: body.name ?? '', prompt: body.prompt ?? '',
      conversationType: body.conversationType, targetKind: body.targetKind, target: body.target, writesAuthorized: body.writesAuthorized === true } : undefined;
    writing.current = true; setBusy('saving');
    try {
      if (patch) {
        const result = await api<DingtalkChannelUpdated>(detailPath(channelId!), { method: 'PATCH', body: patch });
        if (!live.current) return;
        if (result.ok !== true || typeof result.changed !== 'boolean' || typeof result.restartRequired !== 'boolean' || typeof result.liveApplied !== 'boolean' ||
          result.channel?.channelId !== channelId || result.channel.type !== 'dingtalk-dws' || !validDetail(result.detail, channelId!) ||
          result.channel.savedVersion !== result.detail.version || (result.channel.runningVersion !== null && !/^[a-f0-9]{64}$/.test(result.channel.runningVersion ?? '')) ||
          result.channel.restartRequired !== result.restartRequired || result.channel.liveApplied !== result.liveApplied || !sameFields(result.detail, patch)) throw new ApiError(502, 'INVALID_RESPONSE');
        setDraft(detailDraft(result.detail)); setLoadedDetail(result.detail);
        const application = result.restartRequired ? '保存配置待重启；当前运行态尚未应用此配置。'
          : result.liveApplied ? '保存配置已应用到运行态；连接与监听以渠道状态为准。' : '保存配置尚未激活，请查看渠道状态并处理阻断。';
        setFeedback(`${result.changed ? '配置已保存' : '配置未变化'}。${application}`);
      } else {
        const result = await api<DingtalkChannelCreated>('/channels/dingtalk', { method: 'POST', body });
        if (!live.current) return;
        if (result.ok !== true || result.changed !== true || result.restartRequired !== true || result.liveApplied !== false || result.channel?.channelId !== body.channelId) throw new ApiError(502, 'INVALID_RESPONSE');
        setFeedback(`渠道「${body.channelId}」已保存，待重启后接入；当前尚未连接，${body.writesAuthorized ? '已保存外发授权' : '未授权外发'}。`);
      }
      setSaved(true); onSaved();
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof ApiError && cause.code === 'DINGTALK_CHANNEL_VERSION_CONFLICT') {
        setStale(true); setError(cause); setFeedback('原草稿已保留。重新加载会用最新保存配置替换草稿；未重新加载前不能再次保存。');
      } else if (cause instanceof ApiError && cause.code === 'DINGTALK_CHANNEL_EXISTS') {
        setErrors({ channelId: '该渠道标识已存在，请换一个；未覆盖已有配置。' });
        setError(cause);
      } else if (cause instanceof ApiError && ([400, 401, 403, 404, 409, 413, 429].includes(cause.status) || ['CHANNEL_CONFIGURATION_UNAVAILABLE', 'DINGTALK_CLI_UNAVAILABLE', 'DINGTALK_PROFILE_LOOKUP_FAILED', 'DINGTALK_PROFILE_RESPONSE_INVALID', 'DINGTALK_QUERY_INVALID_JSON', 'DINGTALK_QUERY_INCOMPLETE', 'DINGTALK_QUERY_FAILED'].includes(cause.code))) setError(cause);
      else {
        const pending = { channelId: body.channelId, edit: patch };
        setUnknownSave(pending); setFeedback('保存结果未知，正在只读核对原请求；不会重复提交。');
        await verify(pending);
      }
    } finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const check = async () => {
    if (writing.current || !unknownSave) return;
    writing.current = true;
    try { await verify(unknownSave); } finally { writing.current = false; }
  };
  useLayoutEffect(() => {
    const field = form.current?.querySelector('textarea');
    if (!field || !open) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(240, Math.max(120, field.scrollHeight))}px`;
  }, [draft.prompt, open]);
  const reset = () => { setDraft(emptyChannel()); setErrors({}); setError(null); setFeedback(''); setSaved(false); setUnknownSave(null); };
  return <>
    <Button variant={editing ? 'secondary' : 'primary'} icon={editing ? <RiEditLine size={15} /> : <RiAddLine size={17} />} aria-haspopup="dialog"
      aria-label={editing ? `编辑配置：${channelId}` : undefined} onClick={() => { setOpen(true); if (editing && !version) void load(); }}>{editing ? '编辑配置' : '添加钉钉渠道'}</Button>
    <dialog ref={dialog} className="channel-create-dialog" aria-labelledby={`${prefix}-title`} aria-describedby={`${prefix}-boundary`}
      onClose={() => setOpen(false)} onCancel={event => { if (writing.current) event.preventDefault(); }}>
      <header className="channel-create-heading"><div><h2 id={`${prefix}-title`}>{title}</h2></div>
        <IconButton label={`关闭${title}`} disabled={!!busy} onClick={() => setOpen(false)}><RiCloseLine size={19} /></IconButton></header>
      <div className="channel-create-body">
        <p className="channel-create-boundary" id={`${prefix}-boundary`}>{editing
          ? '沿用已保存账号，修改后须重启应用。同一目标保留绑定；切换目标须先处理旧依赖，保存后重新编辑才能授权新目标外发。'
          : '使用 Bot 当前登录账号。保存后须重启接入；默认仅接收消息，外发需在下方明确授权。'}</p>
        {error != null && <Notice error={error} />}
        {feedback && <p className="channel-create-feedback" role="status">{feedback}</p>}
        {editing && (!version || stale) && !unknownSave && <Button variant="secondary" busy={busy === 'loading'} disabled={!!busy} onClick={() => void load()}>重新加载最新配置</Button>}
        {unknownSave && <Button variant="secondary" busy={busy === 'checking'} disabled={!!busy} onClick={() => void check()}>核对保存状态</Button>}
        <form ref={form} noValidate onSubmit={event => void submit(event)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
          <fieldset className="channel-create-fields" disabled={locked}><legend className="sr-only">钉钉渠道配置</legend>
            <div className="channel-create-field"><label htmlFor={`${prefix}-channelId`}>渠道标识</label>
              <input {...field('channelId')} autoFocus={!editing} readOnly={editing} autoComplete="off" maxLength={128} value={draft.channelId} onChange={event => edit('channelId', event.target.value)} />
              <p id={`${prefix}-channelId-help`} className="field-help">{editing ? '固定标识不可修改；编辑不会更换已保存账号。' : '本安装中唯一的标识，重复标识不会覆盖已有渠道。'}</p>
              {errors.channelId && <p id={`${prefix}-channelId-error`} className="field-error" role="alert">{errors.channelId}</p>}</div>
            <div className="channel-create-field"><label htmlFor={`${prefix}-conversationType`}>会话类型</label>
              <select id={`${prefix}-conversationType`} value={draft.conversationType} onChange={event => { setDraft(previous => ({ ...previous, conversationType: event.target.value as DingtalkChannelInput['conversationType'], target: '', writesAuthorized: false })); setErrors(previous => ({ ...previous, target: undefined })); }}><option value="chat-room">群聊</option><option value="chat">私聊</option></select></div>
            <div className="channel-create-field"><label htmlFor={`${prefix}-targetKind`}>目标填写方式</label>
              <select id={`${prefix}-targetKind`} value={draft.targetKind} onChange={event => { setDraft(previous => ({ ...previous, targetKind: event.target.value as DingtalkChannelInput['targetKind'], target: '', writesAuthorized: false })); setErrors(previous => ({ ...previous, target: undefined })); }}><option value="id">按 ID</option><option value="name">按名称</option></select></div>
            <div className="channel-create-field"><label htmlFor={`${prefix}-target`}>{targetLabel}</label>
              <input {...field('target')} autoComplete="off" value={draft.target} onChange={event => edit('target', event.target.value)} />
              <p id={`${prefix}-target-help`} className="field-help">{editing ? '名称须唯一匹配；实际身份切换受旧目标未决依赖约束。' : '名称须唯一匹配；新增目标在重启接入时核对。'}</p>
              {errors.target && <p id={`${prefix}-target-error`} className="field-error" role="alert">{errors.target}</p>}</div>
            <div className="channel-create-field channel-create-wide"><label htmlFor={`${prefix}-name`}>显示名称（可选）</label>
              <input {...field('name')} autoComplete="off" value={draft.name} onChange={event => edit('name', event.target.value)} />
              <p id={`${prefix}-name-help`} className="field-help">用于区分渠道，不改变目标身份；编辑时清空即移除显示名称。</p>
              {errors.name && <p id={`${prefix}-name-error`} className="field-error" role="alert">{errors.name}</p>}</div>
            <div className="channel-create-field channel-create-wide"><label htmlFor={`${prefix}-prompt`}>渠道职责（可选）</label>
              <textarea {...field('prompt')} className="resize-none" rows={5} value={draft.prompt} onChange={event => edit('prompt', event.target.value)} />
              <p id={`${prefix}-prompt-help`} className="field-help">描述此渠道的用途；不作为发送授权或操作凭据。</p>
              {errors.prompt && <p id={`${prefix}-prompt-error`} className="field-error" role="alert">{errors.prompt}</p>}</div>
            <div className="channel-create-field channel-create-wide"><label htmlFor={`${prefix}-writesAuthorized`}>外发授权</label>
              <select {...field('writesAuthorized')} value={draft.writesAuthorized === true ? 'true' : 'false'} disabled={locked || targetEdited}
                onChange={event => setDraft(previous => ({ ...previous, writesAuthorized: event.target.value === 'true' }))}>
                <option value="false">关闭：仅接收消息</option><option value="true">开启：允许回复和通知</option>
              </select>
              <p id={`${prefix}-writesAuthorized-help`} className="field-help">{targetEdited
                ? '目标已修改，外发授权已关闭；请先保存目标，再重新编辑授权。'
                : '允许 Bot 向此会话发送回复、通知和附件，包括已排队未发送的通知。保存后须正常重启才生效；关闭不会撤回已发送的消息。'}</p></div>
          </fieldset>
          <div className="channel-create-actions"><Button type="submit" variant="primary" busy={busy === 'saving'} disabled={locked}>{editing ? '保存渠道修改' : '保存钉钉渠道'}</Button>
            {saved && (editing ? <Button disabled={!!busy} onClick={() => void load()}>重新读取并编辑</Button> : <Button onClick={reset}>添加另一个渠道</Button>)}<Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>关闭</Button></div>
          {busy && <p className="field-help" role="status">{busy === 'saving' ? '正在保存，请勿重复提交。' : busy === 'loading' ? '正在读取已保存配置，不会提交修改。' : '正在只读核对原请求，不会重发保存请求。'}</p>}
        </form>
      </div>
    </dialog>
  </>;
}

const pendingRestart = (item: Channel) => item.restartRequired === true || item.connectionState === 'pending-restart';
const channelError = (code: Channel['errorCode']) => code === 'DINGTALK_CHANNEL_SWITCH_BLOCKED'
  ? '旧目标有未决依赖，身份切换被阻止；请先处理旧依赖，重复重启不能解除。'
  : code === 'CHANNEL_AUTH_REQUIRED' ? '需要完成渠道认证' : code ? '适配器异常，请查看运维说明' : '';

function ChannelCardStatus({ item }: { item: Channel }) {
  const hasRuntime = item.runningConnectionState !== undefined;
  const state = hasRuntime ? item.runningConnectionState : item.connectionState === 'pending-restart' ? 'unknown' : item.connectionState;
  const connected = hasRuntime ? item.runningConnected : item.connected;
  const error = item.runningErrorCode === undefined ? item.errorCode : item.runningErrorCode;
  const loaded = typeof item.savedVersion === 'string' && item.savedVersion === item.runningVersion;
  const mismatch = item.runningVersion !== undefined && item.runningVersion !== null && !loaded;
  const runtimeName = item.runningName && item.runningName !== item.channelId && item.runningName !== item.name ? item.runningName : '';
  return <div className="channel-card-status">
    {item.type === 'dingtalk-dws' && <div className="channel-configuration-state">
      {pendingRestart(item) ? <Badge tone="warning">已保存 · 待重启</Badge>
        : item.liveApplied === true ? <Badge tone="success">配置已应用</Badge>
        : item.liveApplied === false ? <Badge tone="warning">配置未应用</Badge> : <span>配置状态未提供</span>}
      <span>{item.writesAuthorized === true ? '外发已授权' : item.writesAuthorized === false ? '外发未授权' : '外发授权未报告'}</span>
    </div>}
    <div className="channel-health">
      {!state || state === 'unknown' ? <Badge tone="neutral">运行阶段未提供</Badge> : <Status value={state} />}
      <span>{connected === true ? <><RiCheckboxCircleFill size={13} />健康检查正常</> : connected === false ? '健康检查未就绪' : '健康状态未报告'}</span>
    </div>
    {item.runningVersion === null && <p className="channel-runtime-note">尚未加载，保存后须正常重启</p>}
    {mismatch && <p className="channel-runtime-note">当前仍使用此前配置{runtimeName ? `：${runtimeName}` : ''}{item.runningConversationType && item.runningConversationType !== item.conversationType ? ` · ${conversationType(item.runningConversationType)}` : ''}</p>}
    {(item.errorCode === 'DINGTALK_CHANNEL_SWITCH_BLOCKED' || error) && <p className="channel-card-error">{channelError(item.errorCode === 'DINGTALK_CHANNEL_SWITCH_BLOCKED' ? item.errorCode : error)}</p>}
  </div>;

}

export default function ChannelsPage({ id }: { id?: string }) {
  const route = useRoute();
  const execution = !!id && route.searchParams.get('view') === 'execution';
  const endpoint = id ? `/conversations/${encodeURIComponent(id)}` : '';
  const history = useResource<TaskHistory>(execution ? `${endpoint}/tasks` : null, 2500);
  const channels = useResource<{ items: Channel[] }>('/channels', 10000);
  const conversations = useResource<{ items: Conversation[] }>('/conversations', 5000);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const selected = conversations.data?.items.find(item => item.id === id);
  const [offsets, setOffsets] = useState<{ messages: number; outbox: number; messageRevision?: string; outboxRevision?: string }>({ messages: 0, outbox: 0 });
  useEffect(() => { setOffsets({ messages: 0, outbox: 0 }); }, [id]);
  const query = useResource<{ items: Message[]; pages: { messages: { nextOffset: number | null; total: number; revision?: string }; outbox: { nextOffset: number | null; total: number; revision?: string } } }>(id ? `/conversations/${encodeURIComponent(id)}/messages?messageOffset=${offsets.messages}&outboxOffset=${offsets.outbox}&limit=50${offsets.messageRevision ? `&messageRevision=${encodeURIComponent(offsets.messageRevision)}` : ''}${offsets.outboxRevision ? `&outboxRevision=${encodeURIComponent(offsets.outboxRevision)}` : ''}` : null, offsets.messages || offsets.outbox ? 0 : 5000);
  const items = (conversations.data?.items || []).filter(item => (!channel || channel === item.channelId) && `${item.name} ${item.channelId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (id) return <ConversationFrame path={`/channels/${encodeURIComponent(id)}`} execution={execution} channel label={`${selected?.name || '渠道会话'} · ${conversationType(selected?.type)}`}>
    {execution ? <ConversationExecution key={id} endpoint={endpoint} query={history} /> : <>
    {query.error && <Notice error={query.error} onRetry={() => { setOffsets({ messages: 0, outbox: 0 }); query.refresh(); }} stale={!!query.data} />}
    {query.loading && !query.data ? <Loading /> : !query.data && query.error ? <EmptyState title="消息记录暂不可读" description="使用上方按钮重新获取，或返回渠道列表。" /> : <MessageList key={id + ':' + offsets.messages + ':' + offsets.outbox} messages={query.data?.items || []} userLabel="渠道成员" empty={<EmptyState title="暂无消息" description="该会话接收到的消息和 Bot 的实际回复会显示在这里。" />} />}
    {(offsets.messages > 0 || offsets.outbox > 0 || query.data?.pages.messages.nextOffset != null || query.data?.pages.outbox.nextOffset != null) && <div className="conversation-pagination"><div className="inline-actions">{(offsets.messages > 0 || offsets.outbox > 0) && <Button variant="secondary" onClick={() => setOffsets({ messages: 0, outbox: 0 })}>回到最新</Button>}{(query.data?.pages.messages.nextOffset != null || query.data?.pages.outbox.nextOffset != null) && <Button variant="secondary" disabled={query.loading} onClick={() => setOffsets({ messages: query.data?.pages.messages.nextOffset ?? query.data!.pages.messages.total, outbox: query.data?.pages.outbox.nextOffset ?? query.data!.pages.outbox.total, messageRevision: query.data?.pages.messages.revision, outboxRevision: query.data?.pages.outbox.revision })}>查看更早消息</Button>}</div></div>}
  </>} </ConversationFrame>;
  return <div className="page-content channels-page"><div className="page-heading"><div><h2>渠道</h2></div><div className="inline-actions channel-page-actions"><a className="board-button board-button--secondary" href="#/settings">自定义渠道设置</a><DingtalkConfiguration onSaved={channels.refresh} /></div></div>
    {channels.error && <Notice error={channels.error} onRetry={channels.refresh} stale={!!channels.data} />}
    {!channels.data && channels.loading ? <Loading /> : !channels.data && channels.error ? <EmptyState title="渠道配置暂不可读" description="使用上方按钮重新获取。" /> : channels.data?.items.length ? <div className="channel-cards">{channels.data.items.map(item => <div className={`channel-card${channel === item.channelId ? ' selected' : ''}`} key={item.channelId}><button type="button" className="channel-card-select" aria-pressed={channel === item.channelId} onClick={() => setChannel(channel === item.channelId ? '' : item.channelId)}>
      <div className={`channel-symbol ${item.type === 'dingtalk-dws' ? 'dingtalk' : ''}`}><RiGlobalLine size={24} /></div><div><strong>{item.name || item.channelId}</strong><span>{item.name ? `${item.channelId} · ` : ''}{item.type === 'dingtalk-dws' ? `钉钉${item.conversationType ? ` · ${conversationType(item.conversationType)}` : ''}` : item.type === 'web-console' ? 'Web 对话' : item.type}</span></div><Badge tone={pendingRestart(item) ? 'warning' : item.enabled ? 'success' : 'neutral'}>{pendingRestart(item) ? '待重启' : item.enabled ? '已启用' : '未启用'}</Badge><div className="channel-card-bottom"><ChannelCardStatus item={item} /><RiArrowRightLine size={16} /></div>
    </button>{item.type === 'dingtalk-dws' && <div className="channel-card-actions"><DingtalkConfiguration channelId={item.channelId} onSaved={channels.refresh} /></div>}</div>)}</div> : <EmptyState title="还没有配置渠道" description="可用上方按钮添加钉钉群聊或私聊；保存后须重启才接入。" />}
    <div className="section-heading"><div><h3>渠道会话 <span>{items.length}</span></h3>{channel && <p>正在查看 {channel}</p>}</div><Search value={search} onChange={setSearch} label="搜索会话" /></div>
    {conversations.error && <Notice error={conversations.error} onRetry={conversations.refresh} stale={!!conversations.data} />}
    {!conversations.data && conversations.loading ? <Loading /> : !conversations.data && conversations.error ? <EmptyState title="渠道会话暂不可读" description="使用上方按钮重新获取。" /> : !items.length ? <EmptyState title={search || channel ? '没有匹配的会话' : '等待第一条消息'} description={search || channel ? '清除搜索或渠道筛选后重试。' : '已配置的渠道接收到消息后，会话会显示在这里。'} action={(search || channel) ? <Button variant="secondary" onClick={() => { setSearch(''); setChannel(''); }}>清除筛选</Button> : undefined} /> :
    <div className="conversation-list">{items.map(item => <a href={`#/channels/${encodeURIComponent(item.id)}`} className="conversation-row" key={item.id}><span className="conversation-symbol">{item.type === 'chat-room' ? <RiGroupLine size={21} /> : <RiChat3Line size={21} />}</span><div><strong>{item.name || '未命名会话'}</strong><span>{item.channelId} · {conversationType(item.type)}</span></div><RiArrowRightLine size={18} /></a>)}</div>}
  </div>;
}
