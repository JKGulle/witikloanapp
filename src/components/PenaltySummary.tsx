import { formatMoney } from '../lib/loan.ts'
import { amountDueNow, type PenaltyStatus } from '../lib/penalty.ts'

/** Red banner shown while a loan has installments past their due date. */
export function OverdueAlert({ status, audience }: { status: PenaltyStatus; audience: 'borrower' | 'staff' }) {
  if (status.days_overdue <= 0) return null
  const days = `${status.days_overdue} day${status.days_overdue === 1 ? '' : 's'}`

  return (
    <div className="alert alert--error overdue" role="alert">
      <strong>
        {audience === 'borrower' ? `Your payment is ${days} overdue.` : `Overdue by ${days}.`}
      </strong>
      <span>
        A late penalty of {formatMoney(status.penalty_per_day, true)} is added for each day until the overdue amount is
        paid.
      </span>
      <span className="overdue__due">
        {audience === 'borrower' ? 'Pay now' : 'Due now'}: <strong>{formatMoney(amountDueNow(status))}</strong>
        <span className="small">
          {' '}
          ({formatMoney(status.amount_overdue)} overdue installment{status.installments_overdue === 1 ? '' : 's'} +{' '}
          {formatMoney(status.penalty_due)} penalties)
        </span>
      </span>
      {audience === 'borrower' && <span className="small">Payments go to penalties first, then installments.</span>}
    </div>
  )
}

/** Accrued / paid / due penalty figures; hidden when the loan has never been late. */
export function PenaltyBreakdown({ status }: { status: PenaltyStatus }) {
  if (status.penalty_accrued <= 0) return null
  return (
    <dl className="kv penalty-kv">
      <dt>Late penalties</dt>
      <dd>{formatMoney(status.penalty_accrued)}</dd>
      <dt>Penalties paid</dt>
      <dd>{formatMoney(status.penalty_paid)}</dd>
      <dt>Penalties due</dt>
      <dd className={status.penalty_due > 0 ? 'text-danger' : undefined}>{formatMoney(status.penalty_due)}</dd>
    </dl>
  )
}
