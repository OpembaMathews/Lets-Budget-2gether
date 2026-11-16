// Dashboard: the chosen month at a glance.
import { useQuery } from '@tanstack/react-query'
import { api, fmt, money, monthLabel } from './api'
import type { Meta, MonthSummary, Progress } from './api'
import { useRun } from './hooks'
import { FitCard } from './Income'
import { Button, Card } from './ui'

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
  const expectedAll = Number(view.fit.reliable.KES) + Number(view.fit.irregular.KES)
  const coreDone = s.core !== null && Number(s.core.covered) >= Number(s.core.planned)
  const essentialsLeft = Number(s.essentials_left.KES)
  const freeNative = Object.entries(s.free.native)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-slate-600">Where the month stands right now.</p>
        </div>
        {view.status !== 'closed' && <Button onClick={onAddIncome}>+ Add income</Button>}
      </div>

      <FitCard view={view} run={run} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Label>Income received</Label>
          {Object.keys(s.arrived.native).length === 0 && <Big>Nothing yet</Big>}
          {Object.entries(s.arrived.native).map(([code, amount]) => (
            <Big key={code}>{money(amount, code)}</Big>
          ))}
          <Small>
            ≈ {money(s.arrived.KES, 'KES')} of {money(expectedAll, 'KES')} expected
          </Small>
          <Bar part={Number(s.arrived.KES)} whole={expectedAll} />
        </Card>

        <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Saved so far</p>
          {Object.keys(s.savings_reserved.native).length === 0 && <p className="mt-1 text-2xl font-bold">Nothing yet</p>}
          {Object.entries(s.savings_reserved.native).map(([code, amount]) => (
            <p key={code} className="num mt-1 text-2xl font-bold">
              {money(amount, code)}
            </p>
          ))}
          {Object.keys(s.savings_reserved.native).length > 0 && (
            <p className="num text-sm text-brand-100">≈ {money(s.savings_reserved.KES, 'KES')}</p>
          )}
          {s.core ? (
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
          <Big>{money(s.essential.covered.KES, 'KES')}</Big>
          <Small>of {money(s.essential.planned.KES, 'KES')}</Small>
          <Bar part={Number(s.essential.covered.KES)} whole={Number(s.essential.planned.KES)} />
          {essentialsLeft > 0 && <p className="num mt-2 text-xs text-amber-800">{money(essentialsLeft, 'KES')} still to fund</p>}
        </Card>

        <Card className="p-4">
          <Label>Free to spend</Label>
          {freeNative.length === 0 && <Big>–</Big>}
          {freeNative.map(([code, amount]) => (
            <Big key={code}>{money(amount, code)}</Big>
          ))}
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
              const cur = loc.default_currency as 'KES' | 'NTD'
              return (
                <div key={loc.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{loc.name}</span>
                    <span className="num text-slate-600">
                      {fmt(block.covered[cur])} of {money(block.planned[cur], cur)}
                    </span>
                  </div>
                  <Bar part={Number(block.covered[cur])} whole={Number(block.planned[cur])} />
                </div>
              )
            })}
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-slate-600">Flexible lines</span>
                <span className="num text-slate-600">
                  {fmt(s.flexible.covered.KES)} of {money(s.flexible.planned.KES, 'KES')}
                </span>
              </div>
              <Bar part={Number(s.flexible.covered.KES)} whole={Number(s.flexible.planned.KES)} muted />
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

      {debts.data && Number(debts.data.total_kes) > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-semibold text-brand-900">Debts</h2>
            <p className="text-sm text-slate-600">
              {debts.data.debts.filter((d) => d.status === 'open' && Number(d.balance) > 0).length} open ·{' '}
              {Object.entries(debts.data.totals).map(([c, v]) => money(v, c)).join(' + ')}
            </p>
          </div>
          <p className="num text-xl font-bold text-red-700">{money(debts.data.total_kes, 'KES')} owed</p>
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
