import type { Channel, ChannelIngress } from './api';

export const validChannelVersion = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validChannelIngress(value: ChannelIngress | undefined): value is ChannelIngress {
  return !!value && typeof value.supported === 'boolean' && typeof value.available === 'boolean' &&
    ['history', 'none', null].includes(value.backfill) && typeof value.requestedPaused === 'boolean' &&
    ['paused', 'pausing', 'receiving', 'recovering', 'error', 'unavailable'].includes(value.state) &&
    (value.errorCode === null || typeof value.errorCode === 'string');
}
export function ingressUnavailable(item: Channel) {
  if (!validChannelIngress(item.ingress) || !item.ingress.supported || item.ingress.backfill === null) return '此渠道未声明暂停接收能力。';
  if (!item.ingress.available) return '当前接入不可操作，请先核对渠道运行状态。';
  if (!validChannelVersion(item.savedVersion)) return '缺少有效配置版本，请刷新渠道列表。';
  return '';
}
export const ingressAction = (item: Channel) => item.ingress?.state === 'error' ? (item.ingress.requestedPaused ? '重试暂停接收' : '重试恢复接收')
  : item.ingress?.requestedPaused ? '恢复接收' : '暂停接收';
export const ingressTargetPaused = (item: Channel) => item.ingress?.state === 'error' ? item.ingress.requestedPaused : !item.ingress?.requestedPaused;

export function ingressStateText(item: Channel) {
  const ingress = item.ingress;
  if (!validChannelIngress(ingress)) return '当前接收状态尚未确认，请刷新渠道列表。';
  if (ingress.state === 'paused') return '已暂停消息接收。已接纳的任务继续处理。';
  if (ingress.state === 'pausing') return '正在暂停消息接收，尚未完成。已接纳的任务继续处理。';
  if (ingress.state === 'recovering') return ingress.backfill === 'history' ? '正在补拉暂停期间的消息，尚未完成；请留意渠道状态。' : '正在恢复消息接收，尚未完成。此渠道恢复后只接收后续消息。';
  if (ingress.state === 'receiving') return ingress.backfill === 'none' ? '正在接收后续消息。此渠道无法补拉暂停期间的消息。' : '正在接收消息。';
  if (ingress.state === 'error') {
    const reason = ['DINGTALK_AUTH_REQUIRED', 'CHANNEL_AUTH_REQUIRED'].includes(ingress.errorCode ?? '') ? '请先完成渠道认证，再重试恢复接收。'
      : ['CHANNEL_HISTORY_INCOMPLETE', 'CHANNEL_HISTORY_RECOVERY_FAILED', 'DINGTALK_HISTORY_RECOVERY_FAILED', 'DINGTALK_CURSOR_PERSIST_FAILED'].includes(ingress.errorCode ?? '')
        ? '历史补拉尚未完成，原接收进度保留。请核对历史读取权限、完整性与服务状态后再重试；不要清除接收进度。'
        : '请核对渠道运行状态后重试。';
    return `${ingress.requestedPaused ? '暂停请求已保存，但实际接收状态异常。' : '恢复请求已保存，但消息接收尚未恢复。'}${reason}`;
  }
  if (['DINGTALK_AUTH_REQUIRED', 'CHANNEL_AUTH_REQUIRED'].includes(ingress.errorCode ?? '')) return ingress.requestedPaused
    ? '渠道仍在等待认证，暂停意图已保存；实际接收状态尚未确认。' : '渠道正在等待认证，尚未恢复消息接收。';
  return '当前接入不可用，实际接收状态尚未确认。';
}
