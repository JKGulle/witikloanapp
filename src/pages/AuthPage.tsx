import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import { clearLogoutReason, wasIdleLogout } from '../auth/idle.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { Logo } from '../components/Logo.tsx'

type Mode = 'signin' | 'signup'

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

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } },
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
        <p className="auth-hero__tag">Money that flows with you.</p>
      </div>

      <Card className="auth-card">
        <div className="segmented" role="tablist" data-active={mode}>
          <span className="segmented__thumb" aria-hidden="true" />
          <button role="tab" aria-selected={mode === 'signin'} onClick={() => switchMode('signin')}>
            Sign in
          </button>
          <button role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')}>
            Create account
          </button>
        </div>

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
          <label className="field">
            <span>Password</span>
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

          {error && <p className="alert alert--error">{error}</p>}
          {notice && <p className="alert alert--info">{notice}</p>}

          <Button type="submit" block loading={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
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
