import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'
import { affordableAmount, formatMoney, LOAN_LIMITS } from '../lib/loan.ts'
import { formatDateTime } from '../lib/staff.ts'
import type { Profile } from '../lib/types.ts'
import { Button } from './Button.tsx'
import { Card } from './Card.tsx'

/**
 * Admin-only: offer a borrower a specific amount. The offer shows on their home
 * screen and caps what they can apply for (enforced in the database).
 */
export function AdminLoanOffer({ profile, onChanged }: { profile: Profile; onChanged: (message: string) => Promise<void> }) {
  const current = profile.offer_amount === null ? null : Number(profile.offer_amount)
  const [amount, setAmount] = useState(current === null ? '' : String(current))
  const [note, setNote] = useState(profile.offer_note ?? '')
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const income = Number(profile.monthly_income ?? 0)
  const estimate = income > 0 ? affordableAmount(income, 12) : null
  const value = Number(amount)
  const valid =
    amount !== '' &&
    value >= LOAN_LIMITS.minAmount &&
    value <= LOAN_LIMITS.maxAmount &&
    value % LOAN_LIMITS.amountStep === 0

  async function save(next: number | null) {
    setBusy(next === null ? 'remove' : 'save')
    setError(null)
    const { error } = await supabase.rpc('admin_set_loan_offer', {
      p_user_id: profile.id,
      p_amount: next,
      p_note: next === null ? null : note,
    })
    setBusy(null)
    if (error) return setError(error.message)
    if (next === null) {
      setAmount('')
      setNote('')
    }
    await onChanged(next === null ? 'Loan offer removed.' : `Loan offer of ${formatMoney(next, true)} saved.`)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid) void save(value)
  }

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="h3">Loan offer</h2>
        {current !== null && profile.offer_set_at && (
          <span className="muted small">Set {formatDateTime(profile.offer_set_at)}</span>
        )}
      </div>
      <p className="muted small">
        {current === null
          ? 'No offer yet. The borrower sees an estimate based on their income and can apply for any amount.'
          : `The borrower is offered up to ${formatMoney(current, true)} and can't apply for more.`}
        {estimate !== null && ` Income-based estimate: ${formatMoney(estimate, true)} over 12 months.`}
      </p>

      {error && <p className="alert alert--error">{error}</p>}

      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>
            Amount ({formatMoney(LOAN_LIMITS.minAmount, true)}–{formatMoney(LOAN_LIMITS.maxAmount, true)}, steps of{' '}
            {LOAN_LIMITS.amountStep})
          </span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={LOAN_LIMITS.minAmount}
            max={LOAN_LIMITS.maxAmount}
            step={LOAN_LIMITS.amountStep}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Message to the borrower (optional)</span>
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="button-row">
          <Button type="submit" loading={busy === 'save'} disabled={!valid || busy !== null}>
            {current === null ? 'Make offer' : 'Update offer'}
          </Button>
          {current !== null && (
            <Button
              variant="ghost"
              loading={busy === 'remove'}
              disabled={busy !== null}
              onClick={() => window.confirm('Remove this loan offer?') && void save(null)}
            >
              Remove offer
            </Button>
          )}
        </div>
      </form>
    </Card>
  )
}
