import { useEffect, useRef, useState } from 'react';
import { RiCheckboxCircleLine, RiCloseLine, RiInformationLine } from '@remixicon/react';
import { IconButton } from './BoardPrimitives';

export type ActionFeedback = { title: string; description: string; autoDismiss?: boolean };
/** One action receipt, not a live status feed. Persistent failures stay in their owning flow. */
export function ActionNotification({ feedback, onDismiss }: { feedback: ActionFeedback; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  useEffect(() => {
    if (!feedback.autoDismiss || held) return;
    const timer = window.setTimeout(() => dismiss.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback, held]);
  return <section className="action-notification" role="status" aria-live="polite" aria-atomic="true" aria-label="渠道操作提示"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <span className="action-notification-symbol" aria-hidden="true">{feedback.autoDismiss ? <RiCheckboxCircleLine size={20}/> : <RiInformationLine size={20}/>}</span>
    <div className="action-notification-copy"><h2>{feedback.title}</h2><p>{feedback.description}</p></div>
    <IconButton label="关闭渠道操作提示" className="action-notification-close" onClick={onDismiss}><RiCloseLine size={16}/></IconButton>
  </section>;
}
