import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { RiAddLine, RiArrowRightLine, RiChat3Line, RiCheckboxCircleLine, RiCloseLine, RiEyeLine, RiEyeOffLine, RiGlobalLine, RiLayoutRightLine, RiLogoutBoxRLine, RiMenuLine, RiMoonLine, RiPulseLine, RiRefreshLine, RiShieldCheckLine, RiSunLine } from '@remixicon/react';
import { api, errorText, setSession, type ChatSummary, type Overview, type Page, type Session } from './api';
import { dateTime, navigate, useResource, useRoute } from './hooks';
import { Badge, Button, EmptyState, IconButton, Logo } from './components/BoardPrimitives';
import { Loading, Notice, Status } from './components/Shared';
import ChatPage, { createDrafts, type Drafts } from './ChatPage';
import { TaskDetail, TaskList } from './TasksPage';
import ChannelsPage from './ChannelsPage';

function Login({ onLogin, expired }: { onLogin: (session: Session) => void; expired: boolean }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (pending) return;
    if (!token.trim()) { setError('请输入管理员提供的访问令牌。'); input.current?.focus(); return; }
    setPending(true); setError('');
    try { const session = await api<Session>('/login', { method: 'POST', body: { token: token.trim() } }); setToken(''); onLogin(session); }
    catch { setError('连接失败。请确认访问令牌正确，且 Web 插件正在运行。'); input.current?.focus(); }
    finally { setPending(false); }
  };
  return <main className="login-page"><div className="login-brand"><Logo /><Badge tone="neutral">个人工作空间</Badge></div>
    <section className="login-card"><div className="login-symbol"><RiShieldCheckLine size={26} /></div><h1>{expired ? '重新连接你的助手' : '欢迎回到 Night Bot'}</h1>
      <p>{expired ? '登录已失效。重新连接后，可以继续查看任务和对话。' : '对话、任务与渠道，一个安静而有序的工作空间。'}</p>
      <form noValidate onSubmit={event => void submit(event)}><label htmlFor="access-token">访问令牌</label><div className="token-input"><input ref={input} id="access-token" type={show ? 'text' : 'password'} autoComplete="current-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} aria-invalid={!!error} aria-describedby="login-help login-error" placeholder="输入访问令牌" /><IconButton label={show ? '隐藏访问令牌' : '显示访问令牌'} aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <RiEyeOffLine size={18} /> : <RiEyeLine size={18} />}</IconButton></div>
        <p id="login-help" className="field-help">使用本机 Web 插件生成的令牌，由管理员提供。</p><div id="login-error" className="field-error" role={error ? 'alert' : undefined}>{error}</div><Button type="submit" busy={pending} disabled={pending} icon={<RiArrowRightLine size={17} />}>连接工作空间</Button>
      </form><div className="login-security"><RiShieldCheckLine size={14} />令牌不会保存在浏览器中</div>
    </section><span className="login-caption">Night Bot · 让想法成为行动</span></main>;
}

class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? <EmptyState title="这个页面暂时无法显示" description="请重新获取页面，或从侧栏进入其他页面。" action={<Button variant="secondary" onClick={() => this.setState({ failed: false })}>重新显示</Button>} /> : this.props.children; }
}

function Workspace({ session, onLogout, drafts }: { session: Session; onLogout: () => Promise<void>; drafts: Drafts }) {
  const route = useRoute();
  const segments = route.pathname.split('/').filter(Boolean);
  const section = segments[0] || 'chat';
  let id: string | undefined;
  try { id = segments[1] ? decodeURIComponent(segments[1]) : undefined; } catch { id = undefined; }
  const overview = useResource<Overview>('/overview', 5000);
  const chats = useResource<Page<ChatSummary>>('/chat?offset=0&limit=20', 5000);
  const [rail, setRail] = useState(true);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const olderChats = useResource<Page<ChatSummary>>(historyOffset ? `/chat?offset=${historyOffset}&limit=20` : null);
  const drawer = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const currentChats = historyOffset ? olderChats : chats;
  const title = section === 'tasks' ? id ? '任务详情' : '任务' : section === 'channels' ? id ? '渠道会话' : '渠道' : section === 'chat' ? chats.data?.items.find(item => item.id === id)?.title || '与 Bot 对话' : '页面不存在';
  useEffect(() => { document.title = `${title} — Night Bot`; }, [title]);
  useEffect(() => { if (section !== 'chat') titleRef.current?.focus(); drawer.current?.close(); }, [route.pathname, section]);
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = next; setTheme(next);
    try { localStorage.setItem('night-theme', next); } catch { /* 主题仍可在当前页面使用。 */ }
  };
  const logout = async () => {
    if (logoutBusy) return; setLogoutBusy(true); setLogoutError(null);
    try { await onLogout(); }
    catch (err) { setLogoutError(err); }
    finally { setLogoutBusy(false); }
  };
  const refresh = () => { overview.refresh(); chats.refresh(); };
  const navItems = [{ path: 'chat', label: '与 Bot 对话', icon: RiChat3Line }, { path: 'tasks', label: '任务', icon: RiCheckboxCircleLine }, { path: 'channels', label: '渠道', icon: RiGlobalLine }];
  const sidebar = (mobile = false) => <>
    <div className="sidebar-brand"><Logo />{mobile && <IconButton label="关闭导航" onClick={() => drawer.current?.close()}><RiCloseLine size={19} /></IconButton>}</div>
    <Button className="new-chat" variant="secondary" icon={<RiAddLine size={18} />} onClick={() => { navigate('/chat'); drawer.current?.close(); }}>新对话</Button>
    <nav className="primary-nav" aria-label="主导航">{navItems.map(item => <a key={item.path} href={`#/${item.path}`} aria-current={section === item.path ? 'page' : undefined} onClick={() => drawer.current?.close()}><item.icon size={19} /><span>{item.label}</span>{item.path === 'tasks' && overview.data?.running?.total ? <span className="nav-count">{overview.data.running.total}</span> : null}</a>)}</nav>
    <div className="sidebar-history"><div className="sidebar-label"><span>最近对话</span><span>{chats.data?.total ?? ''}</span></div>
      {currentChats.error && <button className="sidebar-retry" onClick={currentChats.refresh}>读取失败，点击刷新</button>}
      {!currentChats.data && currentChats.loading ? <Loading /> : currentChats.data?.items.length ? <nav aria-label="最近对话">{currentChats.data.items.map(chat => <a href={`#/chat/${encodeURIComponent(chat.id)}`} key={chat.id} aria-current={section === 'chat' && id === chat.id ? 'page' : undefined} onClick={() => drawer.current?.close()}><RiChat3Line size={16} /><span>{chat.title || '未命名对话'}</span></a>)}</nav> : <p className="sidebar-empty">{currentChats.error && !currentChats.data ? '对话列表暂不可读' : '从第一段对话开始'}</p>}
      {(historyOffset > 0 || currentChats.data?.nextOffset != null) && <div className="history-pagination">{historyOffset > 0 && <button onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}>上一页</button>}{currentChats.data?.nextOffset != null && <button onClick={() => setHistoryOffset(currentChats.data!.nextOffset!)}>更早对话</button>}</div>}
    </div>
    <div className="sidebar-bottom"><div className="workspace-note"><span className="workspace-dot" /><div><strong>你的专属工作空间</strong><span>任务持续运行，对话随时继续</span></div></div>
      <div className="operator"><span className="operator-avatar">{session.operator.name.slice(0, 1) || 'N'}</span><div><strong>{session.operator.name || '操作者'}</strong><span>本机工作空间</span></div><IconButton label="退出登录" disabled={logoutBusy} onClick={() => void logout()}><RiLogoutBoxRLine size={18} /></IconButton></div>
    </div></>;
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳转到主内容</a><aside className="sidebar desktop-sidebar">{sidebar()}</aside>
    <dialog ref={drawer} className="nav-dialog" aria-label="导航"><div className="sidebar">{sidebar(true)}</div></dialog>
    <div className="main-frame"><header className="topbar"><IconButton label="打开导航" className="mobile-menu" onClick={() => drawer.current?.showModal()}><RiMenuLine size={20} /></IconButton><div className="header-location"><span>工作空间</span><span className="breadcrumb-slash">/</span><h1 ref={titleRef} tabIndex={-1}>{title}</h1></div>
      <div className="topbar-actions"><span className={`connection ${overview.error ? 'offline' : ''}`} role="status"><i />{overview.error ? '连接中断' : overview.data ? '已连接' : '连接中'}</span><span className="toolbar-divider" />
        <IconButton label="刷新概览" onClick={refresh}><RiRefreshLine size={18} /></IconButton><IconButton label={theme === 'light' ? '切换深色外观' : '切换浅色外观'} onClick={toggleTheme}>{theme === 'light' ? <RiMoonLine size={18} /> : <RiSunLine size={18} />}</IconButton>
        {section === 'chat' && <IconButton label={rail ? '隐藏活动面板' : '显示活动面板'} className="rail-toggle" aria-pressed={rail} onClick={() => setRail(value => !value)}><RiLayoutRightLine size={18} /></IconButton>}
      </div></header>
      {!!logoutError && <Notice error={logoutError} />}
      <div className="workspace-body"><main id="main-content" tabIndex={-1} className={`main-panel ${section === 'chat' ? 'chat-panel' : ''}`}><PageBoundary resetKey={route.pathname}>
        {section === 'chat' ? <ChatPage id={id} drafts={drafts} onAccepted={refresh} /> : section === 'tasks' ? id ? <TaskDetail id={id} /> : <TaskList route={route} /> : section === 'channels' ? <ChannelsPage id={id} /> : <EmptyState title="页面不存在" description="从侧栏选择对话、任务或渠道继续。" action={<a href="#/chat">返回对话</a>} />}
      </PageBoundary></main>
      {section === 'chat' && rail && <aside className="activity-rail" aria-label="任务与渠道概览"><div className="rail-heading"><h2>工作动态</h2><RiPulseLine size={18} /></div>
        {overview.error && <Notice error={overview.error} stale={!!overview.data} onRetry={overview.refresh} />}
        {!!Object.keys(overview.data?.sectionErrors || {}).length && <p className="rail-empty" role="status">部分工作动态暂不可读，可刷新概览重新获取。</p>}
        {!overview.data && overview.loading ? <Loading /> : <>
          <div className="activity-counts"><a href="#/tasks?state=running"><span>执行中</span><strong>{overview.data?.running?.total ?? '—'}</strong><span className="count-dot info" /></a><a href="#/tasks?state=waiting"><span>等待中</span><strong>{overview.data?.waiting?.total ?? '—'}</strong><span className="count-dot warning" /></a></div>
          <section className="rail-section"><div className="rail-section-title"><h3>最近任务</h3><a href="#/tasks">查看全部<RiArrowRightLine size={14} /></a></div>
            {overview.data?.tasks?.items.length ? overview.data.tasks.items.slice(0, 5).map(task => <a className="rail-task" key={task.taskId} href={`#/tasks/${encodeURIComponent(task.taskId)}`}><div><Status value={task.state} /><time>{dateTime(task.updatedAt || task.createdAt)}</time></div><strong>{task.title || task.objective || '未命名任务'}</strong></a>) : <p className="rail-empty">{overview.data?.sectionErrors?.tasks || (overview.error && !overview.data) ? '暂时无法读取任务，请刷新。' : '暂无任务，开始对话来安排第一项工作。'}</p>}
          </section>
          <section className="rail-section"><div className="rail-section-title"><h3>已配置渠道</h3><a href="#/channels">查看<RiArrowRightLine size={14} /></a></div>
            {overview.data?.channels?.length ? overview.data.channels.slice(0, 5).map(item => <a className="rail-channel" key={item.channelId} href="#/channels"><span><RiGlobalLine size={18} /></span><div><strong>{item.channelId}</strong><span>{item.type === 'dingtalk-dws' ? '钉钉' : item.type === 'web-console' ? 'Web 对话' : item.type}</span></div><Badge tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? '已启用' : '未启用'}</Badge></a>) : <p className="rail-empty">{overview.data?.sectionErrors?.channels || (overview.error && !overview.data) ? '暂时无法读取渠道，请刷新。' : '尚未配置渠道'}</p>}
          </section>
        </>}<div className="rail-footer"><RiShieldCheckLine size={14} /><span>状态来自 Bot 的实际记录</span></div>
      </aside>}
      </div>
    </div>
  </div>;
}

export default function App() {
  const [session, updateSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const [startupError, setStartupError] = useState<unknown>(null);
  const [drafts, replaceDrafts] = useState(createDrafts);
  const loggingOut = useRef(false), expiredDuringLogout = useRef(false);
  const login = (value: Session) => { setSession(value); updateSession(value); setExpired(false); setStartupError(null); };
  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true; expiredDuringLogout.current = false;
    try {
      await api('/logout', { method: 'POST', body: {} });
      setSession(null); updateSession(null); replaceDrafts(createDrafts()); setExpired(false);
    } catch (error) {
      if (expiredDuringLogout.current) { setSession(null); updateSession(null); setExpired(true); }
      throw error;
    } finally { loggingOut.current = false; }
  };
  useEffect(() => {
    let disposed = false;
    api<Session>('/session').then(value => { if (!disposed) login(value); }).catch(err => { if (!disposed && err?.status !== 401) setStartupError(err); }).finally(() => { if (!disposed) setChecking(false); });
    const expire = () => {
      // 等退出响应的 Set-Cookie 落定后才允许重登，避免迟到退出删除新 cookie。
      if (loggingOut.current) { expiredDuringLogout.current = true; return; }
      setSession(null); updateSession(null); setExpired(true);
    };
    const refreshed = (event: Event) => { expiredDuringLogout.current = false; updateSession((event as CustomEvent<Session>).detail); setExpired(false); setStartupError(null); };
    window.addEventListener('night-session-expired', expire);
    window.addEventListener('night-session-refreshed', refreshed);
    return () => { disposed = true; window.removeEventListener('night-session-expired', expire); window.removeEventListener('night-session-refreshed', refreshed); };
  }, []);
  if (checking) return <div className="startup"><Logo /><Loading>正在连接工作空间…</Loading></div>;
  return session ? <Workspace session={session} drafts={drafts} onLogout={logout} /> : <>{startupError && <div className="startup-notice" role="alert">{errorText(startupError)}</div>}<Login onLogin={login} expired={expired} /></>;
}
