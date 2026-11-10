// Literal dot segments are valid saved channel IDs but URL normalization removes
// them even when percent-encoded. Use the authenticated query fallback for them.
export function channelPath(channelId: string, dingtalkDetail = false) {
  const base = dingtalkDetail ? '/channels/dingtalk' : '/channels';
  return channelId === '.' || channelId === '..' ? `${base}?channelId=${encodeURIComponent(channelId)}` : `${base}/${encodeURIComponent(channelId)}`;
}
