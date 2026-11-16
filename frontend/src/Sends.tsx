// Kenya sends: money sent home in one go or in parts, to different people and for different uses.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, fmt, money, monthLabel } from './api'
import type { MonthSummary, SendBody, SendGroup, SendLine, SendRow, SendsView } from './api'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { Button, Card } from './ui'

const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100'

/** A purpose row in the form. `target` is "g:<section id>" or "l:<line id>". */
interface PurposeDraft {
  key: number
  target: string
  amount: string
}

interface Draft {
  editingId: number | null
  sent_date: string
  recipient_id: string
  amount_kes: string
  amount_ntd: string
  fee_ntd: string
  platform: string
  reference: string
  note: string
  purposes: PurposeDraft[]
}

let nextKey = 1
const today = () => new Date().toISOString().slice(0, 10)
const blankDraft = (): Draft => ({
  editingId: null,
  sent_date: today(),
  recipient_id: '',
  amount_kes: '',
  amount_ntd: '',
  fee_ntd: '',
  platform: '',
  reference: '',
  note: '',
  purposes: [],
})
const plain = (v: string | null) => (v === null ? '' : String(Number(v)))

export default function Sends(props: { month: MonthSummary; onError: (m: string | null) => void }) {
  const { month, onError } = props
  const run = useRun(onError)
  const query = useQuery({ queryKey: ['sends', month.id], queryFn: () => api.sends(month.id) })
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [formVersion, setFormVersion] = useState(0)
  // Ticked lines and the amount to mark as sent for each.
  const [picked, setPicked] = useState<Map<number, string>>(new Map())
  const [formOpen, setFormOpen] = useState(false)
  // Today when it falls in this month, otherwise the month's first day.
  const [sendDate, setSendDate] = useState(() => {
    const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`
    return today().startsWith(prefix) ? today() : `${prefix}-01`
  })
  const [sendTo, setSendTo] = useState('usual')
  const [saving, setSaving] = useState(false)

  if (query.isLoading) return <p className="text-slate-500">Loading sends…</p>
  if (!query.data) return <p className="text-red-700">Could not load the sends for this month.</p>
  const view = query.data
  const locked = view.status === 'closed'
  const t = view.totals

  function openForm(next: Draft) {
    setDraft(next)
    setFormVersion((v) => v + 1)
    setFormOpen(true)
    window.setTimeout(() => document.getElementById('send-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  /** What a ticked line offers by default: the cash ready to send, or if none, what is still to go. */
  function defaultAmount(l: { to_send: string; remaining: string }): string {
    const ready = Number(l.to_send)
    return String(ready > 0 ? ready : Number(l.remaining))
  }

  function toggle(lineId: number, amount: string) {
    setPicked((old) => {
      const next = new Map(old)
      if (next.has(lineId)) next.delete(lineId)
      else next.set(lineId, amount)
      return next
    })
  }

  const pickedRows = view.groups.flatMap((g) =>
    g.lines.filter((l) => picked.has(l.id)).map((l) => ({ g, l, amount: Number(picked.get(l.id) || 0) })),
  )
  const pickedTotal = pickedRows.reduce((sum, r) => sum + r.amount, 0)
  const missingRecipient = sendTo === 'usual' && pickedRows.some((r) => !r.l.recipient_id)
  const canMark = pickedRows.length > 0 && pickedRows.every((r) => r.amount > 0) && !missingRecipient && !saving

  /** Save the ticked lines as sent: one send per recipient. */
  async function markSent() {
    if (!canMark) return
    const byRecipient = new Map<number, typeof pickedRows>()
    for (const r of pickedRows) {
      const who = sendTo === 'usual' ? (r.l.recipient_id as number) : Number(sendTo)
      byRecipient.set(who, [...(byRecipient.get(who) ?? []), r])
    }
    setSaving(true)
    let ok = true
    for (const [who, rows] of byRecipient) {
      const total = rows.reduce((sum, r) => sum + r.amount, 0)
      ok = await run(() =>
        api.createSend(month.id, {
          sent_date: sendDate,
          recipient_id: who,
          amount_kes: total.toFixed(2),
          purposes: rows.map((r) => ({ budget_line_id: r.l.id, amount: r.amount.toFixed(2) })),
        }),
      )
      if (!ok) break
    }
    setSaving(false)
    if (ok) setPicked(new Map())
  }

  function editSend(s: SendRow) {
    // Parts spread from one section come back as that section; the rest stay as lines.
    const byGroup = new Map<number, number>()
    const purposes: PurposeDraft[] = []
    for (const p of s.purposes) {
      if (p.via_group_id !== null) byGroup.set(p.via_group_id, (byGroup.get(p.via_group_id) ?? 0) + Number(p.amount_kes))
      else purposes.push({ key: nextKey++, target: `l:${p.budget_line_id}`, amount: String(Number(p.amount_kes)) })
    }
    for (const [gid, amount] of byGroup) purposes.unshift({ key: nextKey++, target: `g:${gid}`, amount: String(amount) })
    openForm({
      editingId: s.id,
      sent_date: s.sent_date,
      recipient_id: String(s.recipient_id),
      amount_kes: String(Number(s.amount_kes)),
      amount_ntd: plain(s.amount_ntd),
      fee_ntd: plain(s.fee_ntd),
      platform: s.platform ?? '',
      reference: s.reference ?? '',
      note: s.note ?? '',
      purposes,
    })
  }


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Kenya sends · {monthLabel(month)}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tick what you have sent, check the amounts, and mark it as sent. Each section shows what is still to go.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Label>Planned for Kenya</Label>
          <Big>{money(t.planned, 'KES')}</Big>
          <Small>
            Set aside from income: {money(t.set_aside, 'KES')}
            {Number(t.waiting) > 0 && ` · ${fmt(t.waiting)} waiting for income`}
          </Small>
        </Card>
        <div className="rounded-xl bg-brand-800 p-4 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">Sent so far</p>
          <p className="num mt-1 text-2xl font-bold">{money(t.sent, 'KES')}</p>
          <p className="text-sm text-brand-100">
            {t.count} send{t.count === 1 ? '' : 's'}
            {t.average_rate && ` · average 1 NTD = ${Number(t.average_rate).toFixed(2)} KES`}
          </p>
        </div>
        <Card className="p-4">
          <Label>Ready to send</Label>
          <Big>{money(t.to_send, 'KES')}</Big>
          <Small>Cash set aside from your income, not sent yet</Small>
          {Number(t.over) > 0 && <p className="num mt-1 text-xs text-amber-800">{money(t.over, 'KES')} sent beyond the plan</p>}
        </Card>
        <Card className={'p-4 ' + (Number(t.unassigned) > 0 ? 'border-amber-300 bg-amber-50' : '')}>
          <Label>Not yet assigned</Label>
          <Big>{money(t.unassigned, 'KES')}</Big>
          <Small>{Number(t.unassigned) > 0 ? 'Edit a send below to say what it was for' : 'Every shilling sent has a purpose'}</Small>
        </Card>
      </div>

      {!locked && formOpen && (
        <SendForm
          key={formVersion}
          initial={draft}
          view={view}
          monthId={month.id}
          run={run}
          onDone={() => {
            setDraft(blankDraft())
            setFormOpen(false)
          }}
        />
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-brand-900">What each section still needs</h2>
            <p className="text-sm text-slate-600">Tick the lines you have sent, adjust an amount if needed, then mark as sent.</p>
          </div>
          {!locked && !formOpen && (
            <button type="button" className="text-sm text-brand-700 underline" onClick={() => openForm(blankDraft())}>
              Record a different kind of send
            </button>
          )}
        </div>
        {view.groups.map((g) => (
          <GroupCard
            key={g.group_id}
            group={g}
            view={view}
            picked={picked}
            locked={locked}
            onToggle={(id, amount) => toggle(id, amount)}
            onAmount={(id, amount) => setPicked((old) => new Map(old).set(id, amount))}
            onTickAll={(ids) =>
              setPicked((old) => {
                const next = new Map(old)
                for (const [id, amount] of ids) if (!next.has(id)) next.set(id, amount)
                return next
              })
            }
            defaultAmount={defaultAmount}
            run={run}
          />
        ))}
        {view.groups.length === 0 && (
          <Card className="p-5 text-sm text-slate-600">This month has no KES lines, so there is nothing to send.</Card>
        )}
      </div>

      <SendLog view={view} locked={locked} run={run} onEdit={editSend} />

      {picked.size > 0 && !locked && (
        <div className="sticky bottom-4 z-10 rounded-xl bg-brand-900 px-4 py-3 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {picked.size} line{picked.size === 1 ? '' : 's'} ·{' '}
              <strong className="num text-base">{money(pickedTotal, 'KES')}</strong>
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <span className="text-brand-100">Sent on</span>
                <input
                  aria-label="Date sent"
                  type="date"
                  className="rounded-md border border-brand-700 bg-brand-800 px-2 py-1 text-white"
                  value={sendDate}
                  onChange={(e) => setSendDate(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-brand-100">to</span>
                <select
                  aria-label="Sent to"
                  className="rounded-md border border-brand-700 bg-brand-800 px-2 py-1 text-white"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                >
                  <option value="usual">Each line's usual recipient</option>
                  {view.recipients
                    .filter((r) => r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="rounded-lg px-3 py-2 text-brand-100 hover:bg-brand-800" onClick={() => setPicked(new Map())}>
                Clear
              </button>
              <button
                className="rounded-lg bg-leaf px-3.5 py-2 font-semibold text-brand-950 hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canMark}
                onClick={() => void markSent()}
              >
                {saving ? 'Saving…' : 'Mark as sent'}
              </button>
            </div>
          </div>
          {missingRecipient && (
            <p className="mt-2 text-xs text-amber-300">
              A ticked line has no usual recipient. Choose who it went to here, or under the line's name.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SendForm(props: { initial: Draft; view: SendsView; monthId: number; run: Run; onDone: () => void }) {
  const { view, monthId, run, onDone } = props
  const [d, setD] = useState<Draft>(props.initial)
  const [more, setMore] = useState(Boolean(props.initial.amount_ntd || props.initial.platform || props.initial.reference))
  const set = (patch: Partial<Draft>) => setD((old) => ({ ...old, ...patch }))

  const lineIndex = new Map(view.groups.flatMap((g) => g.lines.map((l) => [l.id, { g, l }] as const)))
  const groupIndex = new Map(view.groups.map((g) => [g.group_id, g]))
  const recipients = view.recipients.filter((r) => r.active || String(r.id) === d.recipient_id)

  // While editing, this send's own parts still count in "to send", so add them back.
  const editing = d.editingId !== null ? view.sends.find((s) => s.id === d.editingId) : undefined
  const ownLine = (id: number) =>
    editing?.purposes.filter((p) => p.budget_line_id === id).reduce((t, p) => t + Number(p.amount_kes), 0) ?? 0
  const lineNeed = (id: number) => Number(lineIndex.get(id)?.l.to_send ?? 0) + ownLine(id)
  const groupNeed = (g: SendGroup) => g.lines.reduce((t, l) => t + lineNeed(l.id), 0)
  const need = (target: string) => {
    const [kind, raw] = target.split(':')
    const id = Number(raw)
    if (kind === 'g') {
      const g = groupIndex.get(id)
      return g ? groupNeed(g) : 0
    }
    return lineNeed(id)
  }

  const amount = Number(d.amount_kes || 0)
  const assigned = d.purposes.reduce((t, p) => t + Number(p.amount || 0), 0)
  const left = amount - assigned
  const valid =
    d.recipient_id !== '' &&
    amount > 0 &&
    left >= -0.001 &&
    d.purposes.every((p) => p.target !== '' && Number(p.amount) > 0)

  function addPurpose(target = '') {
    const suggested = target ? Math.max(0, Math.min(need(target), amount > 0 ? left : need(target))) : 0
    set({ purposes: [...d.purposes, { key: nextKey++, target, amount: suggested ? String(suggested) : '' }] })
  }

  function changeTarget(key: number, target: string) {
    const purposes = d.purposes.map((p) => {
      if (p.key !== key) return p
      const others = d.purposes.filter((o) => o.key !== key).reduce((t, o) => t + Number(o.amount || 0), 0)
      // With an amount entered, suggest only what is still unassigned; without one, what the target needs.
      const room = amount > 0 ? Math.max(0, amount - others) : need(target)
      const suggested = Math.min(need(target), room)
      return { ...p, target, amount: p.amount || (suggested > 0 ? String(suggested) : '') }
    })
    const patch: Partial<Draft> = { purposes }
    if (!d.recipient_id && target.startsWith('g:')) {
      const g = groupIndex.get(Number(target.slice(2)))
      if (g?.usual_recipient_id) patch.recipient_id = String(g.usual_recipient_id)
    }
    set(patch)
  }

  async function save() {
    if (!valid) return
    const body: SendBody = {
      sent_date: d.sent_date,
      recipient_id: Number(d.recipient_id),
      amount_kes: d.amount_kes,
      amount_ntd: d.amount_ntd.trim() || null,
      fee_ntd: d.fee_ntd.trim() || null,
      platform: d.platform.trim() || null,
      reference: d.reference.trim() || null,
      note: d.note.trim() || null,
      purposes: d.purposes.map((p) =>
        p.target.startsWith('g:')
          ? { group_id: Number(p.target.slice(2)), amount: p.amount }
          : { budget_line_id: Number(p.target.slice(2)), amount: p.amount },
      ),
    }
    const ok = await run(() => (d.editingId !== null ? api.updateSend(d.editingId, body) : api.createSend(monthId, body)))
    if (ok) onDone()
  }

  return (
    <Card className={'scroll-mt-4 ' + (d.editingId !== null ? 'border-2 border-brand-600' : '')}>
      <div id="send-form" className="flex items-center justify-between rounded-t-xl bg-brand-50 px-4 py-2.5">
        <h2 className="font-semibold text-brand-900">{d.editingId !== null ? 'Edit send' : 'Record a send'}</h2>
        {d.editingId !== null && (
          <button className="text-sm text-slate-600 underline" onClick={onDone}>
            Cancel editing
          </button>
        )}
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Date sent</span>
            <input aria-label="Date sent" type="date" className={box} value={d.sent_date} onChange={(e) => set({ sent_date: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">To</span>
            <select aria-label="Recipient" className={box + ' min-w-[140px]'} value={d.recipient_id} onChange={(e) => set({ recipient_id: e.target.value })}>
              <option value="">Choose…</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Amount received (KES)</span>
            <input
              aria-label="Amount in KES"
              className={box + ' num w-36 text-right'}
              inputMode="decimal"
              value={d.amount_kes}
              placeholder="0"
              onChange={(e) => set({ amount_kes: e.target.value })}
            />
          </label>
          {!more && (
            <button className="pb-2 text-sm text-brand-700 underline" onClick={() => setMore(true)}>
              + NTD cost, fee, platform
            </button>
          )}
        </div>

        {more && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Total cost (NTD)</span>
              <input aria-label="Total cost in NTD" className={box + ' num w-28 text-right'} inputMode="decimal" value={d.amount_ntd} onChange={(e) => set({ amount_ntd: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Of which fee (NTD)</span>
              <input aria-label="Fee in NTD" className={box + ' num w-24 text-right'} inputMode="decimal" value={d.fee_ntd} onChange={(e) => set({ fee_ntd: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Platform</span>
              <input aria-label="Platform" className={box + ' w-32'} placeholder="e.g. Wise" value={d.platform} onChange={(e) => set({ platform: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Reference</span>
              <input aria-label="Reference" className={box + ' w-36'} value={d.reference} onChange={(e) => set({ reference: e.target.value })} />
            </label>
            {Number(d.amount_ntd) > 0 && amount > 0 && (
              <p className="pb-2 text-sm text-slate-600">
                Rate: 1 NTD = <strong className="num">{(amount / Number(d.amount_ntd)).toFixed(2)}</strong> KES
                <span className="text-slate-400"> (plan {Number(view.planning_rate).toFixed(2)})</span>
              </p>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">What it is for</p>
          {d.purposes.length === 0 && (
            <p className="mb-2 text-sm text-slate-500">
              Add a section or a line. You can also save without a purpose and sort it out later.
            </p>
          )}
          <div className="space-y-2">
            {d.purposes.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Purpose"
                  className={box + ' min-w-[220px] flex-1'}
                  value={p.target}
                  onChange={(e) => changeTarget(p.key, e.target.value)}
                >
                  <option value="">Choose a section or line…</option>
                  <optgroup label="Whole section (spread over its lines)">
                    {view.groups.map((g) => (
                      <option key={g.group_id} value={`g:${g.group_id}`}>
                        {g.name} · {fmt(groupNeed(g))} ready to send
                      </option>
                    ))}
                  </optgroup>
                  {view.groups.map((g) => (
                    <optgroup key={g.group_id} label={g.name}>
                      {g.lines.map((l) => (
                        <option key={l.id} value={`l:${l.id}`}>
                          {l.name} · {fmt(lineNeed(l.id))} ready to send
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  aria-label="Purpose amount"
                  className={box + ' num w-32 text-right'}
                  inputMode="decimal"
                  placeholder="KES"
                  value={p.amount}
                  onChange={(e) => set({ purposes: d.purposes.map((o) => (o.key === p.key ? { ...o, amount: e.target.value } : o)) })}
                />
                <button
                  type="button"
                  title="Remove this purpose"
                  className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  onClick={() => set({ purposes: d.purposes.filter((o) => o.key !== p.key) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => addPurpose()}>
              + Add a purpose
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
          <p className={'num text-sm ' + (left < -0.001 ? 'font-semibold text-red-700' : 'text-slate-600')}>
            Assigned {money(assigned, 'KES')} of {money(amount, 'KES')}
            {left > 0.001 && <span className="text-amber-800"> · {money(left, 'KES')} not yet assigned</span>}
            {left < -0.001 && <span> · {money(-left, 'KES')} more than the send</span>}
          </p>
          <Button onClick={() => void save()} disabled={!valid}>
            {d.editingId !== null ? 'Save changes' : 'Record send'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function GroupCard(props: {
  group: SendGroup
  view: SendsView
  picked: Map<number, string>
  locked: boolean
  onToggle: (lineId: number, amount: string) => void
  onAmount: (lineId: number, amount: string) => void
  onTickAll: (lines: [number, string][]) => void
  defaultAmount: (l: SendLine) => string
  run: Run
}) {
  const { group: g, view, picked, locked, onToggle, onAmount, onTickAll, defaultAmount, run } = props
  const usual = view.recipients.find((r) => r.id === g.usual_recipient_id)
  const open = g.lines.filter((l) => Number(l.remaining) > 0)
  const grid = 'grid grid-cols-[28px_minmax(120px,1fr)_76px_76px_76px_100px] items-center gap-2'
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-50 px-4 py-2.5">
        <div>
          <h3 className="font-semibold text-brand-900">{g.name}</h3>
          <p className="text-xs text-slate-500">
            {usual ? `Usually sent to ${usual.name}` : 'No usual recipient set'}
            {!locked && open.length > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  className="font-semibold text-brand-700 hover:underline"
                  onClick={() => onTickAll(open.map((l) => [l.id, defaultAmount(l)]))}
                >
                  Tick all
                </button>
              </>
            )}
          </p>
        </div>
        <div className="min-w-[180px] text-right">
          <p className="num text-sm font-semibold text-brand-800">
            {fmt(g.sent)} of {money(g.planned, 'KES')} sent
          </p>
          <Bar part={Number(g.sent)} whole={Number(g.sent) + Number(g.remaining)} />
        </div>
      </div>
      <div className={grid + ' border-b border-slate-200 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500'}>
        <span />
        <span>Line</span>
        <span className="text-right">Budget</span>
        <span className="text-right" title="Typed on the Month plan. Only this much is sent.">Actual</span>
        <span className="text-right">Sent</span>
        <span className="text-right">To send</span>
      </div>
      {g.lines.map((l) => {
        const isPicked = picked.has(l.id)
        const finished = Number(l.remaining) <= 0
        const ready = Number(l.to_send)
        return (
          <div
            key={l.id}
            className={
              grid +
              ' border-b border-slate-100 px-4 py-1.5 text-sm last:border-b-0 ' +
              (isPicked ? 'bg-leaf/10' : finished || locked ? '' : 'hover:bg-slate-50')
            }
          >
            <input
              type="checkbox"
              aria-label={`Pick ${l.name}`}
              className="accent-brand-700"
              disabled={finished || locked}
              checked={isPicked}
              onChange={() => onToggle(l.id, defaultAmount(l))}
            />
            <span className="min-w-0">
              <span className={'font-medium ' + (finished ? 'text-slate-500' : '')}>{l.name}</span>
              {l.priority === 'essential' && <span className="ml-1.5 text-[11px] font-semibold text-brand-700">Essential</span>}
              <span className="block text-[11px] text-slate-500">
                to{' '}
                <select
                  aria-label={`Who ${l.name} is sent to`}
                  title="Who this line's money is usually sent to"
                  disabled={locked}
                  className={
                    'cursor-pointer rounded border-0 bg-transparent p-0 text-[11px] outline-none hover:underline focus:ring-1 focus:ring-brand-300 ' +
                    (l.own_recipient ? 'font-semibold text-brand-700' : 'text-slate-500')
                  }
                  value={l.own_recipient ? String(l.recipient_id) : ''}
                  onChange={(e) =>
                    void run(() => api.updateLine(l.id, { recipient_id: e.target.value ? Number(e.target.value) : null }))
                  }
                >
                  <option value="">{usual ? `${usual.name} (section)` : 'nobody set (section)'}</option>
                  {view.recipients
                    .filter((r) => r.active || r.id === l.recipient_id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </span>
            </span>
            <span className="num text-right text-slate-600">{fmt(l.planned)}</span>
            <span
              className={'num text-right ' + (l.actual !== null ? 'font-semibold text-amber-800' : 'text-slate-300')}
              title={l.actual !== null ? 'Typed on the Month plan' : 'No actual typed: the budget is used'}
            >
              {l.actual !== null ? fmt(l.actual) : '–'}
            </span>
            <span className="num text-right text-slate-600">{Number(l.sent) > 0 ? fmt(l.sent) : '–'}</span>
            <span className="num text-right font-semibold">
              {isPicked ? (
                <input
                  aria-label={`Amount sent for ${l.name}`}
                  className="num w-full min-w-0 rounded-md border border-brand-300 bg-white px-1.5 py-0.5 text-right text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
                  inputMode="decimal"
                  size={1}
                  value={picked.get(l.id)}
                  onChange={(e) => onAmount(l.id, e.target.value)}
                />
              ) : Number(l.over) > 0 ? (
                <span className="text-amber-800">+{fmt(l.over)} over</span>
              ) : finished ? (
                <span className="text-brand-600">Sent ✓</span>
              ) : ready > 0 ? (
                <span className="text-brand-900">{fmt(ready)}</span>
              ) : (
                <span className="text-xs font-normal text-slate-400" title="No income has covered this yet. You can still tick it if you sent money for it.">
                  {fmt(l.remaining)} · no income yet
                </span>
              )}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

function SendLog(props: { view: SendsView; locked: boolean; run: Run; onEdit: (s: SendRow) => void }) {
  const { view, locked, run, onEdit } = props
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
      <Card>
        <div className="rounded-t-xl bg-brand-50 px-4 py-2.5">
          <h2 className="font-semibold text-brand-900">Sends this month</h2>
        </div>
        {view.sends.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">Nothing sent yet this month.</p>}
        {view.sends.map((s) => {
          // Show section-level purposes once, line purposes on their own.
          const chips = new Map<string, number>()
          for (const p of s.purposes) {
            const label = p.via_group_id !== null ? (p.group_name ?? 'Section') : `${p.line_name} (${p.group_name})`
            chips.set(label, (chips.get(label) ?? 0) + Number(p.amount_kes))
          }
          return (
            <div key={s.id} className="border-b border-slate-100 px-4 py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {s.recipient_name} <span className="num font-bold text-brand-900">{money(s.amount_kes, 'KES')}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.sent_date}
                    {s.platform && ` · ${s.platform}`}
                    {s.amount_ntd && ` · cost ${money(s.amount_ntd, 'NTD')}`}
                    {s.fee_ntd && Number(s.fee_ntd) > 0 && ` (fee ${fmt(s.fee_ntd)})`}
                    {s.rate && ` · 1 NTD = ${Number(s.rate).toFixed(2)} KES`}
                    {s.reference && ` · ref ${s.reference}`}
                  </p>
                </div>
                {!locked && (
                  <div className="flex gap-1">
                    <button className="rounded-md px-2 py-1 text-sm text-brand-700 hover:bg-brand-50" onClick={() => onEdit(s)}>
                      {Number(s.unassigned) > 0 ? 'Assign' : 'Edit'}
                    </button>
                    <button
                      title="Remove this send"
                      className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      onClick={() => {
                        if (window.confirm(`Remove this send of KES ${fmt(s.amount_kes)} to ${s.recipient_name}?`))
                          void run(() => api.deleteSend(s.id))
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[...chips].map(([label, amount]) => (
                  <span key={label} className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs text-brand-900">
                    {label} <span className="num font-semibold">{fmt(amount)}</span>
                  </span>
                ))}
                {Number(s.unassigned) > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                    Not assigned {fmt(s.unassigned)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      <Card className="self-start p-4">
        <h2 className="font-semibold text-brand-900">By recipient</h2>
        {view.per_recipient.length === 0 && <p className="mt-2 text-sm text-slate-500">No sends yet.</p>}
        <div className="mt-2 divide-y divide-slate-100">
          {view.per_recipient.map((r) => (
            <div key={r.recipient_id} className="flex items-baseline justify-between py-1.5 text-sm">
              <span>
                {r.name} <span className="text-xs text-slate-500">× {r.count}</span>
              </span>
              <span className="num font-semibold text-brand-900">{fmt(r.amount_kes)}</span>
            </div>
          ))}
        </div>
        {Number(view.totals.fees_ntd) > 0 && (
          <p className="mt-3 text-xs text-slate-500">Fees this month: {money(view.totals.fees_ntd, 'NTD')}</p>
        )}
      </Card>
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
function Bar(props: { part: number; whole: number }) {
  const pct = props.whole > 0 ? Math.max(0, Math.min(100, (props.part / props.whole) * 100)) : 0
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" title={`${pct.toFixed(0)}%`}>
      <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
    </div>
  )
}
