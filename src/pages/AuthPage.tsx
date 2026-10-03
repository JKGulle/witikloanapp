import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { siteUrl, supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import { clearLogoutReason, wasIdleLogout } from '../auth/idle.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { Logo } from '../components/Logo.tsx'

type Mode = 'signin' | 'signup' | 'forgot'

export function AuthPage() {
  const { session } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() =>
    wasIdleLogout() ? 'You were signed out after 5 minutes of inactivity. Please sign in again.' : null,
  )

  // Show the idle notice once; a later visit to this page shouldn't repeat it.
  useEffect(() => clearLogoutReason(), [])

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${siteUrl}/reset-password`,
      })
      // Same message whether or not the account exists, so emails can't be probed.
      if (error && !/rate limit/i.test(error.message)) setError(error.message)
      else if (error) setError('Too many reset emails were sent recently. Please try again in a little while.')
      else setNotice('If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.')
    } else if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${siteUrl}/auth` },
      })
      if (error) setError(error.message)
      else if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.')
    }
    setBusy(false)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  return (
    <div className="center-screen">
      <div className="auth-hero">
        <Logo size="lg" />
        <p className="auth-hero__tag">A better way to borrow.</p>
      </div>

      <Card className="auth-card">
        {mode === 'forgot' ? (
          <div className="stack">
            <h1 className="h3">Reset your password</h1>
            <p className="muted small">Enter your account email and we'll send you a link to choose a new password.</p>
          </div>
        ) : (
          <div className="segmented" role="tablist" data-active={mode}>
            <span className="segmented__thumb" aria-hidden="true" />
            <button role="tab" aria-selected={mode === 'signin'} onClick={() => switchMode('signin')}>
              Sign in
            </button>
            <button role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')}>
              Create account
            </button>
          </div>
        )}

        <form className="stack" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label className="field">
              <span>Full name</span>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode !== 'forgot' && (
          <label className="field">
            <span className="field__row">
              <span>Password</span>
              {mode === 'signin' && (
                <button type="button" className="text-button" onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              )}
            </span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>
          )}

          {error && <p className="alert alert--error">{error}</p>}
          {notice && <p className="alert alert--info">{notice}</p>}

          <Button type="submit" block loading={busy}>
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
          {mode === 'forgot' && (
            <button type="button" className="text-button" onClick={() => switchMode('signin')}>
              ← Back to sign in
            </button>
          )}
        </form>
      </Card>

      <p className="muted small">
        Questions about interest, penalties or requirements?{' '}
        <Link to="/faq" className="link">
          Read the Help & FAQ
        </Link>
      </p>
    </div>
  )
}
