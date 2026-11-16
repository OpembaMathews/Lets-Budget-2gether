// History: every month at a glance, a simple chart, the yearly totals, and two months side by side.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money } from './api'
import type { HistoryRow } from './api'
import { Card, PhoneLabel, Select } from './ui'

export default function History(props: { onOpenMonth: (id: number) => void }) {
  const query = useQuery({ queryKey: ['history'], queryFn: api.history })
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>('')

  if (query.isLoading) return <p className="text-slate-500">Loading history…</p>
  if (!query.data) return <p className="text-red-700">Could not load history.</p>
  const h = query.data
  const months = h.months
  const options = months.map((m) => ({ value: String(m.id), label: m.label }))
  const left = a || options[Math.max(0, options.length - 2)]?.value || ''
  const right = b || options[options.length - 1]?.value || ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">History</h1>
        <p className="mt-1 text-sm text-slate-600">Every month you have planned, and how they compare. Amounts are in KES.</p>
      </div>

      <Chart months={months} />

      <Card className="overflow-x-auto">
        <div className="md:min-w-[640px]">
          <div className="hidden grid-cols-[minmax(120px,1fr)_80px_repeat(5,96px)] gap-2 border-b md:grid border-slate-200 bg-brand-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Month</span>
            <span>Status</span>
            <span className="text-right">Income</span>
            <span className="text-right">Budget</span>
            <span className="text-right">Actual</span>
            <span className="text-right">Saved</span>
            <span className="text-right">Sent home</span>
          </div>
          {months.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => props.onOpenMonth(m.id)}
              title="Open this month"
              className="grid w-full grid-cols-5 gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-slate-50 md:grid-cols-[minmax(120px,1fr)_80px_repeat(5,96px)] md:py-2"
            >
              {/* On a phone: the month and its status on one row, the five figures under them. */}
              <span className="col-span-4 font-medium text-brand-900 md:col-span-1">{m.label}</span>
              <span className="text-right text-xs capitalize text-slate-500 md:text-left">{m.status}</span>
              <span className="num text-right">
                <PhoneLabel>Income</PhoneLabel>
                {fmt(m.income_kes)}
              </span>
              <span className="num text-right text-slate-600">
                <PhoneLabel>Budget</PhoneLabel>
                {fmt(m.budget_kes)}
              </span>
              <span className={'num text-right ' + (Number(m.actual_kes) > Number(m.budget_kes) ? 'font-semibold text-red-700' : '')}>
                <PhoneLabel>Actual</PhoneLabel>
                {fmt(m.actual_kes)}
              </span>
              <span className="num text-right text-leaf-dark">
                <PhoneLabel>Saved</PhoneLabel>
                {fmt(m.saved_kes)}
              </span>
              <span className="num text-right">
                <PhoneLabel>Sent</PhoneLabel>
                {fmt(m.sent_kes)}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {h.years.map((y) => (
          <Card key={y.year} className="p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-brand-900">{y.year}</h2>
              <a href={api.exportYearUrl(y.year)} className="text-sm font-semibold text-brand-700 underline">
                Download {y.year} as Excel
              </a>
            </div>
            <p className="text-xs text-slate-500">{y.months} month{y.months === 1 ? '' : 's'}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-600">Income</dt>
              <dd className="num text-right font-semibold">{money(y.income_kes, 'KES')}</dd>
              <dt className="text-slate-600">Budget</dt>
              <dd className="num text-right">{money(y.budget_kes, 'KES')}</dd>
              <dt className="text-slate-600">Actual</dt>
              <dd className="num text-right">{money(y.actual_kes, 'KES')}</dd>
              <dt className="text-slate-600">Saved</dt>
              <dd className="num text-right text-leaf-dark">{money(y.saved_kes, 'KES')}</dd>
              <dt className="text-slate-600">Sent home</dt>
              <dd className="num text-right">{money(y.sent_kes, 'KES')}</dd>
            </dl>
          </Card>
        ))}
      </div>

      {options.length >= 2 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-2 font-semibold text-brand-900">Compare</h2>
            <Select ariaLabel="First month" value={left} options={options} onChange={setA} />
            <span className="text-sm text-slate-500">with</span>
            <Select ariaLabel="Second month" value={right} options={options} onChange={setB} />
          </div>
          {left && right && <Compare a={Number(left)} b={Number(right)} />}
        </Card>
      )}
    </div>
  )
}

/** Income, actual and saved per month as simple bars. */
function Chart(props: { months: HistoryRow[] }) {
  const ms = props.months
  if (ms.length === 0) return null
  const top = Math.max(1, ...ms.flatMap((m) => [Number(m.income_kes), Number(m.actual_kes), Number(m.budget_kes)]))
  const series = [
    { key: 'income_kes' as const, label: 'Income', color: 'bg-brand-700' },
    { key: 'actual_kes' as const, label: 'Actual', color: 'bg-slate-400' },
    { key: 'saved_kes' as const, label: 'Saved', color: 'bg-leaf' },
  ]
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={'inline-block h-2.5 w-2.5 rounded-sm ' + s.color} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex h-40 items-end gap-4 overflow-x-auto">
        {ms.map((m) => (
          <div key={m.id} className="flex min-w-[56px] flex-col items-center gap-1">
            <div className="flex h-32 items-end gap-0.5">
              {series.map((s) => (
                <div
                  key={s.key}
                  className={'w-3 rounded-t ' + s.color}
                  style={{ height: `${(Number(m[s.key]) / top) * 100}%` }}
                  title={`${s.label}: ${money(m[s.key], 'KES')}`}
                />
              ))}
            </div>
            <span className="text-[11px] text-slate-500">{m.label.slice(0, 3)} {String(m.year).slice(2)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Compare(props: { a: number; b: number }) {
  const query = useQuery({ queryKey: ['compare', props.a, props.b], queryFn: () => api.compare(props.a, props.b) })
  if (!query.data) return <p className="text-sm text-slate-500">Loading…</p>
  const c = query.data
  const grid = 'grid grid-cols-[minmax(150px,1fr)_repeat(4,80px)_80px] items-center gap-2'
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] text-sm">
        <div className={grid + ' border-b border-slate-200 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'}>
          <span>Line</span>
          <span className="text-right">{c.a.label.slice(0, 3)} budget</span>
          <span className="text-right">{c.a.label.slice(0, 3)} actual</span>
          <span className="text-right">{c.b.label.slice(0, 3)} budget</span>
          <span className="text-right">{c.b.label.slice(0, 3)} actual</span>
          <span className="text-right">Change</span>
        </div>
        {c.lines.map((l) => {
          const change = Number(l.b?.actual ?? 0) - Number(l.a?.actual ?? 0)
          return (
            <div key={`${l.location}/${l.section}/${l.name}`} className={grid + ' border-b border-slate-100 py-1'}>
              <span className="min-w-0 truncate">
                {l.name} <span className="text-xs text-slate-400">{l.section}</span>
              </span>
              <span className="num text-right text-slate-500">{l.a ? fmt(l.a.budget) : '–'}</span>
              <span className="num text-right">{l.a ? fmt(l.a.actual) : '–'}</span>
              <span className="num text-right text-slate-500">{l.b ? fmt(l.b.budget) : '–'}</span>
              <span className="num text-right">{l.b ? fmt(l.b.actual) : '–'}</span>
              <span className={'num text-right ' + (change > 0 ? 'text-red-700' : change < 0 ? 'text-brand-700' : 'text-slate-400')}>
                {change === 0 ? '–' : `${change > 0 ? '+' : ''}${fmt(change)}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
