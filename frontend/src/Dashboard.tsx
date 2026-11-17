// Dashboard: the chosen month at a glance.
import { useQuery } from '@tanstack/react-query'
import { api, fmt, money, monthLabel } from './api'
import type { Meta, MonthSummary, Progress } from './api'
import { useRun } from './hooks'
import { FitCard } from './Income'
import { Button, Card } from './ui'

/** For a month that has been started: how many days are left in it. */
function Countdown(props: { month: MonthSummary }) {
  const { year, month } = props.month
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const lastDay = new Date(year, month, 0).getDate()
  const monthsAway = (year - today.getFullYear()) * 12 + (month - 1 - today.getMonth())
  const days = (n: number) => (n === 1 ? 'day' : 'days')

  let big: string
  let small: string
  let passed = 0
  if (monthsAway > 0) {
    const until = Math.round((new Date(year, month - 1, 1).getTime() - today.getTime()) / 86_400_000)
    big = String(until)
    small = `${days(until)} until it begins`
  } else if (monthsAway < 0) {
    big = 'Month over'
    small = 'Close it in Review'
    passed = 1
  } else {
    const left = lastDay - today.getDate()
    big = left === 0 ? 'Last day' : String(left)
    small = (left === 0 ? '' : `${days(left)} left · `) + `day ${today.getDate()} of ${lastDay}`
    passed = today.getDate() / lastDay
  }
  return (
    <div className="min-w-[150px] rounded-xl border border-brand-100 bg-brand-50 px-4 py-2" title="Days left in this month">
      <p className="flex items-baseline gap-1.5">
        <span className="num text-2xl font-bold leading-none text-brand-900">{big}</span>
        <span className="text-xs text-slate-600">{small}</span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-100">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round(passed * 100)}%` }} />
      </div>
    </div>
  )
}

export default function Dashboard(props: {
  month: MonthSummary
  meta: Meta
  onError: (m: string | null) => void
  onAddIncome: () => void
}) {
  const { month, meta, onError, onAddIncome } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['income', month.id], queryFn: () => api.income(month.id) })
  const debts = useQuery({ queryKey: ['debts', month.id], queryFn: () => api.debts(month.id) })

  if (query.isLoading) return <p className="text-slate-500">Loading…</p>
  if (!query.data) return <p className="text-red-700">Could not load this month.</p>
  const view = query.data
  const s = view.summary
  // Every card leads with NTD; KES is the smaller figure under it.
  const expectedAll = Number(view.fit.reliable.NTD) + Number(view.fit.irregular.NTD)
  const coreDone = s.core !== null && Number(s.core.covered) >= Number(s.core.planned)
  const essentialsLeft = Number(s.essentials_left.NTD)
  const nothing = (t: { native: Record<string, string> }) => Object.keys(t.native).length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-slate-600">Where the month stands right now.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view.status === 'active' && <Countdown month={month} />}
          {view.status !== 'closed' && <Button onClick={onAddIncome}>+ Add income</Button>}
        </div>
      </div>

      <FitCard view={view} run={run} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Label>Income received</Label>
          <Big>{nothing(s.arrived) ? 'Nothing yet' : money(s.arrived.NTD, 'NTD')}</Big>
          <Small>
            of {money(expectedAll, 'NTD')} expected · ≈ {money(s.arrived.KES, 'KES')}
          </Small>
          <Bar part={Number(s.arrived.NTD)} whole={expectedAll} />
        </Card>

        <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Saved so far</p>
          <p className="num mt-1 text-2xl font-bold">
            {nothing(s.savings_reserved) ? 'Nothing yet' : money(s.savings_reserved.NTD, 'NTD')}
          </p>
          {!nothing(s.savings_reserved) && (
            <p className="num text-sm text-brand-100">≈ {money(s.savings_reserved.KES, 'KES')}</p>
          )}
          {s.core && Number(s.core.planned) === 0 ? (
            <p className="mt-1 text-sm text-brand-100">Set your core saving amount on the Month plan</p>
          ) : s.core ? (
            <p className="mt-1 text-sm text-brand-100">
              Core saving {money(s.core.planned, s.core.currency_code)}:{' '}
              <strong className={coreDone ? 'text-leaf' : 'text-amber-300'}>{coreDone ? 'taken ✓' : 'not yet taken'}</strong>
            </p>
          ) : (
            <p className="mt-1 text-sm text-brand-100">Saved through your automatic percentage from each payment</p>
          )}
        </div>

        <Card className="p-4">
          <Label>Essentials funded</Label>
          <Big>{money(s.essential.covered.NTD, 'NTD')}</Big>
          <Small>
            of {money(s.essential.planned.NTD, 'NTD')} · ≈ {money(s.essential.covered.KES, 'KES')}
          </Small>
          <Bar part={Number(s.essential.covered.NTD)} whole={Number(s.essential.planned.NTD)} />
          {essentialsLeft > 0 && <p className="num mt-2 text-xs text-amber-800">{money(essentialsLeft, 'NTD')} still to fund</p>}
        </Card>

        <Card className="p-4">
          <Label>Free to spend</Label>
          <Big>{nothing(s.free) ? '–' : money(s.free.NTD, 'NTD')}</Big>
          {!nothing(s.free) && <Small>≈ {money(s.free.KES, 'KES')}</Small>}
          <Small>Left after savings and bills from payments so far</Small>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold text-brand-900">Funding by location</h2>
          <p className="mb-3 text-xs text-slate-500">How much of each location's plan your payments have covered.</p>
          <div className="space-y-4">
            {meta.locations.map((loc) => {
              const block: Progress | undefined = s.locations[loc.id]
              if (!block) return null
              return (
                <div key={loc.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{loc.name}</span>
                    <span className="num text-slate-600">
                      {fmt(block.covered.NTD)} of {money(block.planned.NTD, 'NTD')}
                    </span>
                  </div>
                  <Bar part={Number(block.covered.NTD)} whole={Number(block.planned.NTD)} />
                </div>
              )
            })}
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-slate-600">Flexible lines</span>
                <span className="num text-slate-600">
                  {fmt(s.flexible.covered.NTD)} of {money(s.flexible.planned.NTD, 'NTD')}
                </span>
              </div>
              <Bar part={Number(s.flexible.covered.NTD)} whole={Number(s.flexible.planned.NTD)} muted />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-brand-900">Still expected</h2>
          <p className="mb-3 text-xs text-slate-500">Payments that have not arrived yet this month.</p>
          {s.upcoming.length === 0 && <p className="text-sm text-slate-500">Nothing more is expected this month.</p>}
          <div className="divide-y divide-slate-100">
            {s.upcoming.map((u) => (
              <div key={u.source_id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-medium">{u.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {u.expected_day ? `around day ${u.expected_day}` : 'no usual day'} ·{' '}
                    {u.reliability === 'regular' ? 'regular' : 'irregular'}
                  </span>
                </div>
                <span className="num font-semibold text-brand-900">{money(u.amount, u.currency_code)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {debts.data && Number(debts.data.total_ntd) > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-semibold text-brand-900">Debts</h2>
            <p className="text-sm text-slate-600">
              {debts.data.debts.filter((d) => d.status === 'open' && Number(d.balance) > 0).length} open ·{' '}
              {Object.entries(debts.data.totals).map(([c, v]) => money(v, c)).join(' + ')}
            </p>
          </div>
          <p className="num text-xl font-bold text-red-700">{money(debts.data.total_ntd, 'NTD')} owed</p>
        </Card>
      )}

      {view.core_note && (
        <Card className="p-4">
          <h2 className="font-semibold text-brand-900">Core saving changes this month</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{view.core_note}</p>
        </Card>
      )}
    </div>
  )
}

function Label(props: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.children}</p>
}
function Big(props: { children: React.ReactNode }) {
  return <p className="num mt-1 text-2xl font-bold text-brand-900">{props.children}</p>
}
function Small(props: { children: React.ReactNode }) {
  return <p className="num text-sm text-slate-500">{props.children}</p>
}
function Bar(props: { part: number; whole: number; muted?: boolean }) {
  const pct = props.whole > 0 ? Math.min(100, (props.part / props.whole) * 100) : 0
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" title={`${pct.toFixed(0)}%`}>
      <div className={'h-full ' + (props.muted ? 'bg-slate-400' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
    </div>
  )
}
