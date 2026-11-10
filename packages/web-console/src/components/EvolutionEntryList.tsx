import {RiArrowRightSLine, RiBookOpenLine, RiBrainLine} from '@remixicon/react';
import type {EvolutionItem, MemoryProvenance} from '../api';
import {dateTime} from '../hooks';
import {Button} from './BoardPrimitives';

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

function usageCounts(item: EvolutionItem) {
  return item.kind === 'skill'
    ? [['模型调用', item.modelUseCount], ['用户引用', item.userUseCount], ['文件读取', item.fileReadCount]] as const
    : item.memoryUse ? [['读取返回', item.memoryUse.readCount], ['搜索命中', item.memoryUse.searchCount]] as const : null;
}

function Usage({item}: {item: EvolutionItem}) {
  const counts = usageCounts(item);
  if (!counts || counts.every(([, value]) => value == null)) return <span className="evolution-usage-empty">未记录</span>;
  return <dl className="evolution-use-counts">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null ? <abbr title="未记录">—</abbr> : formatEvolutionCount(value)}</dd></div>)}</dl>;
}

/** Source and audit metadata stay available without crowding the browsing list. */
export function EvolutionEntryMetadata({item}: {item: EvolutionItem}) {
  const lastUsedAt = item.kind === 'skill' ? item.lastUsedAt : item.memoryUse?.lastAccess?.at;
  return <details className="evolution-entry-details"><summary>来源与使用记录</summary><div className="evolution-entry-details-body">
    <dl className="evolution-entry-properties"><div><dt>类型</dt><dd>{item.kind === 'memory' ? '记忆' : item.origin === 'installed' ? '目录技能' : '学习技能'}</dd></div><div><dt>状态</dt><dd>{statuses[item.status]}</dd></div><div><dt>作用域</dt><dd>{scopeLabels[item.scope]}</dd></div><div><dt>版本</dt><dd className="evolution-entry-version">{String(item.revision)}</dd></div></dl>
    <div className="evolution-entry-source"><EntrySource item={item}/></div>
    <Usage item={item}/>
    <p className="evolution-used-at">{lastUsedAt ? <>最近{item.kind === 'skill' ? '使用' : '返回'} <time dateTime={lastUsedAt}>{dateTime(lastUsedAt)}</time></> : '最近使用未记录'}</p>
    {item.kind === 'memory' && item.memoryUse?.lastAccess && <EvolutionSource value={item.memoryUse.lastAccess.provenance}/>}
    {item.updatedSinceUse && <p className="evolution-update-hint">载入版本与当前不同</p>}
  </div></details>;
}

/** Metadata only. The name is the explicit, version-bound content read action. */
export default function EvolutionEntryList({items, onView}: {items: EvolutionItem[]; onView: (item: EvolutionItem, button: HTMLButtonElement) => void}) {
  return <div className="evolution-table-wrap"><table className="evolution-table">
    <caption className="sr-only">Bot 公共记忆与技能。点击名称查看内容、来源与使用记录。</caption>
    <colgroup><col className="evolution-col-entry"/><col className="evolution-col-usage"/><col className="evolution-col-updated"/></colgroup>
    <thead><tr><th scope="col">名称</th><th scope="col">使用记录</th><th scope="col">最近更新</th></tr></thead>
    <tbody>{items.map(item => <tr key={`${item.kind}:${item.id}`}>
      <td className="evolution-entry-cell"><Button variant="ghost" className="evolution-entry-open" aria-label={`查看内容：${item.name || '未命名记录'}${item.status !== 'applied' ? `，${statuses[item.status]}` : ''}${item.updatedSinceUse ? '，载入版本与当前不同' : ''}`} onClick={event => onView(item, event.currentTarget)}>
        <span className="evolution-item-icon" aria-hidden="true">{item.kind === 'memory' ? <RiBrainLine size={18}/> : <RiBookOpenLine size={18}/>}</span>
        <span className="evolution-item-copy"><span className="evolution-item-title">{item.name || '未命名记录'}</span><span className="sr-only">{item.kind === 'memory' ? '记忆' : '技能'} · {scopeLabels[item.scope]}</span>
          {item.status === 'applied' ? <span className="sr-only">已应用</span> : <span className="evolution-item-status">{statuses[item.status]}</span>}
          {item.updatedSinceUse && <span className="evolution-update-hint">载入版本与当前不同</span>}
        </span><RiArrowRightSLine className="evolution-item-arrow" size={17} aria-hidden="true"/>
      </Button></td>
      <td className="evolution-usage-cell"><Usage item={item}/></td>
      <td className="evolution-updated-cell"><time dateTime={item.updatedAt || undefined}>{dateTime(item.updatedAt || undefined)}</time></td>
    </tr>)}</tbody>
  </table></div>;
}
