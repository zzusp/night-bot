import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RiCloseLine } from '@remixicon/react';
import { type Message } from '../api';
import { IconButton } from './BoardPrimitives';
import { ResponseTimes } from './ResponseTimes';
import { messageProcessPosition, overlapArea, type Placement, type Rect } from '../message-process-position';

// Non-modal message receipt: same portal/layer policy as ActionMenu, without
// a backdrop or inert conversation. Its anchor is the actual message bubble.
export function MessageProcessPopover({ endpoint, message, trigger, onDismiss, onAccessRevoked }: {
  endpoint: string; message: Message; trigger: HTMLButtonElement; onDismiss: () => void; onAccessRevoked: (error: Error) => void;
}) {
  const panel = useRef<HTMLDivElement>(null), title = useId();
  const dismiss = useRef(onDismiss), focused = useRef(false);
  dismiss.current = onDismiss;
  const [position, setPosition] = useState<Placement | null>(null);
  const close = (restore = false) => {
    if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
    dismiss.current();
  };
  useLayoutEffect(() => {
    const element = panel.current, anchor = trigger.closest('.message-body');
    if (!element || !anchor) return;
    const transcript = anchor.closest('.transcript');
    let frame = 0;
    const place = () => {
      frame = 0;
      if (!anchor.isConnected || !transcript) { dismiss.current(); return; }
      const bounds = anchor.getBoundingClientRect(), scrollBounds = transcript.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const safe: Rect = {left: x + 8, right: x + width - 8, top: Math.max(y + 8, scrollBounds.top + 8), bottom: Math.min(y + height - 8, scrollBounds.bottom - 8)};
      const visibleSource = {left: Math.max(bounds.left, scrollBounds.left, safe.left), right: Math.min(bounds.right, scrollBounds.right, safe.right), top: Math.max(bounds.top, safe.top), bottom: Math.min(bounds.bottom, safe.bottom)};
      if (visibleSource.right <= visibleSource.left || visibleSource.bottom <= visibleSource.top) { dismiss.current(); return; }
      const messages = Array.from(transcript.querySelectorAll('.message-body')).filter(node => node !== anchor).map(node => node.getBoundingClientRect()).filter(rect => overlapArea(rect, safe) > 0);
      const furniture = Array.from(document.querySelectorAll('.sidebar, .activity-rail')).map(node => node.getBoundingClientRect()).filter(rect => overlapArea(rect, safe) > 0);
      const desired = Math.min(440, (element.querySelector<HTMLElement>('.message-process-body')?.scrollHeight ?? 0) + (element.querySelector<HTMLElement>('.message-process-heading')?.offsetHeight ?? 0) + 2);
      const next = messageProcessPosition(visibleSource, safe, desired, messages, furniture);
      setPosition(current => current && Object.keys(next).every(key => next[key as keyof Placement] === current[key as keyof Placement]) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) dismiss.current();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      schedule();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element); observer.observe(anchor);
    const column = anchor.closest('.message-column');
    if (column) observer.observe(column);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [trigger, message.role]);
  useLayoutEffect(() => {
    if (position && !focused.current) {
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
      focused.current = true;
    }
  }, [position]);
  return createPortal(<div ref={panel} className="message-process-popover" role="dialog" aria-modal="false" aria-labelledby={title} data-side={position?.side} style={{left: position?.left ?? 0, top: position?.top ?? 0, width: position?.width, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden', '--process-arrow-offset': `${position?.arrowOffset ?? 18}px`} as CSSProperties}
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
