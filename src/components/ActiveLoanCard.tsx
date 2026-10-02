import { Link } from 'react-router-dom'
import { formatDate, formatMoney, loanProgress, loanQuote } from '../lib/loan.ts'
import { amountDueNow, type PenaltyStatus } from '../lib/penalty.ts'
import type { LoanApplication, Payment } from '../lib/types.ts'
import { Card } from './Card.tsx'
import { StatusPill } from './StatusPill.tsx'
import { ChevronRightIcon } from './icons.tsx'

/** Borrower's per-loan summary: outstanding balance, next due date and the amount to pay. */
export function ActiveLoanCard({
  app,
  payments,
  penalty,
}: {
  app: LoanApplication
  payments: Payment[]
  penalty: PenaltyStatus | null
}) {
  const awaitingRelease = app.status === 'approved'
  const progress = loanProgress(app, payments, penalty?.penalty_paid ?? 0)
  const overdue = !awaitingRelease && (penalty?.days_overdue ?? 0) > 0
  const penaltyDue = penalty?.penalty_due ?? 0

  const outstanding = awaitingRelease
    ? loanQuote(Number(app.amount), app.term_months).totalPayable
    : progress.outstanding + penaltyDue
  const amountToPay = awaitingRelease
    ? Number(app.monthly_payment)
    : overdue
      ? amountDueNow(penalty!)
      : progress.nextDueRemaining + penaltyDue

  const dueLabel = awaitingRelease ? 'First due' : overdue ? 'Overdue since' : 'Next due'
  const dueValue = awaitingRelease
    ? '1 month after release'
    : progress.nextDue
      ? formatDate(progress.nextDue.dueDate)
      : '—'

  return (
    <Link to={`/loans/${app.id}`} className="loan-row-link">
      <Card interactive tone={overdue ? 'default' : 'accent'} className={overdue ? 'active-loan is-overdue' : 'active-loan'}>
        <div className="section-head">
          <div className="active-loan__title">
            <strong>{app.purpose} loan</strong>
            <span className="muted small">
              {formatMoney(Number(app.amount), true)} · {app.term_months} months
            </span>
          </div>
          <div className="active-loan__status">
            <StatusPill status={app.status} />
            <ChevronRightIcon />
          </div>
        </div>

        <dl className="active-loan__figures">
          <div>
            <dt>Outstanding balance</dt>
            <dd>{formatMoney(outstanding)}</dd>
          </div>
          <div>
            <dt className={overdue ? 'text-danger' : undefined}>{dueLabel}</dt>
            <dd className={overdue ? 'text-danger' : undefined}>{dueValue}</dd>
          </div>
          <div>
            <dt className={overdue ? 'text-danger' : undefined}>{overdue ? 'Pay now' : 'Amount to pay'}</dt>
            <dd className={overdue ? 'text-danger' : 'active-loan__amount'}>{formatMoney(amountToPay)}</dd>
          </div>
        </dl>

        {awaitingRelease ? (
          <p className="muted small">Approved — your funds are being prepared for release.</p>
        ) : (
          <div className="progress">
            <div className="progress__track">
              <span className="progress__fill" style={{ width: `${progress.percentPaid}%` }} />
            </div>
            <span className="field__row muted small">
              <span>
                {progress.paidInstallments} of {app.term_months} installments paid
              </span>
              {penaltyDue > 0 && <span className="text-danger">Includes {formatMoney(penaltyDue)} penalties</span>}
            </span>
          </div>
        )}
      </Card>
    </Link>
  )
}
