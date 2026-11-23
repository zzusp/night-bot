import {api, ApiError, getSessionVersion, operationErrorText} from '../api';
import {AttachmentInputError, encodeAttachments, newComposerRequestId} from '../compose-attachments';
import type {TaskInputAttempt, TaskInputDraft, TaskInputDrafts} from '../task-input-drafts';
import {Button, Composer} from './BoardPrimitives';

type InputReceipt = {taskId: string; sessionId: string; requestId: string; status: 'accepted'};
const outcomeUnknown = '发送结果待核实。草稿与附件已保留，不会自动重发。';
const mismatch = '任务会话已变化，不能向新会话重发原消息。';

export function TaskInputComposer({taskId, sessionId, draft, drafts}: {
  taskId: string; sessionId?: string; draft: TaskInputDraft; drafts: TaskInputDrafts;
}) {
  const endpoint = `/tasks/${encodeURIComponent(taskId)}/input`;
  const settle = (value: TaskInputAttempt, edit: (draft: TaskInputDraft) => TaskInputDraft) => {
    drafts.update(taskId, previous => previous.attempt === value ? edit(previous) : previous);
  };
  const accept = (receipt: InputReceipt, value: TaskInputAttempt) => {
    if (receipt?.status !== 'accepted' || receipt.taskId !== taskId || receipt.sessionId !== value.sessionId || receipt.requestId !== value.requestId) return false;
    settle(value, () => ({text: '', files: [], accepted: value.requestId}));
    return true;
  };
  const edit = (patch: {text?: string; files?: File[]}) => drafts.update(taskId, previous => previous.attempt || !sessionId
    ? previous : {...previous, ...patch, error: undefined, accepted: undefined});

  const send = async (retry?: TaskInputAttempt) => {
    const current = drafts.get(taskId);
    if (!sessionId || current.checking || (retry ? current.attempt !== retry || retry.state !== 'missing' || retry.sessionId !== sessionId : current.attempt)) return;
    if (!current.text.trim() && !current.files.length) return;
    if (current.text.length > 10_000) {
      drafts.update(taskId, previous => ({...previous, error:'消息最多 10,000 字符，请缩短后发送。'}));
      return;
    }
    const value: TaskInputAttempt = retry ? {...retry, state: 'sending'} : {
      requestId: newComposerRequestId(), sessionId, text: current.text, files: current.files, state: 'sending',
    };
    drafts.update(taskId, previous => ({...previous, attempt: value, error: undefined, accepted: undefined}));
    const version = getSessionVersion();
    try {
      const attachments = await encodeAttachments(value.files);
      // Do not let an async file read turn a previous login's click into a new login's write.
      if (getSessionVersion() !== version) return;
      const receipt = await api<InputReceipt>(endpoint, {method:'POST', body:{sessionId:value.sessionId, requestId:value.requestId, text:value.text, ...(attachments.length ? {attachments} : {})}});
      if (getSessionVersion() !== version) return;
      if (accept(receipt, value)) return;
      settle(value, previous => ({...previous, attempt: {...value, state:'unknown'}, error:outcomeUnknown}));
    } catch (error) {
      if (getSessionVersion() !== version) return;
      if (error instanceof AttachmentInputError) {
        settle(value, previous => ({...previous, attempt:retry, error:error.message}));
      } else if (!retry && error instanceof ApiError && ([400, 403, 404, 413, 429].includes(error.status)
        || ['TASK_INPUT_SESSION_STALE', 'TASK_INPUT_UNAVAILABLE', 'DYNAMIC_COMMAND_ID_CONFLICT', 'DYNAMIC_TASK_REVISION_STALE', 'DYNAMIC_TASK_NOT_ACTIVE', 'DYNAMIC_TASK_NOT_QUIESCENT'].includes(error.code))) {
        const message = error.code === 'TASK_INPUT_SESSION_STALE' ? mismatch : error.code === 'TASK_INPUT_UNAVAILABLE'
          ? '当前任务不能接收消息。' : operationErrorText(error);
        settle(value, previous => ({...previous, attempt:undefined, error:`${message} 草稿与附件已保留。`}));
      } else {
        settle(value, previous => ({...previous, attempt:{...value, state:'unknown'}, error:outcomeUnknown}));
      }
    }
  };

  const check = async () => {
    const current = drafts.get(taskId);
    const value = current.attempt;
    if (!value || value.state === 'sending' || current.checking) return;
    const version = getSessionVersion();
    settle(value, previous => ({...previous, checking:true}));
    try {
      const receipt = await api<InputReceipt>(`${endpoint}/${encodeURIComponent(value.requestId)}`);
      if (getSessionVersion() !== version) return;
      if (accept(receipt, value)) return;
      settle(value, previous => ({...previous, checking:false, error:outcomeUnknown}));
    } catch (error) {
      if (getSessionVersion() !== version) return;
      if (error instanceof ApiError && error.status === 404 && error.code === 'TASK_INPUT_NOT_FOUND') {
        settle(value, previous => ({...previous, checking:false, attempt:{...value, state:'missing'},
          error:sessionId && sessionId !== value.sessionId ? mismatch : '暂未找到接收记录。可用同一请求重试，不会重复接纳。'}));
      } else settle(value, previous => ({...previous, checking:false, error:outcomeUnknown}));
    }
  };

  if (!sessionId && !draft.text && !draft.files.length && !draft.attempt && !draft.accepted) return null;
  return <div className="composer-dock task-input-dock"><div>
    <Composer value={draft.text} onChange={text => edit({text})} onSend={() => send()}
      files={draft.files} onFilesChange={files => edit({files})} disabled={!sessionId || !!draft.attempt}
      busy={draft.attempt?.state === 'sending'} error={draft.error || (!sessionId && (draft.text || draft.files.length) ? '当前任务不能接收消息，草稿已保留。' : undefined)}
      placeholder="给当前任务发消息…" />
    {draft.attempt && draft.attempt.state !== 'sending' && <div className="inline-actions task-input-actions">
      <Button variant="secondary" disabled={draft.checking} busy={draft.checking} onClick={() => void check()}>核对发送状态</Button>
      {draft.attempt.state === 'missing' && draft.attempt.sessionId === sessionId && <Button variant="secondary" disabled={draft.checking} onClick={() => void send(draft.attempt)}>重试这条消息</Button>}
    </div>}
    <p className="task-input-status" role="status">{draft.accepted ? '消息已提交给当前任务。' : ''}</p>
  </div></div>;
}
