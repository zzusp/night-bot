import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiMoreLine } from '@remixicon/react';
import { Button, IconButton } from './BoardPrimitives';

type Action = { label: string; onSelect: (trigger: HTMLButtonElement | null) => void; disabled?: boolean; danger?: boolean; description?: string };

// Canonical overflow action menu. Native buttons remain the keyboard targets;
// the portal avoids clipping inside the application's scrolling page panels.
export function ActionMenu({ label, actions }: { label: string; actions: Action[] }) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const initialLast = useRef(false);
  const trigger = () => anchor.current?.querySelector<HTMLButtonElement>('button');
  const enabledItems = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger()?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !menu.current || !anchor.current) return;
    const bounds = anchor.current.getBoundingClientRect();
    const box = menu.current.getBoundingClientRect();
    const top = bounds.top - box.height - 6;
    setPosition({
      top: Math.max(8, Math.min(top >= 8 ? top : bounds.bottom + 6, window.innerHeight - box.height - 8)),
      left: Math.max(8, Math.min(bounds.right - box.width, window.innerWidth - box.width - 8)),
    });
    const items = enabledItems();
    (initialLast.current ? items.at(-1) : items[0])?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      // Clicking a previously off-screen trigger can queue a scroll event before
      // opening. Its geometry is already captured above; only a later movement
      // invalidates the menu's placement, not that stale event.
      const current = anchor.current?.getBoundingClientRect();
      if (!current || current.top !== bounds.top || current.left !== bounds.left) close();
    };
    const resize = () => close();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  return <>
    <div ref={anchor} className="action-menu-anchor">
      <IconButton label={label} className="action-menu-trigger" id={`${id}-trigger`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => { initialLast.current = false; setOpen(value => !value); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); initialLast.current = event.key === 'ArrowUp'; setOpen(true);
          }
        }}><RiMoreLine size={19} /></IconButton>
    </div>
    {open && createPortal(<div ref={menu} className="board-action-menu" id={`${id}-menu`} role="menu" aria-labelledby={`${id}-trigger`} style={position}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { close(true); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = enabledItems(), current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {actions.map((action, index) => <Fragment key={action.label}><Button variant="ghost" className={action.danger ? 'action-menu-danger' : undefined} role="menuitem" tabIndex={-1} disabled={action.disabled}
        aria-describedby={action.description ? `${id}-description-${index}` : undefined}
        onClick={() => { const source = trigger() ?? null; close(true); action.onSelect(source); }}>{action.label}</Button>
        {action.description && <p role="none" id={`${id}-description-${index}`} className="action-menu-description">{action.description}</p>}</Fragment>)}
    </div>, document.body)}
  </>;
}
