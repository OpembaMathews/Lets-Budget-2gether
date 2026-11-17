// Debts: loans, items on credit and overdrafts such as Fuliza. Repaid by plan lines or by hand.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money, MONTH_NAMES } from './api'
import { ccy } from './api'
import type { Debt, DebtsView, Meta, MonthSummary } from './api'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { Button, Card, EditBox, Select } from './ui'

const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

function monthYear(iso: string | null): string {
  if (!iso) return ''
  const [y, m] = iso.split('-').map(Number)
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`
}

export default function Debts(props: { month: MonthSummary; meta: Meta; onError: (m: string | null) => void }) {
  const { month, meta, onError } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['debts', month.id], queryFn: () => api.debts(month.id) })
  const [openId, setOpenId] = useState<number | null>(null)
  const [lender, setLender] = useState('')
  const [currency, setCurrency] = useState('KES')
  const [owed, setOwed] = useState('')
  const [monthly, setMonthly] = useState('')

  if (query.isLoading) return <p className="text-slate-500">Loading debts…</p>
  if (!query.data) return <p className="text-red-700">Could not load debts.</p>
  const view = query.data
  const open = view.debts.filter((d) => d.status === 'open')
  const cleared = view.debts.filter((d) => d.status === 'cleared')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Debts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Loans, things on credit and overdrafts like Fuliza. A repayment line in your plan is paid with the bills, and
          its actual is taken off the balance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Total owed</p>
          <p className="num mt-1 text-2xl font-bold">{money(view.total_ntd, 'NTD')}</p>
          <p className="text-sm text-brand-100">
            {Object.entries(view.totals).map(([c, v]) => money(v, c)).join(' + ') || 'Nothing owed'}
          </p>
        </div>
        <Card className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a debt</p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!lender.trim()) return
              void run(() =>
                api.createDebt(month.id, {
                  lender: lender.trim(),
                  currency_code: currency,
                  starting_balance: owed || '0',
                  monthly_repayment: monthly || null,
                }),
              ).then((ok) => {
                if (ok) {
                  setLender('')
                  setOwed('')
                  setMonthly('')
                }
              })
            }}
          >
            <input aria-label="Lender" className={box + ' min-w-[140px] flex-1'} placeholder="Lender, e.g. Fuliza" value={lender} onChange={(e) => setLender(e.target.value)} />
            <Select ariaLabel="Currency" value={currency} options={meta.currencies.map((c) => ({ value: c.code, label: ccy(c.code) }))} onChange={setCurrency} className="py-1.5" />
            <input aria-label="Amount owed" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder="Owed now" value={owed} onChange={(e) => setOwed(e.target.value)} />
            <input aria-label="Monthly repayment" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder="Per month" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            <Button type="submit" disabled={!lender.trim()}>
              Add
            </Button>
          </form>
        </Card>
      </div>

      <div className="space-y-3">
        {open.map((d) => (
          <DebtCard key={d.id} debt={d} view={view} meta={meta} monthId={month.id} run={run} isOpen={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
        ))}
        {open.length === 0 && <Card className="p-5 text-sm text-slate-600">No open debts. Add one above if you owe money.</Card>}
      </div>

      {cleared.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-brand-900">Cleared</h2>
          {cleared.map((d) => (
            <DebtCard key={d.id} debt={d} view={view} meta={meta} monthId={month.id} run={run} isOpen={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function DebtCard(props: { debt: Debt; view: DebtsView; meta: Meta; monthId: number; run: Run; isOpen: boolean; onToggle: () => void }) {
  const { debt: d, view, meta, monthId, run, isOpen, onToggle } = props
  const cur = d.currency_code
  const total = Number(d.starting_balance) + Number(d.borrowed)
  const pct = total > 0 ? Math.min(100, (Number(d.repaid) / total) * 100) : 0
  const balance = Number(d.balance)
  const save = (body: Partial<Debt>) => run(() => api.updateDebt(monthId, d.id, body))
  let pace: string
  if (balance <= 0) pace = 'Paid off'
  else if (d.clear_by) pace = `Cleared by ${monthYear(d.clear_by)} at ${money(Number(d.this_month) > 0 ? d.this_month : d.monthly_repayment, cur)} a month`
  else pace = 'No repayment planned yet'

  return (
    <Card>
      <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={onToggle}>
        <div className="min-w-[200px] flex-1">
          <span className="font-semibold text-brand-900">{d.lender}</span>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-leaf" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-slate-600">
            <span className="num">
              {fmt(d.repaid)} repaid of {money(total, cur)}
            </span>
            <span>{pace}</span>
          </div>
        </div>
        <div className="text-right">
          <p className={'num text-sm font-semibold ' + (balance > 0 ? 'text-red-700' : 'text-brand-700')}>{money(Math.max(0, balance), cur)}</p>
          <p className="text-[11px] text-slate-500">still owed</p>
        </div>
      </button>
      {isOpen && <DebtDetail debt={d} view={view} meta={meta} monthId={monthId} run={run} save={save} />}
    </Card>
  )
}

function DebtDetail(props: { debt: Debt; view: DebtsView; meta: Meta; monthId: number; run: Run; save: (b: Partial<Debt>) => Promise<boolean> }) {
  const { debt: d, view, meta, monthId, run, save } = props
  const cur = d.currency_code
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500'
  const sections = meta.locations.flatMap((loc) =>
    loc.groups.map((g) => ({ value: String(g.id), label: `${loc.name} / ${g.name}`, currency: loc.default_currency })),
  )
  const [sectionId, setSectionId] = useState((sections.find((s) => s.currency === cur) ?? sections[0])?.value ?? '')
  const [amount, setAmount] = useState(d.monthly_repayment ? String(Number(d.monthly_repayment)) : '')
  const [linkId, setLinkId] = useState('')
  const [entryKind, setEntryKind] = useState<'borrowed' | 'repaid'>('borrowed')
  const [entryAmount, setEntryAmount] = useState('')
  const [entryNote, setEntryNote] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const section = sections.find((s) => s.value === sectionId)

  return (
    <div className="space-y-5 border-t border-slate-200 bg-slate-50/60 px-4 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <span className={label}>Lender</span>
          <EditBox ariaLabel="Lender" value={d.lender} onCommit={(v) => save({ lender: v })} className="border-slate-300 bg-white font-medium" />
        </div>
        <div>
          <span className={label}>Owed at the start</span>
          <EditBox ariaLabel="Owed at the start" numeric value={String(Number(d.starting_balance))} onCommit={(v) => save({ starting_balance: v })} className="border-slate-300 bg-white" />
        </div>
        <div>
          <span className={label}>Monthly repayment</span>
          <EditBox
            ariaLabel="Monthly repayment"
            numeric
            value={d.monthly_repayment === null ? '' : String(Number(d.monthly_repayment))}
            placeholder="–"
            onCommit={(v) => save({ monthly_repayment: v })}
            className="border-slate-300 bg-white"
          />
        </div>
        <label>
          <span className={label}>Status</span>
          <Select
            ariaLabel="Status"
            className="w-full py-1.5"
            value={d.status}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'cleared', label: 'Cleared' },
            ]}
            onChange={(v) => save({ status: v as Debt['status'] })}
          />
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-brand-900">Repayment in the {view.month?.label} plan</h3>
        {d.lines.length === 0 && <p className="mb-2 text-sm text-slate-500">No repayment line this month.</p>}
        {d.lines.map((l) => (
          <div key={l.line_id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{l.name}</span> <span className="text-xs text-slate-500">· {l.where}</span>
            </span>
            <span className="num flex items-center gap-3 text-slate-600">
              budget <strong className="text-brand-900">{money(l.planned, l.currency_code)}</strong> · repaid {fmt(l.actual)}
              <button type="button" className="rounded px-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => run(() => api.updateLine(l.line_id, { debt_id: null }))}>
                Unlink
              </button>
            </span>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Add a repayment line:</span>
          <Select ariaLabel="Section" value={sectionId} options={sections} onChange={setSectionId} className="py-1.5" />
          <input aria-label="Repayment amount" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder={section ? ccy(section.currency) : ''} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button
            variant="ghost"
            disabled={!section || !(Number(amount) > 0)}
            onClick={() =>
              void run(() =>
                api.createLine(monthId, {
                  group_id: Number(sectionId),
                  name: `${d.lender} repayment`,
                  currency_code: section!.currency,
                  line_type: 'fixed',
                  kind: 'debt_repayment',
                  priority: 'essential',
                  planned: amount,
                  debt_id: d.id,
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
            <Button variant="ghost" disabled={!linkId} onClick={() => void run(() => api.updateLine(Number(linkId), { debt_id: d.id })).then(() => setLinkId(''))}>
              Link
            </Button>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-brand-900">History</h3>
        <div className="rounded-lg border border-slate-200 bg-white">
          {d.history.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Nothing yet.</p>}
          {d.history.map((h, n) => (
            <div key={n} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-b-0">
              <span>
                <span className="text-slate-500">{h.when}</span> · {h.what}
              </span>
              <span className="flex items-center gap-2">
                <span className={'num font-semibold ' + (Number(h.amount) < 0 ? 'text-brand-700' : 'text-red-700')}>
                  {Number(h.amount) < 0 ? '−' : '+'}
                  {money(Math.abs(Number(h.amount)), cur)}
                </span>
                {h.entry_id !== undefined && (
                  <button type="button" title="Remove" className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => run(() => api.deleteDebtEntry(monthId, h.entry_id!))}>
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
            if (!(Number(entryAmount) > 0)) return
            void run(() => api.addDebtEntry(monthId, d.id, { entry_date: entryDate, kind: entryKind, amount: entryAmount, note: entryNote.trim() || null })).then((ok) => {
              if (ok) {
                setEntryAmount('')
                setEntryNote('')
              }
            })
          }}
        >
          <Select
            ariaLabel="Borrowed or repaid"
            value={entryKind}
            options={[
              { value: 'borrowed', label: 'Borrowed more' },
              { value: 'repaid', label: 'Repaid outside the plan' },
            ]}
            onChange={(v) => setEntryKind(v as 'borrowed' | 'repaid')}
            className="py-1.5"
          />
          <input aria-label="Date" type="date" className={box} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <input aria-label="Amount" className={box + ' num w-28 text-right'} inputMode="decimal" placeholder={ccy(cur)} value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} />
          <input aria-label="Note" className={box + ' w-40'} placeholder="Note (optional)" value={entryNote} onChange={(e) => setEntryNote(e.target.value)} />
          <Button type="submit" variant="ghost" disabled={!(Number(entryAmount) > 0)}>
            Add
          </Button>
        </form>
      </div>

      <div className="flex justify-end">
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(`Delete the debt "${d.lender}"? Repayment lines stay in your plan.`)) void run(() => api.deleteDebt(monthId, d.id))
          }}
        >
          Delete this debt
        </Button>
      </div>
    </div>
  )
}
