import { useEffect, useState } from 'react';
import { RiChat3Line, RiGroupLine, RiArrowLeftLine, RiArrowRightLine, RiGlobalLine, RiCheckboxCircleFill } from '@remixicon/react';
import { type Channel, type Conversation, type Message } from './api';
import { useResource } from './hooks';
import { Badge, Button, EmptyState } from './components/BoardPrimitives';
import { Loading, MessageList, Notice, Search } from './components/Shared';

const conversationType = (type?: string | null) => type === 'chat-room' ? '群聊' : type === 'chat' ? '单聊' : '会话类型未记录';

export default function ChannelsPage({ id }: { id?: string }) {
  const channels = useResource<{ items: Channel[] }>('/channels', 10000);
  const conversations = useResource<{ items: Conversation[] }>('/conversations', 5000);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const selected = conversations.data?.items.find(item => item.id === id);
  const [offsets, setOffsets] = useState<{ messages: number; outbox: number; messageRevision?: string; outboxRevision?: string }>({ messages: 0, outbox: 0 });
  useEffect(() => { setOffsets({ messages: 0, outbox: 0 }); }, [id]);
  const query = useResource<{ items: Message[]; pages: { messages: { nextOffset: number | null; total: number; revision?: string }; outbox: { nextOffset: number | null; total: number; revision?: string } } }>(id ? `/conversations/${encodeURIComponent(id)}/messages?messageOffset=${offsets.messages}&outboxOffset=${offsets.outbox}&limit=50${offsets.messageRevision ? `&messageRevision=${encodeURIComponent(offsets.messageRevision)}` : ''}${offsets.outboxRevision ? `&outboxRevision=${encodeURIComponent(offsets.outboxRevision)}` : ''}` : null, offsets.messages || offsets.outbox ? 0 : 5000);
  const items = (conversations.data?.items || []).filter(item => (!channel || channel === item.channelId) && `${item.name} ${item.channelId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (id) return <div className="channel-chat"><div className="channel-chat-header"><a className="back-link" href="#/channels"><RiArrowLeftLine size={16} />全部渠道</a><div><h2>{selected?.name || '渠道会话'}</h2><p>{conversationType(selected?.type)} · {selected?.channelId || '渠道消息'}</p></div><Badge tone="neutral">只读</Badge></div>
    {query.error && <Notice error={query.error} onRetry={() => { setOffsets({ messages: 0, outbox: 0 }); query.refresh(); }} stale={!!query.data} />}
    {query.loading && !query.data ? <Loading /> : !query.data && query.error ? <EmptyState title="消息记录暂不可读" description="使用上方按钮重新获取，或返回渠道列表。" /> : <MessageList key={id + ':' + offsets.messages + ':' + offsets.outbox} messages={query.data?.items || []} userLabel="渠道成员" empty={<EmptyState title="暂无消息" description="该会话接收到的消息和 Bot 的实际回复会显示在这里。" />} />}
    <div className="channel-chat-footer"><span>消息与回复来自现有渠道记录</span><div className="inline-actions">{(offsets.messages > 0 || offsets.outbox > 0) && <Button variant="secondary" onClick={() => setOffsets({ messages: 0, outbox: 0 })}>回到最新</Button>}{(query.data?.pages.messages.nextOffset != null || query.data?.pages.outbox.nextOffset != null) && <Button variant="secondary" disabled={query.loading} onClick={() => setOffsets({ messages: query.data?.pages.messages.nextOffset ?? query.data!.pages.messages.total, outbox: query.data?.pages.outbox.nextOffset ?? query.data!.pages.outbox.total, messageRevision: query.data?.pages.messages.revision, outboxRevision: query.data?.pages.outbox.revision })}>查看更早消息</Button>}</div></div>
  </div>;
  return <div className="page-content channels-page"><div className="page-heading"><div><span className="eyebrow">CHANNELS</span><h2>所有对话，在这里汇合</h2><p>查看已配置的渠道和会话，了解消息如何被处理。</p></div></div>
    {channels.error && <Notice error={channels.error} onRetry={channels.refresh} stale={!!channels.data} />}
    {!channels.data && channels.loading ? <Loading /> : !channels.data && channels.error ? <EmptyState title="渠道配置暂不可读" description="使用上方按钮重新获取。" /> : channels.data?.items.length ? <div className="channel-cards">{channels.data.items.map(item => <button type="button" className={`channel-card${channel === item.channelId ? ' selected' : ''}`} key={item.channelId} aria-pressed={channel === item.channelId} onClick={() => setChannel(channel === item.channelId ? '' : item.channelId)}>
      <div className={`channel-symbol ${item.type === 'dingtalk-dws' ? 'dingtalk' : ''}`}><RiGlobalLine size={24} /></div><div><strong>{item.channelId}</strong><span>{item.type === 'dingtalk-dws' ? '钉钉' : item.type === 'web-console' ? 'Web 对话' : item.type}</span></div><Badge tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? '已启用' : '未启用'}</Badge><div className="channel-card-bottom"><span>{item.connected === true ? <><RiCheckboxCircleFill size={13} />适配器已接入</> : item.enabled ? '等待适配器接入' : '当前未接入'}</span><RiArrowRightLine size={16} /></div>
    </button>)}</div> : <EmptyState title="还没有配置渠道" description="管理员在 Bot 配置中启用渠道后，会自动显示在这里。" />}
    <div className="section-heading"><div><h3>渠道会话 <span>{items.length}</span></h3><p>{channel ? `正在查看 ${channel}` : '查看渠道接收的消息和 Bot 回复'}</p></div><Search value={search} onChange={setSearch} label="搜索会话" /></div>
    {conversations.error && <Notice error={conversations.error} onRetry={conversations.refresh} stale={!!conversations.data} />}
    {!conversations.data && conversations.loading ? <Loading /> : !conversations.data && conversations.error ? <EmptyState title="渠道会话暂不可读" description="使用上方按钮重新获取。" /> : !items.length ? <EmptyState title={search || channel ? '没有匹配的会话' : '等待第一条消息'} description={search || channel ? '清除搜索或渠道筛选后重试。' : '已配置的渠道接收到消息后，会话会显示在这里。'} action={(search || channel) ? <Button variant="secondary" onClick={() => { setSearch(''); setChannel(''); }}>清除筛选</Button> : undefined} /> :
    <div className="conversation-list">{items.map(item => <a href={`#/channels/${encodeURIComponent(item.id)}`} className="conversation-row" key={item.id}><span className="conversation-symbol">{item.type === 'chat-room' ? <RiGroupLine size={21} /> : <RiChat3Line size={21} />}</span><div><strong>{item.name || '未命名会话'}</strong><span>{item.channelId} · {conversationType(item.type)}</span></div><RiArrowRightLine size={18} /></a>)}</div>}
  </div>;
}
