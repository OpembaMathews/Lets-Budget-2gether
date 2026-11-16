// Sign in, or create the password the first time.
import { useState } from 'react'
import { api } from './api'

export default function Login(props: { setUp: boolean; minLength: number; onSignedIn: () => void }) {
  const { setUp, minLength, onSignedIn } = props
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [remember, setRemember] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const creating = !setUp
  const tooShort = creating && password.length > 0 && password.length < minLength
  const mismatch = creating && repeat.length > 0 && repeat !== password
  const valid = creating ? password.length >= minLength && repeat === password : password.length > 0

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setProblem(null)
    try {
      if (creating) await api.authSetup(password, remember)
      else await api.authLogin(password, remember)
      onSignedIn()
    } catch (e) {
      setProblem((e as Error).message)
      setPassword('')
      setRepeat('')
    } finally {
      setBusy(false)
    }
  }

  const box =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
  return (
    <div className="flex min-h-full items-center justify-center bg-brand-900 px-4 py-10">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-leaf text-lg font-black text-brand-950">B</span>
          <div>
            <p className="text-lg font-bold leading-tight text-brand-900">Budget Track</p>
            <p className="text-xs text-slate-500">Plan · Save first · Review</p>
          </div>
        </div>

        <h1 className="text-xl font-bold text-brand-900">{creating ? 'Create your password' : 'Sign in'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {creating
            ? `Choose a password of at least ${minLength} characters. You will use it to open the app.`
            : 'Enter your password to open your budget.'}
        </p>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Password</span>
          <input
            aria-label="Password"
            type="password"
            autoFocus
            autoComplete={creating ? 'new-password' : 'current-password'}
            className={box}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {tooShort && <p className="mt-1 text-xs text-amber-800">At least {minLength} characters.</p>}

        {creating && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Type it again</span>
            <input
              aria-label="Repeat password"
              type="password"
              autoComplete="new-password"
              className={box}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
        )}
        {mismatch && <p className="mt-1 text-xs text-amber-800">The two passwords are not the same.</p>}

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this computer for 30 days
        </label>

        {problem && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{problem}</p>}

        <button
          type="submit"
          disabled={!valid || busy}
          className="mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Please wait…' : creating ? 'Create password and open' : 'Sign in'}
        </button>
        {!creating && (
          <p className="mt-4 text-xs text-slate-500">
            Forgot it? On this computer, run <code className="rounded bg-slate-100 px-1">python -m app.reset_password</code> in
            the backend folder, then create a new one. Your budget is not affected.
          </p>
        )}
      </form>
    </div>
  )
}
