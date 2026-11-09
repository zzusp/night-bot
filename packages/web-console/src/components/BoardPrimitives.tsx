import {useAssistantBrand, brandGlyph} from './AssistantBrand'
// Visual geometry adapted from BoardUI (MIT), revision ec5c5eb.
// See ../styles/boardui.css and ../../licenses/boardui-MIT.txt.
import { RiArrowUpLine, RiChatAiLine, RiMoonClearFill } from '@remixicon/react'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

const classes = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ')

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: ReactNode
  busy?: boolean
}

export function Button({ variant = 'secondary', icon, busy = false, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button {...props} type={type} className={classes('board-button', `board-button--${variant}`, className)} disabled={disabled || busy} aria-busy={busy || undefined}>
      {icon && <span className={classes('board-button-icon', busy && 'board-button-content-hidden')} aria-hidden="true">{icon}</span>}
      <span className={classes(busy && 'board-button-content-hidden')}>{children}</span>
      {busy && <span className="board-button-busy" aria-hidden="true"><Spinner /></span>}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

export function IconButton({ label, title = label, className, children, type = 'button', onClick, ...props }: IconButtonProps) {
  return <button {...props} onClick={onClick} type={type} aria-label={label} title={title} className={classes('board-icon-button', className)}><span aria-hidden="true">{children}</span></button>
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return <span {...props} className={classes('board-badge', `board-badge--${tone}`, className)}>{children}</span>
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return <span className={classes('board-spinner', className)} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="board-empty">
      <span className="board-empty-icon" aria-hidden="true">{icon ?? <RiChatAiLine />}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="board-empty-action">{action}</div>}
    </div>
  )
}

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  const brand=useAssistantBrand();
  return (
    <span className={classes('board-logo', className)} role={compact ? 'img' : undefined} aria-label={compact ? brand.name : undefined}>
      <span className="board-logo-mark" aria-hidden="true">{brand.icon === 'moon' ? <RiMoonClearFill /> : brandGlyph(brand.icon)}</span>
      {!compact && <span>{brand.name}</span>}
    </span>
  )
}

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void | Promise<void>
  disabled?: boolean
  busy?: boolean
  error?: string | null
  placeholder?: string
}

export function Composer({ value, onChange, onSend, disabled = false, busy = false, error, placeholder }: ComposerProps) {
  const brand=useAssistantBrand();
  const id = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const sending = useRef(false)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const waiting = busy || pending
  const displayedError = error || localError

  useLayoutEffect(() => {
    const field = textarea.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }, [value])

  async function send() {
    if (disabled || waiting || sending.current || composing.current || !value.trim()) return
    sending.current = true
    setPending(true)
    setLocalError(null)
    try {
      await onSend()
    } catch {
      setLocalError('消息未能发送，内容已保留，请重试。')
      textarea.current?.focus()
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  return (
    <div className="board-composer">
      <form noValidate onSubmit={submit} className={classes('board-composer-form', waiting && 'board-composer-form--busy', Boolean(displayedError) && 'board-composer-form--error')}>
        <label className="board-sr-only" htmlFor={`${id}-message`}>消息内容</label>
        <textarea
          className="resize-none"
          id={`${id}-message`}
          ref={textarea}
          rows={1}
          value={value}
          placeholder={placeholder || `与 ${brand.name} 对话…`}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={displayedError ? true : undefined}
          aria-describedby={`${id}-help${displayedError ? ` ${id}-error` : ''}`}
          onChange={event => { setLocalError(null); onChange(event.target.value) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
            event.preventDefault()
            void send()
          }}
        />
        <button type="submit" className="board-composer-send" disabled={disabled || waiting || !value.trim()} aria-label={waiting ? '正在发送消息' : '发送消息'} title={waiting ? '正在发送消息' : '发送消息'} aria-busy={waiting || undefined}>
          {waiting ? <Spinner /> : <RiArrowUpLine aria-hidden="true" />}
        </button>
      </form>
      <div className="board-composer-meta sr-only">
        <span id={`${id}-help`} className="sr-only">Enter 发送 · Shift + Enter 换行</span>
        <span role="status" aria-live="polite">{waiting ? '正在处理消息…' : ''}</span>
      </div>
      {displayedError && <p id={`${id}-error`} className="board-composer-error" role="alert">{displayedError}</p>}
    </div>
  )
}
