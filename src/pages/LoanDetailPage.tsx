import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useLoanData } from '../hooks/useLoanData.ts'
import { formatDate, formatMoney, formatRate, loanProgress } from '../lib/loan.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { Loader } from '../components/Loader.tsx'
import { StatusPill } from '../components/StatusPill.tsx'
import { ArrowLeftIcon } from '../components/icons.tsx'
import { OverdueAlert, PenaltyBreakdown } from '../components/PenaltySummary.tsx'
import { EwalletPayCard } from '../components/EwalletPayCard.tsx'
import { amountDueNow } from '../lib/penalty.ts'
import { BorrowerCollateralCard } from '../components/AtmCollateral.tsx'
import { useAuth } from '../auth/auth-context.ts'

export function LoanDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  // Set by the apply page if the loan was created but the ATM card couldn't be saved.
  const collateralError = (useLocation().state as { collateralError?: string } | null)?.collateralError
  const { applications, payments, penalties, loading, error, reload } = useLoanData()
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Start of today, fixed for the life of the page, for marking overdue installments.
  const [today] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })

  if (loading) return <Loader label="Loading loan" />

  const app = applications.find((a) => a.id === id)
  if (!app) {
    return (
      <Card className="empty stack">
        <p className="muted">{error ?? 'Loan not found.'}</p>
        <Link to="/loans" className="link">
          Back to my loans
        </Link>
      </Card>
    )
  }

  const penalty = penalties.get(app.id) ?? null
  const progress = loanProgress(app, payments, penalty?.penalty_paid ?? 0)
  const loanPayments = payments.filter((p) => p.application_id === app.id)
  const showRepayment = app.status === 'disbursed' || app.status === 'paid'
  const penaltyDue = penalty?.penalty_due ?? 0
  const owed = progress.outstanding + penaltyDue
  const payNow =
    penalty && penalty.days_overdue > 0 ? amountDueNow(penalty) : progress.nextDueRemaining + penaltyDue

  async function handleCancel() {
    if (!window.confirm('Cancel this loan application?')) return
    setCancelling(true)
    setActionError(null)
    const { error } = await supabase.rpc('cancel_loan_application', { application_id: app!.id })
    if (error) setActionError(error.message)
    else await reload()
    setCancelling(false)
  }

  return (
    <div className="stack-lg">
      <Link to="/loans" className="back-link">
        <ArrowLeftIcon /> My loans
      </Link>

      <Card tone="accent" className="stack">
        <div className="section-head">
          <span className="eyebrow">{app.purpose} loan</span>
          <StatusPill status={app.status} />
        </div>
        <span className="balance-card__amount">{formatMoney(Number(app.amount))}</span>
        <dl className="quote__grid">
          <div>
            <dt>Monthly</dt>
            <dd>{formatMoney(Number(app.monthly_payment))}</dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{app.term_months} months</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd>{formatRate(Number(app.annual_rate))}</dd>
          </div>
        </dl>
        {showRepayment && (
          <div className="progress" aria-label={`${Math.round(progress.percentPaid)}% repaid`}>
            <div className="progress__track">
              <span className="progress__fill" style={{ width: `${progress.percentPaid}%` }} />
            </div>
            <span className="field__row muted small">
              <span>Paid {formatMoney(progress.totalPaid)}</span>
              <span>Left {formatMoney(progress.outstanding)}</span>
            </span>
          </div>
        )}
        {penalty && <PenaltyBreakdown status={penalty} />}
      </Card>

      {penalty && app.status === 'disbursed' && <OverdueAlert status={penalty} audience="borrower" />}

      {app.status === 'disbursed' && (
        <EwalletPayCard applicationId={app.id} suggested={Math.min(payNow, owed)} owed={owed} onSubmitted={reload} />
      )}

      {app.status === 'rejected' && app.decision_reason && (
        <p className="alert alert--error">Reason: {app.decision_reason}</p>
      )}
      {app.status === 'approved' && (
        <p className="alert alert--info">Approved! Your funds are being prepared for release.</p>
      )}
      {app.rate_adjusted_at && (app.status === 'pending' || app.status === 'approved') && (
        <p className="alert alert--info">
          Witik set your interest to {formatRate(Number(app.annual_rate))}, so your monthly payment is{' '}
          {formatMoney(Number(app.monthly_payment))}.
          {app.status === 'pending' && ' You can still cancel while the application is pending.'}
        </p>
      )}

      {app.status === 'pending' && (
        <Card className="stack">
          <p className="muted">
            Submitted {formatDate(app.created_at)}. Our team usually reviews applications within 24 hours.
          </p>
          {actionError && <p className="alert alert--error">{actionError}</p>}
          <Button variant="danger" onClick={handleCancel} loading={cancelling}>
            Cancel application
          </Button>
        </Card>
      )}

      {collateralError && app.status === 'pending' && (
        <p className="alert alert--error">
          Your application was submitted, but your ATM card details weren't saved: {collateralError} You can add them
          below.
        </p>
      )}
      <BorrowerCollateralCard
        applicationId={app.id}
        loanStatus={app.status}
        defaultName={String(user?.user_metadata?.full_name ?? '')}
      />

      <section className="stack">
        <h2 className="h3">{showRepayment ? 'Repayment schedule' : 'Estimated schedule'}</h2>
        <Card className="table-wrap">
          <table className="schedule">
            <thead>
              <tr>
                <th>#</th>
                <th>Due</th>
                <th>Payment</th>
                <th>Interest</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {progress.schedule.map((row) => (
                <tr
                  key={row.installment}
                  className={
                    !showRepayment
                      ? undefined
                      : row.installment <= progress.paidInstallments
                        ? 'is-paid'
                        : app.status === 'disbursed' && row.dueDate < today
                          ? 'is-overdue'
                          : row.installment === progress.paidInstallments + 1
                            ? 'is-next'
                            : undefined
                  }
                >
                  <td>{row.installment}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>{formatMoney(row.payment)}</td>
                  <td>{formatMoney(row.interest)}</td>
                  <td>{formatMoney(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {loanPayments.length > 0 && (
        <section className="stack">
          <h2 className="h3">Payments</h2>
          {loanPayments.map((p) => (
            <Card key={p.id} className="loan-row">
              <div className="loan-row__main">
                <strong>{formatMoney(Number(p.amount))}</strong>
                <span className="muted small">
                  {formatDate(p.paid_at)}
                  {p.reference ? ` · Ref ${p.reference}` : ''}
                </span>
              </div>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
