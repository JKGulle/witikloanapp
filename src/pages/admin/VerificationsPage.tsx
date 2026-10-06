import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { idTypeLabel } from '../../lib/kyc.ts'
import { EMPLOYMENT_LABELS, formatDateTime } from '../../lib/staff.ts'
import { formatDate, formatMoney } from '../../lib/loan.ts'
import type { KycStatus, KycSubmission, Profile } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Loader } from '../../components/Loader.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { KycReview } from '../../components/KycReview.tsx'
import { VerifiedBadge } from '../../components/VerifiedBadge.tsx'
import { AdminLoanOffer } from '../../components/AdminLoanOffer.tsx'
import { ArrowLeftIcon, ChevronRightIcon } from '../../components/icons.tsx'

type QueueRow = KycSubmission & { profile: Pick<Profile, 'full_name' | 'phone' | 'kyc_status'> | null }

const VIEWS: { key: KycStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'To review' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

/** Queue of identity documents awaiting review (admins and credit investigators). */
export function VerificationsPage() {
  const [view, setView] = useState<KycStatus | 'all'>('pending')
  const { data, error, loading } = useQuery(
    async () =>
      unwrap(
        await supabase
          .from('kyc_submissions')
          .select('*, profile:profiles(full_name, phone, kyc_status)')
          .order('submitted_at', { ascending: false }),
      ) as QueueRow[],
    [],
  )

  const rows = (data ?? []).filter((r) => view === 'all' || r.profile?.kyc_status === view)

  return (
    <div className="stack-lg">
      <div className="stack">
        <h1 className="h1">Verifications</h1>
        <p className="muted small">Check each borrower's ID against their selfie and profile, then verify or reject.</p>
      </div>

      <div className="chips" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={v.key === view}
            className="chip"
            onClick={() => setView(v.key)}
          >
            {v.label}
            <span className="chip__count">
              {(data ?? []).filter((r) => v.key === 'all' || r.profile?.kyc_status === v.key).length}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="alert alert--error">{error}</p>}
      {loading ? (
        <Loader label="Loading verifications" />
      ) : rows.length === 0 ? (
        <Card className="empty">
          <p className="muted">{view === 'pending' ? 'Nothing waiting for review. 🎉' : 'No verifications here.'}</p>
        </Card>
      ) : (
        <div className="stack">
          {rows.map((r) => (
            <Link key={r.user_id} to={`/admin/verifications/${r.user_id}`} className="loan-row-link">
              <Card interactive className="loan-row">
                <div className="loan-row__main">
                  <strong className="name-with-badge">
                    {r.profile?.full_name || 'Unnamed borrower'}
                    {r.profile?.kyc_status === 'verified' && <VerifiedBadge size="sm" />}
                  </strong>
                  <span className="muted small">
                    {idTypeLabel(r.id_type)} · submitted {formatDateTime(r.submitted_at)}
                  </span>
                </div>
                {r.profile && <StatusPill status={r.profile.kyc_status} />}
                <ChevronRightIcon />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** One borrower's documents and details side by side, with verify / reject. */
export function VerificationDetailPage() {
  const { userId = '' } = useParams()
  const { role } = useAuth()
  const [notice, setNotice] = useState<string | null>(null)
  const { data, error, loading, reload } = useQuery(async () => {
    const found = unwrap(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null
    if (!found) throw new Error('Borrower not found, or they have not submitted an ID yet.')
    return found
  }, [userId])

  const back = (
    <Link to="/admin/verifications" className="back-link">
      <ArrowLeftIcon /> Verifications
    </Link>
  )

  if (loading) return <Loader label="Loading borrower" />
  if (!data) {
    return (
      <div className="stack">
        {back}
        <p className="alert alert--error">{error}</p>
      </div>
    )
  }

  const profile = data

  return (
    <div className="stack-lg">
      {back}
      <div className="section-head">
        <h1 className="h1 name-with-badge">
          {profile.full_name || 'Unnamed borrower'}
          {profile.kyc_status === 'verified' && <VerifiedBadge size="lg" />}
        </h1>
        <StatusPill status={profile.kyc_status} />
      </div>

      {notice && <p className="alert alert--info">{notice}</p>}

      <div className="grid-2">
        <Card className="stack">
          <h2 className="h3">Profile details</h2>
          <p className="muted small">The name and birth date should match the ID exactly.</p>
          <dl className="kv">
            <dt>Full name</dt>
            <dd>{profile.full_name || '—'}</dd>
            <dt>Date of birth</dt>
            <dd>{profile.date_of_birth ? formatDate(profile.date_of_birth) : '—'}</dd>
            <dt>Address</dt>
            <dd>{profile.address || '—'}</dd>
            <dt>Mobile</dt>
            <dd>{profile.phone || '—'}</dd>
            <dt>Employment</dt>
            <dd>{profile.employment_status ? EMPLOYMENT_LABELS[profile.employment_status] : '—'}</dd>
            <dt>Monthly income</dt>
            <dd>{profile.monthly_income ? formatMoney(Number(profile.monthly_income)) : '—'}</dd>
          </dl>
        </Card>

        <Card className="stack kyc-standalone">
          {/* Only admins and credit investigators reach this page; both can decide any check. */}
          <KycReview userId={profile.id} status={profile.kyc_status} canReview onChanged={reload} />
        </Card>
      </div>

      {role === 'admin' && (
        <AdminLoanOffer
          key={profile.offer_set_at ?? 'none'}
          profile={profile}
          onChanged={async (message) => {
            setNotice(message)
            await reload()
          }}
        />
      )}
    </div>
  )
}
