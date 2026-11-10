// Literal dot segments are valid saved channel IDs but URL normalization removes
// them even when percent-encoded. Use the authenticated query fallback for them.
export function channelPath(channelId: string, operation: boolean | 'ingress' = false) {
  const base = operation === true ? '/channels/dingtalk' : '/channels';
  const suffix = operation === 'ingress' ? '/ingress' : '';
  return channelId === '.' || channelId === '..' ? `${base}${suffix}?channelId=${encodeURIComponent(channelId)}` : `${base}/${encodeURIComponent(channelId)}${suffix}`;
}
