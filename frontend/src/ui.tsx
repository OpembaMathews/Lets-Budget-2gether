// Small shared building blocks.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/** A text or number box that saves when you leave it or press Enter. */
export function EditBox(props: {
  value: string
  /** Return false (or a promise of false) when the change was refused, and the box resets. */
  onCommit: (value: string) => unknown
  numeric?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])

  function commit() {
    const next = draft.trim()
    if (next === props.value) return
    if (props.numeric) {
      if (next === '' || Number.isNaN(Number(next)) || Number(next) < 0) {
        setDraft(props.value)
        return
      }
    } else if (next === '') {
      setDraft(props.value)
      return
    }
    void Promise.resolve(props.onCommit(next)).then((ok) => {
      if (ok === false) setDraft(props.value)
    })
  }

  return (
    <input
      aria-label={props.ariaLabel}
      className={
        'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition ' +
        'hover:border-slate-300 focus:border-brand-600 focus:bg-white focus:ring-2 focus:ring-brand-100 ' +
        'disabled:cursor-not-allowed disabled:hover:border-transparent ' +
        (props.numeric ? 'num text-right ' : '') +
        (props.className ?? '')
      }
      size={1}
      value={draft}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.numeric ? 'decimal' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(props.value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={'rounded-xl border border-slate-200 bg-white shadow-sm ' + (props.className ?? '')}>
      {props.children}
    </div>
  )
}

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
}) {
  const styles = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-300',
    ghost: 'border border-slate-300 bg-white text-brand-800 hover:bg-brand-50 disabled:text-slate-400',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  }[props.variant ?? 'primary']
  return (
    <button
      type={props.type ?? 'button'}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={'rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ' + styles}
    >
      {props.children}
    </button>
  )
}

export function Select(props: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  ariaLabel?: string
  className?: string
}) {
  return (
    <select
      aria-label={props.ariaLabel}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      className={
        'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none ' +
        'focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 ' +
        (props.className ?? '')
      }
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function ErrorBanner(props: { message: string | null; onClose: () => void }) {
  if (!props.message) return null
  return (
    <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>{props.message}</span>
      <button className="font-semibold" onClick={props.onClose} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
