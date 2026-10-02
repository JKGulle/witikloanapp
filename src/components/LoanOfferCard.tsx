import { Link } from 'react-router-dom'
import { AFFORDABILITY_RATIO, affordableAmount, formatMoney, loanQuote } from '../lib/loan.ts'
import type { LoanApplication } from '../lib/types.ts'
import { Card } from './Card.tsx'
import { SparkIcon } from './icons.tsx'

const OFFER_TERMS = [6, 12, 24] as const
const FEATURED_TERM = 12
/** Shown when there's no income in the profile to personalise the offer. */
const SAMPLE_AMOUNT = 20_000

const applyLink = (amount: number, term: number) => `/apply?amount=${amount}&term=${term}`

/**
 * Home-screen offer. Amounts come from the borrower's income and the app's 40%
 * affordability rule — an estimate, never a promise of approval.
 */
export function LoanOfferCard({
  monthlyIncome,
  overdueLoan,
}: {
  monthlyIncome: number | null
  overdueLoan: LoanApplication | null
}) {
  if (overdueLoan) {
    return (
      <Card tone="accent" className="offer stack">
        <span className="eyebrow">Loan offers paused</span>
        <strong className="h3">Settle your overdue balance first</strong>
        <p className="muted small">
          New offers come back once your {overdueLoan.purpose.toLowerCase()} loan is up to date. Paying now also stops
          the daily late penalty.
        </p>
        <Link to={`/loans/${overdueLoan.id}`} className="btn btn--primary">
          <span className="btn__label">View overdue loan</span>
        </Link>
      </Card>
    )
  }

  const personalised = monthlyIncome !== null && monthlyIncome > 0
  const options = OFFER_TERMS.map((term) => {
    const amount = personalised ? affordableAmount(monthlyIncome, term) : SAMPLE_AMOUNT
    return amount ? { term, amount, quote: loanQuote(amount, term) } : null
  }).filter((o) => o !== null)

  if (options.length === 0) {
    return (
      <Card tone="accent" className="offer stack">
        <span className="eyebrow">Loan offer</span>
        <strong className="h3">Start small</strong>
        <p className="muted small">
          Based on your income, even our smallest loan would be more than {AFFORDABILITY_RATIO * 100}% of your monthly
          income. You can still apply — or update your income in your profile.
        </p>
        <Link to="/apply" className="btn btn--primary">
          <span className="btn__label">See loan options</span>
        </Link>
      </Card>
    )
  }

  const featured = options.find((o) => o.term === FEATURED_TERM) ?? options[0]

  return (
    <Card tone="accent" className="offer">
      <div className="offer__head">
        <span className="offer__icon" aria-hidden="true">
          <SparkIcon />
        </span>
        <span className="eyebrow">{personalised ? 'Your loan offer' : 'Loan offer'}</span>
      </div>

      <div className="offer__headline">
        <span className="muted">{personalised ? 'Borrow up to' : 'Borrow'}</span>
        <span className="offer__amount">{formatMoney(featured.amount, true)}</span>
        <span className="muted small">
          {formatMoney(featured.quote.payment)}/month for {featured.term} months at {featured.quote.annualRate}% p.a.
        </span>
      </div>

      <div className="offer__options" role="list">
        {options.map((o) => (
          <Link
            key={o.term}
            to={applyLink(o.amount, o.term)}
            role="listitem"
            className={o.term === featured.term ? 'offer__option is-featured' : 'offer__option'}
          >
            <span className="offer__option-term">{o.term} months</span>
            <strong>{formatMoney(o.amount, true)}</strong>
            <span className="small">{formatMoney(o.quote.payment)}/mo</span>
          </Link>
        ))}
      </div>

      <Link to={applyLink(featured.amount, featured.term)} className="btn btn--primary btn--block">
        <span className="btn__label">Apply now</span>
      </Link>

      <p className="offer__fineprint">
        {personalised
          ? `Estimate based on your monthly income, keeping payments within ${AFFORDABILITY_RATIO * 100}% of it. `
          : 'Add your monthly income in Profile to see how much you can borrow. '}
        Approval depends on identity verification and a credit investigation.
      </p>
    </Card>
  )
}
