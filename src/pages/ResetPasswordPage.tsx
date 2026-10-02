import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { Loader } from '../components/Loader.tsx'
import { Logo } from '../components/Logo.tsx'

const MIN_LENGTH = 8

/**
 * Landing page for the emailed reset link. Supabase signs the user in from the
 * link (detectSessionInUrl), then they choose a new password here.
 */
export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (loading) return <Loader fullscreen label="Checking your reset link" />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    setDone(true)
  }

  return (
    <div className="center-screen">
      <div className="auth-hero">
        <Logo size="lg" />
      </div>
      <Card className="auth-card">
        {!session ? (
          <div className="stack">
            <h1 className="h3">This link has expired</h1>
            <p className="muted small">
              Reset links work once and expire after a short time. Request a new one from the sign-in page.
            </p>
            <Link to="/auth" className="btn btn--primary btn--block">
              <span className="btn__label">Back to sign in</span>
            </Link>
          </div>
        ) : done ? (
          <div className="stack">
            <h1 className="h3">Password updated</h1>
            <p className="muted small">You're signed in with your new password.</p>
            <Button block onClick={() => navigate('/', { replace: true })}>
              Continue
            </Button>
          </div>
        ) : (
          <form className="stack" onSubmit={handleSubmit}>
            <h1 className="h3">Choose a new password</h1>
            <p className="muted small">For {session.user.email}. Use at least {MIN_LENGTH} characters.</p>
            <label className="field">
              <span>New password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={MIN_LENGTH}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
            {error && <p className="alert alert--error">{error}</p>}
            <Button type="submit" block loading={busy}>
              Update password
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
