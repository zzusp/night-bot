import {RiArrowRightSLine, RiBookOpenLine, RiBrainLine} from '@remixicon/react';
import type {EvolutionItem, MemoryProvenance} from '../api';
import {dateTime} from '../hooks';
import {Badge, Button} from './BoardPrimitives';

export const formatEvolutionCount = (value: number | null | undefined) => value == null ? '未记录' : new Intl.NumberFormat('zh-CN').format(value);
const scopeLabels = {bot: 'Bot 公共', personal: '个人', group: '群组', project: '项目'};
const statuses: Record<EvolutionItem['status'], string> = {applied: '已应用', candidate: '候选，未应用', disabled: '禁止调用', invalid: '格式无效', shadowed: '同名被覆盖', undiscovered: '目录未接入运行时', unsupported: '支持记忆不可用'};

export function EvolutionSource({value}: {value?: MemoryProvenance | null}) {
  if (!value) return <span className="muted">来源未知</span>;
  const type = value.conversationType === 'chat-room' ? '群聊' : value.conversationType === 'chat' ? '私聊' : '会话类型未知';
  return <details className="evolution-source"><summary>{value.conversationName ? `${type} · ${value.conversationName}` : value.taskTitle || value.channelId || '来源详情'}</summary><dl><dt>渠道</dt><dd>{value.channelId || '未知'}</dd><dt>会话</dt><dd>{type} · {value.conversationName || '名称未知'}</dd><dt>会话 ID</dt><dd>{value.conversationId || '未知'}</dd><dt>关联任务</dt><dd>{value.taskId ? <a href={`#/tasks/${encodeURIComponent(value.taskId)}`}>{value.taskTitle || value.taskId}</a> : '未知'}</dd></dl>{value.resolvedFrom && <p className="muted">来源由保留记录恢复；名称是该记录中的名称。</p>}</details>;
}

function EntrySource({item}: {item: EvolutionItem}) {
  if (item.kind === 'memory') return <><EvolutionSource value={item.provenance}/>{(item.origins?.length || 0) > 1 && <details><summary>其他来源（{item.origins!.length - 1}）</summary>{item.origins!.filter(row => JSON.stringify(row) !== JSON.stringify(item.provenance)).map((row, index) => <EvolutionSource key={index} value={row}/>)}</details>}{item.migration?.conflict && <span className="muted">旧库同名冲突，保留为候选</span>}</>;
  if (item.origin === 'installed') return <span className="evolution-location">{item.location || '安装目录'}</span>;
  return <>{item.taskIds?.length ? item.taskIds.map(id => <a className="text-link" key={id} href={`#/tasks/${encodeURIComponent(id)}`}>任务 {id}</a>) : '复盘来源未知'}</>;
}

function Usage({item}: {item: EvolutionItem}) {
  const counts = item.kind === 'skill'
    ? [['模型调用', item.modelUseCount], ['用户引用', item.userUseCount], ['文件读取', item.fileReadCount]] as const
    : item.memoryUse ? [['读取返回', item.memoryUse.readCount], ['搜索命中', item.memoryUse.searchCount]] as const : null;
  if (!counts) return <span className="evolution-usage-empty">使用历史未记录</span>;
  const lastUsedAt = item.kind === 'skill' ? item.lastUsedAt : item.memoryUse?.lastAccess?.at;
  return <div className="evolution-usage">
    <dl className="evolution-use-counts">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatEvolutionCount(value)}</dd></div>)}</dl>
    <span className="evolution-used-at">{lastUsedAt ? <>最近{item.kind === 'skill' ? '使用' : '返回'} <time dateTime={lastUsedAt}>{dateTime(lastUsedAt)}</time></> : '最近使用未记录'}</span>
    {item.kind === 'memory' && item.memoryUse?.lastAccess && <EvolutionSource value={item.memoryUse.lastAccess.provenance}/>}
  </div>;
}

/** Metadata only. Content reads remain an explicit, version-bound action. */
export default function EvolutionEntryList({items, onView}: {items: EvolutionItem[]; onView: (item: EvolutionItem, button: HTMLButtonElement) => void}) {
  return <div className="evolution-table-wrap"><table className="evolution-table">
    <caption className="sr-only">Bot 公共记忆、技能使用、来源与当前更新</caption>
    <colgroup><col className="evolution-col-entry"/><col className="evolution-col-usage"/><col className="evolution-col-updated"/><col className="evolution-col-action"/></colgroup>
    <thead><tr><th scope="col">条目</th><th scope="col">使用情况</th><th scope="col">最近更新</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
    <tbody>{items.map(item => <tr key={`${item.kind}:${item.id}`}>
      <td className="evolution-entry-cell"><div className="evolution-item">
        <span className="evolution-item-icon" aria-hidden="true">{item.kind === 'memory' ? <RiBrainLine size={19}/> : <RiBookOpenLine size={19}/>}</span>
        <div className="evolution-item-copy"><div className="evolution-item-title"><strong>{item.name || '未命名记录'}</strong><Badge tone={item.status === 'applied' ? 'success' : 'warning'}>{statuses[item.status]}</Badge></div>
          <div className="evolution-item-meta"><span>{item.kind === 'memory' ? '记忆' : item.origin === 'installed' ? '目录技能' : '学习技能'}</span><span>{scopeLabels[item.scope]}</span><details className="evolution-entry-details"><summary>来源与版本</summary><div className="evolution-entry-details-body"><div className="evolution-entry-version">版本 <span>{String(item.revision)}</span></div><EntrySource item={item}/></div></details></div>
          {item.updatedSinceUse && <span className="evolution-update-hint">载入版本与当前不同</span>}
        </div>
      </div></td>
      <td className="evolution-usage-cell"><Usage item={item}/></td>
      <td className="evolution-updated-cell"><span className="evolution-mobile-label">更新于 </span><time dateTime={item.updatedAt || undefined}>{dateTime(item.updatedAt || undefined)}</time></td>
      <td className="evolution-action-cell"><Button variant="ghost" className="evolution-view-action" aria-label={`查看内容：${item.name || '未命名记录'}`} onClick={event => onView(item, event.currentTarget)}>查看内容<RiArrowRightSLine size={17} aria-hidden="true"/></Button></td>
    </tr>)}</tbody>
  </table></div>;
}
