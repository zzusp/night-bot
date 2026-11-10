import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {api, ApiError, errorText, type ChannelSettings} from '../api';
import {Button} from './BoardPrimitives';
import {Confirm} from './ConfirmDialog';
import {channelApplicationText} from '../channel-response';

type Plugin = ChannelSettings['items'][number];
type Instance = ChannelSettings['channels'][number];
const defaults = (plugin: Plugin) => Object.fromEntries((plugin.fields || []).filter(field => field.type === 'boolean').map(field => [field.name, false]));

/** Shared manifest form. Both entry points use the same bounded operator API. */
export function CustomChannelForm({plugin, snapshot, initial, onSaved, onBusyChange}: {
  plugin: Plugin; snapshot: ChannelSettings; initial?: Instance; onSaved: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const prefix = useId(), form = useRef<HTMLFormElement>(null), writing = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [channelId, setChannelId] = useState(initial?.channelId || '');
  const [enabled, setEnabled] = useState(initial?.enabled || false);
  const [values, setValues] = useState<Record<string, string | boolean>>(initial?.config || defaults(plugin));
  const [version, setVersion] = useState(snapshot.version);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [unknown, setUnknown] = useState(false), [stale, setStale] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const locked = busy || saved || unknown || stale;
  const pending = useRef<{channelId: string; enabled: boolean; config: typeof values} | null>(null);
  const setWorking = (value: boolean) => { writing.current = value; if (live.current) { setBusy(value); onBusyChange?.(value); } };
  const field = (name: string) => ({id: `${prefix}-${name}`, name, 'aria-invalid': !!errors[name] || undefined,
    'aria-describedby': `${prefix}-${name}-help${errors[name] ? ` ${prefix}-${name}-error` : ''}`});
  const fieldError = (name: string) => errors[name] && <p id={`${prefix}-${name}-error`} className="field-error" role="alert">{errors[name]}</p>;
  const validate = (event: FormEvent) => {
    event.preventDefault(); if (writing.current || locked) return;
    const invalid: Record<string, string> = {};
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(channelId)) invalid.channelId = '使用小写字母开头，最多 64 个小写字母、数字或短横线。';
    else if (!initial && snapshot.channels.some(row => row.channelId === channelId)) invalid.channelId = '该渠道标识已存在，请换一个；新增不会覆盖已有配置。';
    for (const declaration of plugin.fields || []) {
      const value = values[declaration.name];
      if (declaration.required && (value === undefined || value === '' || (typeof value === 'string' && !value.trim()))) invalid[declaration.name] = `请填写${declaration.label}。`;
      else if (typeof value === 'string' && value && (value.length > 2048 || /[\x00-\x1f\x7f]/.test(value))) invalid[declaration.name] = '最多 2048 个字符，不含控制字符。';
      else if (declaration.type === 'credential-ref' && value && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))) invalid[declaration.name] = '只填写环境或密钥存储的引用名称，不填写真实密钥。';
    }
    setErrors(invalid); setError(''); setFeedback('');
    const first = Object.keys(invalid)[0];
    if (first) { (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus(); return; }
    setConfirm(true);
  };
  const save = async () => {
    if (writing.current || locked) return;
    pending.current = {channelId, enabled, config: {...values}};
    setWorking(true); setError(''); setFeedback('');
    try {
      const result = await api<{ok: boolean; restartRequired: boolean; liveApplied: boolean}>('/settings/channels', {method: 'POST', body: {
        type: plugin.type, ...pending.current, expectedVersion: version, createOnly: !initial,
      }});
      if (!live.current) return;
      if (result.ok !== true || typeof result.restartRequired !== 'boolean' || typeof result.liveApplied !== 'boolean' || (result.restartRequired && result.liveApplied)) throw new ApiError(502, 'INVALID_RESPONSE');
      setSaved(true); setFeedback(result.restartRequired ? '渠道配置已保存，正常重启后生效。' : `渠道配置已保存。${channelApplicationText(result)}`); onSaved();
      window.dispatchEvent(new Event('night-settings-updated'));
    } catch (cause) {
      if (!live.current) return;
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        if (cause.code === 'SETTINGS_VERSION_CONFLICT') setStale(true);
      } else { setUnknown(true); setFeedback('保存结果未知，原字段已锁定。请只读核对保存状态，不要重复提交。'); }
    } finally { setWorking(false); }
  };
  const read = async (reset = false) => {
    if (writing.current) return;
    setWorking(true); setError('');
    try {
      const latest = await api<ChannelSettings>('/settings/channels');
      if (!live.current) return;
      if (unknown && pending.current) {
        const expected = pending.current, row = latest.channels.find(item => item.channelId === expected.channelId && item.type === plugin.type);
        const config = Object.fromEntries(Object.entries(expected.config).filter(([,value]) => value !== ''));
        if (latest.version !== version && row?.enabled === expected.enabled && row.config &&
            Object.keys(row.config).length === Object.keys(config).length && Object.entries(config).every(([key, value]) => row.config?.[key] === value)) {
          setUnknown(false); setSaved(true); setFeedback('只读核对确认当前保存配置与本次字段一致。实际应用与连接状态请查看渠道列表。'); onSaved();
        } else setFeedback('仍无法确认本次保存结果，原字段保持锁定。请稍后只读核对，不要重复提交。');
      } else {
        setVersion(latest.version); setStale(false); onSaved();
        if (reset) { setChannelId(''); setEnabled(false); setValues(defaults(plugin)); setSaved(false); setErrors({}); setFeedback(''); }
        else setFeedback('已重新读取版本，原草稿保留。请核对字段后保存。');
      }
    } catch (cause) { if (live.current) setError(errorText(cause)); } finally { setWorking(false); }
  };
  return <div className="custom-channel-form">
    <p className="field-help">{plugin.name} · {plugin.type}。{initial ? '仅可编辑服务端允许安全变更的实例。' : '新增默认停用。'}启用需确认，支持的插件会在线接入，是否需重启以保存结果为准；不继承钉钉目标或外发授权。</p>
    <form ref={form} noValidate onSubmit={validate} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <fieldset className="channel-create-fields" disabled={locked}><legend className="sr-only">{plugin.name}配置</legend>
        <div className="channel-create-field channel-create-wide"><label htmlFor={`${prefix}-channelId`}>渠道标识</label><input {...field('channelId')} value={channelId} readOnly={!!initial} maxLength={64} autoComplete="off" onChange={event => setChannelId(event.target.value)}/><p className="field-help" id={`${prefix}-channelId-help`}>本安装唯一，新增不会覆盖已有渠道。</p>{fieldError('channelId')}</div>
        {plugin.fields?.map(declaration => <div className="channel-create-field channel-create-wide" key={declaration.name}>
          <label htmlFor={`${prefix}-${declaration.name}`}>{declaration.label}{declaration.required ? '（必填）' : ''}</label>
          {declaration.type === 'boolean' ? <select {...field(declaration.name)} value={values[declaration.name] === true ? 'true' : 'false'} onChange={event => setValues({...values, [declaration.name]: event.target.value === 'true'})}><option value="false">关闭</option><option value="true">开启</option></select>
            : <input {...field(declaration.name)} value={String(values[declaration.name] ?? '')} maxLength={2048} autoComplete="off" onChange={event => setValues({...values, [declaration.name]: event.target.value})}/>}
          <p className="field-help" id={`${prefix}-${declaration.name}-help`}>{declaration.type === 'credential-ref' ? '仅填写由环境或密钥存储提供的引用名称，不填写真实密钥。' : '由已安装插件声明的配置字段。'}</p>{fieldError(declaration.name)}
        </div>)}
        <div className="channel-create-field channel-create-wide"><label htmlFor={`${prefix}-enabled`}>重启后启用</label><select id={`${prefix}-enabled`} value={enabled ? 'true' : 'false'} onChange={event => setEnabled(event.target.value === 'true')}><option value="false">否，保持停用</option><option value="true">是，允许插件接入</option></select></div>
      </fieldset>
      <div className="channel-create-actions"><Button type="submit" variant="primary" disabled={locked} busy={busy}>保存自定义渠道</Button>
        {unknown && <Button disabled={busy} onClick={() => void read()}>核对保存状态</Button>}
        {stale && <Button disabled={busy} onClick={() => void read()}>重新读取配置版本</Button>}
        {saved && !initial && <Button disabled={busy} onClick={() => void read(true)}>添加另一个渠道</Button>}
      </div>
    </form>
    <p className="field-error" role={error ? 'alert' : undefined}>{error}</p><p className="channel-create-feedback" role="status" hidden={!feedback}>{feedback}</p>
    {confirm && <Confirm title="保存自定义渠道" onClose={() => setConfirm(false)} onConfirm={() => void save()}><p>渠道 {channelId}，插件 {plugin.name}（{plugin.type}）。{enabled ? '保存后插件可能立即接入并按自身权限处理消息。' : '保持停用。'}运行中渠道的修改受插件安全生命周期保护；不会继承钉钉的目标或授权规则。</p></Confirm>}
  </div>;
}
