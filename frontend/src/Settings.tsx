// Settings: locations and their sections, accounts, currencies.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from './api'
import type { Location, Meta, Recipient, Source, SplitOrder } from './api'
import { Button, Card, EditBox, Select } from './ui'

const ACCOUNT_KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'savings', label: 'Savings' },
  { value: 'chama', label: 'Chama' },
]

const box =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'

export default function Settings(props: { meta: Meta; onError: (message: string | null) => void }) {
  const { meta, onError } = props
  const qc = useQueryClient()
  const currencyOptions = meta.currencies.map((c) => ({ value: c.code, label: c.code }))
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients }).data ?? []

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Locations, sections and accounts are shared by every month. Click a name to rename it.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-brand-900">Locations and sections</h2>
        <p className="mb-4 text-sm text-slate-600">
          A location is a place where money is spent. Each one holds the sections your budget lines sit in.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {meta.locations.map((location) => (
            <LocationCard key={location.id} location={location} currencyOptions={currencyOptions} recipients={recipients} run={run} />
          ))}
        </div>
        <AddLocation currencyOptions={currencyOptions} run={run} />
      </Card>

      <SplitOrderCard run={run} />

      <PasswordCard />

      <IncomeSources currencyOptions={currencyOptions} run={run} />

      <Recipients run={run} />

      <Card className="p-5">
        <h2 className="text-lg font-bold text-brand-900">Accounts</h2>
        <p className="mb-4 text-sm text-slate-600">
          Where your money is held. These are used later for the month-end balance check and as savings destinations.
        </p>
        <div className="divide-y divide-slate-100">
          {meta.accounts.map((account) => (
            <div key={account.id} className="grid grid-cols-[minmax(160px,1fr)_90px_150px_90px_40px] items-center gap-2 py-1.5 text-sm">
              <EditBox
                ariaLabel="Account name"
                value={account.name}
                className="font-medium"
                onCommit={(v) => run(() => api.updateAccount(account.id, { name: v }))}
              />
              <Select
                ariaLabel="Account currency"
                value={account.currency_code}
                options={currencyOptions}
                onChange={(v) => run(() => api.updateAccount(account.id, { currency_code: v }))}
              />
              <Select
                ariaLabel="Account kind"
                value={account.kind}
                options={ACCOUNT_KINDS}
                onChange={(v) => run(() => api.updateAccount(account.id, { kind: v }))}
              />
              <label className="flex items-center gap-1.5 text-slate-600">
                <input
                  type="checkbox"
                  className="accent-brand-700"
                  checked={account.active}
                  onChange={(e) => run(() => api.updateAccount(account.id, { active: e.target.checked }))}
                />
                In use
              </label>
              <button
                type="button"
                title="Remove this account"
                className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                onClick={() => {
                  if (window.confirm(`Remove the account "${account.name}"?`)) void run(() => api.deleteAccount(account.id))
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <AddAccount currencyOptions={currencyOptions} run={run} />
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-brand-900">Currencies</h2>
        <p className="mb-3 text-sm text-slate-600">
          Each amount keeps its own currency. The exchange rate is set per month on the plan screen.
        </p>
        <div className="flex flex-wrap gap-2">
          {meta.currencies.map((c) => (
            <span key={c.code} className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-900">
              <strong>{c.code}</strong> · {c.name}
            </span>
          ))}
        </div>
      </Card>
    </div>
  )
}

type Run = (action: () => Promise<unknown>) => Promise<void>
type Options = { value: string; label: string }[]

const RELIABILITY = [
  { value: 'regular', label: 'Regular' },
  { value: 'irregular', label: 'Irregular' },
]
const RULES = [
  { value: 'percent_first', label: 'Save a % first' },
  { value: 'fixed_first', label: 'Save a fixed amount first' },
  { value: 'three_way', label: 'Three-way split' },
  { value: 'none', label: 'No saving rule' },
]

function IncomeSources(props: { currencyOptions: Options; run: Run }) {
  const { currencyOptions, run } = props
  const query = useQuery({ queryKey: ['sources'], queryFn: api.sources })
  const sources = query.data ?? []
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(currencyOptions[0]?.value ?? 'KES')
  const num = (v: string | null) => (v === null ? '' : String(Number(v)))

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-brand-900">Income sources and saving rules</h2>
      <p className="mb-4 text-sm text-slate-600">
        Regular income counts toward covering your plan and pays the core saving. Irregular income never does. Each
        source has a rule for what is saved from every payment.
      </p>
      <div className="space-y-2">
        {sources.map((s) => {
          const save = (body: Partial<Source>) => run(() => api.updateSource(s.id, body))
          const field = 'flex items-center gap-1.5 text-xs text-slate-500'
          return (
            <div key={s.id} className={'rounded-lg border px-3 py-2 ' + (s.active ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50')}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[160px] flex-1">
                  <EditBox ariaLabel="Source name" value={s.name} className="font-semibold text-brand-900" onCommit={(v) => save({ name: v })} />
                </div>
                <Select ariaLabel="Source currency" value={s.currency_code} options={currencyOptions} onChange={(v) => save({ currency_code: v })} />
                <Select ariaLabel="Regular or irregular" value={s.reliability} options={RELIABILITY} onChange={(v) => save({ reliability: v as Source['reliability'] })} />
                <label className={field}>
                  Pay day
                  <span className="w-12">
                    <EditBox
                      ariaLabel="Usual pay day"
                      numeric
                      value={s.usual_day ? String(s.usual_day) : ''}
                      placeholder="–"
                      onCommit={(v) => save({ usual_day: Math.round(Number(v)) })}
                      className="border-slate-300"
                    />
                  </span>
                </label>
                <label className={field}>
                  <input type="checkbox" className="accent-brand-700" checked={s.active} onChange={(e) => save({ active: e.target.checked })} />
                  In use
                </label>
                <button
                  type="button"
                  title="Remove this source"
                  className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    if (window.confirm(`Remove the income source "${s.name}"?`)) void run(() => api.deleteSource(s.id))
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saving rule</span>
                <Select ariaLabel="Saving rule" value={s.rule_type} options={RULES} onChange={(v) => save({ rule_type: v as Source['rule_type'] })} />
                {(s.rule_type === 'percent_first' || s.rule_type === 'three_way') && (
                  <label className={field}>
                    <span className="w-14">
                      <EditBox ariaLabel="Percent to save" numeric value={num(s.save_percent)} placeholder="0" onCommit={(v) => save({ save_percent: v })} className="border-slate-300" />
                    </span>
                    % saved
                  </label>
                )}
                {s.rule_type === 'three_way' && (
                  <label className={field}>
                    <span className="w-14">
                      <EditBox ariaLabel="Percent for bills" numeric value={num(s.obligations_percent)} placeholder="0" onCommit={(v) => save({ obligations_percent: v })} className="border-slate-300" />
                    </span>
                    % to bills, the rest personal
                  </label>
                )}
                {s.rule_type === 'fixed_first' && (
                  <label className={field}>
                    <span className="w-24">
                      <EditBox ariaLabel="Fixed amount to save" numeric value={num(s.save_fixed)} placeholder="0" onCommit={(v) => save({ save_fixed: v })} className="border-slate-300" />
                    </span>
                    {s.currency_code} saved from each payment
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed) return
          void run(() => api.createSource({ name: trimmed, currency_code: currency, save_percent: '20' })).then(() => setName(''))
        }}
      >
        <input aria-label="New income source" className={box + ' w-64'} placeholder="New income source" value={name} onChange={(e) => setName(e.target.value)} />
        <Select ariaLabel="New source currency" value={currency} options={currencyOptions} onChange={setCurrency} />
        <Button type="submit" disabled={!name.trim()}>
          Add source
        </Button>
      </form>
    </Card>
  )
}

function LocationCard(props: { location: Location; currencyOptions: Options; recipients: Recipient[]; run: Run }) {
  const { location, currencyOptions, recipients, run } = props
  const [newSection, setNewSection] = useState('')
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 rounded-t-lg bg-brand-50 px-3 py-2">
        <EditBox
          ariaLabel="Location name"
          value={location.name}
          className="font-bold text-brand-900"
          onCommit={(v) => run(() => api.updateLocation(location.id, { name: v }))}
        />
        <Select
          ariaLabel="Location currency"
          value={location.default_currency}
          options={currencyOptions}
          onChange={(v) => run(() => api.updateLocation(location.id, { default_currency: v }))}
        />
        <button
          type="button"
          title="Remove this location"
          className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
          onClick={() => {
            if (window.confirm(`Remove the location "${location.name}"?`)) void run(() => api.deleteLocation(location.id))
          }}
        >
          ✕
        </button>
      </div>
      <div className="divide-y divide-slate-100 px-3">
        {location.groups.map((group) => (
          <div key={group.id} className="flex items-center gap-2 py-1 text-sm">
            <EditBox
              ariaLabel="Section name"
              value={group.name}
              onCommit={(v) => run(() => api.updateGroup(group.id, { name: v }))}
            />
            {location.default_currency === 'KES' && (
              <select
                aria-label={`Usual recipient for ${group.name}`}
                title="Who money for this section is usually sent to"
                className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-brand-600"
                value={group.usual_recipient_id ?? ''}
                onChange={(e) =>
                  run(() => api.updateGroup(group.id, { usual_recipient_id: e.target.value ? Number(e.target.value) : null }))
                }
              >
                <option value="">No usual recipient</option>
                {recipients
                  .filter((r) => r.active || r.id === group.usual_recipient_id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      Sent to {r.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              title="Remove this section"
              className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                if (window.confirm(`Remove the section "${group.name}"?`)) void run(() => api.deleteGroup(group.id))
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          const name = newSection.trim()
          if (!name) return
          void run(() => api.createGroup({ name, location_id: location.id })).then(() => setNewSection(''))
        }}
      >
        <input
          aria-label={`New section in ${location.name}`}
          className={box + ' flex-1'}
          placeholder="Add a section…"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
        />
        <Button type="submit" variant="ghost" disabled={!newSection.trim()}>
          Add
        </Button>
      </form>
    </div>
  )
}

function AddLocation(props: { currencyOptions: Options; run: Run }) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(props.currencyOptions[0]?.value ?? 'KES')
  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        void props.run(() => api.createLocation({ name: trimmed, default_currency: currency })).then(() => setName(''))
      }}
    >
      <input
        aria-label="New location name"
        className={box + ' w-64'}
        placeholder="New location, e.g. Nairobi"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select ariaLabel="New location currency" value={currency} options={props.currencyOptions} onChange={setCurrency} />
      <Button type="submit" disabled={!name.trim()}>
        Add location
      </Button>
    </form>
  )
}

function AddAccount(props: { currencyOptions: Options; run: Run }) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(props.currencyOptions[0]?.value ?? 'KES')
  const [kind, setKind] = useState('bank')
  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        void props
          .run(() => api.createAccount({ name: trimmed, currency_code: currency, kind }))
          .then(() => setName(''))
      }}
    >
      <input
        aria-label="New account name"
        className={box + ' w-64'}
        placeholder="New account name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Select ariaLabel="New account currency" value={currency} options={props.currencyOptions} onChange={setCurrency} />
      <Select ariaLabel="New account kind" value={kind} options={ACCOUNT_KINDS} onChange={setKind} />
      <Button type="submit" disabled={!name.trim()}>
        Add account
      </Button>
    </form>
  )
}

function Recipients(props: { run: Run }) {
  const { run } = props
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients }).data ?? []
  const [name, setName] = useState('')
  const [method, setMethod] = useState('M-Pesa')
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-brand-900">Recipients in Kenya</h2>
      <p className="mb-4 text-sm text-slate-600">
        The people and payees you send money to. Each Kenya section can have a usual recipient, set above.
      </p>
      <div className="divide-y divide-slate-100">
        {recipients.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
            <div className="min-w-[140px] flex-1">
              <EditBox ariaLabel="Recipient name" value={r.name} className="font-medium" onCommit={(v) => run(() => api.updateRecipient(r.id, { name: v }))} />
            </div>
            <div className="w-36">
              <EditBox
                ariaLabel="Usual payment method"
                value={r.usual_method ?? ''}
                placeholder="Payment method"
                onCommit={(v) => run(() => api.updateRecipient(r.id, { usual_method: v }))}
                className="text-slate-600"
              />
            </div>
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                className="accent-brand-700"
                checked={r.active}
                onChange={(e) => run(() => api.updateRecipient(r.id, { active: e.target.checked }))}
              />
              In use
            </label>
            <button
              type="button"
              title="Remove this recipient"
              className="rounded-md px-1.5 py-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                if (window.confirm(`Remove the recipient "${r.name}"?`)) void run(() => api.deleteRecipient(r.id))
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed) return
          void run(() => api.createRecipient({ name: trimmed, usual_method: method.trim() || null })).then(() => setName(''))
        }}
      >
        <input aria-label="New recipient name" className={box + ' w-56'} placeholder="New recipient, e.g. Brother" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="New recipient payment method" className={box + ' w-36'} placeholder="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>
          Add recipient
        </Button>
      </form>
    </Card>
  )
}

function SplitOrderCard(props: { run: Run }) {
  const query = useQuery({ queryKey: ['split-order'], queryFn: api.splitOrder })
  const current = query.data?.order
  const options: { value: SplitOrder; title: string; text: string }[] = [
    {
      value: 'bills_first',
      title: 'Bills first',
      text: 'The first money in pays every KE and TW bill. Then the core saving, then extra savings, then projects in priority order.',
    },
    {
      value: 'savings_first',
      title: 'Savings first',
      text: 'Each payment puts the core saving and extra savings aside first, then pays bills, then projects.',
    },
  ]
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-brand-900">How each payment is shared out</h2>
      <p className="mb-3 text-sm text-slate-600">
        Changing this shares out the payments you have already recorded again, except splits you changed by hand.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={
              'flex cursor-pointer gap-3 rounded-lg border p-3 ' +
              (current === o.value ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')
            }
          >
            <input
              type="radio"
              name="split-order"
              className="mt-1 accent-brand-700"
              checked={current === o.value}
              onChange={() => props.run(() => api.setSplitOrder(o.value))}
            />
            <span>
              <span className="block font-semibold text-brand-900">{o.title}</span>
              <span className="text-sm text-slate-600">{o.text}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const valid = current.length > 0 && next.length >= 6 && next === repeat
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-brand-900">Password</h2>
      <p className="mb-3 text-sm text-slate-600">
        Change the password you sign in with. Other browsers that are signed in will be signed out.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          api
            .changePassword(current, next)
            .then(() => {
              setMessage({ ok: true, text: 'Password changed.' })
              setCurrent('')
              setNext('')
              setRepeat('')
            })
            .catch((err: Error) => setMessage({ ok: false, text: err.message }))
        }}
      >
        <input aria-label="Current password" type="password" autoComplete="current-password" className={box + ' w-48'} placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input aria-label="New password" type="password" autoComplete="new-password" className={box + ' w-48'} placeholder="New (6+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
        <input aria-label="Repeat new password" type="password" autoComplete="new-password" className={box + ' w-48'} placeholder="New again" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        <Button type="submit" disabled={!valid}>
          Change password
        </Button>
      </form>
      {next.length > 0 && repeat.length > 0 && next !== repeat && <p className="mt-2 text-xs text-amber-800">The new passwords are not the same.</p>}
      {message && <p className={'mt-2 text-sm ' + (message.ok ? 'text-brand-700' : 'text-red-700')}>{message.text}</p>}
    </Card>
  )
}
