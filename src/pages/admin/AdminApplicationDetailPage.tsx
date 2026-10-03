import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.ts'
import { useAuth } from '../../auth/auth-context.ts'
import { unwrap, useQuery } from '../../hooks/useQuery.ts'
import { formatDate, formatMoney, loanProgress } from '../../lib/loan.ts'
import { EMPLOYMENT_LABELS, QUEUE_TITLES, STAFF_APPLICATION_SELECT, formatDateTime } from '../../lib/staff.ts'
import type { Investigation, Payment, Recommendation, RiskRating, Staff, StaffApplication } from '../../lib/types.ts'
import { Card } from '../../components/Card.tsx'
import { Button } from '../../components/Button.tsx'
import { Loader } from '../../components/Loader.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { ArrowLeftIcon } from '../../components/icons.tsx'
import { KycReview } from '../../components/KycReview.tsx'
import { VerifiedBadge } from '../../components/VerifiedBadge.tsx'
import { OverdueAlert, PenaltyBreakdown } from '../../components/PenaltySummary.tsx'
import { amountDueNow, fetchPenaltyStatus, type PenaltyStatus } from '../../lib/penalty.ts'
import { PaymentSubmissionReview } from '../../components/PaymentSubmissionReview.tsx'

interface Detail {
  app: StaffApplication
  payments: Payment[]
  investigators: Pick<Staff, 'user_id' | 'full_name'>[]
  penalty: PenaltyStatus | null
}

type RpcResult = PromiseLike<{ error: { message: string } | null }>

export function AdminApplicationDetailPage() {
  const { id = '' } = useParams()
  const { role, user } = useAuth()
  const isAdmin = role === 'admin'
  // Cashiers handle the money; admins can too, as a backup.
  const canHandleCash = role === 'admin' || role === 'cashier'
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useQuery(async (): Promise<Detail> => {
    const [app, payments, investigators, penalty] = await Promise.all([
      supabase.from('loan_applications').select(STAFF_APPLICATION_SELECT).eq('id', id).maybeSingle(),
      supabase.from('payments').select('*').eq('application_id', id).order('paid_at', { ascending: false }),
      isAdmin
        ? supabase.from('staff').select('user_id, full_name').eq('role', 'credit_investigator').eq('active', true).order('full_name')
        : Promise.resolve({ data: [], error: null }),
      fetchPenaltyStatus(id).catch(() => null),
    ])
    const found = unwrap(app) as StaffApplication | null
    if (!found) throw new Error('Application not found, or it is not assigned to you.')
    return {
      app: found,
      payments: unwrap(payments) as Payment[],
      investigators: unwrap(investigators) as Detail['investigators'],
      penalty,
    }
  }, [id, isAdmin])

  if (loading) return <Loader label="Loading application" />
  if (!data) {
    return (
      <div className="stack">
        <BackLink />
        <p className="alert alert--error">{error}</p>
      </div>
    )
  }

  const { app, payments, investigators, penalty } = data
  const profile = app.profile
  const isPending = app.status === 'pending'
  const isAssignedToMe = app.investigator_id === user?.id
  const canInvestigate = isPending && (isAdmin || isAssignedToMe)
  const progress = loanProgress(app, payments, penalty?.penalty_paid ?? 0)
  const income = Number(profile?.monthly_income ?? 0)
  const paymentToIncome = income > 0 ? (Number(app.monthly_payment) / income) * 100 : null

  async function run(key: string, success: string, action: () => RpcResult) {
    setBusy(key)
    setActionError(null)
    setNotice(null)
    const { error } = await action()
    setBusy(null)
    if (error) return setActionError(error.message)
    setNotice(success)
    await reload()
  }

  return (
    <div className="stack-lg">
      <BackLink />

      <div className="section-head">
        <div>
          <span className="eyebrow">{app.purpose} loan</span>
          <h1 className="h1 name-with-badge">
            {profile?.full_name || 'Unnamed borrower'}
            {profile?.kyc_status === 'verified' && <VerifiedBadge size="lg" />}
          </h1>
        </div>
        <StatusPill status={app.status} />
      </div>

      {actionError && <p className="alert alert--error">{actionError}</p>}
      {notice && <p className="alert alert--info">{notice}</p>}

      <div className="grid-2">
        <Card tone="accent" className="stack">
          <span className="eyebrow">Requested</span>
          <span className="balance-card__amount">{formatMoney(Number(app.amount))}</span>
          <dl className="kv">
            <dt>Term</dt>
            <dd>{app.term_months} months</dd>
            <dt>Rate</dt>
            <dd>{Number(app.annual_rate)}% p.a.</dd>
            <dt>Monthly</dt>
            <dd>{formatMoney(Number(app.monthly_payment))}</dd>
            <dt>Total payable</dt>
            <dd>{formatMoney(progress.totalPayable)}</dd>
            <dt>Submitted</dt>
            <dd>{formatDateTime(app.created_at)}</dd>
            {app.decided_at && (
              <>
                <dt>Decided</dt>
                <dd>{formatDateTime(app.decided_at)}</dd>
              </>
            )}
            {app.decision_reason && (
              <>
                <dt>Reason</dt>
                <dd>{app.decision_reason}</dd>
              </>
            )}
            {app.disbursed_at && (
              <>
                <dt>Released</dt>
                <dd>
                  {formatDateTime(app.disbursed_at)}
                  {app.disbursement_reference ? ` · ${app.disbursement_reference}` : ''}
                  {app.disbursed_by === user?.id ? ' · by you' : ''}
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Card className="stack">
          <div className="section-head">
            <h2 className="h3">Borrower</h2>
            {profile && <StatusPill status={profile.kyc_status} />}
          </div>
          <dl className="kv">
            <dt>Phone</dt>
            <dd>{profile?.phone || '—'}</dd>
            <dt>Date of birth</dt>
            <dd>{profile?.date_of_birth ? formatDate(profile.date_of_birth) : '—'}</dd>
            <dt>Address</dt>
            <dd>{profile?.address || '—'}</dd>
            <dt>Employment</dt>
            <dd>{profile?.employment_status ? EMPLOYMENT_LABELS[profile.employment_status] : '—'}</dd>
            <dt>Monthly income</dt>
            <dd>{income ? formatMoney(income) : '—'}</dd>
            <dt>Payment / income</dt>
            <dd className={paymentToIncome !== null && paymentToIncome > 40 ? 'text-danger' : undefined}>
              {paymentToIncome === null ? '—' : `${paymentToIncome.toFixed(1)}%`}
            </dd>
          </dl>
          {profile && role !== 'cashier' && (
            <KycReview
              userId={app.user_id}
              status={profile.kyc_status}
              canReview={role === 'admin' || role === 'credit_investigator'}
              onChanged={reload}
            />
          )}
        </Card>
      </div>

      {isAdmin && isPending && (
        <AssignCard
          app={app}
          investigators={investigators}
          busy={busy === 'assign'}
          onAssign={(investigatorId) =>
            run('assign', investigatorId ? 'Investigator assigned.' : 'Investigator removed.', () =>
              supabase.rpc('admin_assign_investigator', {
                p_application_id: app.id,
                p_investigator_id: investigatorId,
              }),
            )
          }
        />
      )}

      {canInvestigate ? (
        <InvestigationForm
          key={app.investigation?.submitted_at ?? 'new'}
          existing={app.investigation}
          busy={busy === 'investigate'}
          onSubmit={(form) =>
            run('investigate', 'Investigation report submitted.', () =>
              supabase.rpc('submit_investigation', { p_application_id: app.id, ...form }),
            )
          }
        />
      ) : (
        app.investigation && <InvestigationSummary investigation={app.investigation} />
      )}

      {isAdmin && isPending && (
        <DecisionCard
          investigation={app.investigation}
          kycVerified={profile?.kyc_status === 'verified'}
          busy={busy}
          onDecide={(decision, reason) =>
            run(`decide-${decision}`, `Application ${decision}.`, () =>
              supabase.rpc('admin_decide_application', {
                p_application_id: app.id,
                p_decision: decision,
                p_reason: reason,
              }),
            )
          }
        />
      )}

      {canHandleCash && app.status === 'approved' && (
        <DisburseCard
          amount={Number(app.amount)}
          borrower={profile?.full_name || 'the borrower'}
          kycVerified={profile?.kyc_status === 'verified'}
          busy={busy === 'disburse'}
          onDisburse={(reference) =>
            run('disburse', 'Loan released. The repayment schedule has started.', () =>
              supabase.rpc('admin_disburse_loan', { p_application_id: app.id, p_reference: reference }),
            )
          }
        />
      )}

      {(app.status === 'disbursed' || app.status === 'paid') && (
        <Card className="stack">
          <div className="section-head">
            <h2 className="h3">Repayment</h2>
            <span className="muted small">
              {progress.paidInstallments}/{app.term_months} installments
            </span>
          </div>
          <div className="progress">
            <div className="progress__track">
              <span className="progress__fill" style={{ width: `${progress.percentPaid}%` }} />
            </div>
            <span className="field__row muted small">
              <span>Paid {formatMoney(progress.totalPaid)}</span>
              <span>Outstanding {formatMoney(progress.outstanding)}</span>
            </span>
          </div>
          {penalty && app.status === 'disbursed' && <OverdueAlert status={penalty} audience="staff" />}
          {penalty && <PenaltyBreakdown status={penalty} />}
          {progress.nextDue && app.status === 'disbursed' && !(penalty && penalty.days_overdue > 0) && (
            <p className="muted small">
              Next due {formatDate(progress.nextDue.dueDate)} · {formatMoney(progress.nextDue.payment)}
            </p>
          )}
          {canHandleCash && app.status === 'disbursed' && (
            <PaymentSubmissionReview
              applicationId={app.id}
              onReviewed={async (message) => {
                setActionError(null)
                setNotice(message)
                await reload()
              }}
            />
          )}
          {canHandleCash && app.status === 'disbursed' && (
            <PaymentForm
              key={payments.length}
              suggested={
                penalty && penalty.days_overdue > 0
                  ? amountDueNow(penalty)
                  : Math.min(progress.nextDue?.payment ?? progress.outstanding, progress.outstanding) +
                    (penalty?.penalty_due ?? 0)
              }
              busy={busy === 'payment'}
              onRecord={(amount, reference) =>
                run('payment', 'Payment recorded.', () =>
                  supabase.rpc('admin_record_payment', {
                    p_application_id: app.id,
                    p_amount: amount,
                    p_reference: reference,
                  }),
                )
              }
            />
          )}
          {canHandleCash && app.status === 'disbursed' && (
            <p className="muted small">Payments are applied to late penalties first, then to installments.</p>
          )}
          {payments.length > 0 && (
            <ul className="plain-list">
              {payments.map((p) => (
                <li key={p.id}>
                  <strong>{formatMoney(Number(p.amount))}</strong>
                  <span className="muted small">
                    {formatDateTime(p.paid_at)}
                    {p.reference ? ` · ${p.reference}` : ''}
                    {p.received_by === user?.id ? ' · received by you' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function BackLink() {
  const { role } = useAuth()
  return (
    <Link to="/admin/applications" className="back-link">
      <ArrowLeftIcon /> {role ? QUEUE_TITLES[role] : 'Applications'}
    </Link>
  )
}

function AssignCard({
  app,
  investigators,
  busy,
  onAssign,
}: {
  app: StaffApplication
  investigators: Detail['investigators']
  busy: boolean
  onAssign: (investigatorId: string | null) => void
}) {
  const [selected, setSelected] = useState(app.investigator_id ?? '')

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Credit investigator</h2>
        {app.assigned_at && <span className="muted small">Assigned {formatDateTime(app.assigned_at)}</span>}
      </div>
      {investigators.length === 0 ? (
        <p className="muted small">
          No active credit investigators yet. <Link to="/admin/staff" className="link">Add one</Link>
        </p>
      ) : (
        <div className="inline-form">
          <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Not assigned</option>
            {investigators.map((i) => (
              <option key={i.user_id} value={i.user_id}>
                {i.full_name}
              </option>
            ))}
          </select>
          <Button loading={busy} disabled={selected === (app.investigator_id ?? '')} onClick={() => onAssign(selected || null)}>
            {selected ? 'Assign' : 'Unassign'}
          </Button>
        </div>
      )}
    </Card>
  )
}

interface InvestigationInput {
  p_employment_verified: boolean
  p_income_verified: boolean
  p_residence_verified: boolean
  p_risk_rating: RiskRating
  p_recommendation: Recommendation
  p_notes: string
}

function InvestigationForm({
  existing,
  busy,
  onSubmit,
}: {
  existing: Investigation | null
  busy: boolean
  onSubmit: (form: InvestigationInput) => void
}) {
  const [employment, setEmployment] = useState(existing?.employment_verified ?? false)
  const [income, setIncome] = useState(existing?.income_verified ?? false)
  const [residence, setResidence] = useState(existing?.residence_verified ?? false)
  const [risk, setRisk] = useState<RiskRating>(existing?.risk_rating ?? 'medium')
  const [recommendation, setRecommendation] = useState<Recommendation>(existing?.recommendation ?? 'approve')
  const [notes, setNotes] = useState(existing?.notes ?? '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit({
      p_employment_verified: employment,
      p_income_verified: income,
      p_residence_verified: residence,
      p_risk_rating: risk,
      p_recommendation: recommendation,
      p_notes: notes,
    })
  }

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Credit investigation</h2>
        {existing && <span className="muted small">Last submitted {formatDateTime(existing.submitted_at)}</span>}
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        <div className="check-grid">
          <label className="checkbox">
            <input type="checkbox" checked={employment} onChange={(e) => setEmployment(e.target.checked)} />
            <span>Employment verified</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={income} onChange={(e) => setIncome(e.target.checked)} />
            <span>Income verified</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={residence} onChange={(e) => setResidence(e.target.checked)} />
            <span>Residence verified</span>
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Risk rating</span>
            <select className="input" value={risk} onChange={(e) => setRisk(e.target.value as RiskRating)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="field">
            <span>Recommendation</span>
            <select
              className="input"
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value as Recommendation)}
            >
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Findings</span>
          <textarea
            className="input"
            rows={4}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Calls made, documents checked, site visit notes…"
          />
        </label>
        <Button type="submit" loading={busy}>
          {existing ? 'Update report' : 'Submit report'}
        </Button>
      </form>
    </Card>
  )
}

function InvestigationSummary({ investigation }: { investigation: Investigation }) {
  const checks = [
    ['Employment', investigation.employment_verified],
    ['Income', investigation.income_verified],
    ['Residence', investigation.residence_verified],
  ] as const

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Credit investigation</h2>
        <span className={`rec rec--${investigation.recommendation}`}>Recommends {investigation.recommendation}</span>
      </div>
      <div className="check-grid">
        {checks.map(([label, verified]) => (
          <span key={label} className={verified ? 'check check--ok' : 'check'}>
            {verified ? '✓' : '✕'} {label}
          </span>
        ))}
      </div>
      <dl className="kv">
        <dt>Risk rating</dt>
        <dd className={`risk risk--${investigation.risk_rating}`}>{investigation.risk_rating}</dd>
        <dt>Submitted</dt>
        <dd>{formatDateTime(investigation.submitted_at)}</dd>
      </dl>
      {investigation.notes && <p className="notes">{investigation.notes}</p>}
    </Card>
  )
}

function DecisionCard({
  investigation,
  kycVerified,
  busy,
  onDecide,
}: {
  investigation: Investigation | null
  kycVerified: boolean
  busy: string | null
  onDecide: (decision: 'approved' | 'rejected', reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Card className="stack">
      <h2 className="h3">Decision</h2>
      {!kycVerified && (
        <p className="alert alert--warning">
          The borrower's identity (KYC) isn't verified yet. Review their ID above before approving.
        </p>
      )}
      {!investigation && (
        <p className="alert alert--warning">No investigation has been submitted yet. Decide only if you're sure.</p>
      )}
      <label className="field">
        <span>Reason (required to reject; shown to the borrower)</span>
        <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="button-row">
        <Button
          loading={busy === 'decide-approved'}
          disabled={!kycVerified}
          onClick={() => window.confirm('Approve this application?') && onDecide('approved', reason)}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          loading={busy === 'decide-rejected'}
          disabled={!reason.trim()}
          onClick={() => window.confirm('Reject this application?') && onDecide('rejected', reason)}
        >
          Reject
        </Button>
      </div>
    </Card>
  )
}

function DisburseCard({
  amount,
  borrower,
  kycVerified,
  busy,
  onDisburse,
}: {
  amount: number
  borrower: string
  kycVerified: boolean
  busy: boolean
  onDisburse: (reference: string) => void
}) {
  const [reference, setReference] = useState('')

  return (
    <Card className="stack">
      <h2 className="h3">Release funds</h2>
      <p className="muted small">
        Release {formatMoney(amount)} to {borrower} (cash, bank transfer or e-wallet), then record the receipt or
        transfer reference here. The repayment schedule starts from today.
      </p>
      {!kycVerified && (
        <p className="alert alert--warning">The borrower's identity isn't marked verified. Check their ID before releasing cash.</p>
      )}
      <div className="inline-form">
        <input
          className="input"
          placeholder="Reference (e.g. OR-0012 or BANK-2026-0012)"
          aria-label="Release reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Button
          loading={busy}
          disabled={!reference.trim()}
          onClick={() => window.confirm(`Confirm you released ${formatMoney(amount)} to ${borrower}?`) && onDisburse(reference)}
        >
          Mark as released
        </Button>
      </div>
    </Card>
  )
}

function PaymentForm({
  suggested,
  busy,
  onRecord,
}: {
  suggested: number
  busy: boolean
  onRecord: (amount: number, reference: string) => void
}) {
  const [amount, setAmount] = useState(suggested.toFixed(2))
  const [reference, setReference] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onRecord(Number(amount), reference)
    setReference('')
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Payment amount"
        required
      />
      <input
        className="input"
        placeholder="Reference (e.g. GCASH-123)"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        aria-label="Payment reference"
      />
      <Button type="submit" loading={busy}>
        Record payment
      </Button>
    </form>
  )
}
