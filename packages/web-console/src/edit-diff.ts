// The official Pi edit result uses one actual source line number per row:
// the old file for context/deletions, and the new file for insertions.
export type EditDiffRow = {kind: 'context' | 'removed' | 'added' | 'omitted'; text: string; line?: number};
const maxDiffLength = 12_000; // Keep the whole patch in the first transcript body page.
const maxDiffRows = 400;

export function parsePiEditDiff(value: unknown): EditDiffRow[] | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxDiffLength || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) return null;
  const raw = value.split('\n');
  if (raw.length > maxDiffRows) return null;
  const rows: EditDiffRow[] = [];
  let hasChanges = false;
  for (const row of raw) {
    if (/^ {2,11}\.\.\.$/.test(row)) {rows.push({kind:'omitted', text:'…'}); continue}
    const match = /^([ +\-]) {0,8}([1-9]\d{0,8}) (.*)$/.exec(row);
    if (!match) return null;
    const [, marker, line, text] = match;
    const kind = marker === '+' ? 'added' : marker === '-' ? 'removed' : 'context';
    rows.push({kind, line:Number(line), text});
    if (kind !== 'context') hasChanges = true;
  }
  return hasChanges ? rows : null;
}

export function requestedEditRows(oldText: string, newText: string): EditDiffRow[] | null {
  const lines = (text: string) => text ? text.replace(/\r\n/g, '\n').split('\n') : [];
  const before = lines(oldText), after = lines(newText);
  if (before.length + after.length > maxDiffRows) return null;
  let start = 0, tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - tail - 1] === after[after.length - tail - 1]) tail++;
  const rows = (kind: EditDiffRow['kind'], items: string[]): EditDiffRow[] => items.map(text => ({kind, text}));
  if (start === before.length && start === after.length) return rows('context', before);
  return [
    ...(start > 2 ? [{kind:'omitted' as const, text:'…'}] : []),
    ...rows('context', before.slice(Math.max(0, start - 2), start)),
    ...rows('removed', before.slice(start, before.length - tail)),
    ...rows('added', after.slice(start, after.length - tail)),
    ...rows('context', before.slice(before.length - tail, before.length - tail + Math.min(2, tail))),
    ...(tail > 2 ? [{kind:'omitted' as const, text:'…'}] : []),
  ];
}
