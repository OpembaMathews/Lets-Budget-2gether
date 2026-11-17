// Sign in to an account, create a new one, or set a new password with a recovery code.
import { useState } from 'react'
import { api } from './api'

type Mode = 'signin' | 'create' | 'forgot'

const box =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100'
const link = 'font-semibold text-brand-700 underline-offset-2 hover:underline'
const primary =
  'mt-5 w-full rounded-lg bg-brand-700 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300'

export default function Login(props: { setUp: boolean; minLength: number; onSignedIn: () => void }) {
  const { setUp, minLength, onSignedIn } = props
  // Until the first account exists there is nothing to sign in to.
  const [mode, setMode] = useState<Mode>(setUp ? 'signin' : 'create')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A recovery code just made. It is shown once, before the app opens.
  const [fresh, setFresh] = useState<{ code: string; reset: boolean } | null>(null)

  const creating = mode === 'create'
  const forgot = mode === 'forgot'
  const choosing = creating || forgot // choosing a new password
  const name = username.trim()
  const badName = creating && name.length > 0 && !/^[a-z0-9][a-z0-9._-]{2,29}$/i.test(name)
  const tooShort = choosing && password.length > 0 && password.length < minLength
  const valid =
    name.length > 0 &&
    !badName &&
    (choosing ? password.length >= minLength : password.length > 0) &&
    (!forgot || code.trim().length > 0)

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setProblem(null)
    try {
      if (creating) setFresh({ code: (await api.authSignup(name, password, remember)).recovery_code, reset: false })
      else if (forgot) setFresh({ code: (await api.resetPassword(name, code, password)).recovery_code, reset: true })
      else {
        await api.authLogin(name, password, remember)
        onSignedIn()
      }
    } catch (e) {
      setProblem((e as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  function switchTo(next: Mode) {
    setMode(next)
    setProblem(null)
    setPassword('')
    setCode('')
  }

  const brand = (
    <div className="mb-5 flex items-center gap-2.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-leaf text-lg font-black text-brand-950">2</span>
      <div>
        <p className="text-lg font-bold leading-tight text-brand-900">Budget 2gether</p>
        <p className="text-xs text-slate-500">Plan · Save first · Review</p>
      </div>
    </div>
  )

  if (fresh)
    return (
      <div className="flex min-h-full items-center justify-center bg-brand-900 px-4 py-10">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          {brand}
          <h1 className="text-xl font-bold text-brand-900">{fresh.reset ? 'Your password is changed' : 'Save your recovery code'}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {fresh.reset ? 'The code you used is finished. This is your new recovery code.' : 'Your account is ready.'} If
            you ever forget your password, this code lets you set a new one. Write it down or save it somewhere safe. It
            is shown only this once.
          </p>
          <RecoveryCode code={fresh.code} />
          <button type="button" className={primary} onClick={onSignedIn}>
            I have saved it. Open my budget
          </button>
        </div>
      </div>
    )

  return (
    <div className="flex min-h-full items-center justify-center bg-brand-900 px-4 py-10">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {brand}

        <h1 className="text-xl font-bold text-brand-900">
          {creating ? 'Create your account' : forgot ? 'Set a new password' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {creating
            ? 'You get your own budget, starting from a short empty plan you fill in.'
            : forgot
              ? 'Enter your username and the recovery code you saved, then choose a new password.'
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

        {forgot && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Recovery code</span>
            <input
              aria-label="Recovery code"
              type="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className={box + ' font-mono uppercase placeholder:normal-case'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}

        <label className="mt-3 block text-sm">
          <span className="mb-1 flex items-baseline justify-between font-semibold text-slate-700">
            {forgot ? 'New password' : 'Password'}
            <button type="button" className={'text-xs ' + link} onClick={() => setShow(!show)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
          <input
            aria-label={forgot ? 'New password' : 'Password'}
            type={show ? 'text' : 'password'}
            autoComplete={choosing ? 'new-password' : 'current-password'}
            className={box}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {choosing && (
          <p className={'mt-1 text-xs ' + (tooShort ? 'text-amber-800' : 'text-slate-500')}>At least {minLength} characters.</p>
        )}
        {mode === 'signin' && (
          <p className="mt-1.5 text-right text-sm">
            <button type="button" className={link} onClick={() => switchTo('forgot')}>
              Forgot your password?
            </button>
          </p>
        )}

        {!forgot && (
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="accent-brand-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in on this device for 30 days
          </label>
        )}

        {problem && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{problem}</p>}

        <button type="submit" disabled={!valid || busy} className={primary}>
          {busy ? 'Please wait…' : creating ? 'Create account and open' : forgot ? 'Set new password' : 'Sign in'}
        </button>

        <p className="mt-4 text-sm text-slate-600">
          {mode === 'signin' ? (
            <>
              New here?{' '}
              <button type="button" className={link} onClick={() => switchTo('create')}>
                Create an account
              </button>
            </>
          ) : (
            setUp && (
              <>
                {forgot ? 'Remembered it?' : 'Already have an account?'}{' '}
                <button type="button" className={link} onClick={() => switchTo('signin')}>
                  Sign in
                </button>
              </>
            )
          )}
        </p>
        {forgot && (
          <p className="mt-2 text-xs text-slate-500">
            No recovery code? Ask the owner of this app to give you a new password. If you are the owner, run
            reset_password on the computer the app runs on.
          </p>
        )}
      </form>
    </div>
  )
}

/** A recovery code in large letters, with a button to copy it. */
export function RecoveryCode(props: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-4 rounded-lg border border-brand-300 bg-brand-50 px-3 py-3 text-center">
      <p aria-label="Recovery code" className="select-all font-mono text-lg font-bold tracking-wider text-brand-900">
        {props.code}
      </p>
      <button
        type="button"
        className="mt-1 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
        onClick={() => void navigator.clipboard?.writeText(props.code).then(() => setCopied(true))}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
