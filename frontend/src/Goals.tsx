// Projects & goals: land, sewing machine, dowry, emergency funds. Funded from plan lines, sends and one-off money.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money, MONTH_NAMES } from './api'
import type { Goal, GoalKind, GoalStatus, GoalsView, Importance, Meta, MonthSummary } from './api'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { Button, Card, EditBox, Select } from './ui'

const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

const STATUS: { value: GoalStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]
const IMPORTANCE: { value: Importance; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
const KIND: { value: GoalKind; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'saving_goal', label: 'Savings goal' },
]
const CLOSED: GoalStatus[] = ['completed', 'cancelled']

function monthYear(iso: string | null): string {
  if (!iso) return ''
  const [y, m] = iso.split('-').map(Number)
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`
}

export default function Goals(props: { month: MonthSummary; meta: Meta; onError: (m: string | null) => void }) {
  const { month, meta, onError } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['goals', month.id], queryFn: () => api.goals(month.id) })
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  if (query.isLoading) return <p className="text-slate-500">Loading projects…</p>
  if (!query.data) return <p className="text-red-700">Could not load your projects.</p>
  const view = query.data
  // The summary cards lead with NTD, at the chosen month's rate.
  const rate = Number(view.month?.rate ?? 1) || 1
  const open = view.goals.filter((g) => !CLOSED.includes(g.status))
  const closed = view.goals.filter((g) => CLOSED.includes(g.status))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Projects & goals</h1>
          <p className="mt-1 text-sm text-slate-600">
            What you are building toward, in the order money should go to it. Funding comes from plan lines linked to a
            project, and from one-off amounts you add.
          </p>
        </div>
        <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : '+ New project or goal'}</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Still needed</p>
          <p className="num mt-1 text-2xl font-bold">{money(Number(view.needed_kes) / rate, 'NTD')}</p>
          <p className="num text-sm text-brand-100">≈ {money(view.needed_kes, 'KES')}</p>
          <p className="text-sm text-brand-100">
            across {view.open_count} open project{view.open_count === 1 ? '' : 's'} and goals
          </p>
        </div>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In {view.month?.label} plan</p>
          <p className="num mt-1 text-2xl font-bold text-brand-900">{money(Number(view.this_month_kes) / rate, 'NTD')}</p>
          <p className="num text-sm text-slate-500">≈ {money(view.this_month_kes, 'KES')}</p>
          <p className="text-sm text-slate-500">from plan lines linked to a project</p>
          {Number(view.savings_shared_kes) > 0 && (
            <p className="num mt-1 text-sm text-leaf-dark">
              + {money(Number(view.savings_shared_kes) / rate, 'NTD')} from extra savings
            </p>
          )}
          {Object.entries(view.savings_unshared).map(([code, v]) => (
            <p key={code} className="num text-xs text-slate-500">
              {money(v, code)} of extra savings not given to a goal yet
            </p>
          ))}
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Funded so far</p>
          {Object.entries(view.totals).map(([code, t]) => (
            <p key={code} className="num mt-1 text-lg font-bold text-brand-900">
              {fmt(t.funded)} <span className="text-sm font-normal text-slate-500">of {money(t.target, code)}</span>
            </p>
          ))}
        </Card>
      </div>

      {adding && <NewGoal monthId={month.id} meta={meta} run={run} onDone={() => setAdding(false)} />}

      <div className="space-y-3">
        {open.length > 1 && (
          <p className="text-xs text-slate-500">
            Drag a project by its ⠿ handle to change its priority. Number 1 gets money first.
          </p>
        )}
        {open.map((g, i) => (
          <div
            key={g.id}
            onDragOver={(e) => {
              if (dragId === null) return
              e.preventDefault()
              if (overId !== g.id) setOverId(g.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId === null || dragId === g.id) return
              const ids = open.map((x) => x.id).filter((id) => id !== dragId)
              const from = open.findIndex((x) => x.id === dragId)
              const to = ids.indexOf(g.id) + (from < i ? 1 : 0) // dropping below when moving down
              ids.splice(to, 0, dragId)
              setDragId(null)
              setOverId(null)
              void run(() => api.orderGoals(month.id, ids))
            }}
            className={
              'rounded-xl transition ' +
              (dragId === g.id ? 'opacity-40 ' : '') +
              (overId === g.id && dragId !== null && dragId !== g.id ? 'ring-2 ring-brand-500 ring-offset-2' : '')
            }
          >
            <GoalCard
              goal={g}
              position={i + 1}
              view={view}
              meta={meta}
              monthId={month.id}
              run={run}
              isOpen={openId === g.id}
              onToggle={() => setOpenId(openId === g.id ? null : g.id)}
              onDragStart={(e) => {
                setDragId(g.id)
                setOpenId(null)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(g.id))
                const card = (e.currentTarget as HTMLElement).closest('[data-goal-card]')
                if (card) e.dataTransfer.setDragImage(card, 24, 24)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
            />
          </div>
        ))}
        {open.length === 0 && <Card className="p-5 text-sm text-slate-600">No open projects. Add one above.</Card>}
      </div>

      {closed.length > 0 && (
        <div className="space-y-3">
          <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Hide' : 'Show'} {closed.length} completed or cancelled
          </button>
          {showClosed && closed.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              position={null}
              view={view}
              meta={meta}
              monthId={month.id}
              run={run}
              isOpen={openId === g.id}
              onToggle={() => setOpenId(openId === g.id ? null : g.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GoalCard(props: {
  goal: Goal
  position: number | null
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  view: GoalsView
  meta: Meta
  monthId: number
  run: Run
  isOpen: boolean
  onToggle: () => void
}) {
  const { goal: g, position, onDragStart, onDragEnd, view, meta, monthId, run, isOpen, onToggle } = props
  const cur = g.currency_code
  const pct = Math.min(100, g.percent ?? 0)
  const done = Number(g.needed) === 0 && Number(g.target) > 0
  const closed = CLOSED.includes(g.status)
  const save = (body: Partial<Goal>) => run(() => api.updateGoal(monthId, g.id, body))

  let pace: string
  if (closed) pace = g.status === 'completed' ? 'Completed' : 'Cancelled'
  else if (done) pace = 'Target reached'
  else if (g.months_left !== null && g.finish) pace = `Done by ${monthYear(g.finish)} at ${money(g.pace, cur)} a month`
  else pace = 'No monthly amount yet'

  return (
    <Card className={closed ? 'opacity-80' : ''}>
      <div data-goal-card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        {position !== null && (
          <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Drag to change priority"
            className="flex cursor-grab select-none items-center gap-1 rounded-md px-1 py-1 text-slate-400 hover:bg-brand-50 hover:text-brand-700 active:cursor-grabbing"
          >
            <span className="text-lg leading-none">⠿</span>
            <span className="num w-5 text-center text-sm font-bold text-brand-800">{position}</span>
          </div>
        )}
        <button type="button" className="min-w-[200px] flex-1 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-brand-900">{g.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
              {g.kind === 'project' ? 'Project' : 'Savings goal'}
            </span>
            {g.importance === 'high' && !closed && (
              <span className="rounded bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">High</span>
            )}
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className={'h-full ' + (done || g.status === 'completed' ? 'bg-leaf' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-slate-600">
            <span className="num">
              {fmt(g.funded)} of {money(g.target, cur)}
              {g.percent !== null && ` · ${Math.floor(g.percent)}%`}
            </span>
            <span className={g.on_time === false ? 'font-semibold text-amber-800' : ''}>
              {pace}
              {g.on_time === false && g.target_date && ` · after the ${monthYear(g.target_date)} target`}
            </span>
          </div>
        </button>
        <div className="text-right">
          <p className="num text-sm font-semibold text-brand-900">{done || closed ? '–' : money(g.needed, cur)}</p>
          <p className="text-[11px] text-slate-500">{done || closed ? '' : 'still needed'}</p>
          {Number(g.this_month) > 0 && <p className="num text-[11px] text-brand-700">{fmt(g.this_month)} this month</p>}
        </div>
      </div>

      {isOpen && <GoalDetail goal={g} view={view} meta={meta} monthId={monthId} run={run} save={save} />}
    </Card>
  )
}

function GoalDetail(props: {
  goal: Goal
  view: GoalsView
  meta: Meta
  monthId: number
  run: Run
  save: (body: Partial<Goal>) => Promise<boolean>
}) {
  const { goal: g, view, meta, monthId, run, save } = props
  const cur = g.currency_code
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500'

  return (
    <div className="space-y-5 border-t border-slate-200 bg-slate-50/60 px-4 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <span className={label}>Name</span>
          <EditBox ariaLabel="Project name" value={g.name} onCommit={(v) => save({ name: v })} className="border-slate-300 bg-white font-medium" />
        </div>
        <div>
          <span className={label}>Target ({cur})</span>
          <EditBox ariaLabel="Target" numeric value={String(Number(g.target))} onCommit={(v) => save({ target: v })} className="border-slate-300 bg-white" />
        </div>
        <div>
          <span className={label}>Already in before</span>
          <EditBox ariaLabel="Already in" numeric value={String(Number(g.opening_amount))} onCommit={(v) => save({ opening_amount: v })} className="border-slate-300 bg-white" />
        </div>
        <div>
          <span className={label}>Monthly amount</span>
          <EditBox
            ariaLabel="Monthly amount"
            numeric
            value={g.monthly_amount === null ? '' : String(Number(g.monthly_amount))}
            placeholder="–"
            onCommit={(v) => save({ monthly_amount: v })}
            className="border-slate-300 bg-white"
          />
        </div>
        <label>
          <span className={label}>Target date</span>
          <input
            aria-label="Target date"
            type="date"
            className={box + ' w-full'}
            value={g.target_date ?? ''}
            onChange={(e) => save({ target_date: e.target.value || null })}
          />
        </label>
        <label>
          <span className={label}>Status</span>
          <Select ariaLabel="Status" className="w-full py-1.5" value={g.status} options={STATUS} onChange={(v) => save({ status: v as GoalStatus })} />
        </label>
        <label>
          <span className={label}>Importance</span>
          <Select ariaLabel="Importance" className="w-full py-1.5" value={g.importance} options={IMPORTANCE} onChange={(v) => save({ importance: v as Importance })} />
        </label>
        <label>
          <span className={label}>Kind</span>
          <Select ariaLabel="Kind" className="w-full py-1.5" value={g.kind} options={KIND} onChange={(v) => save({ kind: v as GoalKind })} />
        </label>
      </div>
      <div>
        <span className={label}>Notes</span>
        <EditBox ariaLabel="Notes" value={g.note ?? ''} placeholder="Add a note…" onCommit={(v) => save({ note: v })} className="border-slate-300 bg-white" />
      </div>

      <PlanLines goal={g} view={view} meta={meta} monthId={monthId} run={run} />

      {g.kind === 'project' && <Breakdown goal={g} monthId={monthId} run={run} />}

      <History goal={g} monthId={monthId} run={run} />

      <div className="flex justify-end">
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(`Delete "${g.name}"? Plan lines linked to it stay in your plan but stop counting toward it.`))
              void run(() => api.deleteGoal(monthId, g.id))
          }}
        >
          Delete this {g.kind === 'project' ? 'project' : 'goal'}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Funded {money(g.funded, cur)}: {fmt(g.opening_amount)} already in, {fmt(g.from_lines)} from your plan,{' '}
        {fmt(g.from_savings)} from extra savings, {fmt(g.from_entries)} one-off. Extra savings go to goals in priority
        order, up to each one's monthly amount.
      </p>
    </div>
  )
}

/** Plan lines in this month that feed the project, and ways to add one. */
function PlanLines(props: { goal: Goal; view: GoalsView; meta: Meta; monthId: number; run: Run }) {
  const { goal: g, view, meta, monthId, run } = props
  const sections = meta.locations.flatMap((loc) =>
    loc.groups.map((gr) => ({ value: String(gr.id), label: `${loc.name} / ${gr.name}`, currency: loc.default_currency })),
  )
  // Start on a section in the project's own currency, so no conversion is needed.
  const [sectionId, setSectionId] = useState(
    (sections.find((s) => s.currency === g.currency_code) ?? sections[0])?.value ?? '',
  )
  const [amount, setAmount] = useState(g.monthly_amount ? String(Number(g.monthly_amount)) : '')
  const [linkId, setLinkId] = useState('')
  const section = sections.find((s) => s.value === sectionId)

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-brand-900">In the {view.month?.label} plan</h3>
      {g.lines.length === 0 && <p className="mb-2 text-sm text-slate-500">No plan line feeds this yet this month.</p>}
      {g.lines.map((l) => (
        <div key={l.line_id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <div>
            <span className="font-medium">{l.name}</span> <span className="text-xs text-slate-500">· {l.where}</span>
          </div>
          <div className="num flex items-center gap-3 text-slate-600">
            <span>
              budget <strong className="text-brand-900">{money(l.planned, l.currency_code)}</strong>
            </span>
            <span>actual {fmt(l.actual)}</span>
            {Number(l.set_aside_to_send) > 0 && <span className="text-xs">+{fmt(l.set_aside_to_send)} to send</span>}
            <button
              type="button"
              title="Stop counting this line toward the project"
              className="rounded px-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700"
              onClick={() => run(() => api.updateLine(l.line_id, { goal_id: null }))}
            >
              Unlink
            </button>
          </div>
        </div>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Add a line to this month:</span>
        <Select ariaLabel="Section for the new line" value={sectionId} options={sections} onChange={setSectionId} className="py-1.5" />
        <input
          aria-label="Amount for the new line"
          className={box + ' num w-28 text-right'}
          inputMode="decimal"
          placeholder={section?.currency ?? ''}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button
          variant="ghost"
          disabled={!section || !(Number(amount) > 0)}
          onClick={() =>
            void run(() =>
              api.createLine(monthId, {
                group_id: Number(sectionId),
                name: g.name,
                currency_code: section!.currency,
                line_type: 'fixed',
                kind: 'saving',
                priority: 'flexible',
                planned: amount,
                goal_id: g.id,
              }),
            )
          }
        >
          Add line
        </Button>
      </div>
      {view.linkable_lines.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Or count a line already in the plan:</span>
          <select aria-label="Line to link" className={box + ' min-w-[200px]'} value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">Choose a line…</option>
            {view.linkable_lines.map((l) => (
              <option key={l.line_id} value={l.line_id}>
                {l.name} · {l.where} · {money(l.planned, l.currency_code)}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            disabled={!linkId}
            onClick={() => void run(() => api.updateLine(Number(linkId), { goal_id: g.id })).then(() => setLinkId(''))}
          >
            Link
          </Button>
        </div>
      )}
    </div>
  )
}

function Breakdown(props: { goal: Goal; monthId: number; run: Run }) {
  const { goal: g, monthId, run } = props
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Materials')
  const [estimate, setEstimate] = useState('')
  const cur = g.currency_code
  const grid = 'grid grid-cols-[minmax(140px,1fr)_100px_96px_96px_40px_28px] items-center gap-2'
  const left = Number(g.funded) - Number(g.spent)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-900">Cost breakdown</h3>
        <p className="num text-xs text-slate-600">
          Estimated {money(g.estimate, cur)} · spent {money(g.spent, cur)}
          {Number(g.spent) > 0 && (
            <span className={left < 0 ? ' font-semibold text-red-700' : ''}>
              {' '}
              · {left < 0 ? `${fmt(-left)} more spent than funded` : `${fmt(left)} funded but not yet spent`}
            </span>
          )}
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="min-w-[480px]">
          <div className={grid + ' border-b border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'}>
            <span>Item</span>
            <span>Type</span>
            <span className="text-right">Estimate</span>
            <span className="text-right">Actual</span>
            <span>Done</span>
            <span />
          </div>
          {g.items.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No items yet. Add materials, labour and so on.</p>}
          {g.items.map((i) => {
            const save = (body: Parameters<typeof api.updateGoalItem>[2]) => run(() => api.updateGoalItem(monthId, i.id, body))
            const over = i.actual !== null && Number(i.actual) > Number(i.estimate)
            return (
              <div key={i.id} className={grid + ' border-b border-slate-100 px-3 py-1 text-sm last:border-b-0'}>
                <EditBox ariaLabel="Item" value={i.name} onCommit={(v) => save({ name: v })} />
                <EditBox ariaLabel="Item type" value={i.category ?? ''} placeholder="–" onCommit={(v) => save({ category: v })} className="text-slate-600" />
                <EditBox ariaLabel="Estimate" numeric value={String(Number(i.estimate))} onCommit={(v) => save({ estimate: v })} />
                <EditBox
                  ariaLabel="Actual cost"
                  numeric
                  value={i.actual === null ? '' : String(Number(i.actual))}
                  placeholder="–"
                  onCommit={(v) => save({ actual: v })}
                  className={over ? 'font-semibold text-red-700' : ''}
                />
                <input type="checkbox" aria-label="Done" className="accent-brand-700" checked={i.done} onChange={(e) => save({ done: e.target.checked })} />
                <button
                  type="button"
                  title="Remove this item"
                  className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  onClick={() => run(() => api.deleteGoalItem(monthId, i.id))}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <form
            className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              void run(() => api.addGoalItem(monthId, g.id, { name: name.trim(), category, estimate: estimate || '0' })).then((ok) => {
                if (ok) {
                  setName('')
                  setEstimate('')
                }
              })
            }}
          >
            <input aria-label="New item" className={box + ' min-w-[160px] flex-1'} placeholder="Add an item…" value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label="New item type" className={box} value={category} onChange={(e) => setCategory(e.target.value)}>
              {['Materials', 'Labour', 'Equipment', 'Transport', 'Meals', 'Fees', 'Unplanned', 'Other'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input aria-label="New item estimate" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder={`Estimate ${cur}`} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
            <Button type="submit" variant="ghost" disabled={!name.trim()}>
              Add
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function History(props: { goal: Goal; monthId: number; run: Run }) {
  const { goal: g, monthId, run } = props
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const cur = g.currency_code
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-brand-900">Money in</h3>
      <div className="rounded-lg border border-slate-200 bg-white">
        {g.history.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Nothing yet.</p>}
        {g.history.map((h, n) => (
          <div key={n} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-b-0">
            <span>
              <span className="text-slate-500">{h.when}</span> · {h.source}
            </span>
            <span className="flex items-center gap-2">
              <span className="num font-semibold text-brand-900">{money(h.amount, cur)}</span>
              {h.entry_id !== undefined && (
                <button
                  type="button"
                  title="Remove this amount"
                  className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  onClick={() => run(() => api.deleteGoalEntry(monthId, h.entry_id!))}
                >
                  ✕
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!(Number(amount) > 0)) return
          void run(() => api.addGoalEntry(monthId, g.id, { entry_date: date, amount, note: note.trim() || null })).then((ok) => {
            if (ok) {
              setAmount('')
              setNote('')
            }
          })
        }}
      >
        <span className="text-xs text-slate-500">Add money from outside the plan:</span>
        <input aria-label="Date" type="date" className={box} value={date} onChange={(e) => setDate(e.target.value)} />
        <input aria-label="Amount" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder={cur} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input aria-label="What it was" className={box + ' w-44'} placeholder="e.g. Bonus" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" variant="ghost" disabled={!(Number(amount) > 0)}>
          Add
        </Button>
      </form>
    </div>
  )
}

function NewGoal(props: { monthId: number; meta: Meta; run: Run; onDone: () => void }) {
  const { monthId, meta, run, onDone } = props
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GoalKind>('project')
  const [currency, setCurrency] = useState('KES')
  const [target, setTarget] = useState('')
  const [opening, setOpening] = useState('')
  const [monthly, setMonthly] = useState('')
  const [date, setDate] = useState('')
  const [importance, setImportance] = useState<Importance>('medium')
  const valid = name.trim() !== '' && Number(target) > 0
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500'

  return (
    <Card className="border-2 border-brand-600 p-4">
      <h2 className="mb-3 font-semibold text-brand-900">New project or goal</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2">
          <span className={label}>Name</span>
          <input aria-label="Name" className={box + ' w-full'} placeholder="e.g. Water tank" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className={label}>Kind</span>
          <Select ariaLabel="Kind" className="w-full py-1.5" value={kind} options={KIND} onChange={(v) => setKind(v as GoalKind)} />
        </label>
        <label>
          <span className={label}>Currency</span>
          <Select
            ariaLabel="Currency"
            className="w-full py-1.5"
            value={currency}
            options={meta.currencies.map((c) => ({ value: c.code, label: c.code }))}
            onChange={setCurrency}
          />
        </label>
        <label>
          <span className={label}>Target</span>
          <input aria-label="Target" className={box + ' num w-full text-right'} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label>
          <span className={label}>Already in</span>
          <input aria-label="Already in" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </label>
        <label>
          <span className={label}>Monthly amount</span>
          <input aria-label="Monthly amount" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="–" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <label>
          <span className={label}>Target date</span>
          <input aria-label="Target date" type="date" className={box + ' w-full'} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span className={label}>Importance</span>
          <Select ariaLabel="Importance" className="w-full py-1.5" value={importance} options={IMPORTANCE} onChange={(v) => setImportance(v as Importance)} />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={() =>
            void run(() =>
              api.createGoal(monthId, {
                name: name.trim(),
                kind,
                currency_code: currency,
                target,
                opening_amount: opening || '0',
                monthly_amount: monthly || null,
                target_date: date || null,
                importance,
                status: 'planning',
              }),
            ).then((ok) => ok && onDone())
          }
        >
          Add
        </Button>
      </div>
    </Card>
  )
}
