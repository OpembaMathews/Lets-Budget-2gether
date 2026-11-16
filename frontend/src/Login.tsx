// Sign in to an account, or create a new one.
import { useState } from 'react'
import { api } from './api'

export default function Login(props: { setUp: boolean; minLength: number; onSignedIn: () => void }) {
  const { setUp, minLength, onSignedIn } = props
  // Until the first account exists there is nothing to sign in to.
  const [creating, setCreating] = useState(!setUp)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const name = username.trim()
  const badName = creating && name.length > 0 && !/^[a-z0-9][a-z0-9._-]{2,29}$/i.test(name)
  const tooShort = creating && password.length > 0 && password.length < minLength
  const valid = creating ? name.length > 0 && !badName && password.length >= minLength : name.length > 0 && password.length > 0

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setProblem(null)
    try {
      if (creating) await api.authSignup(name, password, remember)
      else await api.authLogin(name, password, remember)
      onSignedIn()
    } catch (e) {
      setProblem((e as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  function switchTo(create: boolean) {
    setCreating(create)
    setProblem(null)
    setPassword('')
  }

  const box =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
  const link = 'font-semibold text-brand-700 underline-offset-2 hover:underline'
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
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-leaf text-lg font-black text-brand-950">2</span>
          <div>
            <p className="text-lg font-bold leading-tight text-brand-900">Lets Budget 2gether</p>
            <p className="text-xs text-slate-500">Plan · Save first · Review</p>
          </div>
        </div>

        <h1 className="text-xl font-bold text-brand-900">{creating ? 'Create your account' : 'Sign in'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {creating
            ? 'You get your own budget, filled with sample figures you can change to yours.'
            : 'Enter your username and password to open your budget.'}
        </p>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-semibold text-slate-700">Username</span>
          <input
            aria-label="Username"
            type="text"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            className={box}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        {badName && (
          <p className="mt-1 text-xs text-amber-800">3 to 30 letters, numbers, dots, dashes or underscores. No spaces.</p>
        )}

        <label className="mt-3 block text-sm">
          <span className="mb-1 flex items-baseline justify-between font-semibold text-slate-700">
            Password
            <button type="button" className={'text-xs ' + link} onClick={() => setShow(!show)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
          <input
            aria-label="Password"
            type={show ? 'text' : 'password'}
            autoComplete={creating ? 'new-password' : 'current-password'}
            className={box}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {creating && (
          <p className={'mt-1 text-xs ' + (tooShort ? 'text-amber-800' : 'text-slate-500')}>At least {minLength} characters.</p>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device for 30 days
        </label>

        {problem && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{problem}</p>}

        <button
          type="submit"
          disabled={!valid || busy}
          className="mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Please wait…' : creating ? 'Create account and open' : 'Sign in'}
        </button>

        <p className="mt-4 text-sm text-slate-600">
          {creating ? (
            setUp && (
              <>
                Already have an account?{' '}
                <button type="button" className={link} onClick={() => switchTo(false)}>
                  Sign in
                </button>
              </>
            )
          ) : (
            <>
              New here?{' '}
              <button type="button" className={link} onClick={() => switchTo(true)}>
                Create an account
              </button>
            </>
          )}
        </p>
        {!creating && (
          <p className="mt-2 text-xs text-slate-500">Forgot your password? Ask the owner of this app to give you a new one.</p>
        )}
      </form>
    </div>
  )
}
