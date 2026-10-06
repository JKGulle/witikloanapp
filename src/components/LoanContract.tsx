import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { CONTRACT_VERSION, LENDER } from '../lib/contract.ts'
import { formatMoney, formatRate, loanQuote, LOCALE } from '../lib/loan.ts'
import { PENALTY_PER_DAY, PENALTY_TOTAL_COST_CAP } from '../lib/penalty.ts'
import { Button } from './Button.tsx'

export interface ContractTerms {
  borrowerName: string
  borrowerEmail: string
  amount: number
  termMonths: number
  annualRate: number
  purpose: string
}

/**
 * The loan agreement with this loan's figures filled in, including the Truth in Lending
 * disclosure (R.A. 3765). Wording is version CONTRACT_VERSION — see src/lib/contract.ts.
 */
export function LoanContractText({
  terms,
  version = CONTRACT_VERSION,
  date,
}: {
  terms: ContractTerms
  /** For an agreement already accepted: the version and acceptance date on record. */
  version?: string
  date?: Date
}) {
  // Fixed for the life of the page: a new agreement is dated the day it is shown.
  const [shownOn] = useState(() => new Date())
  const q = loanQuote(terms.amount, terms.termMonths, terms.annualRate)
  const dated = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long' }).format(date ?? shownOn)

  return (
    <article className="contract">
      <header className="contract__head">
        <h3 className="contract__title">Loan Agreement and Disclosure Statement</h3>
        <span className="muted small">
          Version {version} · {dated}
        </span>
      </header>

      <section>
        <h4>1. The parties</h4>
        <p>
          This agreement is between <strong>{LENDER.name}</strong>, doing business as {LENDER.tradeName}, a lending
          company registered with the Securities and Exchange Commission (SEC Reg. No. {LENDER.secRegistration},
          Certificate of Authority No. {LENDER.certificateOfAuthority}), with office at {LENDER.address} (the
          “Lender”), and <strong>{terms.borrowerName || 'the Borrower'}</strong>
          {terms.borrowerEmail ? ` (${terms.borrowerEmail})` : ''} (the “Borrower”).
        </p>
      </section>

      <section>
        <h4>2. Disclosure statement</h4>
        <p>As required by the Truth in Lending Act (R.A. 3765), the full cost of this loan is:</p>
        <dl className="contract__figures">
          <div>
            <dt>Amount borrowed (principal)</dt>
            <dd>{formatMoney(terms.amount)}</dd>
          </div>
          <div>
            <dt>Deductions and fees</dt>
            <dd>{formatMoney(0)}</dd>
          </div>
          <div>
            <dt>Net amount you receive</dt>
            <dd>{formatMoney(terms.amount)}</dd>
          </div>
          <div>
            <dt>Interest rate (fixed)</dt>
            <dd>{formatRate(terms.annualRate)}</dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{terms.termMonths} monthly installments</dd>
          </div>
          <div>
            <dt>Monthly installment</dt>
            <dd>{formatMoney(q.payment)}</dd>
          </div>
          <div>
            <dt>Total interest (finance charge)</dt>
            <dd>{formatMoney(q.totalInterest)}</dd>
          </div>
          <div>
            <dt>Total amount to repay</dt>
            <dd>{formatMoney(q.totalPayable)}</dd>
          </div>
          <div>
            <dt>Purpose</dt>
            <dd>{terms.purpose}</dd>
          </div>
        </dl>
        <p>
          Interest is computed on the diminishing principal balance. The last installment may differ by a few
          centavos to absorb rounding. The exact due dates are shown in the repayment schedule in the app once the
          loan is released.
        </p>
      </section>

      <section>
        <h4>3. Approval and release</h4>
        <p>
          Submitting an application is not an approval. The Lender approves a loan only after verifying the Borrower's
          identity and completing a credit investigation, and may decline any application. This agreement takes effect
          when the loan amount is released to the Borrower. The Borrower may cancel the application at any time before
          it is approved.
        </p>
        <p>
          The Lender may change the interest rate before release only. If it does, the Borrower will be shown the
          revised agreement and the loan will not be released unless the Borrower accepts it.
        </p>
      </section>

      <section>
        <h4>4. Repayment</h4>
        <p>
          The Borrower shall pay one installment every month, starting one month after the release date, through the
          Lender's official GCash or Maya accounts shown in the app or to an authorized Witik cashier against an
          official receipt. Payments made any other way are at the Borrower's risk. Payments are applied first to
          unpaid penalties, then to installments in order of their due dates.
        </p>
        <p>
          The Borrower may pay ahead of schedule at any time. Paying early does not reduce the total interest above
          unless the Lender agrees in writing.
        </p>
      </section>

      <section>
        <h4>5. Late payment</h4>
        <p>
          For every day that an installment remains unpaid after its due date, a late penalty of{' '}
          <strong>{formatMoney(PENALTY_PER_DAY)} per day</strong> is charged. In line with SEC Memorandum Circular No.
          3 (2022), total interest and penalties will never exceed {PENALTY_TOTAL_COST_CAP * 100}% of the amount borrowed —
          for this loan, penalties stop at{' '}
          {formatMoney(Math.max(terms.amount * PENALTY_TOTAL_COST_CAP - q.totalInterest, 0))}.
        </p>
      </section>

      <section>
        <h4>6. ATM card collateral (only if offered)</h4>
        <p>
          If the Borrower offers an ATM card as collateral, the Borrower hands the card to a Witik cashier when the loan
          is released and gets it back once the loan is fully paid. The Lender records only the bank, the last four
          digits and the cardholder name. <strong>The Borrower must never share the card's PIN</strong>, and no one from
          Witik will ever ask for it.
        </p>
      </section>

      <section>
        <h4>7. Borrower's declarations</h4>
        <p>
          The Borrower declares that all information and documents given to the Lender are true and complete, and that
          the Borrower is of legal age and able to enter into this agreement. False information is a ground to decline
          the application or to demand immediate payment of the full outstanding balance.
        </p>
      </section>

      <section>
        <h4>8. Collection practices</h4>
        <p>
          The Lender will collect only through fair and lawful means, in line with SEC Memorandum Circular No. 18
          (2019). It will never threaten, insult or publicly shame the Borrower, or contact people in the Borrower's
          contact list who are not co-makers or guarantors.
        </p>
      </section>

      <section>
        <h4>9. Personal data</h4>
        <p>
          The Lender processes the Borrower's personal data, ID documents and loan records to evaluate, service and
          collect this loan and to meet legal requirements, in accordance with the Data Privacy Act of 2012 (R.A.
          10173). The Borrower may request access to or correction of their data by writing to {LENDER.email}.
        </p>
      </section>

      <section>
        <h4>10. Electronic acceptance</h4>
        <p>
          The Borrower's acceptance in the app — ticking the agreement box and submitting — is the Borrower's electronic
          signature under the Electronic Commerce Act (R.A. 8792) and has the same effect as a handwritten signature.
          The Lender keeps a record of the version accepted, the date and time, and the terms shown.
        </p>
      </section>

      <section>
        <h4>11. Governing law</h4>
        <p>
          This agreement is governed by the laws of the Philippines. Any case arising from it shall be filed in the
          proper courts of {LENDER.venue}. Questions about this agreement can be sent to {LENDER.email}.
        </p>
      </section>

      <p className="contract__end">— End of agreement —</p>
    </article>
  )
}

/**
 * The contract in a scrollable box. The agreement checkbox unlocks only once the borrower has
 * scrolled to the end, so they can't agree without at least passing through every clause.
 */
export function ContractConsent({
  terms,
  agreed,
  onAgreedChange,
}: {
  terms: ContractTerms
  agreed: boolean
  onAgreedChange: (agreed: boolean) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [readToEnd, setReadToEnd] = useState(false)

  const check = useCallback(() => {
    const box = boxRef.current
    if (box && box.scrollTop + box.clientHeight >= box.scrollHeight - 24) setReadToEnd(true)
  }, [])

  // A tall screen may show the whole contract without scrolling.
  useEffect(() => {
    check()
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(check)
    observer.observe(box)
    return () => observer.disconnect()
  }, [check])

  return (
    <div className="stack">
      <div
        ref={boxRef}
        className="contract-box"
        tabIndex={0}
        role="region"
        aria-label="Loan agreement"
        onScroll={check}
      >
        <LoanContractText terms={terms} />
      </div>
      {!readToEnd && <p className="muted small contract-hint">Scroll to the end of the agreement to continue.</p>}
      <label className={`checkbox${readToEnd ? '' : ' is-disabled'}`}>
        <input
          type="checkbox"
          checked={agreed}
          disabled={!readToEnd}
          onChange={(e) => onAgreedChange(e.target.checked)}
        />
        <span>
          I have read and agree to the <strong>Loan Agreement and Disclosure Statement</strong> above, and I confirm my
          information is accurate.
        </span>
      </label>
    </div>
  )
}

/** Shown on a not-yet-released loan when its terms changed (rate adjusted or new contract version). */
export function ContractReacceptCard({
  terms,
  reason,
  onAccept,
}: {
  terms: ContractTerms
  reason: 'rate' | 'version' | 'missing'
  onAccept: () => Promise<string | null>
}) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await onAccept())
    setBusy(false)
  }

  return (
    <form className="card stack contract-reaccept" onSubmit={handleSubmit}>
      <h2 className="h3">Review your loan agreement</h2>
      <p className="alert alert--warning">
        {reason === 'rate'
          ? `Witik changed your interest rate to ${formatRate(terms.annualRate)}. Please read the updated agreement.`
          : reason === 'version'
            ? 'Our loan agreement was updated. Please read the new version.'
            : 'Please read and accept the loan agreement for this application.'}{' '}
        Your loan can't be released until you accept it.
      </p>
      <ContractConsent terms={terms} agreed={agreed} onAgreedChange={setAgreed} />
      {error && <p className="alert alert--error">{error}</p>}
      <Button type="submit" block loading={busy} disabled={!agreed}>
        Accept agreement
      </Button>
    </form>
  )
}
