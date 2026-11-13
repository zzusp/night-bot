import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useResource } from './hooks';
import { Button } from './components/BoardPrimitives';
import { Loading, Notice } from './components/Shared';
import './styles/feedback.css';

type Feedback = { id: string; state: 'collecting' | 'editing' | 'ready' | 'failed' | 'submitting' | 'submitted' | 'unknown'; title: string; body: string; target: string; error?: string; url?: string };
type Destination = { target: string; model: string | null; revision?: string; endpoint?: string };
export const feedbackPrivacyNotice = '默认不收集。经您同意后采集本地诊断信息，脱敏后发送所选模型服务分析；自动脱敏可能遗漏。内容可审核修改，确认后才提交 GitHub。';

export const feedbackImageNotice = '图片在 GitHub 页面中手动粘贴或拖入，不会由 Night Bot 读取、上传或发送给 Pi。图片可能包含隐私，无法保证自动脱敏，请先遮盖敏感信息。发布前请在 GitHub 核对正文和图片，最终提交后可能公开可见。';

export default function FeedbackPage() {
  const destination = useResource<Destination>('/feedback');
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [collectEvidence, setCollectEvidence] = useState(false);
  const [nativeImages, setNativeImages] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [nativeOpened, setNativeOpened] = useState(false);
  const [editDraft, setEditDraft] = useState<{title: string; body: string} | null>(null);
  const [consent, setConsent] = useState(false), [confirm, setConfirm] = useState(false);
  const [record, setRecord] = useState<Feedback | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [url, setUrl] = useState(''), [submitAttempted, setSubmitAttempted] = useState(false);
  const editLock = useRef(false), requestLock = useRef(false), submitLock = useRef(false), revokeLock = useRef(false), mounted = useRef(true), titleInput = useRef<HTMLInputElement>(null);
  const polling = useResource<Feedback>(record?.state === 'collecting' ? `/feedback/${encodeURIComponent(record.id)}` : null, 2000);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (polling.data && polling.data.id === record?.id) { setRecord(polling.data); setConfirm(false); } }, [polling.data, record?.id]);
  useEffect(() => { setConsent(false); }, [destination.data?.model, destination.data?.endpoint, destination.data?.revision]);
  const collecting = record?.state === 'collecting';
  const collect = async () => {
    if (requestLock.current || !destination.data || record || (collectEvidence && (!consent || !destination.data.model || !destination.data.revision))) return;
    if (!title.trim() || !description.trim()) { setError('请填写标题与问题详情。'); titleInput.current?.focus(); return; }
    requestLock.current = true; setBusy(true); setError('');
    try {
      const result = await api<Feedback>(collectEvidence ? '/feedback/collect' : '/feedback/draft', { method: 'POST', body: collectEvidence ? { title: title.trim(), description: description.trim(), consent: true, model: destination.data.model, revision: destination.data.revision } : { title: title.trim(), description: description.trim() } });
      if (mounted.current) { setRecord(result); setConfirm(false); }
    } catch (cause) { if (mounted.current) {
      if (cause instanceof ApiError && ['FEEDBACK_MODEL_CHANGED','FEEDBACK_INPUT_INVALID','FEEDBACK_CONSENT_REQUIRED','FEEDBACK_BUSY','FEEDBACK_LIMIT','FEEDBACK_CLOSED','FEEDBACK_UNAVAILABLE'].includes(cause.code)) { requestLock.current = false; setConsent(false); destination.refresh(); setError(collectEvidence ? '诊断尚未启动。请核对模型与输入，稍后重新同意采集。' : '预览尚未创建。请核对输入后重试。'); }
      else setError('请求未能确认，请勿重复提交；当前问题内容已保留。');
    } }
    finally { if (mounted.current) setBusy(false); /* An uncertain POST is never automatically replayed. */ }
  };
  const revoke = async () => {
    if (!record || busy || submitAttempted || submitLock.current || revokeLock.current || editLock.current) return;
    revokeLock.current = true;
    setBusy(true); setError('');
    try {
      await api(`/feedback/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      if (mounted.current) { setRecord(null); setEditDraft(null); setNativeOpened(false); setCopyStatus(''); setConsent(false); setConfirm(false); requestLock.current = false; }
    } catch { if (mounted.current) setError('未能确认撤销，请重新核对；未提交 GitHub。'); }
    finally { revokeLock.current = false; if (mounted.current) setBusy(false); }
  };
  const updatePreview = async () => {
    if (!record || record.state !== 'ready' || !editDraft || busy || submitAttempted || editLock.current || submitLock.current || revokeLock.current) return;
    setConfirm(false);
    if (!editDraft.title.trim() || !editDraft.body.trim()) { setError('请填写提交标题与正文。'); return; }
    editLock.current = true; setBusy(true); setError('');
    try {
      const updated = await api<Feedback>(`/feedback/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: { title: editDraft.title, body: editDraft.body } });
      if (!mounted.current) return;
      if (updated.id !== record.id || updated.state !== 'ready') throw new Error('Preview not ready');
      setRecord(updated); setEditDraft(null); setConfirm(false);
    } catch { if (mounted.current) setError('预览更新未完成，修改内容已保留。请重新更新预览，核对脱敏后的内容再提交。'); }
    finally { editLock.current = false; if (mounted.current) setBusy(false); }
  };
  const copyField = async (field: 'title' | 'body') => {
    if (!record || record.state !== 'ready' || editDraft || busy || submitAttempted) return;
    try {
      await navigator.clipboard.writeText(record[field]);
      if (mounted.current) setCopyStatus(field === 'title' ? '标题已复制' : '完整正文已复制');
    } catch { if (mounted.current) setCopyStatus('无法复制，请从上方预览手动选择并复制。'); }
  };
  const openGitHub = () => {
    if (!record || record.state !== 'ready' || !nativeImages || !confirm || busy || submitAttempted || editDraft !== null) return;
    // Lock the API route before opening; only an explicit button can hand off.
    setNativeOpened(true); setCopyStatus('');
    window.open('https://github.com/zzusp/night-bot/issues/new', '_blank', 'noopener,noreferrer');
  };
  const submit = async () => {
    if (nativeImages || nativeOpened) return;
    if (!record || record.state !== 'ready' || editDraft !== null || !confirm || busy || submitAttempted || submitLock.current || revokeLock.current || editLock.current) return;
    submitLock.current = true;
    setSubmitAttempted(true); setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>(`/feedback/${encodeURIComponent(record.id)}/submit`, { method: 'POST', body: { confirm: true, title: record.title, body: record.body } });
      const parsed = new URL(result.url);
      if (parsed.origin !== 'https://github.com' || !parsed.pathname.startsWith(`/${record.target}/issues/`)) throw new Error('Unexpected issue destination');
      if (mounted.current) setUrl(parsed.href);
    } catch { if (mounted.current) { setConfirm(false); setError('提交未能确认。请在目标仓库核对，当前页面不会重复提交。'); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const verify = async () => {
    if (!record || busy || editLock.current) return;
    setBusy(true); setConfirm(false);
    try {
      const current = await api<Feedback>(`/feedback/${encodeURIComponent(record.id)}`);
      if (!mounted.current) return;
      setRecord(current);
      if (current.state === 'ready') { submitLock.current = false; setSubmitAttempted(false); setError('尚未提交。请重新检查当前内容，再明确确认。'); }
      else if (current.state === 'submitted' && current.url && /^https:\/\/github\.com\/zzusp\/night-bot\/issues\/\d+$/.test(current.url)) { setUrl(current.url); setError(''); }
      else setError('提交状态仍未确认，请到目标仓库核对；不会重复提交。');
    } catch { if (mounted.current) setError('暂时无法核对提交状态，请稍后重新核对。'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="page-content feedback-page">
    {destination.error && <Notice error={destination.error} onRetry={destination.refresh} />}
    {!destination.data && destination.loading && <Loading />}
    <section className="settings-card"><form noValidate onSubmit={event => { event.preventDefault(); void collect(); }}>
      <label htmlFor="feedback-title">标题</label><input ref={titleInput} id="feedback-title" maxLength={160} value={title} disabled={busy || !!record || requestLock.current} onChange={event => setTitle(event.target.value)} aria-describedby={error ? 'feedback-error' : undefined} />
      <label htmlFor="feedback-description">问题详情</label><textarea className="resize-none" id="feedback-description" rows={7} maxLength={6000} value={description} disabled={busy || !!record || requestLock.current} onChange={event => setDescription(event.target.value)} placeholder="发生了什么、操作步骤、期望结果" />
      {!record && <fieldset disabled={busy || requestLock.current} className="feedback-mode" aria-describedby="feedback-privacy-summary"><legend>本地现场信息</legend>
        <label className="feedback-consent"><input type="radio" name="feedback-mode" value="none" checked={!collectEvidence} onChange={() => { setCollectEvidence(false); setConsent(false); }} />不收集</label>
        <label className="feedback-consent"><input type="radio" name="feedback-mode" value="collect" checked={collectEvidence} onChange={() => { setCollectEvidence(true); setConsent(false); }} />由 AI 收集诊断</label>
      </fieldset>}
      <div className="feedback-privacy" aria-label="数据收集与提交提示">
        <p id="feedback-privacy-summary" className="feedback-privacy-summary">{feedbackPrivacyNotice}</p>
      </div>
      {!record && <>{collectEvidence && <label className="feedback-consent"><input type="checkbox" checked={consent} disabled={busy || requestLock.current || !destination.data?.model} onChange={event => setConsent(event.target.checked)} />我同意采集消息链路、路由、任务及模型/工具计时、错误摘要，脱敏后连同问题发送至 {destination.data?.model ?? '未配置模型'}（{destination.data?.endpoint ?? '配置的模型服务'}）用于分析；本次不提交 GitHub。</label>}<div><Button variant="primary" type="submit" busy={busy} disabled={!destination.data || requestLock.current || (collectEvidence && (!consent || !destination.data.model || !destination.data.revision))}>{collectEvidence ? '开始诊断' : '生成预览'}</Button></div></>}
    </form></section>
    {record && !submitAttempted && <Button disabled={busy} onClick={() => void revoke()}>清除暂存</Button>}
    {collecting && <Loading>Pi 正在诊断</Loading>}
    {polling.error && <Notice error={polling.error} onRetry={polling.refresh} />}
    {record?.state === 'failed' && <Notice error={new Error()} message="本次诊断失败，未提交 GitHub。问题内容已保留。" />}
    {record && ['ready', 'editing', 'submitting', 'submitted', 'unknown'].includes(record.state) && <section className="settings-card feedback-preview" aria-label="提交内容预览"><h2>提交内容</h2><dl><dt>目标仓库</dt><dd>{record.target}</dd></dl>
      {!url && record.state === 'ready' ? <div className="feedback-preview-fields">
        <label htmlFor="feedback-issue-title">提交标题</label><input id="feedback-issue-title" maxLength={160} value={editDraft?.title ?? record.title} disabled={busy || submitAttempted} onChange={event => { setEditDraft({title: event.target.value, body: editDraft?.body ?? record.body}); setConfirm(false); }} />
        <label htmlFor="feedback-issue-body">提交正文</label><textarea className="resize-none" id="feedback-issue-body" rows={16} maxLength={48000} value={editDraft?.body ?? record.body} disabled={busy || submitAttempted} onChange={event => { setEditDraft({title: editDraft?.title ?? record.title, body: event.target.value}); setConfirm(false); }} />
        {editDraft && <div><Button disabled={busy || submitAttempted} busy={busy && editLock.current} onClick={() => void updatePreview()}>更新预览</Button></div>}
      </div> : <><h3>{record.title}</h3><pre tabIndex={0} aria-label="Issue 完整正文">{record.body}</pre></>}
      {!url && record.state === 'ready' && <>
        <fieldset className="feedback-mode" disabled={busy || submitAttempted || nativeOpened}><legend>图片附件</legend>
          <label className="feedback-consent"><input type="radio" name="feedback-images" checked={!nativeImages} onChange={() => { setNativeImages(false); setConfirm(false); setCopyStatus(''); }} />不添加图片</label>
          <label className="feedback-consent"><input type="radio" name="feedback-images" checked={nativeImages} onChange={() => { setNativeImages(true); setConfirm(false); setCopyStatus(''); }} />在 GitHub 添加图片</label>
        </fieldset>
        {nativeImages && <p className="feedback-image-notice">{feedbackImageNotice}</p>}
        <label className="feedback-consent"><input type="checkbox" checked={confirm} disabled={busy || submitAttempted || editDraft !== null} onChange={event => setConfirm(event.target.checked)} />{nativeImages ? '我已核对以上内容，将在 GitHub 粘贴正文、添加图片并最终确认提交。' : <>我已检查以上完整内容，同意向 {record.target} 提交 Issue，内容可能公开可见。</>}</label>
        {nativeImages ? <div className="feedback-github-handoff" aria-label="GitHub 图片反馈">
          <ol><li>复制标题与完整正文。</li><li>打开 GitHub 编辑页，粘贴内容并添加图片。</li><li>检查图片上传完成后，在 GitHub 提交。</li></ol>
          <div className="feedback-handoff-actions">
            <Button disabled={busy || submitAttempted || editDraft !== null} onClick={() => void copyField('title')}>复制标题</Button>
            <Button disabled={busy || submitAttempted || editDraft !== null} onClick={() => void copyField('body')}>复制完整正文</Button>
            <Button variant="primary" disabled={!confirm || busy || submitAttempted || editDraft !== null} onClick={openGitHub}>打开 GitHub 编辑页 ↗</Button>
          </div>
          <p>{nativeOpened ? '已转入 GitHub 手动提交，本次反馈不会再经 API 提交。若未弹出编辑页，请允许浏览器弹窗后重试；请在 GitHub 完成并核对 Issue。' : 'Night Bot 不会创建 Issue；关闭或返回此页不会自动提交。'}</p>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </div> : <Button variant="primary" disabled={!confirm || submitAttempted || editDraft !== null} busy={busy} onClick={() => void submit()}>确认提交 Issue</Button>}
      </>}
    </section>}
    {submitAttempted && !url && <Button disabled={busy} onClick={() => void verify()}>核对提交状态</Button>}
    {error && <p id="feedback-error" role="alert">{error}</p>}
    {url && <p role="status">已提交：<a href={url} target="_blank" rel="noopener noreferrer">查看 Issue</a></p>}
  </div>;
}
