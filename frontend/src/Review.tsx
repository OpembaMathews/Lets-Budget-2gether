// Month-end review: how the month went, what still needs attention, the balance check, and closing the month.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money } from './api'
import type { MonthSummary, ReviewView } from './api'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { Button, Card, EditBox } from './ui'

export default function Review(props: { month: MonthSummary; onError: (m: string | null) => void }) {
  const { month, onError } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['review', month.id], queryFn: () => api.review(month.id) })

  if (query.isLoading) return <p className="text-slate-500">Loading the review…</p>
  if (!query.data) return <p className="text-red-700">Could not load the review.</p>
  const r = query.data
  const closed = r.status === 'closed'
  const f = r.figures
  // Every card leads with NTD; KES is the smaller figure under it.
  const diff = Number(f.actual.NTD) - Number(f.budget.NTD)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Month-end review · {r.label}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Check how the month went, fix anything that is off, record your real balances, then close the month.
          </p>
        </div>
        <a
          href={api.exportMonthUrl(month.id)}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
        >
          Download as Excel
        </a>
      </div>

      {closed && (
        <div className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
          This month is closed{r.closed_at ? ` (since ${r.closed_at.slice(0, 10)})` : ''}. Nothing in it can be changed
          until it is reopened.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure title="Income received" main={Object.keys(f.income.native).length ? money(f.income.NTD, 'NTD') : '–'} sub={`≈ ${money(f.income.KES, 'KES')}`} dark />
        <Figure
          title="Spent and sent (actual)"
          main={money(f.actual.NTD, 'NTD')}
          sub={`of ${money(f.budget.NTD, 'NTD')} budget · ${diff > 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`}`}
          warn={diff > 0}
        />
        <Figure title="Saved" main={money(f.saved.NTD, 'NTD')} sub={`≈ ${money(f.saved.KES, 'KES')} · savings and projects from income`} />
        <Figure title="Free to spend" main={money(f.free.NTD, 'NTD')} sub={`Sent home: ${money(f.sent_kes, 'KES')}`} />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold text-brand-900">Budget against actual by location</h2>
        <div className="space-y-3">
          {Object.entries(f.locations).map(([name, l]) => {
            const b = Number(l.budget.NTD)
            const a = Number(l.actual.NTD)
            return (
              <div key={name}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className={'num ' + (a > b ? 'font-semibold text-red-700' : 'text-slate-600')}>
                    {fmt(a)} of {money(b, 'NTD')}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className={'h-full ' + (a > b ? 'bg-red-500' : 'bg-brand-600')} style={{ width: `${b > 0 ? Math.min(100, (a / b) * 100) : 0}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Checks review={r} />

      <Balances review={r} run={run} closed={closed} />

      <CloseBox review={r} run={run} />
    </div>
  )
}

function Figure(props: { title: string; main: string; sub: string; dark?: boolean; warn?: boolean }) {
  if (props.dark)
    return (
      <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">{props.title}</p>
        <p className="num mt-1 text-xl font-bold">{props.main}</p>
        <p className="num text-sm text-brand-100">{props.sub}</p>
      </div>
    )
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.title}</p>
      <p className="num mt-1 text-xl font-bold text-brand-900">{props.main}</p>
      <p className={'num text-sm ' + (props.warn ? 'font-semibold text-red-700' : 'text-slate-500')}>{props.sub}</p>
    </Card>
  )
}

function Checks(props: { review: ReviewView }) {
  const c = props.review.checks
  const items: { tone: 'warn' | 'info'; title: string; body: string[] }[] = []
  if (c.needs_review > 0)
    items.push({ tone: 'warn', title: `${c.needs_review} carried-over amount(s) never confirmed`, body: ['Confirm them on the Month plan.'] })
  if (c.over_budget.length)
    items.push({
      tone: 'warn',
      title: `${c.over_budget.length} line(s) over budget`,
      body: c.over_budget.map((l) => `${l.name} (${l.section}): ${money(l.actual, l.currency_code)} of ${fmt(l.planned)}`),
    })
  if (c.ready_to_send.length)
    items.push({
      tone: 'warn',
      title: 'Cash set aside for Kenya but not sent',
      body: c.ready_to_send.map((l) => `${l.name} (${l.section}): KES ${fmt(l.amount)}`),
    })
  if (Number(c.unassigned_sends) > 0)
    items.push({ tone: 'warn', title: `KES ${fmt(c.unassigned_sends)} sent without a purpose`, body: ['Assign it on Kenya sends.'] })
  if (c.income_not_arrived.length)
    items.push({
      tone: 'info',
      title: 'Expected income that has not arrived',
      body: c.income_not_arrived.map((u) => `${u.name}: ${money(u.amount, u.currency_code)}`),
    })
  if (c.nothing_given.length)
    items.push({
      tone: 'info',
      title: `${c.nothing_given.length} line(s) with nothing given`,
      body: c.nothing_given.map((l) => `${l.name} (${l.section})${l.typed ? ' · actual typed as 0' : ''}`),
    })

  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-brand-900">Before you close</h2>
      {items.length === 0 && <p className="text-sm text-brand-700">Everything looks in order. ✓</p>}
      <div className="space-y-2">
        {items.map((it) => (
          <details
            key={it.title}
            className={'rounded-lg border px-3 py-2 text-sm ' + (it.tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50')}
          >
            <summary className={'cursor-pointer font-semibold ' + (it.tone === 'warn' ? 'text-amber-900' : 'text-slate-700')}>{it.title}</summary>
            <ul className="mt-1 list-disc pl-5 text-slate-700">
              {it.body.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Card>
  )
}

function Balances(props: { review: ReviewView; run: Run; closed: boolean }) {
  const { review: r, run, closed } = props
  const b = r.balances
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-brand-900">Balance check</h2>
      <p className="mb-3 text-sm text-slate-600">
        Type the real balance of each account at the end of the month.
        {b.has_previous
          ? ` The app compares them with ${b.previous_label}'s balances plus this month's income, less what was given out.`
          : ' This is your first check, so these balances become the starting point for next month.'}
      </p>
      <div className="divide-y divide-slate-100">
        {b.accounts.map((a) => (
          <div key={a.account_id} className="grid grid-cols-[minmax(0,1fr)_40px_130px] items-center sm:grid-cols-[minmax(140px,1fr)_60px_140px] gap-2 py-1.5 text-sm">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-slate-500">{a.currency_code}</span>
            <EditBox
              ariaLabel={`Balance of ${a.name}`}
              numeric
              disabled={closed}
              value={a.actual_balance === null ? '' : String(Number(a.actual_balance))}
              placeholder="Type balance"
              onCommit={(v) => run(() => api.setBalance(r.month_id, { account_id: a.account_id, actual_balance: v }))}
              className="border-slate-300 font-semibold text-brand-900"
            />
          </div>
        ))}
      </div>
      {b.currencies.some((c) => c.entered !== null || c.expected !== null) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {b.currencies.map((c) => (
            <div key={c.currency_code} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-brand-900">{c.currency_code}</p>
              <p className="num text-slate-700">Your balances: {c.entered !== null ? money(c.entered, c.currency_code) : '–'}</p>
              {c.expected !== null ? (
                <>
                  <p className="num text-slate-600">
                    Should be about {money(c.expected, c.currency_code)}
                    <span className="text-xs text-slate-500">
                      {' '}
                      ({fmt(c.opening)} + {fmt(c.income)} in − {fmt(c.spent)} given out
                      {Number(c.sends_cost) > 0 ? ` − ${fmt(c.sends_cost)} sent home` : ''})
                    </span>
                  </p>
                  {c.difference !== null && (
                    <p className={'num font-semibold ' + (Math.abs(Number(c.difference)) < 1 ? 'text-brand-700' : 'text-amber-800')}>
                      {Math.abs(Number(c.difference)) < 1
                        ? 'Matches ✓'
                        : `${Number(c.difference) < 0 ? 'Short by' : 'More by'} ${money(Math.abs(Number(c.difference)), c.currency_code)}, likely spending from free money or something not recorded`}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500">Starting point. Compared from next month.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function CloseBox(props: { review: ReviewView; run: Run }) {
  const { review: r, run } = props
  const [note, setNote] = useState(r.review_note ?? '')
  const closed = r.status === 'closed'
  const box =
    'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
  return (
    <Card className={'p-4 ' + (closed ? '' : 'border-2 border-brand-600')}>
      <h2 className="font-semibold text-brand-900">{closed ? 'Month closed' : 'Close the month'}</h2>
      {!closed && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            Closing locks {r.label} so it stays as a true record, and saves a backup copy of your data first. You can
            reopen it later if you need to.
          </p>
          <textarea
            aria-label="Notes for this month"
            className={box}
            rows={2}
            placeholder="Anything to remember about this month (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-3 flex justify-end">
            <Button
              onClick={() => {
                if (window.confirm(`Close ${r.label}? It will be locked until you reopen it.`)) void run(() => api.closeMonth(r.month_id, note))
              }}
            >
              Close {r.label}
            </Button>
          </div>
        </>
      )}
      {closed && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{r.review_note ? `Note: ${r.review_note}` : 'No note.'}</p>
          <Button
            variant="ghost"
            onClick={() => {
              const reason = (window.prompt(`Why are you reopening ${r.label}?`) ?? '').trim()
              if (reason) void run(() => api.reopenMonth(r.month_id, reason))
            }}
          >
            Reopen
          </Button>
        </div>
      )}
      {r.close_log && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{r.close_log}</p>}
    </Card>
  )
}
