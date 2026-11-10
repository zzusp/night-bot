import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiCloseLine } from '@remixicon/react';
import { type Message } from '../api';
import { IconButton } from './BoardPrimitives';
import { ResponseTimes } from './ResponseTimes';

// Non-modal message receipt: same portal/layer policy as ActionMenu, without
// a backdrop or inert conversation. Its anchor is the actual message bubble.
export function MessageProcessPopover({ endpoint, message, trigger, onDismiss, onAccessRevoked }: {
  endpoint: string; message: Message; trigger: HTMLButtonElement; onDismiss: () => void; onAccessRevoked: (error: Error) => void;
}) {
  const panel = useRef<HTMLDivElement>(null), title = useId();
  const dismiss = useRef(onDismiss), focused = useRef(false);
  dismiss.current = onDismiss;
  const [position, setPosition] = useState({ top: 0, left: 0, visibility: 'hidden' as 'hidden' | 'visible' });
  const close = (restore = false) => {
    if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
    dismiss.current();
  };
  useLayoutEffect(() => {
    const element = panel.current, anchor = trigger.closest('.message-body');
    if (!element || !anchor) return;
    const place = () => {
      if (!anchor.isConnected) { dismiss.current(); return; }
      const bounds = anchor.getBoundingClientRect(), box = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const minX = x + 8, minY = y + 8, maxX = x + width - box.width - 8, maxY = y + height - box.height - 8;
      const leftFits = bounds.left - box.width - 10 >= minX, rightFits = bounds.right + box.width + 10 <= x + width - 8;
      let left: number, top = bounds.top;
      if ((message.role === 'user' && leftFits) || (!rightFits && leftFits)) left = bounds.left - box.width - 10;
      else if (rightFits) left = bounds.right + 10;
      else {
        left = message.role === 'user' ? bounds.right - box.width : bounds.left;
        top = bounds.bottom + 8;
        if (top > maxY && bounds.top - box.height - 8 >= minY) top = bounds.top - box.height - 8;
      }
      setPosition({ left: Math.max(minX, Math.min(left, maxX)), top: Math.max(minY, Math.min(top, maxY)), visibility: 'visible' });
    };
    place();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) dismiss.current();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      // A scrolled-away bubble must not leave an orphan floating over another message.
      dismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    const observer = new ResizeObserver(place);
    observer.observe(element); observer.observe(anchor);
    const column = anchor.closest('.message-column');
    if (column) observer.observe(column);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [trigger, message.role]);
  useLayoutEffect(() => {
    if (position.visibility === 'visible' && !focused.current) {
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      focused.current = true;
    }
  }, [position.visibility]);
  return createPortal(<div ref={panel} className="message-process-popover" role="dialog" aria-modal="false" aria-labelledby={title} style={position}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger) dismiss.current(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); close(true); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) close(true);
    }}>
    <header className="message-process-heading"><h2 id={title}>消息处理过程</h2><IconButton label="关闭消息处理过程" onClick={() => close(true)}><RiCloseLine size={18} /></IconButton></header>
    <div className="message-process-body"><ResponseTimes endpoint={endpoint} message={message} onAccessRevoked={onAccessRevoked} /></div>
  </div>, document.body);
}
