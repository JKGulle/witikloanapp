import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AFFORDABILITY_RATIO, formatMoney, LOAN_LIMITS, loanQuote } from '../lib/loan.ts'
import type { Profile } from '../lib/types.ts'
import { Card } from '../components/Card.tsx'
import { Button } from '../components/Button.tsx'
import { AtmCardFields, PinWarning } from '../components/AtmCollateral.tsx'
import { emptyAtmCard, isAtmCardComplete, offerAtmCollateral, type AtmCardInput } from '../lib/collateral.ts'
import { CONTRACT_VERSION } from '../lib/contract.ts'
import { ContractConsent } from '../components/LoanContract.tsx'

const PURPOSES = ['Education', 'Medical', 'Business', 'Home improvement', 'Emergency', 'Debt consolidation', 'Other']


/** Reads ?amount= / ?term= (from a loan offer), snapped to the allowed range and step. */
function fromParam(raw: string | null, min: number, max: number, step: number, fallback: number) {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n / step) * step))
}

function fillPercent(value: number, min: number, max: number) {
  return { '--fill': `${max > min ? ((value - min) / (max - min)) * 100 : 100}%` } as CSSProperties
}

export function ApplyPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [requestedAmount, setAmount] = useState(() =>
    fromParam(params.get('amount'), LOAN_LIMITS.minAmount, LOAN_LIMITS.maxAmount, LOAN_LIMITS.amountStep, 20_000),
  )
  const [term, setTerm] = useState(() => fromParam(params.get('term'), LOAN_LIMITS.minTerm, LOAN_LIMITS.maxTerm, 1, 12))
  const [purpose, setPurpose] = useState(PURPOSES[0])
  // The terms the borrower agreed to; changing any of them withdraws the agreement.
  const [agreedTo, setAgreedTo] = useState<string | null>(null)
  const [withCard, setWithCard] = useState(false)
  const [card, setCard] = useState<AtmCardInput | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile | null))
  }, [user])

  // An admin's offer caps the amount; the database refuses anything above it too.
  const offer = profile?.offer_amount ? Number(profile.offer_amount) : null
  const maxAmount = offer ?? LOAN_LIMITS.maxAmount
  const amount = Math.min(requestedAmount, maxAmount)
  const quote = loanQuote(amount, term)
  const profileComplete = Boolean(profile?.full_name && profile?.monthly_income && profile?.phone)
  const income = Number(profile?.monthly_income ?? 0)
  const overBudget = income > 0 && quote.payment > income * AFFORDABILITY_RATIO
  const termsKey = `${amount}-${term}-${purpose}-${quote.annualRate}`
  const agreed = agreedTo === termsKey

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('loan_applications')
      .insert({ amount, term_months: term, purpose, contract_version: CONTRACT_VERSION })
      .select('id')
      .single()
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    let collateralError: string | null = null
    if (withCard && card) {
      try {
        await offerAtmCollateral(data.id, card)
      } catch (err) {
        // The application exists either way; the loan page lets them add the card again.
        collateralError = err instanceof Error ? err.message : String(err)
      }
    }
    setBusy(false)
    navigate(`/loans/${data.id}`, { replace: true, state: collateralError ? { collateralError } : undefined })
  }

  const atmCard = card ?? emptyAtmCard(profile?.full_name ?? '')

  return (
    <form className="stack-lg" onSubmit={handleSubmit}>
      <h1 className="h1">Apply for a loan</h1>

      {profile && !profileComplete && (
        <p className="alert alert--warning">
          Complete your <Link to="/profile">profile</Link> (name, phone and monthly income) before applying.
        </p>
      )}
      {profile && (profile.kyc_status === 'unverified' || profile.kyc_status === 'rejected') && (
        <p className="alert alert--info">
          Loans are approved only after your identity is verified.{' '}
          <Link to="/profile">Upload your ID and selfie</Link> to avoid delays.
        </p>
      )}

      <Card className="stack">
        <label className="field">
          <span className="field__row">
            <span>Amount</span>
            <strong className="field__value">{formatMoney(amount, true)}</strong>
          </span>
          <input
            type="range"
            className="range"
            min={LOAN_LIMITS.minAmount}
            max={maxAmount}
            step={LOAN_LIMITS.amountStep}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={fillPercent(amount, LOAN_LIMITS.minAmount, maxAmount)}
          />
          <span className="field__row muted small">
            <span>{formatMoney(LOAN_LIMITS.minAmount, true)}</span>
            <span>{formatMoney(maxAmount, true)}</span>
          </span>
          {offer !== null && <span className="muted small">Witik has offered you up to {formatMoney(offer, true)}.</span>}
        </label>

        <label className="field">
          <span className="field__row">
            <span>Term</span>
            <strong className="field__value">
              {term} month{term > 1 ? 's' : ''}
            </strong>
          </span>
          <input
            type="range"
            className="range"
            min={LOAN_LIMITS.minTerm}
            max={LOAN_LIMITS.maxTerm}
            value={term}
            onChange={(e) => setTerm(Number(e.target.value))}
            style={fillPercent(term, LOAN_LIMITS.minTerm, LOAN_LIMITS.maxTerm)}
          />
        </label>

        <label className="field">
          <span>Purpose</span>
          <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </Card>

      <Card tone="accent" className="quote">
        <span className="eyebrow">Monthly payment</span>
        <span className="quote__amount">{formatMoney(quote.payment)}</span>
        <dl className="quote__grid">
          <div>
            <dt>Interest rate</dt>
            <dd>{quote.annualRate}% p.a.</dd>
          </div>
          <div>
            <dt>Total interest</dt>
            <dd>{formatMoney(quote.totalInterest)}</dd>
          </div>
          <div>
            <dt>Total payable</dt>
            <dd>{formatMoney(quote.totalPayable)}</dd>
          </div>
        </dl>
      </Card>

      <p className="muted small">
        Fixed rate for the whole loan. Late installments are charged a daily penalty —{' '}
        <Link to="/faq#interest" className="link">
          how interest and penalties work
        </Link>
        .
      </p>

      {overBudget && (
        <p className="alert alert--warning">
          This payment is more than {AFFORDABILITY_RATIO * 100}% of your monthly income. Consider a smaller amount or
          longer term.
        </p>
      )}

      <Card className="stack">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={withCard}
            onChange={(e) => {
              setWithCard(e.target.checked)
              if (e.target.checked && !card) setCard(atmCard)
            }}
          />
          <span>
            <strong>Offer my ATM card as collateral</strong> (optional)
            <br />
            <span className="muted small">
              You hand the card to a Witik cashier when your loan is released and get it back when it's fully paid.
            </span>
          </span>
        </label>
        {withCard && (
          <div className="stack collateral-option">
            <AtmCardFields value={atmCard} onChange={setCard} />
            <PinWarning />
          </div>
        )}
      </Card>

      <Card className="stack">
        <h2 className="h3">Loan agreement</h2>
        <p className="muted small">
          Read the agreement for the loan above. If you change the amount, term or purpose, it updates and you'll need
          to read it again.
        </p>
        <ContractConsent
          key={termsKey}
          terms={{
            borrowerName: profile?.full_name ?? '',
            borrowerEmail: user?.email ?? '',
            amount,
            termMonths: term,
            annualRate: quote.annualRate,
            purpose,
          }}
          agreed={agreed}
          onAgreedChange={(yes) => setAgreedTo(yes ? termsKey : null)}
        />
      </Card>

      {error && <p className="alert alert--error">{error}</p>}

      <Button type="submit" block loading={busy} disabled={!agreed || !profileComplete || (withCard && !isAtmCardComplete(atmCard))}>
        Submit application
      </Button>
    </form>
  )
}
