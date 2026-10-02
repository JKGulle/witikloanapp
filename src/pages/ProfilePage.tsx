import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import type { EmploymentStatus, Profile } from '../lib/types.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { Loader } from '../components/Loader.tsx'
import { KycSection } from '../components/KycSection.tsx'

const EMPLOYMENT: { value: EmploymentStatus; label: string }[] = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
]

type EditableFields = Pick<
  Profile,
  'full_name' | 'phone' | 'date_of_birth' | 'address' | 'employment_status' | 'monthly_income'
>

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<EditableFields | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) setMessage({ kind: 'error', text: error.message })
        const p = data as Profile | null
        setProfile(p)
        setForm({
          full_name: p?.full_name ?? '',
          phone: p?.phone ?? '',
          date_of_birth: p?.date_of_birth ?? '',
          address: p?.address ?? '',
          employment_status: p?.employment_status ?? 'employed',
          monthly_income: p?.monthly_income ?? null,
        })
      })
  }, [user])

  if (!form) return <Loader label="Loading profile" />

  function set<K extends keyof EditableFields>(key: K, value: EditableFields[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !form) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase
      .from('profiles')
      .update({
        ...form,
        full_name: form.full_name?.trim() || null,
        phone: form.phone?.trim() || null,
        address: form.address?.trim() || null,
        date_of_birth: form.date_of_birth || null,
      })
      .eq('id', user.id)
    setBusy(false)
    setMessage(error ? { kind: 'error', text: error.message } : { kind: 'info', text: 'Profile saved.' })
  }

  return (
    <div className="stack-lg">
      <form className="stack-lg" onSubmit={handleSubmit}>
        <div className="section-head">
          <h1 className="h1">Profile</h1>
        </div>
        <p className="muted small">{user?.email}</p>
  
        <Card className="stack">
          <label className="field">
            <span>Full name</span>
            <input className="input" value={form.full_name ?? ''} onChange={(e) => set('full_name', e.target.value)} required />
          </label>
          <label className="field">
            <span>Mobile number</span>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+63 9XX XXX XXXX"
              required
            />
          </label>
          <label className="field">
            <span>Date of birth</span>
            <input
              className="input"
              type="date"
              value={form.date_of_birth ?? ''}
              onChange={(e) => set('date_of_birth', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Address</span>
            <textarea
              className="input"
              rows={2}
              value={form.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
            />
          </label>
        </Card>
  
        <Card className="stack">
          <label className="field">
            <span>Employment</span>
            <select
              className="input"
              value={form.employment_status ?? 'employed'}
              onChange={(e) => set('employment_status', e.target.value as EmploymentStatus)}
            >
              {EMPLOYMENT.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Monthly income</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={form.monthly_income ?? ''}
              onChange={(e) => set('monthly_income', e.target.value === '' ? null : Number(e.target.value))}
              required
            />
          </label>
        </Card>
  
        {message && <p className={`alert alert--${message.kind}`}>{message.text}</p>}
  
        <Button type="submit" block loading={busy}>
          Save profile
        </Button>
      </form>

      {user && profile && (
        <KycSection
          userId={user.id}
          status={profile.kyc_status}
          onSubmitted={() => setProfile((p) => (p ? { ...p, kyc_status: 'pending' } : p))}
        />
      )}

      <Link to="/faq" className="btn btn--ghost btn--block">
        <span className="btn__label">Help & FAQ</span>
      </Link>
      <Button variant="ghost" block onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  )
}
