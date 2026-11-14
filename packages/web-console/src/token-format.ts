const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const exactTokenCount = (value: unknown) => valid(value) ? value.toLocaleString('zh-CN') : '未知';

/** Display only: base-1000, one decimal at most, with rounded tier promotion. */
export function formatTokenCount(value: unknown): string {
  if (!valid(value)) return '未知';
  if (value < 1000) return String(value);
  const units = [1000, 1e6, 1e9], suffixes = ['K', 'M', 'B'];
  let tier = value >= 1e9 ? 2 : value >= 1e6 ? 1 : 0;
  // Round the integer remainder, avoiding unsafe addition to a large count.
  const rounded = () => Math.floor(value / units[tier]) * 10 + Math.floor((value % units[tier] + units[tier] / 20) / (units[tier] / 10));
  let tenths = rounded();
  while (tier < 2 && tenths >= 10000) {tier++; tenths = rounded();}
  return `${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ''}${suffixes[tier]}`;
}
