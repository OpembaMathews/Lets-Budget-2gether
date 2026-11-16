// The month plan: every line by location and section, editable in place.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money, monthLabel, otherCurrency } from './api'
import type { Group, Line, LineActual, LineKind, LineType, Location, Meta, MonthDetail, Priority, Total } from './api'
import { Button, Card, EditBox, PhoneLabel, Select } from './ui'

const TYPE_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'variable', label: 'Variable' },
  { value: 'one_off', label: 'One-off' },
]
const KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'saving', label: 'Saving' },
  { value: 'debt_repayment', label: 'Debt repayment' },
]
const COLUMNS = 'md:grid-cols-[minmax(150px,1fr)_96px_84px_100px_100px_92px_44px] items-center gap-x-2 gap-y-1 md:gap-2'
const HEAD_GRID = 'hidden md:grid ' + COLUMNS
// On a phone a line is three short rows: name and buttons, type and priority, then the three amounts.
const ROW_GRID = 'grid grid-cols-6 ' + COLUMNS
const CELL = ' md:order-none md:col-span-1'

const EMPTY: Total = { native: {}, KES: '0', NTD: '0' }

export default function MonthPlan(props: { monthId: number; meta: Meta; onError: (message: string | null) => void }) {
  const { monthId, meta, onError } = props
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['month', monthId], queryFn: () => api.month(monthId) })
  const goalsQuery = useQuery({ queryKey: ['goals', monthId], queryFn: () => api.goals(monthId) })
  const goalNames = new Map((goalsQuery.data?.goals ?? []).map((g) => [g.id, g.name]))

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onError(null)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      await qc.invalidateQueries()
    }
  }

  if (query.isLoading) return <p className="text-slate-500">Loading the plan…</p>
  if (query.isError || !query.data) return <p className="text-red-700">Could not load this month.</p>

  const month = query.data
  const locked = month.status === 'closed'
  const rate = Number(month.fx_rate_ntd_kes)
  const totals = month.totals

  return (
    <div className="space-y-6">
      <Header month={month} locked={locked} run={run} />
      <Summary month={month} meta={meta} />

      {totals.needs_review > 0 && !locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            <strong>{totals.needs_review}</strong> variable {totals.needs_review === 1 ? 'amount was' : 'amounts were'}{' '}
            carried over{month.copied_from ? ` from ${month.copied_from}` : ''} as a suggestion. Change the ones that
            differ this month, then confirm the rest.
          </p>
          <Button variant="ghost" onClick={() => run(() => api.confirmAll(month.id))}>
            Confirm all
          </Button>
        </div>
      )}

      {meta.locations.map((location) => (
        <LocationBlock
          key={location.id}
          location={location}
          month={month}
          rate={rate}
          locked={locked}
          run={run}
          goalNames={goalNames}
        />
      ))}

      {meta.locations.length === 0 && (
        <Card className="p-6 text-sm text-slate-600">Add a location in Settings to start planning.</Card>
      )}
    </div>
  )
}

type Run = (action: () => Promise<unknown>) => Promise<void>

function Header(props: { month: MonthDetail; locked: boolean; run: Run }) {
  const { month, locked, run } = props
  const statusStyle = {
    planning: 'bg-amber-100 text-amber-900',
    active: 'bg-brand-100 text-brand-800',
    closed: 'bg-slate-200 text-slate-700',
  }[month.status]
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-brand-900">{monthLabel(month)}</h1>
          <span className={'rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ' + statusStyle}>
            {month.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Monthly plan · {month.totals.line_count} lines. Click any name or amount to change it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-600">1 NTD =</span>
          <span className="w-16">
            <EditBox
              ariaLabel="NTD to KES rate"
              numeric
              disabled={locked}
              value={String(Number(month.fx_rate_ntd_kes))}
              onCommit={(v) => run(() => api.updateMonth(month.id, { fx_rate_ntd_kes: v }))}
              className="border-slate-300 font-semibold"
            />
          </span>
          <span className="text-slate-600">KES</span>
        </label>
      </div>
    </div>
  )
}

function Summary(props: { month: MonthDetail; meta: Meta }) {
  const { month, meta } = props
  const t = month.totals
  const essential = Number((t.priority.essential ?? EMPTY).KES)
  const flexible = Number((t.priority.flexible ?? EMPTY).KES)
  const share = essential + flexible > 0 ? (essential / (essential + flexible)) * 100 : 0
  const saving = t.kind.saving ?? EMPTY
  const rate = Number(month.fx_rate_ntd_kes)
  const actualKes = month.lines.reduce((sum, l) => {
    const a = Number(month.actuals[l.id]?.actual ?? 0)
    return sum + (l.currency_code === 'NTD' ? a * rate : a)
  }, 0)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Total budget</p>
        <p className="num mt-1 text-2xl font-bold">{money(t.grand.KES, 'KES')}</p>
        <p className="num text-sm text-brand-100">≈ {money(t.grand.NTD, 'NTD')}</p>
        <p className="num mt-2 border-t border-brand-700 pt-2 text-sm text-brand-100">
          Actual so far: <strong className="text-white">{money(actualKes, 'KES')}</strong>
        </p>
      </div>
      {meta.locations.map((loc) => {
        const total = t.locations[loc.id] ?? EMPTY
        const other = otherCurrency(loc.default_currency)
        return (
          <Card key={loc.id} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{loc.name}</p>
            <p className="num mt-1 text-2xl font-bold text-brand-900">
              {money(total[loc.default_currency as 'KES' | 'NTD'], loc.default_currency)}
            </p>
            <p className="num text-sm text-slate-500">≈ {money(total[other as 'KES' | 'NTD'], other)}</p>
          </Card>
        )
      })}
      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Essential · Flexible</p>
        <p className="num mt-1 text-lg font-bold text-brand-900">
          {fmt(essential)} <span className="font-normal text-slate-400">·</span>{' '}
          <span className="text-slate-600">{fmt(flexible)}</span>
          <span className="ml-1 text-xs font-normal text-slate-500">KES</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" title={`${share.toFixed(0)}% essential`}>
          <div className="h-full bg-brand-600" style={{ width: `${share}%` }} />
        </div>
        <p className="num mt-2 text-sm text-slate-600">
          Savings in plan: <strong className="text-leaf-dark">{money(saving.KES, 'KES')}</strong>
        </p>
      </Card>
    </div>
  )
}

function LocationBlock(props: {
  location: Location
  month: MonthDetail
  rate: number
  locked: boolean
  run: Run
  goalNames: Map<number, string>
}) {
  const { location, month, rate, locked, run, goalNames } = props
  const total = month.totals.locations[location.id] ?? EMPTY
  const cur = location.default_currency as 'KES' | 'NTD'
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between border-b-2 border-brand-700 pb-1">
        <h2 className="text-lg font-bold text-brand-900">{location.name}</h2>
        <p className="num text-sm font-semibold text-brand-800">{money(total[cur], cur)}</p>
      </div>
      <div className="space-y-4">
        {location.groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            location={location}
            month={month}
            rate={rate}
            locked={locked}
            run={run}
            goalNames={goalNames}
          />
        ))}
        {location.groups.length === 0 && (
          <p className="text-sm text-slate-500">No sections yet. Add one in Settings.</p>
        )}
      </div>
    </section>
  )
}

function GroupCard(props: {
  group: Group
  location: Location
  month: MonthDetail
  rate: number
  locked: boolean
  run: Run
  goalNames: Map<number, string>
}) {
  const { group, location, month, rate, locked, run, goalNames } = props
  const lines = month.lines.filter((l) => l.group_id === group.id)
  const total = month.totals.groups[group.id] ?? EMPTY
  const cur = location.default_currency as 'KES' | 'NTD'
  const actual = lines
    .filter((l) => l.currency_code === cur)
    .reduce((sum, l) => sum + Number(month.actuals[l.id]?.actual ?? 0), 0)
  const budget = Number(total[cur])

  return (
    <Card className="overflow-x-auto">
      <div className="md:min-w-[720px]">
        <div className="flex items-center justify-between gap-2 rounded-t-xl bg-brand-50 px-4 py-2.5">
          <h3 className="font-semibold text-brand-900">{group.name}</h3>
          <p className={'num text-sm font-semibold ' + (actual > budget ? 'text-red-700' : 'text-brand-800')}>
            {fmt(actual)} <span className="font-normal text-slate-500">of</span> {money(budget, cur)}
          </p>
        </div>
        <div className={HEAD_GRID + ' border-b border-slate-200 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'}>
          <span className="pl-2">Line</span>
          <span>Type</span>
          <span>Priority</span>
          <span className="text-right">Budget ({cur})</span>
          <span className="text-right">Actual</span>
          <span className="text-right">Left</span>
          <span />
        </div>
        {lines.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            actual={month.actuals[line.id]}
            rate={rate}
            locked={locked}
            run={run}
            goalName={line.goal_id ? goalNames.get(line.goal_id) : undefined}
          />
        ))}
        {lines.length === 0 && <p className="px-6 py-3 text-sm text-slate-500">No lines in this section yet.</p>}
        {!locked && <AddLine group={group} currency={cur} monthId={month.id} run={run} />}
      </div>
    </Card>
  )
}

function LineRow(props: {
  line: Line
  actual: LineActual | undefined
  rate: number
  locked: boolean
  run: Run
  goalName?: string
}) {
  const { line, actual, rate, locked, run, goalName } = props
  const planned = Number(line.planned)
  /** The core saving needs a reason before it can be reduced or removed. */
  const askReason = (action: string) =>
    (window.prompt(`This is your core saving. Why are you ${action} it this month?`) ?? '').trim()

  const update = (body: Parameters<typeof api.updateLine>[1]): Promise<unknown> => {
    const lowering = body.planned !== undefined && Number(body.planned) < planned
    if (line.is_core && (lowering || body.is_core === false)) {
      const reason = askReason(lowering ? 'reducing' : 'unmarking')
      if (!reason) return Promise.resolve(false)
      return run(() => api.updateLine(line.id, { ...body, reason }))
    }
    return run(() => api.updateLine(line.id, body))
  }
  const remove = () => {
    if (line.is_core) {
      const reason = askReason('removing')
      if (reason) void run(() => api.deleteLine(line.id, reason))
    } else if (window.confirm(`Remove "${line.name}" from this month?`)) {
      void run(() => api.deleteLine(line.id))
    }
  }
  const converted = line.currency_code === 'NTD' ? planned * rate : planned / rate
  const essential = line.priority === 'essential'

  return (
    <div
      className={
        ROW_GRID +
        ' border-b border-slate-100 px-4 py-2 text-sm last:border-b-0 md:py-1 ' +
        (line.needs_review ? 'border-l-4 border-l-amber-400 bg-amber-50/60 pl-3' : '')
      }
    >
      <div className={'order-1 col-span-5 min-w-0' + CELL}>
        <div className="flex items-center gap-1">
          <EditBox
            ariaLabel="Line name"
            value={line.name}
            disabled={locked}
            onCommit={(v) => update({ name: v })}
            className="font-medium"
          />
          {line.kind !== 'expense' && (
            <span className="shrink-0 rounded bg-leaf/20 px-1.5 py-0.5 text-[11px] font-semibold text-leaf-dark">
              {line.is_core ? 'Core saving' : line.kind === 'saving' ? 'Saving' : 'Debt'}
            </span>
          )}
          {line.kind === 'saving' && !line.is_core && !locked && (
            <button
              type="button"
              title="Make this the core saving: the fixed amount taken first each month"
              className="shrink-0 rounded px-1 text-[11px] text-slate-400 hover:text-brand-700"
              onClick={() => void update({ is_core: true })}
            >
              make core
            </button>
          )}
        </div>
        {goalName && (
          <p className="truncate pl-2 text-xs font-semibold text-brand-700" title="This line's actual counts toward this project">
            → {goalName}
          </p>
        )}
        {line.note && <p className="truncate pl-2 text-xs text-slate-500" title={line.note}>{line.note}</p>}
      </div>

      <Select
        ariaLabel="Line type"
        value={line.line_type}
        disabled={locked}
        options={TYPE_OPTIONS}
        onChange={(v) => update({ line_type: v as LineType })}
        className={'order-3 col-span-3 ml-2 justify-self-start md:ml-0 md:justify-self-stretch' + CELL}
      />

      <button
        type="button"
        disabled={locked}
        onClick={() => update({ priority: (essential ? 'flexible' : 'essential') as Priority })}
        title="Click to switch between essential and flexible"
        className={
          'order-4 col-span-3 justify-self-end rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed md:justify-self-stretch md:px-2.5 md:py-1 ' +
          (essential ? 'bg-brand-700 text-white hover:bg-brand-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') +
          CELL
        }
      >
        {essential ? 'Essential' : 'Flexible'}
      </button>

      <div className={'order-5 col-span-2 min-w-0' + CELL} title={`≈ ${money(converted, otherCurrency(line.currency_code))}`}>
        <PhoneLabel className="pr-2 text-right">Budget</PhoneLabel>
        <EditBox
          ariaLabel="Budget"
          numeric
          value={String(planned)}
          disabled={locked || line.weekly_amount !== null}
          onCommit={(v) => update({ planned: v })}
          className="font-semibold text-brand-900"
        />
      </div>

      <div className={'order-6 col-span-2 min-w-0' + CELL}>
        <PhoneLabel className="pr-2 text-right">Actual</PhoneLabel>
        <ActualBox line={line} actual={actual} locked={locked} update={update} />
      </div>

      <div className={'order-7 col-span-2 min-w-0' + CELL}>
        <PhoneLabel className="pr-2 text-right">Left</PhoneLabel>
        <LeftCell actual={actual} />
      </div>

      <div className={'order-2 col-span-1 flex items-center justify-end gap-1' + CELL}>
        {line.needs_review && !locked && (
          <button
            type="button"
            title="Confirm this amount"
            onClick={() => update({ needs_review: false })}
            className="rounded-md px-2.5 py-1.5 text-brand-700 hover:bg-brand-100 md:px-1.5 md:py-1"
          >
            ✓
          </button>
        )}
        {!locked && (
          <button
            type="button"
            title="Remove this line"
            onClick={remove}
            className="rounded-md px-2.5 py-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 md:px-1.5 md:py-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

/** The actual: worked out from payments and sends, or typed over by hand. */
function ActualBox(props: {
  line: Line
  actual: LineActual | undefined
  locked: boolean
  update: (body: Parameters<typeof api.updateLine>[1]) => Promise<unknown>
}) {
  const { line, actual, locked, update } = props
  if (!actual) return <span />
  const waiting = Number(actual.set_aside_to_send)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-0.5">
        <EditBox
          ariaLabel={`Actual for ${line.name}`}
          numeric
          disabled={locked}
          value={String(Number(actual.actual))}
          onCommit={(v) => (Number(v) === Number(actual.auto) && !actual.manual ? true : update({ actual: v }))}
          className={actual.manual ? 'font-semibold text-amber-800' : 'text-slate-700'}
        />
        {actual.manual && !locked && (
          <button
            type="button"
            title={`Typed by hand. Click to go back to the worked-out figure (${fmt(actual.auto)}).`}
            className="shrink-0 rounded px-0.5 text-xs text-amber-700 hover:bg-amber-100"
            onClick={() => void update({ actual: null })}
          >
            ↺
          </button>
        )}
      </div>
      {waiting > 0 && (
        <p className="num truncate pr-2 text-right text-[11px] text-slate-500" title="Set aside from income, not sent yet">
          +{fmt(waiting)} to send
        </p>
      )}
    </div>
  )
}

function LeftCell(props: { actual: LineActual | undefined }) {
  const a = props.actual
  if (!a) return <span />
  const left = Number(a.left)
  const cell = 'num block py-1 pr-2 text-right md:py-0 '
  if (a.over) return <span className={cell + 'font-semibold text-red-700'}>Over {fmt(-left)}</span>
  if (left === 0) return <span className={cell + 'font-semibold text-brand-600'}>Done ✓</span>
  return <span className={cell + 'text-slate-600'}>{fmt(left)}</span>
}

function AddLine(props: { group: Group; currency: string; monthId: number; run: Run }) {
  const { group, currency, monthId, run } = props
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [lineType, setLineType] = useState<LineType>('variable')
  const [kind, setKind] = useState<LineKind>('expense')
  const valid = name.trim() !== '' && (amount === '' || (!Number.isNaN(Number(amount)) && Number(amount) >= 0))

  async function add() {
    if (!valid) return
    await run(() =>
      api.createLine(monthId, {
        group_id: group.id,
        name: name.trim(),
        currency_code: currency,
        line_type: lineType,
        kind,
        priority: kind === 'expense' ? 'flexible' : 'essential',
        planned: amount === '' ? '0' : amount,
      }),
    )
    setName('')
    setAmount('')
  }

  const box =
    'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 px-4 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <input
        aria-label={`New line in ${group.name}`}
        className={box + ' min-w-[180px] flex-1'}
        placeholder={`Add a line to ${group.name}…`}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select ariaLabel="New line type" value={lineType} options={TYPE_OPTIONS} onChange={(v) => setLineType(v as LineType)} />
      <Select ariaLabel="New line kind" value={kind} options={KIND_OPTIONS} onChange={(v) => setKind(v as LineKind)} />
      <input
        aria-label="New line amount"
        className={box + ' num w-28 text-right'}
        placeholder={`Amount ${currency}`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button type="submit" variant="ghost" disabled={!valid}>
        Add
      </Button>
    </form>
  )
}
