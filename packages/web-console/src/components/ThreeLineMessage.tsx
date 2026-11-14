import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Measure rendered line boxes, not character counts: CJK, inline emphasis and
// viewport changes must share the same three-line rule. Never rewrite the body.
export function ThreeLineMessage({ children, text, collapsedLabel = '展开' }: { children: ReactNode; text: string; collapsedLabel?: string }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [cutoff, setCutoff] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = ref.current!;
    const measure = () => {
      if (!root.isConnected) return;
      const origin = root.getBoundingClientRect().top;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const lines: { top: number; bottom: number }[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const match = lines.find(line => Math.abs(line.top - rect.top) < 3 || (rect.top < line.bottom && rect.bottom > line.top));
          if (match) { match.top = Math.min(match.top, rect.top); match.bottom = Math.max(match.bottom, rect.bottom); }
          else lines.push({ top: rect.top, bottom: rect.bottom });
        }
      }
      lines.sort((a, b) => a.top - b.top);
      const next = lines.length > 3 ? Math.ceil(lines[2].bottom - origin + 2) : null;
      setCutoff(previous => previous === next ? previous : next);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    document.fonts?.ready.then(measure);
    return () => resize.disconnect();
  }, [text]);
  const collapsed = cutoff !== null && !expanded;
  useLayoutEffect(() => {
    // Clipped links must not receive invisible keyboard focus. Their complete
    // semantic text remains readable; expanding restores ordinary link behavior.
    for (const link of ref.current!.querySelectorAll('a')) {
      if (collapsed) link.setAttribute('tabindex', '-1');
      else link.removeAttribute('tabindex');
    }
  }, [collapsed, text]);
  return <div className="three-line-message" data-collapsed={collapsed || undefined}>
    <div ref={ref} id={id} className="three-line-content" style={collapsed ? { maxHeight: cutoff!, overflow: 'hidden' } : undefined}>{children}</div>
    {cutoff !== null && <button className="message-disclosure" type="button" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : collapsedLabel}{expanded ? <RiArrowUpSLine size={14} aria-hidden="true" /> : <RiArrowDownSLine size={14} aria-hidden="true" />}</button>}
  </div>;
}
