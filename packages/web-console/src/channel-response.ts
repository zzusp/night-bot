import type { DingtalkChannelCreated } from './api';

const version = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validDingtalkCreated(result: DingtalkChannelCreated, channelId: string) {
  const row = result?.channel;
  return result?.ok === true && result.changed === true && typeof result.restartRequired === 'boolean' && typeof result.liveApplied === 'boolean' &&
    row?.channelId === channelId && row.type === 'dingtalk-dws' && version(row.savedVersion) && (row.runningVersion === null || version(row.runningVersion)) &&
    row.restartRequired === result.restartRequired && row.liveApplied === result.liveApplied &&
    (!result.liveApplied || (!result.restartRequired && row.enabled === true && row.runningVersion === row.savedVersion));
}
export function channelApplicationText(result: {restartRequired: boolean; liveApplied: boolean}) {
  return result.restartRequired ? '保存配置待重启；当前运行态尚未应用此配置。'
    : result.liveApplied ? '保存配置已应用到运行态；连接与监听以渠道状态为准。' : '保存配置尚未激活，请查看渠道状态并处理阻断。';
}
