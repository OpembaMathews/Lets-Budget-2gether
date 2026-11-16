// Income: expected income, the plan fit check, recording a payment and its split.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money } from './api'
import type { Arrival, IncomeView, MonthSummary, Slice, SourceRow } from './api'
import { monthLabel } from './api'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { Button, Card, EditBox, Select } from './ui'

const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

export function ruleText(s: { rule_type: string; save_percent: string | null; save_fixed: string | null; obligations_percent: string | null; currency_code: string }): string {
  const pct = Number(s.save_percent ?? 0)
  if (s.rule_type === 'percent_first') return `Save ${fmt(pct)}% first`
  if (s.rule_type === 'fixed_first') return `Save ${money(s.save_fixed ?? 0, s.currency_code)} first`
  if (s.rule_type === 'three_way') {
    const ob = Number(s.obligations_percent ?? 0)
    return `${fmt(pct)}% save · ${fmt(ob)}% bills · ${fmt(Math.max(0, 100 - pct - ob))}% personal`
  }
  return 'No saving rule'
}

export default function Income(props: { month: MonthSummary; onError: (m: string | null) => void }) {
  const { month, onError } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['income', month.id], queryFn: () => api.income(month.id) })
  // The payment whose split is open for checking or adjusting.
  const [openId, setOpenId] = useState<number | null>(null)

  if (query.isLoading) return <p className="text-slate-500">Loading income…</p>
  if (!query.data) return <p className="text-red-700">Could not load income for this month.</p>
  const view = query.data
  const locked = view.status === 'closed'
  const planning = view.status === 'planning'
  const payments = [...view.arrivals].sort((a, b) => b.received_date.localeCompare(a.received_date) || b.id - a.id)
  const open = payments.find((a) => a.id === openId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Income · {monthLabel(month)}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add each payment on the day it arrives. Each one is split straight away: savings first, then bills, and the
          rest is free to spend.
        </p>
      </div>

      {planning && <FitCard view={view} run={run} />}

      <ReceivedSoFar view={view} />

      {!locked && <RecordPayment view={view} month={month} run={run} onRecorded={(id) => setOpenId(id)} />}

      {open && (
        <SplitPanel key={open.id} arrival={open} view={view} run={run} locked={locked} onClose={() => setOpenId(null)} />
      )}

      <Card>
        <div className="flex items-baseline justify-between rounded-t-xl bg-brand-50 px-4 py-2.5">
          <h2 className="font-semibold text-brand-900">Payments received</h2>
          <span className="text-xs text-slate-500">
            {payments.length} payment{payments.length === 1 ? '' : 's'}
          </span>
        </div>
        {payments.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">No payments recorded yet this month.</p>}
        {payments.map((a) => (
          <ConfirmedRow
            key={a.id}
            arrival={a}
            locked={locked}
            run={run}
            isOpen={a.id === openId}
            onToggle={() => setOpenId(a.id === openId ? null : a.id)}
          />
        ))}
      </Card>

      <Card className="overflow-x-auto">
        <div className="min-w-[540px]">
          <div className="rounded-t-xl bg-brand-50 px-4 py-2.5">
            <h2 className="font-semibold text-brand-900">Expected this month</h2>
          </div>
          <div className="grid grid-cols-[minmax(150px,1fr)_88px_112px_48px_100px] items-center gap-2 border-b border-slate-200 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Source</span>
            <span>Kind</span>
            <span className="text-right">Expected</span>
            <span className="text-right">Day</span>
            <span className="text-right">Arrived</span>
          </div>
          {view.sources.filter((s) => s.active).map((s) => (
            <ExpectedRow key={s.id} source={s} monthId={month.id} locked={locked} run={run} />
          ))}
          <p className="px-4 py-2 text-xs text-slate-500">
            Only regular income counts toward covering the plan. Sources and their rules are changed in Settings.
          </p>
        </div>
      </Card>

      {!planning && <FitCard view={view} run={run} />}
    </div>
  )
}

/** How much has come in this month, and where it went. */
function ReceivedSoFar(props: { view: IncomeView }) {
  const { view } = props
  const s = view.summary
  const native = Object.entries(s.arrived.native)
  const expected = Number(view.fit.reliable.KES) + Number(view.fit.irregular.KES)
  const freeNative = Object.entries(s.free.native)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Received so far</p>
        {native.length === 0 && <p className="mt-1 text-2xl font-bold">Nothing yet</p>}
        {native.map(([code, amount]) => (
          <p key={code} className="num mt-1 text-2xl font-bold">
            {money(amount, code)}
          </p>
        ))}
        <p className="num text-sm text-brand-100">
          ≈ {money(s.arrived.KES, 'KES')} of {money(expected, 'KES')} expected
        </p>
      </div>
      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved from it</p>
        {Object.keys(s.savings_reserved.native).length === 0 && <p className="mt-1 text-2xl font-bold text-leaf-dark">–</p>}
        {Object.entries(s.savings_reserved.native).map(([code, amount]) => (
          <p key={code} className="num mt-1 text-2xl font-bold text-leaf-dark">
            {money(amount, code)}
          </p>
        ))}
        <p className="num text-sm text-slate-500">
          ≈ {money(s.savings_reserved.KES, 'KES')}
          {s.core ? (Number(s.core.covered) >= Number(s.core.planned) ? ' · core saving taken' : ' · core saving not yet taken') : ''}
        </p>
      </Card>
      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Free to spend</p>
        {freeNative.length === 0 && <p className="mt-1 text-2xl font-bold text-brand-900">–</p>}
        {freeNative.map(([code, amount]) => (
          <p key={code} className="num mt-1 text-2xl font-bold text-brand-900">
            {money(amount, code)}
          </p>
        ))}
        <p className="text-sm text-slate-500">After savings and bills</p>
      </Card>
    </div>
  )
}

/** Does the plan fit the reliable income? Also where the month is started. */
export function FitCard(props: { view: IncomeView; run: Run }) {
  const { view, run } = props
  const { fit } = view
  const [source, setSource] = useState('')
  const gap = Number(fit.gap_kes)
  const planning = view.status === 'planning'

  const tone = fit.fits ? 'border-brand-300 bg-brand-50' : 'border-amber-300 bg-amber-50'
  return (
    <div className={'rounded-xl border p-4 ' + tone}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
          <Figure label="Reliable income expected" value={money(fit.reliable.KES, 'KES')} sub={`≈ ${money(fit.reliable.NTD, 'NTD')}`} />
          <Figure label="Plan" value={money(fit.plan.KES, 'KES')} sub={`≈ ${money(fit.plan.NTD, 'NTD')}`} />
          <Figure
            label={fit.fits ? 'Room left' : 'Plan is too large by'}
            value={money(Math.abs(gap), 'KES')}
            sub={fit.fits ? 'The plan fits your reliable income' : `≈ ${money(fit.gap_ntd, 'NTD')}`}
            strong={!fit.fits}
          />
        </div>
        <div className="text-right">
          {view.status === 'active' && (
            <p className="text-sm font-semibold text-brand-800">Month started</p>
          )}
          {view.status === 'closed' && <p className="text-sm font-semibold text-slate-600">Month closed</p>}
          {planning && fit.fits && fit.needs_review === 0 && (
            <Button onClick={() => run(() => api.activate(view.month_id))}>Start the month</Button>
          )}
        </div>
      </div>

      {Number(fit.irregular.KES) > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Irregular income of {money(fit.irregular.KES, 'KES')} is expected too, but it is not counted toward the plan.
        </p>
      )}

      {planning && fit.needs_review > 0 && (
        <p className="mt-3 text-sm text-amber-900">
          Confirm the {fit.needs_review} carried-over amount{fit.needs_review === 1 ? '' : 's'} on the Month plan before
          starting the month.
        </p>
      )}

      {planning && !fit.fits && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <p className="text-sm text-amber-900">
            The month cannot start until the plan fits. Reduce flexible lines on the Month plan, or say where the
            shortfall will come from.
          </p>
          {fit.flexible_lines.length > 0 && (
            <p className="mt-1 text-sm text-slate-700">
              Largest flexible lines:{' '}
              {fit.flexible_lines.slice(0, 5).map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ' · '}
                  {l.name} <span className="num text-slate-500">({money(l.planned, l.currency_code)})</span>
                </span>
              ))}
            </p>
          )}
          {fit.needs_review === 0 && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (source.trim()) void run(() => api.activate(view.month_id, source.trim()))
              }}
            >
              <input
                aria-label="Where the shortfall will come from"
                className={box + ' min-w-[260px] flex-1'}
                placeholder="Shortfall comes from… e.g. last month's balance"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              <Button type="submit" disabled={!source.trim()}>
                Start anyway
              </Button>
            </form>
          )}
        </div>
      )}

      {view.shortfall_source && view.status !== 'planning' && (
        <p className="mt-2 text-sm text-amber-900">
          Started with a shortfall of {money(view.shortfall_amount, 'KES')}, to come from: {view.shortfall_source}
        </p>
      )}
    </div>
  )
}

function Figure(props: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.label}</p>
      <p className={'num text-xl font-bold ' + (props.strong ? 'text-amber-800' : 'text-brand-900')}>{props.value}</p>
      {props.sub && <p className="num text-xs text-slate-500">{props.sub}</p>}
    </div>
  )
}

function ExpectedRow(props: { source: SourceRow; monthId: number; locked: boolean; run: Run }) {
  const { source: s, monthId, locked, run } = props
  const regular = s.reliability === 'regular'
  return (
    <div className="grid grid-cols-[minmax(150px,1fr)_88px_112px_48px_100px] items-center gap-2 border-b border-slate-100 px-4 py-1.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{s.name}</p>
        <p className="truncate text-xs text-slate-500">{ruleText(s)}</p>
      </div>
      <span>
        <span className={'rounded-full px-2 py-0.5 text-xs font-semibold ' + (regular ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600')}>
          {regular ? 'Regular' : 'Irregular'}
        </span>
      </span>
      <div className="flex min-w-0 items-center gap-1">
        <EditBox
          ariaLabel={`Expected from ${s.name}`}
          numeric
          disabled={locked}
          value={String(Number(s.expected ?? 0))}
          onCommit={(v) => run(() => api.setExpected(monthId, { source_id: s.id, amount: v }))}
          className="font-semibold text-brand-900"
        />
        <span className="text-xs text-slate-500">{s.currency_code}</span>
      </div>
      <EditBox
        ariaLabel={`Expected day for ${s.name}`}
        numeric
        disabled={locked}
        value={s.expected_day ? String(s.expected_day) : ''}
        placeholder="–"
        onCommit={(v) =>
          run(() => api.setExpected(monthId, { source_id: s.id, amount: String(Number(s.expected ?? 0)), expected_day: Math.round(Number(v)) }))
        }
      />
      <span className="num text-right text-slate-600">{Number(s.arrived) > 0 ? money(s.arrived, s.currency_code) : '–'}</span>
    </div>
  )
}

function RecordPayment(props: { view: IncomeView; month: MonthSummary; run: Run; onRecorded: (id: number) => void }) {
  const { view, month, run, onRecorded } = props
  const monthId = month.id
  const sources = view.sources.filter((s) => s.active)
  const [sourceId, setSourceId] = useState(String(sources[0]?.id ?? ''))
  const [amount, setAmount] = useState('')
  // Today when it falls in this month, otherwise the month's first day.
  const [date, setDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`
    return today.startsWith(prefix) ? today : `${prefix}-01`
  })
  const chosen = sources.find((s) => String(s.id) === sourceId)
  // Payments can be added in any month that is not closed.
  const ready = view.status !== 'closed'
  const valid = ready && chosen !== undefined && Number(amount) > 0

  return (
    <Card className="p-4">
      <h2 className="font-semibold text-brand-900">Add a payment</h2>
      {!ready && <p className="mt-1 text-sm text-slate-600">This month is closed.</p>}
      {view.status === 'planning' && (
        <p className="mt-1 text-sm text-slate-600">
          This month has not been started yet. Adding a payment starts it, as long as your plan fits your income.
        </p>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          let after: IncomeView | undefined
          void run(async () => {
            after = await api.recordArrival(monthId, { source_id: Number(sourceId), amount, received_date: date })
          }).then((ok) => {
            if (!ok || !after) return
            setAmount('')
            const newest = after.arrivals.reduce((m, a) => (a.id > m ? a.id : m), 0)
            if (newest) onRecorded(newest)
          })
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-slate-700">From</span>
          <Select
            ariaLabel="Income source"
            className="py-1.5"
            value={sourceId}
            onChange={setSourceId}
            disabled={!ready}
            options={sources.map((s) => ({ value: String(s.id), label: s.name }))}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Amount {chosen ? `(${chosen.currency_code})` : ''}</span>
          <input
            aria-label="Payment amount"
            className={box + ' num w-36 text-right'}
            inputMode="decimal"
            disabled={!ready}
            value={amount}
            placeholder={chosen?.expected ? String(Number(chosen.expected)) : '0'}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Date received</span>
          <input aria-label="Date received" type="date" className={box} disabled={!ready} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <Button type="submit" disabled={!valid}>
          Add payment
        </Button>
      </form>
    </Card>
  )
}

const SECTIONS: { key: string; title: string; hint: string }[] = [
  { key: 'essential', title: 'Essential bills', hint: 'KE and TW bills that must be covered.' },
  { key: 'flexible', title: 'Flexible bills', hint: 'Paid after the essentials.' },
  { key: 'core_saving', title: 'Core saving', hint: 'Your fixed monthly saving.' },
  { key: 'savings', title: 'Extra savings', hint: "From this source's saving rule." },
  { key: 'project', title: 'Projects', hint: 'In your project priority order.' },
]

function SplitPanel(props: { arrival: Arrival; view: IncomeView; run: Run; onClose: () => void; locked: boolean }) {
  const { arrival, view, run, onClose, locked } = props
  const cur = arrival.currency_code
  const slices = arrival.allocations.filter((a) => a.kind !== 'free')
  const free = arrival.allocations.filter((a) => a.kind === 'free').reduce((sum, a) => sum + Number(a.amount), 0)
  const left = view.summary.essentials_left
  const short = Number(left.KES) > 0

  function change(slice: Slice, value: string) {
    const body = slices.map((s) => ({
      kind: s.kind,
      budget_line_id: s.budget_line_id,
      amount: s.id === slice.id ? value : s.amount,
    }))
    return run(() => api.setAllocations(arrival.id, body))
  }

  return (
    <Card className="border-2 border-brand-600">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl bg-brand-800 px-4 py-3 text-white">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Saved · how it was split</p>
          <p className="text-lg font-bold">
            {arrival.source_name} · <span className="num">{money(arrival.amount, cur)}</span>
          </p>
        </div>
        <p className="text-sm text-brand-100">Received {arrival.received_date}</p>
      </div>

      {[...SECTIONS]
        // show the parts in the order this payment was shared out
        .sort((a, b) => {
          const at = (k: string) => {
            const i = slices.findIndex((s) => s.kind === k)
            return i === -1 ? 99 : i
          }
          return at(a.key) - at(b.key)
        })
        .map((section) => {
        const rows = slices.filter((s) => s.kind === section.key)
        if (rows.length === 0) return null
        const total = rows.reduce((sum, r) => sum + Number(r.amount), 0)
        return (
          <div key={section.key} className="border-b border-slate-200">
            <div className="flex items-baseline justify-between bg-slate-50 px-4 py-1.5">
              <p className="text-sm font-semibold text-brand-900">
                {section.title} <span className="font-normal text-slate-500">· {section.hint}</span>
              </p>
              <p className="num text-sm font-semibold text-brand-800">{money(total, cur)}</p>
            </div>
            {rows.map((s) => (
              <div key={s.id} className="grid grid-cols-[minmax(160px,1fr)_minmax(120px,auto)_130px] items-center gap-3 px-4 py-1 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{s.line_name ?? 'Set aside for savings goals'}</span>
                  {s.group_name && (
                    <span className="text-slate-500">
                      {' '}
                      · {s.location_name} / {s.group_name}
                    </span>
                  )}
                </div>
                <span className="num text-right text-xs text-slate-500">
                  {s.line_currency && s.line_amount !== null
                    ? `${money(s.line_amount, s.line_currency)} of ${fmt(s.line_planned)}`
                    : ''}
                </span>
                <div className="flex items-center gap-1">
                  <EditBox
                    ariaLabel={`Amount for ${s.line_name ?? 'extra savings'}`}
                    numeric
                    disabled={locked}
                    value={String(Number(s.amount))}
                    onCommit={(v) => change(s, v)}
                    className="border-slate-200 font-semibold text-brand-900"
                  />
                  <span className="text-xs text-slate-500">{cur}</span>
                </div>
              </div>
            ))}
          </div>
        )
      })}

      <div className="flex items-baseline justify-between bg-leaf/15 px-4 py-2.5">
        <p className="text-sm font-semibold text-brand-900">
          Free to spend <span className="font-normal text-slate-600">· what is left after everything above</span>
        </p>
        <p className="num text-lg font-bold text-leaf-dark">{money(free, cur)}</p>
      </div>

      {short && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Payments so far do not cover every essential yet. <strong>{money(left.KES, 'KES')}</strong> of essentials
          still need funding. Reliable income still expected this month:{' '}
          <strong>{money(view.summary.upcoming_reliable.KES, 'KES')}</strong>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-slate-500">
          {locked ? 'This month is closed.' : 'Change any amount and the rest moves to free to spend.'}
        </p>
        <div className="flex gap-2">
          {!locked && (
            <Button variant="ghost" onClick={() => run(() => api.resuggest(arrival.id))}>
              Reset to suggestion
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Card>
  )
}

function ConfirmedRow(props: { arrival: Arrival; locked: boolean; run: Run; isOpen: boolean; onToggle: () => void }) {
  const { arrival: a, locked, run, isOpen, onToggle } = props
  const cur = a.currency_code
  const sum = (test: (s: Slice) => boolean) => a.allocations.filter(test).reduce((t, s) => t + Number(s.amount), 0)
  const saved = sum((s) => s.kind === 'core_saving' || s.kind === 'savings' || s.kind === 'project')
  const here = sum((s) => (s.kind === 'essential' || s.kind === 'flexible') && s.line_currency === cur)
  const away = sum((s) => (s.kind === 'essential' || s.kind === 'flexible') && s.line_currency !== cur)
  const free = sum((s) => s.kind === 'free')
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-semibold'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0">
      <div>
        <p className="font-medium">
          {a.source_name} <span className="num font-bold text-brand-900">{money(a.amount, cur)}</span>
        </p>
        <p className="text-xs text-slate-500">
          Received {a.received_date}
          {a.adjusted && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">split changed by hand</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={chip + ' bg-leaf/20 text-leaf-dark'}>Saved {fmt(saved)}</span>
        <span className={chip + ' bg-brand-100 text-brand-800'}>Bills here {fmt(here)}</span>
        {away > 0 && <span className={chip + ' bg-brand-100 text-brand-800'}>To send {fmt(away)}</span>}
        <span className={chip + ' bg-slate-100 text-slate-700'}>Free {fmt(free)}</span>
        <button
          type="button"
          className={'ml-1 rounded-md px-2 py-1 text-sm ' + (isOpen ? 'bg-brand-100 text-brand-900' : 'text-brand-700 hover:bg-brand-50')}
          onClick={onToggle}
        >
          {isOpen ? 'Hide split' : locked ? 'See split' : 'Adjust split'}
        </button>
        {!locked && (
          <button
            type="button"
            title="Remove this payment"
            className="ml-1 rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
            onClick={() => {
              if (window.confirm(`Remove this ${a.source_name} payment and its split?`)) void run(() => api.deleteArrival(a.id))
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
