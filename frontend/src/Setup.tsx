// First-time set-up: a new account is walked through everything the app needs before its first payment arrives.
// Every answer is saved straight away, so the guide can be left and picked up again.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ccy, money, monthLabel, places } from './api'
import type { Debt, Goal, Group, Line, LineType, Location, Meta, MonthSummary, SourceRow } from './api'
import { COUNTRIES, currencyOf } from './countries'
import { useRun } from './hooks'
import type { Run } from './hooks'
import { TodayRate } from './TodayRate'
import { Button, Card, ErrorBanner, Select } from './ui'

const STEP_KEY = 'setup-step'
const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

const ACCOUNT_KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'savings', label: 'Savings' },
  { value: 'chama', label: 'Chama' },
]
const LINE_TYPES = [
  { value: 'fixed', label: 'Same every month' },
  { value: 'variable', label: 'Changes each month' },
  { value: 'one_off', label: 'This month only' },
]

/** What every step needs: the month being planned, its rate, and how to save a change. */
interface Ctx {
  monthId: number
  rate: number
  meta: Meta
  run: Run
}

interface Step {
  key: string
  title: string
  body: ReactNode
}

export default function Setup(props: {
  month: MonthSummary
  meta: Meta
  username: string
  onSignOut: () => void
}) {
  const { month, meta } = props
  const [error, setError] = useState<string | null>(null)
  const run = useRun(setError)
  const [index, setIndex] = useState(readStep)
  const ctx: Ctx = { monthId: month.id, rate: Number(month.fx_rate_ntd_kes) || 1, meta, run }

  const steps: Step[] = [
    { key: 'welcome', title: 'Welcome', body: <Welcome /> },
    { key: 'countries', title: 'Where you live and where home is', body: <CountriesStep ctx={ctx} month={month} /> },
    { key: 'income', title: 'Your income', body: <IncomeStep ctx={ctx} /> },
    ...meta.locations.map((loc) => ({
      key: `loc-${loc.id}`,
      title: `Spending in ${loc.name}`,
      body: <LocationStep ctx={ctx} location={loc} />,
    })),
    { key: 'savings', title: 'Savings', body: <SavingsStep ctx={ctx} /> },
    { key: 'goals', title: 'Projects and goals', body: <GoalsStep ctx={ctx} /> },
    { key: 'debts', title: 'Debts', body: <DebtsStep ctx={ctx} /> },
    { key: 'accounts', title: 'Where your money is kept', body: <AccountsStep ctx={ctx} /> },
    { key: 'finish', title: 'Check and finish', body: <FinishStep ctx={ctx} /> },
  ]
  const at = Math.min(index, steps.length - 1)
  const step = steps[at]
  const last = at === steps.length - 1

  function go(to: number) {
    setIndex(to)
    setError(null)
    try {
      localStorage.setItem(STEP_KEY, String(to))
    } catch {
      // the guide still works; it just opens on the first step next time
    }
    window.scrollTo(0, 0)
  }

  function finish() {
    try {
      localStorage.removeItem(STEP_KEY)
    } catch {
      // nothing to forget
    }
    void run(() => api.setSetup(false))
  }

  return (
    <div className="min-h-full">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-leaf text-lg font-black text-brand-950">2</span>
            <p className="text-lg font-bold leading-tight">Budget 2gether</p>
          </div>
          <button type="button" onClick={props.onSignOut} className="text-sm font-semibold text-brand-300 hover:text-white">
            Sign out <span className="font-normal">({props.username})</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Set-up · step {at + 1} of {steps.length}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-brand-900">{step.title}</h1>
        <div className="mt-3 flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              tabIndex={-1}
              title={s.title}
              onClick={() => go(i)}
              className={'h-1.5 flex-1 rounded-full ' + (i <= at ? 'bg-brand-600' : 'bg-slate-200')}
            />
          ))}
        </div>

        <div className="mt-5">
          <ErrorBanner message={error} onClose={() => setError(null)} />
          {step.body}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            {at > 0 && (
              <Button variant="ghost" onClick={() => go(at - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {!last && (
              <button
                type="button"
                className="text-sm text-slate-500 underline"
                title="Go straight to the app. You can come back to this guide from Settings."
                onClick={() => {
                  if (window.confirm('Leave the set-up guide? You can open it again from Settings.')) finish()
                }}
              >
                Skip set-up
              </button>
            )}
            {last ? <Button onClick={finish}>Finish and open my dashboard</Button> : <Button onClick={() => go(at + 1)}>Next</Button>}
          </div>
        </div>
      </main>
    </div>
  )
}

function readStep(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(STEP_KEY)) || 0)
  } catch {
    return 0
  }
}

// ---- small pieces -------------------------------------------------------------

/** A box that saves when you leave it or press Enter. An empty amount means 0. */
function Field(props: {
  value: string | number | null | undefined
  onCommit: (value: string) => unknown
  ariaLabel: string
  numeric?: boolean
  placeholder?: string
  className?: string
}) {
  const shown = props.numeric
    ? props.value === null || props.value === undefined || Number(props.value) === 0
      ? ''
      : String(Number(props.value))
    : String(props.value ?? '')
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  // What was saved, once the change has come back from the server.
  const latest = useRef(shown)
  latest.current = shown

  function commit() {
    const next = props.numeric ? draft.replace(/,/g, '').trim() : draft.trim()
    if (next === shown) return
    const bad = props.numeric ? next !== '' && (Number.isNaN(Number(next)) || Number(next) < 0) : next === ''
    if (bad) {
      setDraft(shown)
      return
    }
    void Promise.resolve(props.onCommit(props.numeric && next === '' ? '0' : next)).then((ok) => {
      setDraft(ok === false ? shown : latest.current)
    })
  }

  return (
    <input
      aria-label={props.ariaLabel}
      className={box + ' min-w-0 ' + (props.numeric ? 'num text-right ' : '') + (props.className ?? 'w-full')}
      size={1}
      value={draft}
      placeholder={props.placeholder ?? (props.numeric ? '0' : undefined)}
      inputMode={props.numeric ? 'decimal' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function Labeled(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={'block min-w-0 text-xs ' + (props.className ?? '')}>
      <span className="mb-0.5 block font-semibold uppercase tracking-wide text-slate-500">{props.label}</span>
      {props.children}
    </label>
  )
}

function Intro(props: { children: ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-slate-700">{props.children}</p>
}

function Remove(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className="rounded px-2 py-1 text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-700"
    >
      ✕
    </button>
  )
}

function currencyOptions(meta: Meta) {
  return meta.currencies.map((c) => ({ value: c.code, label: ccy(c.code) }))
}

/** An amount moved between NTD and KES. `rate` is KES for one NTD. */
function convert(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return amount
  return from === 'NTD' ? amount * rate : amount / rate
}

/** The section a helper line goes in: the one with this name where that currency is spent, made if missing. */
async function sectionFor(meta: Meta, currency: string, name: string): Promise<Group> {
  const location = meta.locations.find((l) => l.default_currency === currency) ?? meta.locations[0]
  if (!location) throw new Error('Add a location in Settings first')
  return location.groups.find((g) => g.name === name) ?? (await api.createGroup({ name, location_id: location.id }))
}

// ---- 1. welcome ---------------------------------------------------------------

function Welcome() {
  const points: [string, string][] = [
    ['Plan the month', 'Give every cost a budget: rent, food, what you send home, what you save.'],
    ['Record each payment', 'When money arrives you type it in, and the app shares it out: bills first, then savings, then your projects. What is left is free to spend.'],
    ['Send money home', 'The app tracks what is set aside for home and what you have really sent.'],
    ['Review and close', 'At the end of the month you compare budget with actual and check your balances.'],
  ]
  return (
    <div className="space-y-4">
      <Intro>
        This app is for someone who earns in one country and supports a home in another. The next few steps collect
        what it needs to work for you. It takes about ten minutes, everything is saved as you go, and you can change
        any of it later.
      </Intro>
      <Card className="divide-y divide-slate-100">
        {points.map(([title, text], i) => (
          <div key={title} className="flex gap-3 p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-800">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-brand-900">{title}</p>
              <p className="text-sm text-slate-600">{text}</p>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ---- the two countries and the rate between them ---------------------------------

function CountriesStep(props: { ctx: Ctx; month: MonthSummary }) {
  const { ctx, month } = props
  // Shown from here, so two quick choices do not undo each other while the first is still being saved.
  const [profile, setProfile] = useState(ctx.meta.profile)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const setRate = (v: string) => ctx.run(() => api.updateMonth(ctx.monthId, { fx_rate_ntd_kes: v }))

  /** Save the country and its currency, then start from today's rate between the two. */
  function choose(which: 'residence' | 'home', country: string) {
    const currency = currencyOf(country)
    if (!currency) return
    const before = profile
    const next = { ...profile, [`${which}_country`]: country, [`${which}_currency`]: currency }
    setProfile(next)
    // One save at a time, in the order chosen, so the rate that lands last belongs to the last choice.
    saving.current = saving.current.then(async () => {
      const ok = await ctx.run(async () => {
        await api.setProfile(next)
        try {
          const today = await api.fxRate()
          await api.updateMonth(ctx.monthId, { fx_rate_ntd_kes: today.rate })
        } catch {
          // the rate is only a suggestion; it can be typed below
        }
      })
      if (!ok) setProfile(before)
    })
  }

  const options = (current: string) => {
    const names = COUNTRIES.map((c) => c.name)
    return (names.includes(current) ? names : [current, ...names]).map((name) => ({ value: name, label: name }))
  }

  return (
    <div className="space-y-4">
      <Intro>
        The app keeps two currencies side by side: the one you earn and spend in where you live, and the one used at
        home. Choose your two countries and it will name everything after them.
      </Intro>
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Labeled label="Where you live and earn">
          <Select ariaLabel="Country you live in" className="w-full py-2" value={profile.residence_country} onChange={(v) => choose('residence', v)} options={options(profile.residence_country)} />
          <span className="mt-1 block text-sm normal-case text-slate-600">
            Currency: <strong>{profile.residence_currency}</strong>
          </span>
        </Labeled>
        <Labeled label="Home, where you send money">
          <Select ariaLabel="Home country" className="w-full py-2" value={profile.home_country} onChange={(v) => choose('home', v)} options={options(profile.home_country)} />
          <span className="mt-1 block text-sm normal-case text-slate-600">
            Currency: <strong>{profile.home_currency}</strong>
          </span>
        </Labeled>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-semibold text-brand-900">Your exchange rate for {monthLabel(month)}</h2>
          <p className="text-sm text-slate-600">
            The app uses this rate to add the two currencies together. Check it at the start of every month.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">1 {ccy('NTD')} =</span>
          <Field ariaLabel="Exchange rate" numeric className="w-28" value={month.fx_rate_ntd_kes} onCommit={setRate} />
          <span className="font-semibold">{ccy('KES')}</span>
        </div>
        <TodayRate current={month.fx_rate_ntd_kes} onUse={(rate) => void setRate(rate)} />
      </Card>
    </div>
  )
}

// ---- 2. income ----------------------------------------------------------------

function IncomeStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const query = useQuery({ queryKey: ['setup-income', ctx.monthId], queryFn: () => api.income(ctx.monthId) })
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('NTD')
  if (!query.data) return <p className="text-slate-500">Loading…</p>
  const view = query.data
  const sources = view.sources.filter((s) => s.active)

  async function add() {
    const made = await api.createSource({ name: name.trim(), currency_code: currency, reliability: 'regular', rule_type: 'percent_first', save_percent: '10' })
    await api.setExpected(ctx.monthId, { source_id: made.id, amount: '0' })
    setName('')
  }

  return (
    <div>
      <Intro>
        List every place money comes from, and how much you expect this month. <strong>Regular</strong> income is
        money you can count on, like a salary: the plan must fit inside it. <strong>Irregular</strong> income, like
        side jobs, is a bonus and never counted on.
      </Intro>
      <div className="space-y-3">
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} ctx={ctx} />
        ))}
        {sources.length === 0 && <p className="text-sm text-amber-800">Add at least one income source.</p>}
      </div>
      <Card className="mt-3 flex flex-wrap items-end gap-2 p-3">
        <Labeled label="Another source" className="flex-1 basis-40">
          <input aria-label="New income source" className={box + ' w-full'} placeholder="e.g. Weekend job" value={name} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Select ariaLabel="Currency of the new source" className="py-1.5" value={currency} onChange={setCurrency} options={currencyOptions(ctx.meta)} />
        <Button variant="ghost" disabled={!name.trim()} onClick={() => void ctx.run(add)}>
          Add source
        </Button>
      </Card>
      <p className="mt-4 text-sm text-slate-700">
        Regular income expected this month: <strong className="num">{money(view.fit.reliable.NTD, 'NTD')}</strong>
        {Number(view.fit.irregular.NTD) > 0 && (
          <>
            {' '}
            · irregular: <span className="num">{money(view.fit.irregular.NTD, 'NTD')}</span>
          </>
        )}
      </p>
    </div>
  )
}

function SourceCard(props: { source: SourceRow; ctx: Ctx }) {
  const { source: s, ctx } = props
  const patch = (body: Parameters<typeof api.updateSource>[1]) => ctx.run(() => api.updateSource(s.id, body))
  return (
    <Card className="p-3">
      <div className="flex items-start gap-2">
        <Labeled label="Name" className="flex-1">
          <Field ariaLabel={`Name of ${s.name}`} value={s.name} onCommit={(v) => patch({ name: v })} className="w-full font-semibold" />
        </Labeled>
        <Remove
          label={`Remove ${s.name}`}
          onClick={() => {
            if (window.confirm(`Remove ${s.name}?`)) void ctx.run(() => api.deleteSource(s.id))
          }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labeled label={`Expected (${ccy(s.currency_code)})`}>
          <Field
            ariaLabel={`Expected from ${s.name}`}
            numeric
            value={s.expected}
            onCommit={(v) => ctx.run(() => api.setExpected(ctx.monthId, { source_id: s.id, amount: v }))}
          />
        </Labeled>
        <Labeled label="Currency">
          <Select ariaLabel={`Currency of ${s.name}`} className="w-full py-1.5" value={s.currency_code} onChange={(v) => void patch({ currency_code: v })} options={currencyOptions(ctx.meta)} />
        </Labeled>
        <Labeled label="Kind">
          <Select
            ariaLabel={`Kind of ${s.name}`}
            className="w-full py-1.5"
            value={s.reliability}
            onChange={(v) => void patch({ reliability: v as SourceRow['reliability'] })}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'irregular', label: 'Irregular' },
            ]}
          />
        </Labeled>
        <Labeled label="Pay day (1–31)">
          <Field
            ariaLabel={`Pay day of ${s.name}`}
            numeric
            placeholder="any"
            value={s.usual_day}
            onCommit={(v) => {
              const day = Number(v) >= 1 && Number(v) <= 31 ? Math.round(Number(v)) : null
              return ctx.run(async () => {
                await api.updateSource(s.id, { usual_day: day })
                await api.setExpected(ctx.monthId, { source_id: s.id, expected_day: day })
              })
            }}
          />
        </Labeled>
      </div>
    </Card>
  )
}

// ---- 3. spending, one step per location ------------------------------------------

function LocationStep(props: { ctx: Ctx; location: Location }) {
  const { ctx, location: loc } = props
  const currency = loc.default_currency
  const month = useQuery({ queryKey: ['setup-month', ctx.monthId], queryFn: () => api.month(ctx.monthId) })
  const recipients = useQuery({ queryKey: ['setup-recipients'], queryFn: api.recipients }).data ?? []
  const [section, setSection] = useState('')
  if (!month.data) return <p className="text-slate-500">Loading…</p>

  const sentHome = currency === 'KES'
  const lines = month.data.lines.filter((l) => l.kind === 'expense')
  const allLines = month.data.lines
  // Sections that only hold savings or repayments are set up in later steps.
  const groups = loc.groups.filter((g) => lines.some((l) => l.group_id === g.id) || !allLines.some((l) => l.group_id === g.id))
  const total = lines
    .filter((l) => groups.some((g) => g.id === l.group_id))
    .reduce((sum, l) => sum + convert(Number(l.planned), l.currency_code, currency, ctx.rate), 0)

  return (
    <div>
      <Intro>
        {sentHome
          ? `What does home in ${loc.name} cost each month? These are the amounts you send. Group them into sections by who receives the money, and say who that is.`
          : `What does a month of living in ${loc.name} cost you? Change the names to fit your life, type a budget for each, and remove what you do not need.`}{' '}
        Mark a line <strong>Essential</strong> if it must be paid, or <strong>Flexible</strong> if it could be cut in a
        tight month. Income pays essentials first.
      </Intro>

      {sentHome && <RecipientsBox ctx={ctx} recipients={recipients} />}

      <div className="space-y-4">
        {groups.map((g) => {
          const mine = lines.filter((l) => l.group_id === g.id)
          return (
            <Card key={g.id}>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50 px-3 py-2">
                <Field ariaLabel={`Name of section ${g.name}`} value={g.name} onCommit={(v) => ctx.run(() => api.updateGroup(g.id, { name: v }))} className="w-40 flex-1 font-semibold text-brand-900" />
                {sentHome && (
                  <Select
                    ariaLabel={`Who receives ${g.name}`}
                    className="py-1.5"
                    value={g.usual_recipient_id === null ? '' : String(g.usual_recipient_id)}
                    onChange={(v) => void ctx.run(() => api.updateGroup(g.id, { usual_recipient_id: v === '' ? null : Number(v) }))}
                    options={[{ value: '', label: 'Sent to: choose…' }, ...recipients.filter((r) => r.active).map((r) => ({ value: String(r.id), label: `Sent to ${r.name}` }))]}
                  />
                )}
                {mine.length === 0 && (
                  <Remove label={`Remove section ${g.name}`} onClick={() => void ctx.run(() => api.deleteGroup(g.id))} />
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {mine.map((l) => (
                  <LineRow key={l.id} line={l} ctx={ctx} />
                ))}
              </div>
              <AddLine ctx={ctx} group={g} currency={currency} />
            </Card>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Labeled label="Another section" className="flex-1 basis-40">
          <input aria-label="New section" className={box + ' w-full'} placeholder={sentHome ? 'e.g. School, Parents' : 'e.g. Study'} value={section} onChange={(e) => setSection(e.target.value)} />
        </Labeled>
        <Button
          variant="ghost"
          disabled={!section.trim()}
          onClick={() =>
            void ctx.run(async () => {
              await api.createGroup({ name: section.trim(), location_id: loc.id })
              setSection('')
            })
          }
        >
          Add section
        </Button>
      </div>

      <p className="mt-4 text-sm text-slate-700">
        {loc.name} budget: <strong className="num">{money(total, currency)}</strong>
        {currency !== 'NTD' && <span className="num text-slate-500"> ≈ {money(total / ctx.rate, 'NTD')}</span>}
      </p>
    </div>
  )
}

function LineRow(props: { line: Line; ctx: Ctx }) {
  const { line: l, ctx } = props
  const patch = (body: Parameters<typeof api.updateLine>[1]) => ctx.run(() => api.updateLine(l.id, body))
  const essential = l.priority === 'essential'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_110px_190px_84px_auto]">
      <Field ariaLabel={`Name of ${l.name}`} value={l.name} onCommit={(v) => patch({ name: v })} className="col-span-2 w-full sm:col-span-1" />
      <Field ariaLabel={`Budget for ${l.name}`} numeric className="w-24 sm:w-full" value={l.planned} onCommit={(v) => patch({ planned: v })} />
      <Select ariaLabel={`How often ${l.name} is paid`} className="w-full py-1.5" value={l.line_type} onChange={(v) => void patch({ line_type: v as LineType })} options={LINE_TYPES} />
      <button
        type="button"
        title="Essential lines are paid first. Click to change."
        onClick={() => void patch({ priority: essential ? 'flexible' : 'essential' })}
        className={'rounded-full px-3 py-1 text-center text-xs font-semibold ' + (essential ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600')}
      >
        {essential ? 'Essential' : 'Flexible'}
      </button>
      <Remove label={`Remove ${l.name}`} onClick={() => void ctx.run(() => api.deleteLine(l.id))} />
    </div>
  )
}

function AddLine(props: { ctx: Ctx; group: Group; currency: string }) {
  const { ctx, group, currency } = props
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  async function add() {
    await api.createLine(ctx.monthId, {
      group_id: group.id,
      name: name.trim(),
      currency_code: currency,
      planned: amount.replace(/,/g, '').trim() || '0',
      priority: 'essential',
      line_type: 'variable',
    })
    setName('')
    setAmount('')
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
      <input aria-label={`New line in ${group.name}`} className={box + ' min-w-0 flex-1 basis-40'} placeholder={`Add a line to ${group.name}…`} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label={`Budget for the new line in ${group.name}`} className={box + ' num w-28 text-right'} inputMode="decimal" placeholder={`Amount ${ccy(currency)}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button variant="ghost" disabled={!name.trim()} onClick={() => void ctx.run(add)}>
        Add
      </Button>
    </div>
  )
}

function RecipientsBox(props: { ctx: Ctx; recipients: { id: number; name: string; usual_method: string | null; active: boolean }[] }) {
  const { ctx } = props
  const [name, setName] = useState('')
  const [method, setMethod] = useState(places().home === 'Kenya' ? 'M-Pesa' : 'Mobile money')
  const people = props.recipients.filter((r) => r.active)
  return (
    <Card className="mb-4 p-3">
      <h2 className="font-semibold text-brand-900">Who you send money to</h2>
      <p className="mb-2 text-sm text-slate-600">People and payees at home: a partner, a parent, a school, your own bank account.</p>
      <div className="flex flex-wrap gap-2">
        {people.map((r) => (
          <span key={r.id} className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-3 pr-1 text-sm text-brand-900">
            <strong>{r.name}</strong>
            {r.usual_method && <span className="text-slate-500">· {r.usual_method}</span>}
            <Remove label={`Remove ${r.name}`} onClick={() => void ctx.run(() => api.deleteRecipient(r.id))} />
          </span>
        ))}
        {people.length === 0 && <span className="text-sm text-amber-800">Add at least one person.</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="New recipient" className={box + ' min-w-0 flex-1 basis-40'} placeholder="e.g. Mum" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="How the new recipient is paid" className={box + ' w-32'} placeholder="How they are paid" value={method} onChange={(e) => setMethod(e.target.value)} />
        <Button
          variant="ghost"
          disabled={!name.trim()}
          onClick={() =>
            void ctx.run(async () => {
              await api.createRecipient({ name: name.trim(), usual_method: method.trim() || null })
              setName('')
            })
          }
        >
          Add person
        </Button>
      </div>
    </Card>
  )
}

// ---- 4. savings ---------------------------------------------------------------

function SavingsStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const month = useQuery({ queryKey: ['setup-month', ctx.monthId], queryFn: () => api.month(ctx.monthId) })
  const income = useQuery({ queryKey: ['setup-income', ctx.monthId], queryFn: () => api.income(ctx.monthId) })
  const order = useQuery({ queryKey: ['setup-order'], queryFn: api.splitOrder })
  if (!month.data || !income.data) return <p className="text-slate-500">Loading…</p>
  const core = month.data.lines.find((l) => l.is_core)
  const sources = income.data.sources.filter((s) => s.active)
  const chosen = order.data?.order ?? 'bills_first'

  async function addCore() {
    const group = await sectionFor(ctx.meta, 'KES', 'Savings')
    const line = await api.createLine(ctx.monthId, { group_id: group.id, name: 'Core saving', currency_code: 'KES', kind: 'saving', line_type: 'fixed', priority: 'essential' })
    await api.updateLine(line.id, { is_core: true })
  }

  return (
    <div className="space-y-4">
      <Intro>The app saves for you in two ways, so saving does not depend on what happens to be left over.</Intro>

      <Card className="p-4">
        <h2 className="font-semibold text-brand-900">1. Core saving</h2>
        <p className="mb-3 text-sm text-slate-600">
          One fixed amount you save every month, whatever happens. It is taken from regular income only, and the app
          asks for a reason if you ever lower it. Leave it at 0 if you are not ready for one.
        </p>
        {core ? (
          <div className="flex items-center gap-2 text-sm">
            <Field
              ariaLabel="Core saving amount"
              numeric
              className="w-32"
              value={core.planned}
              onCommit={(v) =>
                ctx.run(() => api.updateLine(core.id, { planned: v, ...(Number(v) < Number(core.planned) ? { reason: 'Changed during set-up' } : {}) }))
              }
            />
            <span className="font-semibold">{ccy(core.currency_code)} every month</span>
            {core.currency_code !== 'NTD' && Number(core.planned) > 0 && (
              <span className="num text-slate-500">≈ {money(Number(core.planned) / ctx.rate, 'NTD')}</span>
            )}
          </div>
        ) : (
          <Button variant="ghost" onClick={() => void ctx.run(addCore)}>
            Add a core saving
          </Button>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-brand-900">2. A share of every payment</h2>
        <p className="mb-3 text-sm text-slate-600">
          On top of the core saving, a percentage of each payment can be saved. This is what later feeds your
          projects. Type 0 for a source you do not want to save from.
        </p>
        <div className="space-y-2">
          {sources.map((s) =>
            s.rule_type === 'percent_first' || s.rule_type === 'none' ? (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <Field
                  ariaLabel={`Percent saved from ${s.name}`}
                  numeric
                  className="w-20"
                  value={s.rule_type === 'none' ? 0 : s.save_percent}
                  onCommit={(v) => ctx.run(() => api.updateSource(s.id, { rule_type: 'percent_first', save_percent: v }))}
                />
                <span className="w-16 text-slate-600">% saved</span>
              </div>
            ) : (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="text-slate-500">has its own rule, set in Settings</span>
              </div>
            ),
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-brand-900">3. What gets paid first</h2>
        <p className="mb-3 text-sm text-slate-600">When a payment is not enough for everything, which comes first?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['bills_first', 'Bills first', 'Every bill is paid first. Then the core saving, extra savings and projects.'],
              ['savings_first', 'Savings first', 'Each payment puts savings aside first, then pays bills and projects.'],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className={'flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ' + (chosen === value ? 'border-brand-600 bg-brand-50' : 'border-slate-200')}
            >
              <input type="radio" name="split-order" className="mt-1 accent-brand-700" checked={chosen === value} onChange={() => void ctx.run(() => api.setSplitOrder(value))} />
              <span>
                <strong className="block text-brand-900">{title}</strong>
                <span className="text-slate-600">{text}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ---- 5. projects and goals ------------------------------------------------------

function GoalsStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const query = useQuery({ queryKey: ['setup-goals', ctx.monthId], queryFn: () => api.goals(ctx.monthId) })
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [monthly, setMonthly] = useState('')
  const [currency, setCurrency] = useState('KES')
  if (!query.data) return <p className="text-slate-500">Loading…</p>
  const goals = query.data.goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled')

  /** A project is funded through a line in the plan that is linked to it. */
  async function linkLine(goal: { id: number; name: string; currency_code: string }, amount: string) {
    const group = await sectionFor(ctx.meta, goal.currency_code, 'Savings')
    await api.createLine(ctx.monthId, { group_id: group.id, name: goal.name, currency_code: goal.currency_code, kind: 'saving', line_type: 'fixed', priority: 'flexible', planned: amount, goal_id: goal.id })
  }

  async function add() {
    const amount = monthly.replace(/,/g, '').trim() || '0'
    const before = new Set(query.data!.goals.map((g) => g.id))
    const view = await api.createGoal(ctx.monthId, { name: name.trim(), kind: 'project', currency_code: currency, target: target.replace(/,/g, '').trim() || '0', monthly_amount: amount, status: 'active' })
    const made = view.goals.find((g) => !before.has(g.id))
    if (made && Number(amount) > 0) await linkLine(made, amount)
    setName('')
    setTarget('')
    setMonthly('')
  }

  async function setMonthlyFor(g: Goal, amount: string) {
    await api.updateGoal(ctx.monthId, g.id, { monthly_amount: amount })
    if (g.lines.length > 0) await api.updateLine(g.lines[0].line_id, { planned: amount })
    else if (Number(amount) > 0) await linkLine(g, amount)
  }

  async function remove(g: Goal) {
    for (const l of g.lines) await api.deleteLine(l.line_id)
    await api.deleteGoal(ctx.monthId, g.id)
  }

  return (
    <div>
      <Intro>
        Is there something bigger you are building toward: land, a house, school fees, an emergency fund, a laptop?
        Add each one with what it costs and what you can put in every month. The monthly amount becomes a line in
        your plan, and the app shows how far along you are and when you will get there. Skip this step if you have
        none yet.
      </Intro>
      <div className="space-y-3">
        {goals.map((g) => (
          <Card key={g.id} className="p-3">
            <div className="flex items-start gap-2">
              <Labeled label="Project or goal" className="flex-1">
                <Field ariaLabel={`Name of ${g.name}`} value={g.name} onCommit={(v) => ctx.run(() => api.updateGoal(ctx.monthId, g.id, { name: v }))} className="w-full font-semibold" />
              </Labeled>
              <Remove
                label={`Remove ${g.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${g.name}?`)) void ctx.run(() => remove(g))
                }}
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Labeled label={`Cost (${ccy(g.currency_code)})`}>
                <Field ariaLabel={`Cost of ${g.name}`} numeric value={g.target} onCommit={(v) => ctx.run(() => api.updateGoal(ctx.monthId, g.id, { target: v }))} />
              </Labeled>
              <Labeled label="Saved already">
                <Field ariaLabel={`Already saved for ${g.name}`} numeric value={g.opening_amount} onCommit={(v) => ctx.run(() => api.updateGoal(ctx.monthId, g.id, { opening_amount: v }))} />
              </Labeled>
              <Labeled label="Each month">
                <Field ariaLabel={`Monthly amount for ${g.name}`} numeric value={g.lines.length > 0 ? g.lines[0].planned : g.monthly_amount} onCommit={(v) => ctx.run(() => setMonthlyFor(g, v))} />
              </Labeled>
            </div>
            {g.months_left !== null && Number(g.needed) > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {money(g.needed, g.currency_code)} still needed · about {g.months_left} month{g.months_left === 1 ? '' : 's'} at this pace
              </p>
            )}
          </Card>
        ))}
        {goals.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
      </div>
      <Card className="mt-3 p-3">
        <p className="mb-2 text-sm font-semibold text-brand-900">Add a project or goal</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto_auto] sm:items-end">
          <Labeled label="Name" className="col-span-2 sm:col-span-1">
            <input aria-label="New project name" className={box + ' w-full'} placeholder="e.g. Emergency fund" value={name} onChange={(e) => setName(e.target.value)} />
          </Labeled>
          <Labeled label="Cost">
            <input aria-label="New project cost" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="0" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Labeled>
          <Labeled label="Each month">
            <input aria-label="New project monthly amount" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Labeled>
          <Select ariaLabel="Currency of the new project" className="py-1.5" value={currency} onChange={setCurrency} options={currencyOptions(ctx.meta)} />
          <Button variant="ghost" disabled={!name.trim()} onClick={() => void ctx.run(add)}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---- 6. debts -----------------------------------------------------------------

function DebtsStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const query = useQuery({ queryKey: ['setup-debts', ctx.monthId], queryFn: () => api.debts(ctx.monthId) })
  const [lender, setLender] = useState('')
  const [owed, setOwed] = useState('')
  const [monthly, setMonthly] = useState('')
  const [currency, setCurrency] = useState('KES')
  if (!query.data) return <p className="text-slate-500">Loading…</p>
  const debts = query.data.debts.filter((d) => d.status === 'open')

  /** A debt is paid down through a repayment line in the plan that is linked to it. */
  async function linkLine(debt: { id: number; lender: string; currency_code: string }, amount: string) {
    const group = await sectionFor(ctx.meta, debt.currency_code, 'Debts')
    await api.createLine(ctx.monthId, { group_id: group.id, name: `Repay ${debt.lender}`, currency_code: debt.currency_code, kind: 'debt_repayment', line_type: 'fixed', priority: 'essential', planned: amount, debt_id: debt.id })
  }

  async function add() {
    const amount = monthly.replace(/,/g, '').trim() || '0'
    const before = new Set(query.data!.debts.map((d) => d.id))
    const view = await api.createDebt(ctx.monthId, { lender: lender.trim(), currency_code: currency, starting_balance: owed.replace(/,/g, '').trim() || '0', monthly_repayment: amount })
    const made = view.debts.find((d) => !before.has(d.id))
    if (made && Number(amount) > 0) await linkLine(made, amount)
    setLender('')
    setOwed('')
    setMonthly('')
  }

  async function setMonthlyFor(d: Debt, amount: string) {
    await api.updateDebt(ctx.monthId, d.id, { monthly_repayment: amount })
    if (d.lines.length > 0) await api.updateLine(d.lines[0].line_id, { planned: amount })
    else if (Number(amount) > 0) await linkLine(d, amount)
  }

  async function remove(d: Debt) {
    for (const l of d.lines) await api.deleteLine(l.line_id)
    await api.deleteDebt(ctx.monthId, d.id)
  }

  return (
    <div>
      <Intro>
        Do you owe anyone money: a loan, a lender app, a friend, a shop? List each one with what you still owe and
        what you repay every month. The repayment becomes an essential line in your plan, and the app shows when
        the debt will be cleared. Skip this step if you owe nothing.
      </Intro>
      <div className="space-y-3">
        {debts.map((d) => (
          <Card key={d.id} className="p-3">
            <div className="flex items-start gap-2">
              <Labeled label="Owed to" className="flex-1">
                <Field ariaLabel={`Name of lender ${d.lender}`} value={d.lender} onCommit={(v) => ctx.run(() => api.updateDebt(ctx.monthId, d.id, { lender: v }))} className="w-full font-semibold" />
              </Labeled>
              <Remove
                label={`Remove the debt to ${d.lender}`}
                onClick={() => {
                  if (window.confirm(`Remove the debt to ${d.lender}?`)) void ctx.run(() => remove(d))
                }}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Labeled label={`Still owed (${ccy(d.currency_code)})`}>
                <Field ariaLabel={`Amount owed to ${d.lender}`} numeric value={d.starting_balance} onCommit={(v) => ctx.run(() => api.updateDebt(ctx.monthId, d.id, { starting_balance: v }))} />
              </Labeled>
              <Labeled label="Repaid each month">
                <Field ariaLabel={`Monthly repayment to ${d.lender}`} numeric value={d.lines.length > 0 ? d.lines[0].planned : d.monthly_repayment} onCommit={(v) => ctx.run(() => setMonthlyFor(d, v))} />
              </Labeled>
            </div>
            {d.months_left !== null && (
              <p className="mt-2 text-xs text-slate-500">
                Cleared in about {d.months_left} month{d.months_left === 1 ? '' : 's'} at this pace
              </p>
            )}
          </Card>
        ))}
        {debts.length === 0 && <p className="text-sm text-slate-500">No debts listed.</p>}
      </div>
      <Card className="mt-3 p-3">
        <p className="mb-2 text-sm font-semibold text-brand-900">Add a debt</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto_auto] sm:items-end">
          <Labeled label="Owed to" className="col-span-2 sm:col-span-1">
            <input aria-label="New debt lender" className={box + ' w-full'} placeholder="e.g. Bank loan" value={lender} onChange={(e) => setLender(e.target.value)} />
          </Labeled>
          <Labeled label="Still owed">
            <input aria-label="New debt amount owed" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="0" value={owed} onChange={(e) => setOwed(e.target.value)} />
          </Labeled>
          <Labeled label="Each month">
            <input aria-label="New debt monthly repayment" className={box + ' num w-full text-right'} inputMode="decimal" placeholder="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Labeled>
          <Select ariaLabel="Currency of the new debt" className="py-1.5" value={currency} onChange={setCurrency} options={currencyOptions(ctx.meta)} />
          <Button variant="ghost" disabled={!lender.trim()} onClick={() => void ctx.run(add)}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---- 7. accounts --------------------------------------------------------------

function AccountsStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('NTD')
  const [kind, setKind] = useState('bank')
  const accounts = ctx.meta.accounts.filter((a) => a.active)
  return (
    <div>
      <Intro>
        Where is your money held: bank accounts, mobile money, a savings account, a savings group? At the end of each month you
        type the real balance of each one, and the app checks it against what it expected. That is how you catch
        spending that was never recorded.
      </Intro>
      <Card className="divide-y divide-slate-100">
        {accounts.map((a) => (
          <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <Field ariaLabel={`Name of ${a.name}`} value={a.name} onCommit={(v) => ctx.run(() => api.updateAccount(a.id, { name: v }))} />
            <Select ariaLabel={`Currency of ${a.name}`} className="py-1.5" value={a.currency_code} onChange={(v) => void ctx.run(() => api.updateAccount(a.id, { currency_code: v }))} options={currencyOptions(ctx.meta)} />
            <Select ariaLabel={`Kind of ${a.name}`} className="py-1.5" value={a.kind} onChange={(v) => void ctx.run(() => api.updateAccount(a.id, { kind: v }))} options={ACCOUNT_KINDS} />
            <Remove label={`Remove ${a.name}`} onClick={() => void ctx.run(() => api.deleteAccount(a.id))} />
          </div>
        ))}
        {accounts.length === 0 && <p className="p-3 text-sm text-amber-800">Add at least one account.</p>}
      </Card>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Labeled label="Another account" className="flex-1 basis-40">
          <input aria-label="New account" className={box + ' w-full'} placeholder="e.g. Post office savings" value={name} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Select ariaLabel="Currency of the new account" className="py-1.5" value={currency} onChange={setCurrency} options={currencyOptions(ctx.meta)} />
        <Select ariaLabel="Kind of the new account" className="py-1.5" value={kind} onChange={setKind} options={ACCOUNT_KINDS} />
        <Button
          variant="ghost"
          disabled={!name.trim()}
          onClick={() =>
            void ctx.run(async () => {
              await api.createAccount({ name: name.trim(), currency_code: currency, kind })
              setName('')
            })
          }
        >
          Add account
        </Button>
      </div>
    </div>
  )
}

// ---- 8. check and finish ---------------------------------------------------------

function FinishStep(props: { ctx: Ctx }) {
  const { ctx } = props
  const income = useQuery({ queryKey: ['setup-income', ctx.monthId], queryFn: () => api.income(ctx.monthId) })
  const month = useQuery({ queryKey: ['setup-month', ctx.monthId], queryFn: () => api.month(ctx.monthId) })
  const goals = useQuery({ queryKey: ['setup-goals', ctx.monthId], queryFn: () => api.goals(ctx.monthId) })
  const debts = useQuery({ queryKey: ['setup-debts', ctx.monthId], queryFn: () => api.debts(ctx.monthId) })
  if (!income.data || !month.data || !goals.data || !debts.data) return <p className="text-slate-500">Loading…</p>

  const fit = income.data.fit
  const reliable = Number(fit.reliable.NTD)
  const plan = Number(fit.plan.NTD)
  const lines = month.data.lines
  const core = lines.find((l) => l.is_core)
  const empty = lines.filter((l) => Number(l.planned) === 0 && !l.is_core)
  const homeSections = ctx.meta.locations
    .filter((l) => l.default_currency === 'KES')
    .flatMap((l) => l.groups)
    .filter((g) => lines.some((l) => l.group_id === g.id && Number(l.planned) > 0))
  const noRecipient = homeSections.filter((g) => g.usual_recipient_id === null)
  const openGoals = goals.data.goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled')
  const openDebts = debts.data.debts.filter((d) => d.status === 'open')

  // Things the app cannot work without come first; the rest are reminders.
  const gaps: { must: boolean; text: string }[] = []
  if (reliable === 0) gaps.push({ must: true, text: 'No regular income is expected yet. Go back to "Your income" and type what you expect.' })
  if (plan === 0) gaps.push({ must: true, text: 'Nothing is budgeted yet. Go back to the spending steps and type an amount for each line.' })
  if (reliable > 0 && !fit.fits)
    gaps.push({ must: true, text: `Your plan is ${money(fit.gap_ntd, 'NTD')} larger than your regular income. Lower some flexible lines, or the month cannot be started.` })
  if (noRecipient.length > 0)
    gaps.push({ must: false, text: `No one is chosen to receive: ${noRecipient.map((g) => g.name).join(', ')}.` })
  if (core && Number(core.planned) === 0) gaps.push({ must: false, text: 'Your core saving is 0. You can set one at any time on the Month plan.' })
  if (empty.length > 0)
    gaps.push({ must: false, text: `${empty.length} line${empty.length === 1 ? ' has' : 's have'} no budget: ${empty.slice(0, 4).map((l) => l.name).join(', ')}${empty.length > 4 ? '…' : ''}. Remove them or give them an amount.` })
  if (ctx.meta.accounts.filter((a) => a.active).length === 0) gaps.push({ must: false, text: 'No accounts are listed, so the month-end balance check has nothing to compare.' })

  const rows: [string, string][] = [
    ['Regular income expected', money(reliable, 'NTD')],
    ['Planned for the month', money(plan, 'NTD')],
    [fit.fits ? 'Room left' : 'Short by', money(Math.abs(reliable - plan), 'NTD')],
    ['Core saving', core ? money(core.planned, core.currency_code) : 'None'],
    ['Projects and goals', String(openGoals.length)],
    ['Debts', String(openDebts.length)],
    ['Exchange rate', `1 ${ccy('NTD')} = ${ctx.rate} ${ccy('KES')}`],
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-2 font-semibold text-brand-900">Your month at a glance</h2>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-600">{label}</dt>
              <dd className={'num text-right font-semibold ' + (label === 'Short by' ? 'text-red-700' : 'text-brand-900')}>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold text-brand-900">{gaps.length === 0 ? 'Everything the app needs is in place ✓' : 'Still to sort out'}</h2>
        {gaps.length === 0 ? (
          <p className="text-sm text-slate-600">Your plan fits your regular income and nothing is missing.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {gaps.map((g) => (
              <li key={g.text} className={'rounded-lg border px-3 py-2 ' + (g.must ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700')}>
                {g.text}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold text-brand-900">What happens next</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>When money arrives, open <strong>Income</strong> and add the payment. The app shares it out for you.</li>
          <li>When you send money home, record it on <strong>{places().home} sends</strong>.</li>
          <li>The <strong>Dashboard</strong> shows where the month stands at any moment.</li>
          <li>At the end of the month, open <strong>Review</strong>, type your balances and close the month.</li>
        </ol>
        <p className="mt-2 text-sm text-slate-600">You can finish now and fix anything later on the Month plan and in Settings.</p>
      </Card>
    </div>
  )
}
