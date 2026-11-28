export function readErrorLabel(source?: string) {
 if (!source) return '读取内容';
 if (source.includes('/messages/')) return '记录正文';
 if (source.endsWith('/activity')) return '工作动态';
 if (source.includes('stage-times')) return '处理耗时';
 if (source.includes('/router/context-window')) return '上下文窗口';
 if (source.includes('/session')) return source.startsWith('/tasks/') ? '执行记录' : '路由记录';
 if (source.includes('/learning')) return '任务复盘';
 if (source.startsWith('/tasks')) return '任务';
 if (source.startsWith('/channels')) return '渠道配置';
 if (source.startsWith('/conversations')) return '渠道会话';
 if (source.startsWith('/recent-conversations')) return '最近对话';
 if (source.startsWith('/channel-plugins')) return '渠道类型';
 if (source.startsWith('/chat')) return '对话';
 if (source.startsWith('/settings/models')) return '模型列表';
 if (source.startsWith('/settings')) return '设置';
 if (source.startsWith('/evolution/items')) return '记忆与技能正文';
 if (source.startsWith('/evolution')) return '自进化记录';
 if (source.startsWith('/feedback')) return '反馈诊断';
 if (source.startsWith('/schedules')) return '定时任务';
 if (source.startsWith('/overview')) return '工作动态';
 return '读取内容';
}
