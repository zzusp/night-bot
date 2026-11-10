export type Rect = { left: number; top: number; right: number; bottom: number };
export type Placement = { left: number; top: number; width: number; maxHeight: number; side: 'left' | 'right' | 'top' | 'bottom'; arrowOffset: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
export const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// Prefer the nearest side that does not cover another message. Background rails
// are a softer obstacle than conversation text; the selected bubble is never a
// candidate surface. If a side cannot fit, use the larger vertical gap.
export function messageProcessPosition(anchor: Rect, viewport: Rect, desiredHeight: number, messages: Rect[] = [], furniture: Rect[] = []): Placement {
  const gap = 10, width = Math.min(304, viewport.right - viewport.left), height = Math.min(desiredHeight, viewport.bottom - viewport.top);
  const candidates: Array<Placement & { score: number }> = [];
  const add = (side: Placement['side'], left: number, top: number, maxHeight: number) => {
    const box = {left, top, right: left + width, bottom: top + maxHeight};
    const horizontal = side === 'left' || side === 'right';
    const arrowOffset = horizontal ? clamp((anchor.top + anchor.bottom) / 2 - top, 18, maxHeight - 18) : clamp((anchor.left + anchor.right) / 2 - left, 18, width - 18);
    candidates.push({side, left, top, width, maxHeight, arrowOffset,
      score: messages.reduce((sum, rect) => sum + overlapArea(box, rect), 0) * 100
        + furniture.reduce((sum, rect) => sum + overlapArea(box, rect), 0)
        + (horizontal ? 0 : width * height * .15)});
  };
  const top = clamp(anchor.top, viewport.top, viewport.bottom - height);
  if (anchor.right + gap + width <= viewport.right) add('right', anchor.right + gap, top, height);
  if (anchor.left - gap - width >= viewport.left) add('left', anchor.left - gap - width, top, height);
  const left = clamp(anchor.right - width, viewport.left, viewport.right - width);
  const below = viewport.bottom - anchor.bottom - gap, above = anchor.top - viewport.top - gap;
  if (below >= Math.min(160, height)) add('bottom', left, anchor.bottom + gap, Math.min(height, below));
  if (above >= Math.min(160, height)) add('top', left, anchor.top - gap - Math.min(height, above), Math.min(height, above));
  if (!candidates.length) {
    // Very tall messages leave no adjacent surface. A bounded edge fallback
    // keeps some of the selected text visible and all controls reachable.
    const maxHeight = Math.min(height, Math.max(120, (viewport.bottom - viewport.top) / 2));
    add(below >= above ? 'bottom' : 'top', left, below >= above ? viewport.bottom - maxHeight : viewport.top, maxHeight);
  }
  const {score: _score, ...placement} = candidates.sort((a, b) => a.score - b.score)[0];
  return placement;
}
