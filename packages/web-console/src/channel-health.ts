import type { Channel } from './api';

export function channelRecoveryError(code: Channel['errorCode']) {
  return code === 'CHANNEL_MESSAGE_ID_CONFLICT' ? '旧消息与已保存的同版本记录冲突，历史恢复已停止；需核对来源记录，重复重启不能解除。'
    : code === 'CHANNEL_HISTORY_INCOMPLETE' ? '历史查询不完整或仍缺少待接纳消息，恢复尚未完成；请核对渠道历史读取权限与完整性。'
    : code === 'CHANNEL_HISTORY_RECOVERY_FAILED' ? '历史消息恢复失败；请核对服务日志中的渠道错误，当前不能确认恢复完成。' : '';
}

// Runtime facts take precedence over saved config. A configuration lifecycle
// error can coexist with a healthy old adapter and is shown separately.
export function channelHealthPresentation(item: Channel) {
  const runtime = item.runningConnectionState !== undefined;
  const state = runtime ? item.runningConnectionState : item.connectionState;
  const connected = runtime ? item.runningConnected : item.connected;
  const error = runtime ? item.runningErrorCode : item.errorCode;
  if (channelRecoveryError(error) || state === 'error' || error === 'CHANNEL_ADAPTER_ERROR' || error === 'DINGTALK_CHANNEL_SWITCH_BLOCKED') {
    return { kind: 'abnormal', label: '健康检查异常' } as const;
  }
  if (state === 'waiting-auth' || state === 'stopped' || error === 'CHANNEL_AUTH_REQUIRED') {
    return { kind: 'not-ready', label: '健康检查未就绪' } as const;
  }
  if (connected === true) return { kind: 'normal', label: '健康检查正常' } as const;
  if (connected === false) return { kind: 'not-ready', label: '健康检查未就绪' } as const;
  return { kind: 'unknown', label: '健康状态未报告' } as const;
}
