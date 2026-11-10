import type { Channel } from './api';

// Runtime facts take precedence over saved config. A configuration lifecycle
// error can coexist with a healthy old adapter and is shown separately.
export function channelHealthPresentation(item: Channel) {
  const runtime = item.runningConnectionState !== undefined;
  const state = runtime ? item.runningConnectionState : item.connectionState;
  const connected = runtime ? item.runningConnected : item.connected;
  const error = runtime ? item.runningErrorCode : item.errorCode;
  if (state === 'error' || error === 'CHANNEL_ADAPTER_ERROR' || error === 'DINGTALK_CHANNEL_SWITCH_BLOCKED') {
    return { kind: 'abnormal', label: '健康检查异常' } as const;
  }
  if (state === 'waiting-auth' || state === 'stopped' || error === 'CHANNEL_AUTH_REQUIRED') {
    return { kind: 'not-ready', label: '健康检查未就绪' } as const;
  }
  if (connected === true) return { kind: 'normal', label: '健康检查正常' } as const;
  if (connected === false) return { kind: 'not-ready', label: '健康检查未就绪' } as const;
  return { kind: 'unknown', label: '健康状态未报告' } as const;
}
