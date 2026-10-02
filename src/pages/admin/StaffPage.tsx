import { useState, type FormEvent } from 'react'
import { signUpWithoutSession, supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { ROLE_LABELS, formatDateTime } from '../../lib/staff.ts'
import type { Staff, StaffRole } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Button } from '../../components/Button.tsx'
import { Loader } from '../../components/Loader.tsx'

export function StaffPage() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useQuery(
    async () => unwrap(await supabase.from('staff').select('*').order('created_at')) as Staff[],
    [],
  )
  const [toggling, setToggling] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  async function toggleActive(member: Staff) {
    const verb = member.active ? 'Deactivate' : 'Reactivate'
    if (!window.confirm(`${verb} ${member.full_name}?`)) return
    setToggling(member.user_id)
    setListError(null)
    const { error } = await supabase.rpc('admin_set_staff_active', {
      p_user_id: member.user_id,
      p_active: !member.active,
    })
    setToggling(null)
    if (error) setListError(error.message)
    else await reload()
  }

  const investigators = (data ?? []).filter((s) => s.role === 'credit_investigator')
  const cashiers = (data ?? []).filter((s) => s.role === 'cashier')
  const admins = (data ?? []).filter((s) => s.role === 'admin')

  return (
    <div className="stack-lg">
      <h1 className="h1">Staff</h1>

      <CreateStaffForm onCreated={reload} />

      {error && <p className="alert alert--error">{error}</p>}
      {listError && <p className="alert alert--error">{listError}</p>}
      {loading ? (
        <Loader label="Loading staff" />
      ) : (
        [
          { title: 'Credit investigators', members: investigators },
          { title: 'Cashiers', members: cashiers },
          { title: 'Admins', members: admins },
        ].map((group) => (
          <section key={group.title} className="stack">
            <h2 className="h3">
              {group.title} <span className="muted">({group.members.length})</span>
            </h2>
            {group.members.length === 0 ? (
              <Card className="empty">
                <p className="muted">None yet.</p>
              </Card>
            ) : (
              group.members.map((m) => (
                <Card key={m.user_id} className={m.active ? 'loan-row' : 'loan-row is-inactive'}>
                  <div className="loan-row__main">
                    <strong>{m.full_name}</strong>
                    <span className="muted small">
                      {m.email} · added {formatDateTime(m.created_at)}
                    </span>
                  </div>
                  {!m.active && <span className="pill pill--cancelled">Inactive</span>}
                  {m.user_id !== user?.id && (
                    <Button
                      variant={m.active ? 'danger' : 'ghost'}
                      className="btn--sm"
                      loading={toggling === m.user_id}
                      onClick={() => void toggleActive(m)}
                    >
                      {m.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </Card>
              ))
            )}
          </section>
        ))
      )}
    </div>
  )
}

function CreateStaffForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<StaffRole>('credit_investigator')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const cleanEmail = email.trim().toLowerCase()
    const grant = () =>
      supabase.rpc('admin_grant_staff_role', { p_email: cleanEmail, p_role: role, p_full_name: fullName.trim() })

    // 1. If the email already has an account, just grant the role — no sign-up, no email sent.
    const first = await grant()
    let created = false
    let needsConfirmation = false

    if (first.error) {
      if (!/no account exists/i.test(first.error.message)) {
        setBusy(false)
        return setMessage({ kind: 'error', text: first.error.message })
      }

      // 2. No account yet: create the login, then grant the role.
      const signUp = await signUpWithoutSession(cleanEmail, password, fullName.trim())
      if (signUp.error) {
        setBusy(false)
        return setMessage({
          kind: 'error',
          text: /rate limit/i.test(signUp.error.message)
            ? 'Supabase has hit its hourly email limit, so no new account could be created. Try again later, or raise the limit (see README → Email limits).'
            : signUp.error.message,
        })
      }
      const second = await grant()
      if (second.error) {
        setBusy(false)
        return setMessage({ kind: 'error', text: second.error.message })
      }
      created = true
      needsConfirmation = !signUp.data.session
    }
    setBusy(false)

    setMessage({
      kind: 'info',
      text: !created
        ? `${cleanEmail} already had an account. It now has the ${ROLE_LABELS[role]} role; they sign in with their existing password.`
        : needsConfirmation
          ? `${ROLE_LABELS[role]} account created. They must confirm their email, then sign in with the temporary password.`
          : `${ROLE_LABELS[role]} account created. They can sign in now with the temporary password.`,
    })
    setFullName('')
    setEmail('')
    setPassword('')
    await onCreated()
  }

  return (
    <Card className="stack">
      <h2 className="h3">Add staff member</h2>
      <form className="stack" onSubmit={handleSubmit}>
        <div className="grid-2">
          <label className="field">
            <span>Full name</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Temporary password</span>
            <input
              className="input"
              type="text"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              <option value="credit_investigator">Credit Investigator</option>
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          Share the temporary password privately. If the email already has an account, it's given the role instead.
        </p>
        {message && <p className={`alert alert--${message.kind}`}>{message.text}</p>}
        <Button type="submit" loading={busy}>
          Add {ROLE_LABELS[role]}
        </Button>
      </form>
    </Card>
  )
}
