import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, applyProfile, ccy, MONTH_NAMES, monthLabel, places } from './api'
import type { MonthSummary, SignedInUser } from './api'
import Dashboard from './Dashboard'
import Debts from './Debts'
import Goals from './Goals'
import History from './History'
import Income from './Income'
import Login from './Login'
import MonthPlan from './MonthPlan'
import Review from './Review'
import Sends from './Sends'
import Settings from './Settings'
import Setup from './Setup'
import { Button, ErrorBanner, Select } from './ui'

type Page = 'dashboard' | 'plan' | 'income' | 'sends' | 'goals' | 'debts' | 'review' | 'history' | 'settings'

const PAGES: [Page, string][] = [
  ['dashboard', 'Dashboard'],
  ['plan', 'Month plan'],
  ['income', 'Income'],
  ['sends', 'Kenya sends'],
  ['goals', 'Projects & goals'],
  ['debts', 'Debts'],
  ['review', 'Review'],
  ['history', 'History'],
  ['settings', 'Settings'],
]


export default function App() {
  const qc = useQueryClient()
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus, retry: false })

  /** Forget everything loaded for the old session, then ask whether we are signed in now. */
  async function refreshSession() {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    await qc.refetchQueries({ queryKey: ['auth'] })
  }

  useEffect(() => {
    const signedOut = () => void qc.invalidateQueries({ queryKey: ['auth'] })
    window.addEventListener('budget-signed-out', signedOut)
    return () => window.removeEventListener('budget-signed-out', signedOut)
  }, [qc])

  if (auth.isLoading) return <p className="p-6 text-slate-500">Opening…</p>
  if (auth.isError || !auth.data)
    return <p className="p-6 text-red-700">The app cannot reach its backend. Start the Python server on port 8000, then reload.</p>
  if (!auth.data.signed_in || !auth.data.user)
    return (
      <Login
        setUp={auth.data.set_up}
        minLength={auth.data.min_length}
        onSignedIn={() => void refreshSession()}
      />
    )
  return (
    <SignedInApp
      user={auth.data.user}
      onSignOut={async () => {
        await api.authLogout()
        await refreshSession()
      }}
    />
  )
}

function SignedInApp(props: { user: SignedInUser; onSignOut: () => Promise<void> }) {
  const [page, setPage] = useState<Page>('dashboard')
  const [chosenMonth, setChosenMonth] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // On a phone the list of screens is folded away behind a Menu button.
  const [menuOpen, setMenuOpen] = useState(false)

  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta })
  // Before anything is drawn: what this budget's two currencies and countries are called.
  applyProfile(meta.data?.profile)
  const pages = PAGES.map(([key, label]): [Page, string] => [key, key === 'sends' ? `${places().home} sends` : label])
  const months = useQuery({ queryKey: ['months'], queryFn: api.months })

  const list = months.data ?? []
  // Open on the month we are in. Failing that, the latest month that has started, then the newest one.
  const now = new Date()
  const thisMonth = list.find((m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1)
  const pastOrCurrent = list.find((m) => m.year * 12 + m.month <= now.getFullYear() * 12 + now.getMonth() + 1)
  const defaultMonth = thisMonth ?? pastOrCurrent ?? list[list.length - 1]
  const monthId =
    chosenMonth !== null && list.some((m) => m.id === chosenMonth) ? chosenMonth : (defaultMonth?.id ?? null)
  const offline = meta.isError || months.isError
  const month = list.find((m) => m.id === monthId)

  // A new account goes through the set-up guide before it sees the app.
  const setup = useQuery({ queryKey: ['setup'], queryFn: api.setup })
  if (setup.isLoading) return <p className="p-6 text-slate-500">Opening…</p>
  if (setup.data?.pending && meta.data && month)
    return <Setup month={month} meta={meta.data} username={props.user.username} onSignOut={() => void props.onSignOut()} />

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="sticky top-0 z-10 flex shrink-0 flex-col bg-brand-900 text-white lg:static lg:min-h-screen lg:w-60">
        <div className="flex items-center justify-between gap-3 border-b border-brand-800 px-4 py-2.5 lg:px-5 lg:py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-leaf text-lg font-black text-brand-950">
              2
            </span>
            <div>
              <p className="text-lg font-bold leading-tight">Budget 2gether</p>
              <p className="hidden text-xs text-brand-300 lg:block">Plan · Save first · Review</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg bg-brand-800 px-3 py-2 text-sm font-semibold lg:hidden"
          >
            {menuOpen ? 'Close' : pages.find(([key]) => key === page)?.[1]}
            <span aria-hidden className="text-base leading-none">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
        <nav className={(menuOpen ? 'flex' : 'hidden') + ' max-h-[calc(100dvh-58px)] flex-col gap-1 overflow-y-auto p-3 lg:flex lg:max-h-none'}>
          {pages.map(([key, label]) => (
            <NavItem
              key={key}
              label={label}
              active={page === key}
              onClick={() => {
                setPage(key)
                setMenuOpen(false)
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => void props.onSignOut()}
            className="rounded-lg px-3 py-3 text-left text-sm font-semibold text-brand-300 transition hover:bg-brand-800 hover:text-white lg:py-2"
          >
            Sign out <span className="font-normal">({props.user.username})</span>
          </button>
        </nav>
        <p className="mt-auto hidden px-5 py-4 text-xs text-brand-300/80 lg:block">Your data stays on this computer.</p>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ErrorBanner message={error} onClose={() => setError(null)} />

          {offline && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              The app cannot reach its backend. Start the Python server on port 8000, then reload this page.
            </div>
          )}

          {!offline && page !== 'settings' && (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                {list.length > 0 && monthId !== null && (
                  <Select
                    ariaLabel="Choose a month"
                    className="py-2 font-semibold"
                    value={String(monthId)}
                    onChange={(v) => setChosenMonth(Number(v))}
                    options={list.map((m) => ({ value: String(m.id), label: monthLabel(m) }))}
                  />
                )}
                <Button onClick={() => setCreating(true)}>+ New month</Button>
              </div>
              {page === 'plan' && meta.data && monthId !== null && (
                <MonthPlan monthId={monthId} meta={meta.data} onError={setError} />
              )}
              {page === 'dashboard' && meta.data && month && (
                <Dashboard month={month} meta={meta.data} onError={setError} onAddIncome={() => setPage('income')} />
              )}
              {page === 'income' && month && <Income month={month} onError={setError} />}
              {page === 'sends' && month && <Sends month={month} onError={setError} />}
              {page === 'goals' && month && meta.data && <Goals month={month} meta={meta.data} onError={setError} />}
              {page === 'debts' && month && meta.data && <Debts month={month} meta={meta.data} onError={setError} />}
              {page === 'review' && month && <Review month={month} onError={setError} />}
              {page === 'history' && (
                <History
                  onOpenMonth={(id) => {
                    setChosenMonth(id)
                    setPage('plan')
                  }}
                />
              )}
              {months.isSuccess && list.length === 0 && (
                <p className="text-slate-600">No months yet. Create your first month to start planning.</p>
              )}
            </>
          )}

          {!offline && page === 'settings' && meta.data && <Settings meta={meta.data} user={props.user} onError={setError} />}
        </div>
      </main>

      {creating && (
        <NewMonthDialog
          months={list}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setChosenMonth(id)
            setPage('plan')
          }}
        />
      )}
    </div>
  )
}

function NavItem(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        'rounded-lg px-3 py-3 text-left text-sm font-semibold transition lg:py-2 ' +
        (props.active ? 'bg-brand-700 text-white' : 'text-brand-100 hover:bg-brand-800')
      }
    >
      {props.label}
    </button>
  )
}

function NewMonthDialog(props: { months: MonthSummary[]; onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient()
  const latest = props.months[0]
  const now = new Date()
  const startYear = latest ? (latest.month === 12 ? latest.year + 1 : latest.year) : now.getFullYear()
  const startMonth = latest ? (latest.month === 12 ? 1 : latest.month + 1) : now.getMonth() + 1

  const [year, setYear] = useState(String(startYear))
  const [month, setMonth] = useState(String(startMonth))
  const [copy, setCopy] = useState(true)
  const [rate, setRate] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setProblem(null)
    try {
      const created = await api.createMonth({
        year: Number(year),
        month: Number(month),
        copy_previous: copy,
        ...(rate.trim() ? { fx_rate_ntd_kes: rate.trim() } : {}),
      })
      await qc.invalidateQueries()
      props.onCreated(created.id)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const box =
    'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-brand-950/50 p-4" onClick={props.onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-brand-900">Open a new month</h2>
        <p className="mt-1 text-sm text-slate-600">
          Fixed lines are copied as they are. Variable lines are copied as suggestions for you to check. One-off lines
          are left behind.
        </p>
        <div className="mt-4 flex gap-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Month</span>
            <Select
              ariaLabel="Month"
              className="w-full py-1.5"
              value={month}
              onChange={setMonth}
              options={MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))}
            />
          </label>
          <label className="w-28 text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Year</span>
            <input aria-label="Year" className={box + ' w-full'} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-brand-700" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Copy the plan from the month before
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Rate: 1 {ccy('NTD')} in {ccy('KES')} (optional)</span>
          <input
            aria-label="Exchange rate"
            className={box + ' w-32'}
            inputMode="decimal"
            placeholder={latest ? String(Number(latest.fx_rate_ntd_kes)) : '4.1'}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <span className="ml-2 text-slate-500">Leave empty to keep last month's rate.</span>
        </label>
        {problem && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{problem}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy}>
            {busy ? 'Opening…' : 'Open month'}
          </Button>
        </div>
      </div>
    </div>
  )
}
